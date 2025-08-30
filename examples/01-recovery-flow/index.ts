/**
 * Complete Safe Recovery Service workflow example
 * 
 * Demonstrates: Safe account setup, guardian-based recovery with emoji authentication,
 * off-chain signature collection, and service-managed execution/finalization.
 * 
 * See README.md for detailed workflow explanation and setup instructions.
 */

import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { TypedDataDomain } from 'viem';
import {
    CandidePaymaster,
    EXECUTE_RECOVERY_PRIMARY_TYPE,
    SafeAccountV0_3_0,
    SocialRecoveryModule,
    SocialRecoveryModuleGracePeriodSelector,
} from "abstractionkit";
import { RecoveryByGuardian } from "safe-recovery-service-sdk";
import * as dotenv from 'dotenv';

async function main() {
    dotenv.config();

    // Environment variables - set these in your .env file
    const chainId = BigInt(process.env.CHAIN_ID as string);
    const serviceUrl = process.env.RECOVERY_SERVICE_URL as string;
    const bundlerUrl = process.env.BUNDLER_URL as string;
    const nodeUrl = process.env.NODE_URL as string;
    const paymasterUrl = process.env.PAYMASTER_URL as string;

    console.log("Starting Safe Recovery Flow Example");
    console.log(`Chain ID: ${chainId}`);

    // --------- 1. Create accounts ---------
    console.log("\nStep 1: Creating accounts");

    const ownerPrivateKey = generatePrivateKey();
    const ownerAccount = privateKeyToAccount(ownerPrivateKey);
    console.log("Original owner:", ownerAccount.address);

    const newOwnerPrivateKey = generatePrivateKey();
    const newOwner = privateKeyToAccount(newOwnerPrivateKey);
    console.log("New owner (recovery target):", newOwner.address);

    const guardian1PrivateKey = generatePrivateKey();
    const guardian1Account = privateKeyToAccount(guardian1PrivateKey);

    const guardian2PrivateKey = generatePrivateKey();
    const guardian2Account = privateKeyToAccount(guardian2PrivateKey);

    // --------- 2. Create Safe Account ---------
    console.log("\nStep 2: Creating Safe Account");

    const smartAccount = SafeAccountV0_3_0.initializeNewAccount([ownerAccount.address]);
    console.log("Safe account address:", smartAccount.accountAddress);

    // --------- 3. Setup Recovery Module and Guardians ---------
    console.log("\nStep 3: Setting up Recovery Module and Guardians");

    const srm = new SocialRecoveryModule(SocialRecoveryModuleGracePeriodSelector.After3Minutes);
    console.log("Recovery module address:", SocialRecoveryModuleGracePeriodSelector.After3Minutes);

    // Create transactions to enable module and add guardians
    const enableModuleTx = srm.createEnableModuleMetaTransaction(smartAccount.accountAddress);

    const addGuardian1Tx = srm.createAddGuardianWithThresholdMetaTransaction(
        guardian1Account.address,
        1n // Set threshold to 1 after adding first guardian
    );

    const addGuardian2Tx = srm.createAddGuardianWithThresholdMetaTransaction(
        guardian2Account.address,
        2n // Set threshold to 2 after adding second guardian (both guardians needed)
    );

    // Create and execute user operation
    let userOperation = await smartAccount.createUserOperation(
        [enableModuleTx, addGuardian1Tx, addGuardian2Tx],
        nodeUrl,
        bundlerUrl
    );

    // Use paymaster for sponsored transaction
    const paymaster = new CandidePaymaster(paymasterUrl);
    const [paymasterUserOperation, _sponsorMetadata] = await paymaster.createSponsorPaymasterUserOperation(
        userOperation,
        bundlerUrl
    );
    userOperation = paymasterUserOperation;

    // Sign and send the user operation
    userOperation.signature = smartAccount.signUserOperation(
        userOperation,
        [ownerPrivateKey],
        chainId
    );

    console.log("Sending setup transaction...");
    const sendUserOperationResponse = await smartAccount.sendUserOperation(userOperation, bundlerUrl);

    console.log("Waiting for setup transaction to be included...");
    const userOperationReceiptResult = await sendUserOperationResponse.included();

    if (userOperationReceiptResult.success) {
        console.log("Recovery module and guardians successfully set up. Transaction hash:", userOperationReceiptResult.receipt.transactionHash)
    } else {
        console.log("Useroperation execution failed")
    }

    // --------- 4. Create Recovery Request ---------
    // Using 3-minute grace period for demo purposes (use longer periods in production)
    const recoveryService = new RecoveryByGuardian(
        serviceUrl,
        chainId,
        SocialRecoveryModuleGracePeriodSelector.After3Minutes
    );
    console.log("\nStep 4: Creating Recovery Request");

    // Get EIP-712 data for recovery request
    const recoveryRequestEip712Data = await srm.getRecoveryRequestEip712Data(
        nodeUrl,
        chainId,
        smartAccount.accountAddress,
        [newOwner.address],
        1n // New threshold
    );

    // First guardian signs the recovery request
    const guardian1Signature = await guardian1Account.signTypedData({
        primaryType: EXECUTE_RECOVERY_PRIMARY_TYPE,
        domain: recoveryRequestEip712Data.domain as TypedDataDomain,
        types: recoveryRequestEip712Data.types,
        message: recoveryRequestEip712Data.messageValue
    });

    // Create the recovery request
    const recoveryRequest = await recoveryService.createRecoveryRequest(
        smartAccount.accountAddress,
        [newOwner.address],
        1, // New threshold
        guardian1Account.address,
        guardian1Signature
    );

    console.log("Recovery request created with ID:", recoveryRequest.id);
    console.log("Recovery Status:", recoveryRequest.status);
    console.log("IMPORTANT - Emoji for guardian coordination:", recoveryRequest.emoji);
    console.log("The initiating guardian should communicate this emoji to other guardians through secure channels");
    console.log("Other guardians should verify this emoji matches before signing to prevent unauthorized recovery");

    // --------- 5. Add Second Guardian Signature ---------
    console.log("\nStep 5: Adding second guardian signature");

    // Second guardian signs the same recovery request
    const guardian2Signature = await guardian2Account.signTypedData({
        primaryType: EXECUTE_RECOVERY_PRIMARY_TYPE,
        domain: recoveryRequestEip712Data.domain as TypedDataDomain,
        types: recoveryRequestEip712Data.types,
        message: recoveryRequestEip712Data.messageValue
    });

    // Submit the second guardian's signature
    const signatureSubmitted = await recoveryService.submitGuardianSignatureForRecoveryRequest(
        recoveryRequest.id,
        guardian2Account.address,
        guardian2Signature
    );

    console.log("Second guardian signature submitted to Recovery Service:", signatureSubmitted);

    // --------- 6. SERVICE-HANDLED EXECUTION ---------
    console.log("\nStep 6: Service-Handled Recovery Execution");

    const executionResult = await recoveryService.executeRecoveryRequest(recoveryRequest.id);
    console.log("Recovery execution request sent to service:", executionResult);

    console.log("Waiting for transaction to be included...")
    await new Promise(resolve => setTimeout(resolve, 1 * 30 * 1000)); // 30 seconds

    // Check execution status
    const executedRequest = await recoveryService.getExecutedRecoveryRequestForLatestNonce(
        nodeUrl,
        smartAccount.accountAddress
    );

    if (executedRequest && executedRequest.status === "EXECUTED") {
        console.log("Recovery request successfully executed!");
        console.log("Recovery ID:", executedRequest.id);
        console.log("Recovery execution transaction hash:", executedRequest.executeData.transactionHash)
    } else {
        console.log("Recovery execution failed or still pending");
        return;
    }

    // --------- 7. SERVICE-HANDLED FINALIZATION ---------
    console.log("\nStep 7: Service-Handled Recovery Finalization");

    console.log("Waiting for 3-minute grace period...");
    await new Promise(resolve => setTimeout(resolve, 3 * 60 * 1000)); // 3 minutes

    // Finalize the recovery
    const finalizationResult = await recoveryService.finalizeRecoveryRequest(recoveryRequest.id);
    console.log("Recovery finalization request sent to service:", finalizationResult);

    console.log("Waiting for transaction to be included...")

    await new Promise(resolve => setTimeout(resolve, 1 * 30 * 1000)); // 30 seconds

    console.log("Recovery Finilzation transaction hash:", recoveryRequest.finalizeData.transactionHash);

    // Check final status
    const finalizedRequest = await recoveryService.getFinalizedRecoveryRequestForLatestNonce(
        nodeUrl,
        smartAccount.accountAddress
    );

    if (finalizedRequest && finalizedRequest.status === "FINALIZED") {
        console.log("Safe account recovered to new owner:", newOwner.address);
        console.log("Recovery ID:", finalizedRequest.id);

        // Verify no more pending/executed requests
        const pendingRequests = await recoveryService.getPendingRecoveryRequestsForLatestNonce(
            nodeUrl,
            smartAccount.accountAddress
        );

        console.log("Pending requests:", pendingRequests.length);
    } else {
        console.log("Recovery finalization failed or still pending");
    }

    console.log("\nRecovery flow example completed!");
}

// Error handling wrapper
main()
    .then(() => {
        process.exit(0);
    })
    .catch((error) => {
        console.error("Error occurred:", error);
        process.exit(1);
    });