# Safe Recovery Service SDK

TypeScript SDK by [Candidelabs](https://candide.dev) for interacting with the [Safe Social Recovery Module](https://github.com/safe-global/safe-modules/tree/main/modules/recovery). Enables guardian-based account recovery, custodial guardian services via email/SMS, and alert subscriptions for recovery events.

Looking for runnable code? Jump to the **[examples →](./examples/README.md)**

## Installation

```bash
npm install safe-recovery-service-sdk
# or
yarn add safe-recovery-service-sdk
```

## Overview

The SDK exposes three main classes:

| Class | Purpose |
|---|---|
| `RecoveryByGuardian` | Manage recovery requests with your own guardian keys |
| `RecoveryByCustodialGuardian` | Register email/SMS channels with Candide's guardian service |
| `Alerts` | Subscribe to email/SMS notifications for recovery events |

---

## RecoveryByGuardian

Use this when you control your own guardian wallets. Guardians sign recovery requests off-chain; the service handles on-chain execution.

```ts
import { RecoveryByGuardian } from "safe-recovery-service-sdk";
import { SocialRecoveryModuleGracePeriodSelector } from "abstractionkit";

const recoveryService = new RecoveryByGuardian(
    "https://recovery.candide.dev",
    84532n, // Base Sepolia
    SocialRecoveryModuleGracePeriodSelector.After7Days
);

// Create a recovery request with the first guardian signature
const request = await recoveryService.createRecoveryRequest(
    safeAddress,
    [newOwnerAddress],
    1,               // new threshold
    guardian1Address,
    guardian1Signature
);
// request.emoji — share with other guardians to verify request authenticity

// Collect additional guardian signatures until threshold is met
await recoveryService.submitGuardianSignatureForRecoveryRequest(
    request.id,
    guardian2Address,
    guardian2Signature
);

// Execute, wait grace period, then finalize
await recoveryService.executeRecoveryRequest(request.id);
// ... wait grace period ...
await recoveryService.finalizeRecoveryRequest(request.id);
```

Recovery requests follow the lifecycle: `PENDING` → `EXECUTED` → `FINALIZED`

---

## RecoveryByCustodialGuardian

Use this to register email and/or SMS channels with Candide's guardian service. Candide acts as the guardian and signs recovery requests after you verify your identity via OTP.

```ts
import { RecoveryByCustodialGuardian } from "safe-recovery-service-sdk";
import {
    getSafeMessageEip712Data,
    SAFE_MESSAGE_PRIMARY_TYPE,
    SafeAccountV0_3_0,
} from "abstractionkit";

const guardian = new RecoveryByCustodialGuardian(
    "https://recovery.candide.dev",
    84532n
);

// 1. Generate and sign the registration SIWE message (EIP-1271 Safe message format)
const siweMessage = guardian.createRegistrationToEmailRecoverySiweStatementToSign(
    safeAddress,
    "user@example.com"
);
const typedData = getSafeMessageEip712Data(safeAddress, chainId, siweMessage);
const ownerSig = await ownerAccount.signTypedData({
    ...typedData,
    primaryType: SAFE_MESSAGE_PRIMARY_TYPE
});
const signature = SafeAccountV0_3_0.buildSignaturesFromSingerSignaturePairs([
    { signer: ownerAccount.address, signature: ownerSig }
]);

// 2. Register and verify via OTP
const challengeId = await guardian.createRegistrationToEmailRecovery(
    safeAddress, "user@example.com", siweMessage, signature
);
await guardian.submitRegistrationChallenge(challengeId, otpCode);

// 3. Trigger recovery — verify identity via OTP on each registered channel
const signatureRequest = await guardian.requestCustodialGuardianSignatureChallenge(
    safeAddress, [newOwnerAddress], 1
);
const result = await guardian.submitCustodialGuardianSignatureChallenge(
    signatureRequest.requestId,
    signatureRequest.auths[0].challengeId,
    otpCode
);

// 4. Execute recovery with the guardian signature
await guardian.createAndExecuteRecoveryRequest(
    safeAddress,
    [newOwnerAddress],
    1,
    result.custodianGuardianAddress,
    result.custodianGuardianSignature
);
```

---

## Alerts

Subscribe to email or SMS notifications when recovery events occur on a Safe.

```ts
import { Alerts } from "safe-recovery-service-sdk";

const alerts = new Alerts("https://recovery.candide.dev", 84532n);

// 1. Sign a SIWE message with a plain EOA signMessage (no EIP-712 needed)
const siweMessage = alerts.createEmailSubscriptionSiweStatementToSign(
    safeAddress, ownerAddress, "user@example.com"
);
const signature = await ownerAccount.signMessage({ message: siweMessage });

// 2. Create and activate the subscription
const subscriptionId = await alerts.createEmailSubscription(
    safeAddress, ownerAddress, "user@example.com", siweMessage, signature
);
await alerts.activateSubscription(subscriptionId, otpCode);

// 3. List active subscriptions
const authMessage = alerts.getSubscriptionsSiweStatementToSign(ownerAddress);
const authSig = await ownerAccount.signMessage({ message: authMessage });
const active = await alerts.getActiveSubscriptions(
    safeAddress, ownerAddress, authMessage, authSig
);
```

Alerts are triggered when a recovery request is initiated, executed, or finalized.

---

## Grace Periods

Choose a grace period when deploying the Social Recovery Module. The grace period is the window during which the original owner can cancel an unauthorized recovery before it finalizes.

| Selector | Grace Period | Use |
|---|---|---|
| `SocialRecoveryModuleGracePeriodSelector.After3Minutes` | 3 minutes | Testing only |
| `SocialRecoveryModuleGracePeriodSelector.After3Days` | 3 days | Production |
| `SocialRecoveryModuleGracePeriodSelector.After7Days` | 7 days | Production |
| `SocialRecoveryModuleGracePeriodSelector.After14Days` | 14 days | Production |

---

## Error Handling

All methods throw `SafeRecoveryServiceSdkError` on failure:

```ts
import { SafeRecoveryServiceSdkError } from "safe-recovery-service-sdk";

try {
    await recoveryService.createRecoveryRequest(/* ... */);
} catch (error) {
    if (error instanceof SafeRecoveryServiceSdkError) {
        console.error(error.stringify()); // structured output with code and context
    }
}
```

Error codes: `SIWE_ERROR`, `HTTP_ERROR`, `BAD_DATA`, `TIMEOUT`, `UNKNOWN_ERROR`

---

## Examples

The [`examples/`](./examples) directory contains three runnable examples that walk through the full flow in order:

| # | Example | What it does |
|---|---|---|
| 01 | [`01-enable-email-sms-recovery`](./examples/01-enable-email-sms-recovery) | Deploy a Safe, register email/SMS with Candide Guardian, add guardian on-chain |
| 02 | [`02-alerts-setup`](./examples/02-alerts-setup) | Subscribe to email/SMS recovery event notifications |
| 03 | [`03-recovery-flow`](./examples/03-recovery-flow) | Trigger a recovery via OTP, wait grace period, finalize |

```bash
cd examples
yarn install
cp .env.example .env
# Fill in .env, then run in order:
yarn dev:enable-email-sms-recovery   # prints OWNER_PRIVATE_KEY + SAFE_ACCOUNT_ADDRESS — copy into .env
yarn dev:alerts-setup
yarn dev:recovery-flow
```

See [`examples/README.md`](./examples/README.md) for full setup instructions.

---

## Development

```bash
yarn install
yarn build    # compile to dist/
yarn test     # run tests
yarn clean    # remove dist/
```

---

## Links

- [GitHub](https://github.com/candidelabs/safe-recovery-sdk)
- [Candidelabs](https://candide.dev)
- [Safe Documentation](https://docs.safe.global)

## License

MIT
