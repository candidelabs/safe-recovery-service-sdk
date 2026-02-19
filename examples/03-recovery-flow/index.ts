/**
 * Example 03: Recovery Flow (Candide Guardian)
 *
 * Demonstrates: Triggering a recovery for a Safe account that already has the Candide
 * Guardian registered (from Example 01). The Candide Guardian service handles the guardian
 * signature automatically after you verify your identity via OTP on your registered channels.
 *
 * Recovery status progression: PENDING → EXECUTED → FINALIZED
 * A grace period exists between EXECUTED and FINALIZED so the original owner can cancel
 * an unauthorized recovery attempt before ownership permanently transfers.
 *
 * Prerequisites:
 *   - Run Example 01 first (Safe deployed, Candide Guardian registered and added on-chain)
 *   - Fill in .env: CHAIN_ID, RECOVERY_SERVICE_URL, NODE_URL, SAFE_ACCOUNT_ADDRESS
 *
 * Expected duration: ~10 minutes (includes the 3-minute grace period for testing)
 */

import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import {
    SafeAccountV0_3_0,
    SocialRecoveryModuleGracePeriodSelector,
} from "abstractionkit";
import { RecoveryByCustodialGuardian, RecoveryByGuardian, SafeRecoveryServiceSdkError } from "safe-recovery-service-sdk";
import * as dotenv from 'dotenv';
import * as readline from 'readline';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function askQuestion(question: string): Promise<string> {
    return new Promise((resolve) => rl.question(question, resolve));
}

async function main() {
    dotenv.config();

    console.log("Recovery Flow (Candide Guardian) — Example 03");
    console.log("===============================================\n");

    const requiredEnvVars = [
        'CHAIN_ID', 'RECOVERY_SERVICE_URL', 'NODE_URL', 'SAFE_ACCOUNT_ADDRESS'
    ];
    const missing = requiredEnvVars.filter(v => !process.env[v]);
    if (missing.length > 0) {
        throw new Error(`Missing required environment variables: ${missing.join(', ')}. Please check your .env file.`);
    }

    const chainId = BigInt(process.env.CHAIN_ID as string);
    const serviceUrl = process.env.RECOVERY_SERVICE_URL as string;
    const nodeUrl = process.env.NODE_URL as string;
    const safeAccountAddress = process.env.SAFE_ACCOUNT_ADDRESS as string;

    // newOwnerAccount is the recovery target — generated fresh each run
    const newOwnerPrivateKey = generatePrivateKey();
    const newOwnerAccount = privateKeyToAccount(newOwnerPrivateKey);

    console.log(`Safe Account:           ${safeAccountAddress}`);
    console.log(`New owner (target):     ${newOwnerAccount.address}\n`);

    const custodialGuardianService = new RecoveryByCustodialGuardian(serviceUrl, chainId);

    // Request a signature challenge from the Candide Guardian Service.
    // This identifies the new owners and threshold, and returns the registered
    // channels that must be verified before the guardian will sign.
    const signatureRequest = await custodialGuardianService.requestCustodialGuardianSignatureChallenge(
        safeAccountAddress,
        [newOwnerAccount.address],
        1 // new threshold
    );

    console.log("Registered channels to verify:");
    signatureRequest.auths.forEach((auth, i) => {
        console.log(`  ${i + 1}. ${auth.channel} — ${auth.target}`);
    });
    console.log("\nAll channels must be verified to complete recovery.");

    // Verify identity on each registered channel via OTP
    let verificationResult;

    for (const auth of signatureRequest.auths) {
        const recoveryOtpCode = await askQuestion(`\nOTP sent to ${auth.target} — enter code: `);

        verificationResult = await custodialGuardianService.submitCustodialGuardianSignatureChallenge(
            signatureRequest.requestId,
            auth.challengeId,
            recoveryOtpCode
        );

        if (verificationResult.success) {
            console.log(`${auth.channel} verified.`);
        } else {
            console.log(`${auth.channel} verification failed`);
            rl.close();
            return;
        }
    }

    if (!verificationResult || !verificationResult.custodianGuardianAddress || !verificationResult.custodianGuardianSignature) {
        console.log("Error: Failed to obtain valid guardian signature");
        rl.close();
        return;
    }

    // Execute recovery. The Candide Guardian service submits the recovery transaction
    // on-chain using its signature. Status: PENDING → EXECUTED → FINALIZED
    console.log("\nExecuting recovery...");

    const recoveryRequest = await custodialGuardianService.createAndExecuteRecoveryRequest(
        safeAccountAddress,
        [newOwnerAccount.address],
        1,
        verificationResult.custodianGuardianAddress as string,
        verificationResult.custodianGuardianSignature as string
    );

    console.log(`Recovery executed. Status: ${recoveryRequest.status}`);

    // Wait for the grace period. This window gives the original owner time to cancel
    // an unauthorized recovery. For testing we use 3 minutes; production modules
    // use 3, 7, or 14 days.
    console.log("\nWaiting 3-minute grace period (the original owner can cancel during this window)...");
    await new Promise(resolve => setTimeout(resolve, 4 * 60 * 1000));

    // Finalize recovery
    console.log("Finalizing recovery...");

    const recoveryService = new RecoveryByGuardian(
        serviceUrl,
        chainId,
        SocialRecoveryModuleGracePeriodSelector.After3Minutes
    );

    const finalizationResult = await recoveryService.finalizeRecoveryRequest(recoveryRequest.id);

    if (!finalizationResult) {
        console.log("Recovery finalization failed");
        rl.close();
        return;
    }

    // Wait for on-chain confirmation before querying owners
    await new Promise(resolve => setTimeout(resolve, 30 * 1000));

    // Verify new owners on-chain
    const smartAccount = new SafeAccountV0_3_0(safeAccountAddress);
    const newOwners = await smartAccount.getOwners(nodeUrl);

    console.log("\nRecovery complete!");
    console.log(`Safe Account: ${safeAccountAddress}`);
    console.log(`New owners:   ${newOwners.join(", ")}`);

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

// =============================================================================
// ALTERNATIVE: Manual Guardian Recovery
// =============================================================================
//
// If instead of Candide's custodial guardian you want to use your own guardian
// keys (EOA wallets you control), use the RecoveryByGuardian class directly:
//
//   const recoveryService = new RecoveryByGuardian(serviceUrl, chainId, gracePeriodSelector);
//
// Typical flow:
//   1. Collect EIP-712 guardian signatures off-chain:
//        const eip712Data = await srm.getRecoveryRequestEip712Data(nodeUrl, chainId, safeAddress, newOwners, threshold);
//        const sig = await guardianAccount.signTypedData({ primaryType: EXECUTE_RECOVERY_PRIMARY_TYPE, ...eip712Data });
//   2. Submit the first guardian's signature to create the request:
//        const request = await recoveryService.createRecoveryRequest(safeAddress, newOwners, threshold, guardian1.address, sig1);
//        // Note the request.emoji — all other guardians should verify it matches via a secure channel
//   3. Collect and submit remaining guardian signatures:
//        await recoveryService.submitGuardianSignatureForRecoveryRequest(request.id, guardian2.address, sig2);
//   4. Trigger execution once threshold is met:
//        await recoveryService.executeRecoveryRequest(request.id);
//   5. Wait for the grace period, then finalize:
//        await recoveryService.finalizeRecoveryRequest(request.id);
//   6. Verify on-chain:
//        await smartAccount.getOwners(nodeUrl);
//
// Key methods: createRecoveryRequest(), submitGuardianSignatureForRecoveryRequest(),
//              executeRecoveryRequest(), finalizeRecoveryRequest(),
//              getRecoveryRequestsForLatestNonce(), getPendingRecoveryRequestsForLatestNonce()
