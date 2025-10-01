/**
 * Candide Guardian Recovery Service Example
 * 
 * Demonstrates: Safe account setup with Candide Guardian integration for simplified recovery.
 * Shows registration with both email and SMS, verification, and recovery request flow using 
 * Candide's managed guardian service that handles guardian signatures automatically.
 * 
 * See README.md for detailed workflow explanation and setup instructions.
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
import { RecoveryByCustodialGuardian, RecoveryByGuardian } from "safe-recovery-service-sdk";
import * as dotenv from 'dotenv';
import * as readline from 'readline';

// Create readline interface for user input
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function askQuestion(question: string): Promise<string> {
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            resolve(answer);
        });
    });
}

async function main() {
    dotenv.config();

    // Validate required environment variables (USER_PHONE only needed if SMS is selected)
    const requiredEnvVars = ['CHAIN_ID', 'RECOVERY_SERVICE_URL', 'BUNDLER_URL', 'NODE_URL', 'PAYMASTER_URL', 'USER_EMAIL'];
    const missing = requiredEnvVars.filter(v => !process.env[v]);
    if (missing.length > 0) {
        throw new Error(`Missing required environment variables: ${missing.join(', ')}. Please check your .env file.`);
    }

    // Environment variables - set these in your .env file
    const chainId = BigInt(process.env.CHAIN_ID as string);
    const serviceUrl = process.env.RECOVERY_SERVICE_URL as string;
    const bundlerUrl = process.env.BUNDLER_URL as string;
    const nodeUrl = process.env.NODE_URL as string;
    const paymasterUrl = process.env.PAYMASTER_URL as string;
    const userEmail = process.env.USER_EMAIL as string;
    const userPhone = process.env.USER_PHONE as string; // Format: +1234567890

    console.log("Candide Guardian Recovery Example");
    console.log("=================================\n");

    // --------- 1. Setup Safe Account ---------
    console.log("Step 1: Setting up Safe Account");

    const ownerPrivateKey = generatePrivateKey();
    const ownerAccount = privateKeyToAccount(ownerPrivateKey);
    const smartAccount = SafeAccountV0_3_0.initializeNewAccount([ownerAccount.address]);
    
    console.log(`Safe Account: ${smartAccount.accountAddress}`);
    console.log(`Owner: ${ownerAccount.address}`);

    // Deploy Safe with recovery module
    console.log("\nDeploying Safe with Recovery Module...");
    
    const srm = new SocialRecoveryModule(SocialRecoveryModuleGracePeriodSelector.After3Minutes);
    const enableModuleTx = srm.createEnableModuleMetaTransaction(smartAccount.accountAddress);
    const paymaster = new CandidePaymaster(paymasterUrl);
    
    let userOperation = await smartAccount.createUserOperation([enableModuleTx], nodeUrl, bundlerUrl);
    const [paymasterUserOperation, _sponsorMetadata] = await paymaster.createSponsorPaymasterUserOperation(userOperation, bundlerUrl);
    userOperation = paymasterUserOperation;
    userOperation.signature = smartAccount.signUserOperation(userOperation, [ownerPrivateKey], chainId);
    
    const deployResponse = await smartAccount.sendUserOperation(userOperation, bundlerUrl);
    const deployResult = await deployResponse.included();
    
    if (!deployResult.success) {
        console.log("Safe deployment failed");
        rl.close();
        return;
    }
    console.log("Safe deployed successfully");

    // --------- 2. Register with Candide Guardian ---------
    console.log("\nStep 2: Register with Candide Guardian Service");
    
    const custodialGuardianService = new RecoveryByCustodialGuardian(serviceUrl, chainId);
    
    console.log("Choose your recovery verification methods:");
    console.log("1. Email only");
    console.log("2. SMS only");
    console.log("3. Both email and SMS (more secure)");
    
    const methodChoice = await askQuestion("Enter choice (1-3): ");
    const choice = parseInt(methodChoice);
    
    if (choice < 1 || choice > 3) {
        console.log("Invalid choice");
        rl.close();
        return;
    }
    
    const enableEmail = choice === 1 || choice === 3;
    const enableSms = choice === 2 || choice === 3;
    
    console.log(`Selected: ${enableEmail ? 'Email' : ''}${enableEmail && enableSms ? ' + ' : ''}${enableSms ? 'SMS' : ''}`);

    let candideGuardianAddress: string = '';
    
    // --------- 6. Register Email (if selected) ---------
    if (enableEmail) {
        console.log("\nStep 6a: Registering email with Candide Guardian Service");

        // Generate SIWE message for email registration
        const emailRegistrationSiweMessage = custodialGuardianService.createRegistrationToEmailRecoverySiweStatementToSign(
            smartAccount.accountAddress,
            userEmail
        );

        console.log("SIWE message for email registration:", emailRegistrationSiweMessage);

        // Create EIP-1271 signature using Safe message format
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

        // Build signature for single-owner Safe
        const emailRegistrationSignature = SafeAccountV0_3_0.buildSignaturesFromSingerSignaturePairs([
            { signer: ownerAccount.address, signature: emailOwnerSignature }
        ]);

        // Create email registration
        const emailRegistrationChallengeId = await custodialGuardianService.createRegistrationToEmailRecovery(
            smartAccount.accountAddress,
            userEmail,
            emailRegistrationSiweMessage,
            emailRegistrationSignature
        );

        console.log("Email registration challenge created:", emailRegistrationChallengeId);
        console.log(`Check your email (${userEmail}) for OTP verification code`);

        // Verify Email Registration
        console.log("\nStep 6b: Verifying email registration with OTP");

        const emailOtpCode = await askQuestion("Enter the OTP code from your email: ");

        const emailRegistrationResult = await custodialGuardianService.submitRegistrationChallenge(
            emailRegistrationChallengeId,
            emailOtpCode
        );

        console.log("Email registration successful!");
        console.log("Email registration ID:", emailRegistrationResult.registrationId);
        console.log("Candide Guardian address:", emailRegistrationResult.guardianAddress);

        candideGuardianAddress = emailRegistrationResult.guardianAddress;
    }

    // --------- 7. Register SMS (if selected) ---------
    if (enableSms) {
        console.log("\nStep 7a: Registering SMS with Candide Guardian Service");

        // Generate SIWE message for SMS registration
        const smsRegistrationSiweMessage = custodialGuardianService.createRegistrationToSmsRecoverySiweStatementToSign(
            smartAccount.accountAddress,
            userPhone
        );

        console.log("SIWE message for SMS registration:", smsRegistrationSiweMessage);

        // Create EIP-1271 signature using Safe message format
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

        // Build signature for single-owner Safe
        const smsRegistrationSignature = SafeAccountV0_3_0.buildSignaturesFromSingerSignaturePairs([
            { signer: ownerAccount.address, signature: smsOwnerSignature }
        ]);

        // Create SMS registration
        const smsRegistrationChallengeId = await custodialGuardianService.createRegistrationToSmsRecovery(
            smartAccount.accountAddress,
            userPhone,
            smsRegistrationSiweMessage,
            smsRegistrationSignature
        );

        console.log("SMS registration challenge created:", smsRegistrationChallengeId);
        console.log(`Check your phone (${userPhone}) for SMS OTP verification code`);

        // Verify SMS Registration
        console.log("\nStep 7b: Verifying SMS registration with OTP");

        const smsOtpCode = await askQuestion("Enter the OTP code from your SMS: ");

        const smsRegistrationResult = await custodialGuardianService.submitRegistrationChallenge(
            smsRegistrationChallengeId,
            smsOtpCode
        );

        console.log("SMS registration successful!");
        console.log("SMS registration ID:", smsRegistrationResult.registrationId);
        
        // Set guardian address from SMS registration if email wasn't registered
        if (!enableEmail) {
            candideGuardianAddress = smsRegistrationResult.guardianAddress;
        }
    }

    // --------- 8. Add Candide Guardian to Safe ---------
    console.log("\nStep 8: Adding Candide Guardian to Safe");
    
    if (!candideGuardianAddress) {
        console.log("Error: No Candide Guardian address obtained from registration");
        rl.close();
        return;
    }

    // Create transaction to add guardian
    const addGuardianTx = srm.createAddGuardianWithThresholdMetaTransaction(
        candideGuardianAddress,
        1n // Set guardian threshold to 1 (only need Candide Guardian for recovery)
    );

    // Create and execute user operation
    userOperation = await smartAccount.createUserOperation(
        [addGuardianTx],
        nodeUrl,
        bundlerUrl
    );

    const [paymasterUserOperation2, _sponsorMetadata2] = await paymaster.createSponsorPaymasterUserOperation(
        userOperation,
        bundlerUrl
    );
    userOperation = paymasterUserOperation2;

    // Sign and send the user operation
    userOperation.signature = smartAccount.signUserOperation(
        userOperation,
        [ownerPrivateKey],
        chainId
    );

    console.log("Adding Candide Guardian to Safe...");
    const addGuardianResponse = await smartAccount.sendUserOperation(userOperation, bundlerUrl);

    console.log("Waiting for guardian addition transaction...");
    const addGuardianResult = await addGuardianResponse.included();

    if (addGuardianResult.success) {
        console.log("Candide Guardian successfully added. Transaction hash:", addGuardianResult.receipt.transactionHash);
    } else {
        console.log("Failed to add Candide Guardian");
        rl.close();
        return;
    }

    // --------- 9. Initiate Recovery with Candide Guardian ---------
    console.log("\nStep 9: Initiating recovery with Candide Guardian");
    console.log("Scenario: Owner lost access, initiating recovery to new owner");

    const newOwnerPrivateKey = generatePrivateKey();
    const newOwner = privateKeyToAccount(newOwnerPrivateKey);
    console.log("New owner (recovery target):", newOwner.address);

    // Request Candide Guardian signature for recovery
    const signatureRequest = await custodialGuardianService.requestCustodialGuardianSignatureChallenge(
        smartAccount.accountAddress,
        [newOwner.address],
        1 // New threshold
    );

    console.log("Recovery signature request created");
    console.log("Request ID:", signatureRequest.requestId);
    console.log("Authentication challenges available:", signatureRequest.auths.length);

    // Show required verification methods (all registered channels)
    console.log("Required verification methods (majority threshold):");
    signatureRequest.auths.forEach((auth, index) => {
        console.log(`  ${index + 1}. ${auth.channel} (${auth.target})`);
    });
    console.log("\nYou must verify ALL registered channels to complete recovery.");

    // --------- 10. Verify All Recovery Channels ---------
    console.log("\nStep 10: Verifying recovery request with all registered channels");

    let verificationResult;
    
    for (const auth of signatureRequest.auths) {
        console.log(`\nVerifying ${auth.channel} (${auth.target})...`);
        console.log(`Check your ${auth.channel} for recovery verification OTP`);
        
        const recoveryOtpCode = await askQuestion(`Enter the recovery OTP code from your ${auth.channel}: `);

        verificationResult = await custodialGuardianService.submitCustodialGuardianSignatureChallenge(
            signatureRequest.requestId,
            auth.challengeId,
            recoveryOtpCode
        );

        if (verificationResult.success) {
            console.log(`${auth.channel} verification successful!`);
        } else {
            console.log(`${auth.channel} verification failed`);
            rl.close();
            return;
        }
    }

    console.log("\nAll recovery verifications completed successfully!");
    console.log("Candide Guardian signature obtained");
    
    if (!verificationResult || !verificationResult.custodianGuardianAddress || !verificationResult.custodianGuardianSignature) {
        console.log("Error: Failed to obtain valid guardian signature");
        rl.close();
        return;
    }

    // --------- 11. Execute Recovery ---------
    console.log("\nStep 1: Executing recovery with Candide Guardian");

    const recoveryRequest = await custodialGuardianService.createAndExecuteRecoveryRequest(
        smartAccount.accountAddress,
        [newOwner.address],
        1,
        verificationResult.custodianGuardianAddress as string,
        verificationResult.custodianGuardianSignature as string
    );

    console.log(`Recovery executed (ID: ${recoveryRequest.id})`);

    // --------- 12. Wait for Grace Period and Finalize ---------
    console.log("\nStep 12: Waiting for grace period and finalizing recovery");
    console.log("Grace period: 3 minutes (for demo purposes)");

    console.log("Waiting for 3-minute grace period...");
    await new Promise(resolve => setTimeout(resolve, 4 * 60 * 1000)); // 4 minutes

    // Initialize recovery service for finalization
    const recoveryService = new RecoveryByGuardian(
        serviceUrl,
        chainId,
        SocialRecoveryModuleGracePeriodSelector.After3Minutes
    );

    const finalizationResult = await recoveryService.finalizeRecoveryRequest(recoveryRequest.id);

    if (finalizationResult) {
        console.log("Recovery successfully finalized!");

        // Wait a moment for blockchain confirmation
        await new Promise(resolve => setTimeout(resolve, 30 * 1000)); // 30 seconds

        // Verify new owners
        const newOwners = await smartAccount.getOwners(nodeUrl);
        console.log("New Safe owners:", newOwners);
        console.log("Recovery completed - Safe now controlled by:", newOwner.address);
    } else {
        console.log("Recovery finalization failed");
    }

    // --------- 13. Summary ---------
    console.log("\nCandide Guardian Recovery Complete!");
    console.log("=====================================");
    console.log("Safe Account:", smartAccount.accountAddress);
    console.log("Original owner:", ownerAccount.address);
    console.log("Candide Guardian:", candideGuardianAddress);
    console.log("Recovery target:", newOwner.address);
    console.log(`Registered channels: ${enableEmail ? 'Email' : ''}${enableEmail && enableSms ? ' + ' : ''}${enableSms ? 'SMS' : ''}`);
    console.log(`Recovery verification: All registered channels (majority threshold)`);
    console.log("");
    console.log("Key benefits demonstrated:");
    console.log("• User choice in verification methods during setup");
    console.log("• Majority threshold security (all channels must be verified)");
    console.log("• No need to manage personal guardian keys");
    console.log("• Automated guardian signature generation");
    console.log("• Service-managed recovery execution");
    console.log("• Simple single-owner Safe setup");

    rl.close();
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(`\nError: ${error.message || error}`);
        rl.close();
        process.exit(1);
    });