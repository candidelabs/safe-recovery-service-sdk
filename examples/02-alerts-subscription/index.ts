/**
 * Safe Recovery Service Alert System Example
 * 
 * Demonstrates: Safe account setup with recovery module and guardian configuration,
 * followed by setting up email and sms alert subscriptions to monitor recovery events.
 * 
 * See README.md for detailed workflow explanation and setup instructions.
 */

import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import {
    SafeAccountV0_3_0,
    SocialRecoveryModule,
    SocialRecoveryModuleGracePeriodSelector,
    CandidePaymaster,
} from "abstractionkit";
import { Alerts } from "safe-recovery-service-sdk";
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

    // Validate required environment variables
    const requiredEnvVars = ['CHAIN_ID', 'RECOVERY_SERVICE_URL', 'BUNDLER_URL', 'NODE_URL', 'PAYMASTER_URL', 'USER_EMAIL', 'USER_PHONE'];
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
    const userEmail = process.env.USER_EMAIL as string; // Email for alerts
    const userPhone = process.env.USER_PHONE as string; // Phone number for SMS alerts

    console.log("Starting Safe Alerts Subscription Example");
    console.log(`Chain ID: ${chainId}`);

    // --------- 1. Create accounts ---------
    console.log("\nStep 1: Creating accounts");

    const ownerPrivateKey = generatePrivateKey();
    const ownerAccount = privateKeyToAccount(ownerPrivateKey);
    console.log("Safe owner:", ownerAccount.address);

    const guardianPrivateKey = generatePrivateKey();
    const guardianAccount = privateKeyToAccount(guardianPrivateKey);
    console.log("Guardian:", guardianAccount.address);

    // --------- 2. Create Safe Account ---------
    console.log("\nStep 2: Creating Safe Account");

    const smartAccount = SafeAccountV0_3_0.initializeNewAccount([ownerAccount.address]);
    console.log("Safe account address:", smartAccount.accountAddress);

    // --------- 3. Setup Recovery Module and Guardian ---------
    console.log("\nStep 3: Setting up Recovery Module and Guardian");

    const srm = new SocialRecoveryModule(SocialRecoveryModuleGracePeriodSelector.After3Days);
    console.log("Recovery module address:", SocialRecoveryModuleGracePeriodSelector.After3Days);
    console.log("Recovery module type: Social Recovery Module (3-day grace period)");

    // Create transactions to enable module and add guardian
    const enableModuleTx = srm.createEnableModuleMetaTransaction(smartAccount.accountAddress);

    const addGuardianTx = srm.createAddGuardianWithThresholdMetaTransaction(
        guardianAccount.address,
        1n // Set threshold to 1
    );

    // Create and execute user operation
    let userOperation = await smartAccount.createUserOperation(
        [enableModuleTx, addGuardianTx],
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
        console.log("Recovery module and guardian successfully set up. Transaction hash:", userOperationReceiptResult.receipt.transactionHash);
    } else {
        console.log("User operation execution failed");
        rl.close();
        return;
    }

    // --------- 4. Setup Alert System ---------
    console.log("\nStep 4: Setting up Alert System");

    const alertsService = new Alerts(serviceUrl, chainId);
    console.log("Alerts service initialized for chain:", chainId.toString());

    // --------- 5. Create Email Subscription ---------
    console.log("\nStep 5: Creating email alert subscription");

    // Generate SIWE message for creating email subscription
    const emailSubscriptionSiweMessage = alertsService.createEmailSubscriptionSiweStatementToSign(
        smartAccount.accountAddress,
        ownerAccount.address,
        userEmail
    );
    console.log("Message to sign: " + emailSubscriptionSiweMessage);

    // Sign the SIWE message with owner's private key
    const emailSubscriptionSignature = await ownerAccount.signMessage({
        message: emailSubscriptionSiweMessage
    });

    console.log("Signed SIWE message for email subscription");

    // Create the email subscription
    const subscriptionId = await alertsService.createEmailSubscription(
        smartAccount.accountAddress,
        ownerAccount.address,
        userEmail,
        emailSubscriptionSiweMessage,
        emailSubscriptionSignature
    );

    console.log("Email subscription created with ID:", subscriptionId);
    console.log(`Check your email (${userEmail}) for OTP activation code`);

    // --------- 6. Activate Email Subscription ---------
    console.log("\nStep 6: Activating email subscription");

    const otpChallenge = await askQuestion("Enter the OTP code sent your email: ");

    console.log("Activating subscription with OTP...");

    try {
        const activationResult = await alertsService.activateSubscription(subscriptionId, otpChallenge);

        if (activationResult) {
            console.log("Email subscription successfully activated!");
        } else {
            console.log("Failed to activate email subscription");
        }
    } catch (error) {
        console.log("Error activating subscription:", error);
        console.log("Please verify the OTP code and try again");
    }

    // --------- 7. Create SMS Subscription ---------
    console.log("\nStep 7: Creating SMS alert subscription");

    // Generate SIWE message for creating SMS subscription
    const smsSubscriptionSiweMessage = alertsService.createSubscriptionSiweStatementToSign(
        smartAccount.accountAddress,
        ownerAccount.address,   
        "sms",
        userPhone
    );

    console.log("Message to sign for SMS: " + smsSubscriptionSiweMessage);

    // Sign the SIWE message with owner's private key
    const smsSubscriptionSignature = await ownerAccount.signMessage({
        message: smsSubscriptionSiweMessage
    });

    console.log("Signed SIWE message for SMS subscription");

    // Create the SMS subscription
    const smsSubscriptionId = await alertsService.createSubscription(
        smartAccount.accountAddress,
        ownerAccount.address,
        "sms",
        userPhone,
        smsSubscriptionSiweMessage,
        smsSubscriptionSignature
    );

    console.log("SMS subscription created with ID:", smsSubscriptionId);
    console.log(`Check your phone (${userPhone}) for SMS with OTP activation code`);

    // --------- 8. Activate SMS Subscription ---------
    console.log("\nStep 8: Activating SMS subscription");
    
    const smsOtpChallenge = await askQuestion("Enter the OTP code from your SMS: ");
    
    console.log("Activating SMS subscription with OTP...");
    
    try {
        const smsActivationResult = await alertsService.activateSubscription(smsSubscriptionId, smsOtpChallenge);
        
        if (smsActivationResult) {
            console.log("SMS subscription successfully activated!");
        } else {
            console.log("Failed to activate SMS subscription");
        }
    } catch (error) {
        console.log("Error activating SMS subscription:", error);
        console.log("Please verify the SMS OTP code and try again");
    }

    // --------- 9. Verify Active Subscriptions ---------
    console.log("\nStep 9: Retrieving active subscriptions");

    // Generate SIWE message for getting subscriptions
    const getSubscriptionsSiweMessage = alertsService.getSubscriptionsSiweStatementToSign(ownerAccount.address);

    // Sign the SIWE message
    const getSubscriptionsSignature = await ownerAccount.signMessage({
        message: getSubscriptionsSiweMessage
    });

    // Get active subscriptions
    const activeSubscriptions = await alertsService.getActiveSubscriptions(
        smartAccount.accountAddress,
        ownerAccount.address,
        getSubscriptionsSiweMessage,
        getSubscriptionsSignature
    );

    console.log("Active subscriptions:", activeSubscriptions.length);
    activeSubscriptions.forEach((subscription, index) => {
        console.log(`  ${index + 1}. ID: ${subscription.id}`);
        console.log(`     Channel: ${subscription.channel}`);
        console.log(`     Target: ${subscription.target}`);
    });

    // --------- 10. Summary ---------
    console.log("\nAlert System Setup Complete!");
    console.log("=================================");
    console.log("Safe Account:", smartAccount.accountAddress);
    console.log("Recovery Module: Social Recovery Module (3-day grace period)");
    console.log("Guardian configured: 1");
    console.log("Guardian threshold: 1");
    console.log("Email alerts configured for:", userEmail);
    console.log("SMS alerts configured for:", userPhone);
    console.log("");
    console.log("Your Safe account is now protected by:");
    console.log("• Social recovery with guardians");
    console.log("• Email and SMS notifications for recovery events");
    console.log("• 3-day grace period for recovery finalization");
    console.log("");
    console.log("You will receive email and SMS alerts when:");
    console.log("• Recovery requests are initiated");
    console.log("• Recovery requests are executed");
    console.log("• Recovery requests are finalized");
    console.log("• Guardian configurations change");

    rl.close();
}

// Error handling wrapper
main()
    .then(() => {
        console.log("\nExample completed successfully!");
        process.exit(0);
    })
    .catch((error) => {
        console.error("\nError occurred:", error.message || error);
        if (error.context) {
            console.error("Context:", error.context);
        }
        rl.close();
        process.exit(1);
    });