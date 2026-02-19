/**
 * Example 02: Alerts Setup
 *
 * Demonstrates: Subscribing email and SMS channels to recovery event notifications for
 * a Safe account that already has the Social Recovery Module enabled (set up in Example 01).
 * Uses SIWE (Sign-In With Ethereum) for off-chain authentication — no on-chain transaction needed.
 *
 * Prerequisites:
 *   - Run Example 01 first and add SAFE_ACCOUNT_ADDRESS to your .env
 *   - Fill in .env: CHAIN_ID, RECOVERY_SERVICE_URL, SAFE_ACCOUNT_ADDRESS,
 *     OWNER_PRIVATE_KEY, USER_EMAIL (and USER_PHONE if you want SMS alerts)
 *
 * Expected duration: ~5 minutes (includes OTP round-trips)
 *
 * After this example:
 *   - Your Safe will send email/SMS alerts whenever a recovery event occurs
 *   - Run Example 03 to trigger a recovery and observe the alerts
 */

import { privateKeyToAccount } from 'viem/accounts';
import { Alerts, SafeRecoveryServiceSdkError } from "safe-recovery-service-sdk";
import * as dotenv from 'dotenv';
import * as readline from 'readline';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function askQuestion(question: string): Promise<string> {
    return new Promise((resolve) => rl.question(question, resolve));
}

async function main() {
    dotenv.config();

    console.log("Alerts Setup — Example 02");
    console.log("==========================\n");

    const requiredEnvVars = [
        'CHAIN_ID', 'RECOVERY_SERVICE_URL', 'SAFE_ACCOUNT_ADDRESS',
        'OWNER_PRIVATE_KEY', 'USER_EMAIL'
    ];
    const missing = requiredEnvVars.filter(v => !process.env[v]);
    if (missing.length > 0) {
        throw new Error(`Missing required environment variables: ${missing.join(', ')}. Please check your .env file.`);
    }

    const chainId = BigInt(process.env.CHAIN_ID as string);
    const serviceUrl = process.env.RECOVERY_SERVICE_URL as string;
    const safeAccountAddress = process.env.SAFE_ACCOUNT_ADDRESS as string;
    const ownerPrivateKey = process.env.OWNER_PRIVATE_KEY as `0x${string}`;
    const userEmail = process.env.USER_EMAIL as string;
    const userPhone = process.env.USER_PHONE as string;

    const ownerAccount = privateKeyToAccount(ownerPrivateKey);

    console.log(`Owner:        ${ownerAccount.address}`);
    console.log(`Safe Account: ${safeAccountAddress}\n`);

    const alertsService = new Alerts(serviceUrl, chainId);

    // Check for existing subscriptions before creating new ones.
    // SIWE is used here for off-chain authentication — it proves ownership of the owner address
    // without requiring an on-chain transaction, keeping this step gasless.
    const getSubscriptionsSiweMessage = alertsService.getSubscriptionsSiweStatementToSign(ownerAccount.address);
    const getSubscriptionsSignature = await ownerAccount.signMessage({ message: getSubscriptionsSiweMessage });

    const existingSubscriptions = await alertsService.getActiveSubscriptions(
        safeAccountAddress,
        ownerAccount.address,
        getSubscriptionsSiweMessage,
        getSubscriptionsSignature
    );

    if (existingSubscriptions.length > 0) {
        console.log(`Existing subscriptions (${existingSubscriptions.length}):`);
        existingSubscriptions.forEach((sub, i) => {
            console.log(`  ${i + 1}. ${sub.channel} — ${sub.target}`);
        });
        console.log();
    }

    // Choose alert channels
    console.log("Choose your alert channels:");
    console.log("  1. Email only");
    console.log("  2. SMS only");
    console.log("  3. Both email and SMS");

    const channelChoice = await askQuestion("Enter choice (1-3): ");
    const choice = parseInt(channelChoice);

    if (choice < 1 || choice > 3) {
        console.log("Invalid choice");
        rl.close();
        return;
    }

    const enableEmail = choice === 1 || choice === 3;
    const enableSms = choice === 2 || choice === 3;

    if (enableSms && !userPhone) {
        throw new Error("USER_PHONE is required for SMS alerts. Add it to your .env file.");
    }

    // Create and activate email alert subscription (if selected)
    if (enableEmail) {
        const emailSubscriptionSiweMessage = alertsService.createEmailSubscriptionSiweStatementToSign(
            safeAccountAddress,
            ownerAccount.address,
            userEmail
        );

        const emailSubscriptionSignature = await ownerAccount.signMessage({
            message: emailSubscriptionSiweMessage
        });

        const emailSubscriptionId = await alertsService.createEmailSubscription(
            safeAccountAddress,
            ownerAccount.address,
            userEmail,
            emailSubscriptionSiweMessage,
            emailSubscriptionSignature
        );

        const emailOtpChallenge = await askQuestion(`\nOTP sent to ${userEmail} — enter code: `);

        try {
            const emailActivationResult = await alertsService.activateSubscription(emailSubscriptionId, emailOtpChallenge);
            if (emailActivationResult) {
                console.log("Email alerts activated.");
            } else {
                console.log("Failed to activate email alerts");
            }
        } catch (error) {
            if (error instanceof SafeRecoveryServiceSdkError) {
                console.error("Error activating email subscription:", error.stringify());
            } else {
                console.error("Error activating email subscription:", error instanceof Error ? error.message : error);
            }
        }
    }

    // Create and activate SMS alert subscription (if selected)
    if (enableSms) {
        const smsSubscriptionSiweMessage = alertsService.createSubscriptionSiweStatementToSign(
            safeAccountAddress,
            ownerAccount.address,
            "sms",
            userPhone
        );

        const smsSubscriptionSignature = await ownerAccount.signMessage({
            message: smsSubscriptionSiweMessage
        });

        const smsSubscriptionId = await alertsService.createSubscription(
            safeAccountAddress,
            ownerAccount.address,
            "sms",
            userPhone,
            smsSubscriptionSiweMessage,
            smsSubscriptionSignature
        );

        const smsOtpChallenge = await askQuestion(`\nOTP sent to ${userPhone} — enter code: `);

        try {
            const smsActivationResult = await alertsService.activateSubscription(smsSubscriptionId, smsOtpChallenge);
            if (smsActivationResult) {
                console.log("SMS alerts activated.");
            } else {
                console.log("Failed to activate SMS alerts");
            }
        } catch (error) {
            if (error instanceof SafeRecoveryServiceSdkError) {
                console.error("Error activating SMS subscription:", error.stringify());
            } else {
                console.error("Error activating SMS subscription:", error instanceof Error ? error.message : error);
            }
        }
    }

    // Verify active subscriptions
    const verifySubscriptionsSiweMessage = alertsService.getSubscriptionsSiweStatementToSign(ownerAccount.address);
    const verifySubscriptionsSignature = await ownerAccount.signMessage({
        message: verifySubscriptionsSiweMessage
    });

    const activeSubscriptions = await alertsService.getActiveSubscriptions(
        safeAccountAddress,
        ownerAccount.address,
        verifySubscriptionsSiweMessage,
        verifySubscriptionsSignature
    );

    const channels = [enableEmail ? `email (${userEmail})` : null, enableSms ? `SMS (${userPhone})` : null]
        .filter(Boolean).join(", ");

    console.log(`\nActive subscriptions (${activeSubscriptions.length}):`);
    activeSubscriptions.forEach((sub, i) => {
        console.log(`  ${i + 1}. ${sub.channel} — ${sub.target}`);
    });

    console.log(`\nAlerts configured for: ${channels}`);
    console.log("You will be notified when a recovery request is initiated, executed, or finalized.");
    console.log("\nNext: yarn dev:recovery-flow  (Example 03)");

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
