/**
 * Example 01: Enable Email/SMS Recovery
 *
 * Demonstrates: Deploying a Safe account with the Social Recovery Module, registering
 * email and/or SMS channels with the Candide Guardian Service (OTP verification), and
 * adding the Candide Guardian on-chain so it can authorise future recovery requests.
 *
 * Prerequisites:
 *   - Fill in .env (see .env.example): CHAIN_ID, RECOVERY_SERVICE_URL, BUNDLER_URL,
 *     NODE_URL, PAYMASTER_URL, SPONSORSHIP_POLICY_ID, USER_EMAIL,
 *     USER_PHONE (optional, only needed for SMS)
 *   - yarn install
 *
 * Expected duration: ~5 minutes (includes OTP round-trips)
 *
 * After this example:
 *   - Copy the printed OWNER_PRIVATE_KEY and SAFE_ACCOUNT_ADDRESS into your .env
 *   - Run Example 02 to set up alert subscriptions
 *   - Run Example 03 to execute a recovery
 */

import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { TypedDataDomain } from 'viem';
import {
    CandidePaymaster,
    getSafeMessageEip712Data,
    SAFE_MESSAGE_PRIMARY_TYPE,
    SafeAccountV0_3_0,
    SocialRecoveryModule,
    SocialRecoveryModuleGracePeriodSelector,
} from "abstractionkit";
import { RecoveryByCustodialGuardian, SafeRecoveryServiceSdkError } from "safe-recovery-service-sdk";
import * as dotenv from 'dotenv';
import * as readline from 'readline';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function askQuestion(question: string): Promise<string> {
    return new Promise((resolve) => rl.question(question, resolve));
}

async function main() {
    dotenv.config();

    console.log("Enable Email/SMS Recovery — Example 01");
    console.log("=======================================\n");

    const requiredEnvVars = [
        'CHAIN_ID', 'RECOVERY_SERVICE_URL', 'BUNDLER_URL', 'NODE_URL',
        'PAYMASTER_URL', 'SPONSORSHIP_POLICY_ID', 'USER_EMAIL'
    ];
    const missing = requiredEnvVars.filter(v => !process.env[v]);
    if (missing.length > 0) {
        throw new Error(`Missing required environment variables: ${missing.join(', ')}. Please check your .env file.`);
    }

    const chainId = BigInt(process.env.CHAIN_ID as string);
    const serviceUrl = process.env.RECOVERY_SERVICE_URL as string;
    const bundlerUrl = process.env.BUNDLER_URL as string;
    const nodeUrl = process.env.NODE_URL as string;
    const paymasterUrl = process.env.PAYMASTER_URL as string;
    const sponsorshipPolicyId = process.env.SPONSORSHIP_POLICY_ID as string;
    const userEmail = process.env.USER_EMAIL as string;
    const userPhone = process.env.USER_PHONE as string; // Format: +1234567890

    // Generate owner key, or reuse from env if already set
    const ownerPrivateKey: `0x${string}` = process.env.OWNER_PRIVATE_KEY
        ? process.env.OWNER_PRIVATE_KEY as `0x${string}`
        : generatePrivateKey();
    const ownerAccount = privateKeyToAccount(ownerPrivateKey);

    // Initialise Safe account address (counterfactual — not yet deployed)
    const smartAccount = SafeAccountV0_3_0.initializeNewAccount([ownerAccount.address]);

    console.log(`Owner:        ${ownerAccount.address}`);
    console.log(`Safe Account: ${smartAccount.accountAddress}\n`);

    // Deploy Safe with the Social Recovery Module enabled
    // Using the 3-minute grace period module for testing; change to After3Days / After7Days / After14Days for production
    const srm = new SocialRecoveryModule(SocialRecoveryModuleGracePeriodSelector.After3Minutes);
    const paymaster = new CandidePaymaster(paymasterUrl);

    // Skip the enableModule meta-transaction if the Safe is already deployed and the module is already enabled
    // (e.g. when re-running this example with a persisted OWNER_PRIVATE_KEY)
    const safeIsDeployed = await SafeAccountV0_3_0.isDeployed(smartAccount.accountAddress, nodeUrl);
    const moduleAlreadyEnabled = safeIsDeployed
        ? await smartAccount.isModuleEnabled(nodeUrl, srm.moduleAddress)
        : false;

    if (moduleAlreadyEnabled) {
        console.log(`Social Recovery Module already enabled (${srm.moduleAddress}) — skipping deploy step\n`);
    } else {
        const enableModuleTx = srm.createEnableModuleMetaTransaction(smartAccount.accountAddress);

        let userOperation = await smartAccount.createUserOperation([enableModuleTx], nodeUrl, bundlerUrl);
        const sponsoredDeploy = await paymaster.createSponsorPaymasterUserOperation(
            smartAccount, userOperation, bundlerUrl, sponsorshipPolicyId
        );
        userOperation = sponsoredDeploy.userOperation;
        userOperation.signature = smartAccount.signUserOperation(userOperation, [ownerPrivateKey], chainId);

        console.log(safeIsDeployed ? "Enabling Social Recovery Module..." : "Deploying Safe...");
        const deployResponse = await smartAccount.sendUserOperation(userOperation, bundlerUrl);
        const deployResult = await deployResponse.included();

        if (!deployResult || !deployResult.success) {
            console.log("Safe deployment / module enablement failed");
            rl.close();
            return;
        }
        console.log(`Done. tx: ${deployResult.receipt.transactionHash}\n`);
    }

    const custodialGuardianService = new RecoveryByCustodialGuardian(serviceUrl, chainId);

    // Choose recovery channels
    console.log("Choose your recovery verification channels:");
    console.log("  1. Email only");
    console.log("  2. SMS only");
    console.log("  3. Both email and SMS (more secure — both must be verified during recovery)");

    const methodChoice = await askQuestion("Enter choice (1-3): ");
    const choice = parseInt(methodChoice);

    if (choice < 1 || choice > 3) {
        console.log("Invalid choice");
        rl.close();
        return;
    }

    const enableEmail = choice === 1 || choice === 3;
    const enableSms = choice === 2 || choice === 3;

    if (enableSms && !userPhone) {
        throw new Error("USER_PHONE is required for SMS registration. Add it to your .env file.");
    }

    // guardianAddress is the same regardless of how many channels are registered —
    // it is a deterministic address derived from your Safe account by the Candide service.
    let candideGuardianAddress: string = '';

    // Register email channel (if selected)
    if (enableEmail) {
        const emailRegistrationSiweMessage = custodialGuardianService.createRegistrationToEmailRecoverySiweStatementToSign(
            smartAccount.accountAddress,
            userEmail
        );

        // EIP-1271 is used here (instead of a plain EOA signMessage) because the Safe contract
        // validates off-chain messages via its own signature scheme. getSafeMessageEip712Data
        // wraps the plain message in the Safe-specific EIP-712 envelope, and
        // buildSignaturesFromSingerSignaturePairs formats the owner signature so the Safe
        // contract can verify it during registration.
        const emailSafeTypedData = getSafeMessageEip712Data(
            smartAccount.accountAddress,
            chainId,
            emailRegistrationSiweMessage
        );

        const emailOwnerSignature = await ownerAccount.signTypedData({
            domain: emailSafeTypedData.domain as TypedDataDomain,
            types: emailSafeTypedData.types,
            primaryType: SAFE_MESSAGE_PRIMARY_TYPE,
            message: emailSafeTypedData.messageValue
        });

        const emailRegistrationSignature = SafeAccountV0_3_0.buildSignaturesFromSingerSignaturePairs([
            { signer: ownerAccount.address, signature: emailOwnerSignature }
        ]);

        const emailRegistrationChallengeId = await custodialGuardianService.createRegistrationToEmailRecovery(
            smartAccount.accountAddress,
            userEmail,
            emailRegistrationSiweMessage,
            emailRegistrationSignature
        );

        const emailOtpCode = await askQuestion(`\nOTP sent to ${userEmail} — enter code: `);

        const emailRegistrationResult = await custodialGuardianService.submitRegistrationChallenge(
            emailRegistrationChallengeId,
            emailOtpCode
        );

        console.log(`Email registered. Guardian: ${emailRegistrationResult.guardianAddress}`);
        candideGuardianAddress = emailRegistrationResult.guardianAddress;
    }

    // Register SMS channel (if selected)
    if (enableSms) {
        const smsRegistrationSiweMessage = custodialGuardianService.createRegistrationToSmsRecoverySiweStatementToSign(
            smartAccount.accountAddress,
            userPhone
        );

        // Same EIP-1271 pattern as email registration above
        const smsSafeTypedData = getSafeMessageEip712Data(
            smartAccount.accountAddress,
            chainId,
            smsRegistrationSiweMessage
        );

        const smsOwnerSignature = await ownerAccount.signTypedData({
            domain: smsSafeTypedData.domain as TypedDataDomain,
            types: smsSafeTypedData.types,
            primaryType: SAFE_MESSAGE_PRIMARY_TYPE,
            message: smsSafeTypedData.messageValue
        });

        const smsRegistrationSignature = SafeAccountV0_3_0.buildSignaturesFromSingerSignaturePairs([
            { signer: ownerAccount.address, signature: smsOwnerSignature }
        ]);

        const smsRegistrationChallengeId = await custodialGuardianService.createRegistrationToSmsRecovery(
            smartAccount.accountAddress,
            userPhone,
            smsRegistrationSiweMessage,
            smsRegistrationSignature
        );

        const smsOtpCode = await askQuestion(`\nOTP sent to ${userPhone} — enter code: `);

        const smsRegistrationResult = await custodialGuardianService.submitRegistrationChallenge(
            smsRegistrationChallengeId,
            smsOtpCode
        );

        console.log("SMS registered.");

        // guardianAddress is the same for email and SMS — just set it if email wasn't registered
        if (!enableEmail) {
            candideGuardianAddress = smsRegistrationResult.guardianAddress;
        }
    }

    // Add Candide Guardian on-chain
    if (!candideGuardianAddress) {
        console.log("Error: No Candide Guardian address obtained from registration");
        rl.close();
        return;
    }

    const guardianAlreadyAdded = await srm.isGuardian(
        nodeUrl, smartAccount.accountAddress, candideGuardianAddress
    );

    if (guardianAlreadyAdded) {
        console.log(`\nCandide Guardian (${candideGuardianAddress}) already added on-chain — skipping`);
    } else {
        const addGuardianTx = srm.createAddGuardianWithThresholdMetaTransaction(
            candideGuardianAddress,
            1n // threshold 1 — only Candide Guardian is required to authorise recovery
        );

        let addGuardianUserOp = await smartAccount.createUserOperation([addGuardianTx], nodeUrl, bundlerUrl);

        const sponsoredAddGuardian = await paymaster.createSponsorPaymasterUserOperation(
            smartAccount, addGuardianUserOp, bundlerUrl, sponsorshipPolicyId
        );
        addGuardianUserOp = sponsoredAddGuardian.userOperation;
        addGuardianUserOp.signature = smartAccount.signUserOperation(addGuardianUserOp, [ownerPrivateKey], chainId);

        console.log("\nAdding Candide Guardian on-chain...");
        const addGuardianResponse = await smartAccount.sendUserOperation(addGuardianUserOp, bundlerUrl);
        const addGuardianResult = await addGuardianResponse.included();

        if (!addGuardianResult || !addGuardianResult.success) {
            console.log("Failed to add Candide Guardian");
            rl.close();
            return;
        }
        console.log(`Guardian added. tx: ${addGuardianResult.receipt.transactionHash}`);
    }

    // Verify setup with getRegistrations()
    const registrationsSiweMessage = custodialGuardianService.getRegistrationsSiweStatementToSign(
        smartAccount.accountAddress
    );

    // Use EIP-1271 here for the same reason as during registration (Safe message verification)
    const registrationsSafeTypedData = getSafeMessageEip712Data(
        smartAccount.accountAddress,
        chainId,
        registrationsSiweMessage
    );

    const registrationsOwnerSignature = await ownerAccount.signTypedData({
        domain: registrationsSafeTypedData.domain as TypedDataDomain,
        types: registrationsSafeTypedData.types,
        primaryType: SAFE_MESSAGE_PRIMARY_TYPE,
        message: registrationsSafeTypedData.messageValue
    });

    const registrationsSignature = SafeAccountV0_3_0.buildSignaturesFromSingerSignaturePairs([
        { signer: ownerAccount.address, signature: registrationsOwnerSignature }
    ]);

    const registrations = await custodialGuardianService.getRegistrations(
        smartAccount.accountAddress,
        registrationsSiweMessage,
        registrationsSignature
    );

    console.log(`\nRegistered channels (${registrations.length}):`);
    registrations.forEach((reg, i) => {
        console.log(`  ${i + 1}. ${reg.channel} — ${reg.target}`);
    });

    console.log("\n========================================");
    console.log("Setup complete! Copy these into your .env:");
    console.log(`  OWNER_PRIVATE_KEY=${ownerPrivateKey}`);
    console.log(`  SAFE_ACCOUNT_ADDRESS=${smartAccount.accountAddress}`);
    console.log("========================================");
    console.log("\nNext:");
    console.log("  yarn dev:alerts-setup       (Example 02)");
    console.log("  yarn dev:recovery-flow      (Example 03)");

    rl.close();
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        if (error instanceof SafeRecoveryServiceSdkError) {
            console.error("\nError:", error.stringify());
        } else {
            console.error("\nError:", error instanceof Error ? error.message : error);
            let cause = error?.cause;
            while (cause) {
                console.error("Caused by:", cause instanceof Error ? cause.message : JSON.stringify(cause));
                cause = cause?.cause;
            }
        }
        rl.close();
        process.exit(1);
    });
