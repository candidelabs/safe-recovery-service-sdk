---
name: integrate-safe-recovery
description: Generate integration code for safe-recovery-service-sdk. Use when a developer wants to add guardian recovery, custodial guardian registration, alert subscriptions, or manual guardian recovery to their Safe account application.
argument-hint: registration|alerts|recovery|manual-recovery
---

## Step 1 — Identify scenario

Check `$ARGUMENTS`. If it is one of `registration`, `alerts`, `recovery`, or `manual-recovery`, use it directly and skip to Step 2.

Otherwise present this menu and wait for the developer to choose:

```
Which scenario do you want to integrate?
  1. registration    — Register email/SMS channels + add Candide Guardian on-chain
  2. alerts          — Subscribe to recovery event notifications
  3. recovery        — Trigger a recovery via Candide Guardian (OTP-verified)
  4. manual-recovery — Collect your own guardian signatures and run recovery
```

Map the response to the scenario name (`1` → `registration`, `2` → `alerts`, `3` → `recovery`, `4` → `manual-recovery`).

---

## Step 2 — Explore the developer's project

Before writing any code, read the project to understand the context. Look for:

- **Language**: TypeScript or JavaScript? Check for `tsconfig.json`, `.ts` source files, or `.js` source files.
- **Existing Safe account setup**: Is there already a `SafeAccountV0_3_0` instance? How is it constructed (from env vars, a config object, constructor params)?
- **Config patterns**: Do they use `process.env`, a config module, dependency injection, or something else?
- **Runtime context**: Node.js script, Express/Fastify backend service, browser app, or a test file?
- **Existing imports from `abstractionkit`**: Are any already present? Which ones?
- **Package manager**: `yarn`, `npm`, or `pnpm`?

Adapt all generated code to match the project's existing patterns. For example:
- If they use a config object instead of `process.env`, use that pattern.
- If they already have a `SafeAccountV0_3_0` instance, reference it rather than re-constructing it.
- If they are in a browser context, omit `readline` and note that OTP collection must come from a UI input.

---

## Step 3 — Generate integration code

Produce one self-contained code block per scenario. Add inline comments on any non-obvious step. Do not add comments to lines that are self-explanatory.

### Scenario: `registration`

**What it does**: Registers email and/or SMS channels with the Candide Guardian Service (OTP-verified), then adds the Candide Guardian address on-chain as a guardian of the Safe.

**Key classes**: `RecoveryByCustodialGuardian` (from `safe-recovery-service-sdk`), `SocialRecoveryModule`, `getSafeMessageEip712Data`, `SAFE_MESSAGE_PRIMARY_TYPE`, `SafeAccountV0_3_0` (from `abstractionkit`)

**Auth pattern — EIP-1271 contract signature**:
The Candide service verifies the registration signature *against the Safe contract* (not just the EOA), so a plain `signMessage` is not enough. The correct sequence is:
1. Get the SIWE statement string from `createRegistrationToEmailRecoverySiweStatementToSign()` or `createRegistrationToSmsRecoverySiweStatementToSign()`
2. Wrap it in the Safe EIP-712 envelope: `getSafeMessageEip712Data(safeAddress, chainId, siweStatement)`
3. Sign the typed data: `ownerAccount.signTypedData({ domain, types, primaryType: SAFE_MESSAGE_PRIMARY_TYPE, message })`
4. Format as Safe signature: `SafeAccountV0_3_0.buildSignaturesFromSingerSignaturePairs([{ signer, signature }])`
5. Pass the formatted signature to `createRegistrationToEmailRecovery()` / `createRegistrationToSmsRecovery()`

**Canonical method sequence**:
```
custodialService.createRegistrationToEmailRecoverySiweStatementToSign(safeAddress, email)
  → getSafeMessageEip712Data(safeAddress, chainId, siweStatement)
  → ownerAccount.signTypedData(...)
  → SafeAccountV0_3_0.buildSignaturesFromSingerSignaturePairs([...])
  → custodialService.createRegistrationToEmailRecovery(safeAddress, email, siweStatement, signature)
  → [collect OTP]
  → custodialService.submitRegistrationChallenge(challengeId, otpCode)
    → returns { guardianAddress }

// Same pattern for SMS using createRegistrationToSmsRecoverySiweStatementToSign / createRegistrationToSmsRecovery

srm.createAddGuardianWithThresholdMetaTransaction(guardianAddress, threshold)
  → smartAccount.createUserOperation([addGuardianTx], nodeUrl, bundlerUrl)
  → smartAccount.sendUserOperation(userOperation, bundlerUrl)
```

**Reference file**: `examples/01-enable-email-sms-recovery/index.ts`

---

### Scenario: `alerts`

**What it does**: Subscribes email and/or SMS addresses to receive notifications when recovery events (initiated, executed, finalized) occur on a Safe.

**Key class**: `Alerts` (from `safe-recovery-service-sdk`)

**Auth pattern — plain `signMessage` on SIWE string**:
Alerts authentication is EOA-only (no Safe contract involvement), so a simple off-chain signature suffices:
1. Get the SIWE statement from `createEmailSubscriptionSiweStatementToSign()` or `createSubscriptionSiweStatementToSign()`
2. Sign it directly: `ownerAccount.signMessage({ message: siweStatement })`
3. Pass both the statement and signature to `createEmailSubscription()` / `createSubscription()`

**Canonical method sequence**:
```
// Email
alertsService.createEmailSubscriptionSiweStatementToSign(safeAddress, ownerAddress, email)
  → ownerAccount.signMessage({ message: siweStatement })
  → alertsService.createEmailSubscription(safeAddress, ownerAddress, email, siweStatement, signature)
  → [collect OTP]
  → alertsService.activateSubscription(subscriptionId, otpCode)

// SMS
alertsService.createSubscriptionSiweStatementToSign(safeAddress, ownerAddress, "sms", phone)
  → ownerAccount.signMessage({ message: siweStatement })
  → alertsService.createSubscription(safeAddress, ownerAddress, "sms", phone, siweStatement, signature)
  → [collect OTP]
  → alertsService.activateSubscription(subscriptionId, otpCode)

// List existing
alertsService.getSubscriptionsSiweStatementToSign(ownerAddress)
  → ownerAccount.signMessage({ message: siweStatement })
  → alertsService.getActiveSubscriptions(safeAddress, ownerAddress, siweStatement, signature)
```

**Reference file**: `examples/02-alerts-setup/index.ts`

---

### Scenario: `recovery`

**What it does**: Initiates a recovery for a Safe that already has the Candide Guardian registered. The developer specifies new owners/threshold, verifies identity via OTP on each registered channel, and the service handles the guardian signature and on-chain execution.

**Key classes**: `RecoveryByCustodialGuardian`, `RecoveryByGuardian` (from `safe-recovery-service-sdk`)

**Auth pattern — OTP challenge flow** (no signing by the app's EOA):
1. `requestCustodialGuardianSignatureChallenge(safeAddress, newOwners, threshold)` — returns `{ requestId, auths: [{ challengeId, channel, target }] }`
2. For each auth: `submitCustodialGuardianSignatureChallenge(requestId, challengeId, otpCode)` — returns `{ success, custodianGuardianAddress, custodianGuardianSignature }` on the last verification
3. `createAndExecuteRecoveryRequest(safeAddress, newOwners, threshold, guardianAddress, guardianSignature)` — returns recovery request with `{ id, status }`
4. Wait for grace period
5. `finalizeRecoveryRequest(requestId)` — completes ownership transfer

**Canonical method sequence**:
```
custodialService.requestCustodialGuardianSignatureChallenge(safeAddress, newOwners, newThreshold)
  → for each auth: custodialService.submitCustodialGuardianSignatureChallenge(requestId, challengeId, otpCode)
    → last auth returns { custodianGuardianAddress, custodianGuardianSignature }
  → custodialService.createAndExecuteRecoveryRequest(safeAddress, newOwners, newThreshold, guardianAddress, guardianSignature)
    → returns { id, status: "EXECUTED" }
  → [wait grace period]
  → recoveryService.finalizeRecoveryRequest(recoveryRequest.id)
  → smartAccount.getOwners(nodeUrl)  // verify
```

**Note on `RecoveryByGuardian` constructor**: requires `(serviceUrl, chainId, gracePeriodSelector)` where `gracePeriodSelector` is a `SocialRecoveryModuleGracePeriodSelector` enum value — it must match the module the Safe was deployed with.

**Reference file**: `examples/03-recovery-flow/index.ts`

---

### Scenario: `manual-recovery`

**What it does**: Collects EIP-712 guardian signatures from EOA guardian wallets that the developer controls, then submits them to the recovery service and finalizes.

**Key class**: `RecoveryByGuardian` (from `safe-recovery-service-sdk`), `SocialRecoveryModule` (from `abstractionkit`)

**Auth pattern — EIP-712 `signTypedData` with `EXECUTE_RECOVERY_PRIMARY_TYPE`**:
1. `srm.getRecoveryRequestEip712Data(nodeUrl, chainId, safeAddress, newOwners, threshold)` — returns typed data to sign
2. Each guardian: `guardianAccount.signTypedData({ primaryType: EXECUTE_RECOVERY_PRIMARY_TYPE, ...eip712Data })`
3. First guardian creates the request: `recoveryService.createRecoveryRequest(safeAddress, newOwners, threshold, guardian1Address, sig1)`
   - Note the `request.emoji` field — all guardians should verify it matches via a secure out-of-band channel before signing
4. Additional guardians: `recoveryService.submitGuardianSignatureForRecoveryRequest(requestId, guardianNAddress, sigN)`
5. Once threshold met: `recoveryService.executeRecoveryRequest(requestId)`
6. Wait grace period, then: `recoveryService.finalizeRecoveryRequest(requestId)`

**Canonical method sequence**:
```
srm.getRecoveryRequestEip712Data(nodeUrl, chainId, safeAddress, newOwners, threshold)
  → guardian1Account.signTypedData({ primaryType: EXECUTE_RECOVERY_PRIMARY_TYPE, ...eip712Data })
  → recoveryService.createRecoveryRequest(safeAddress, newOwners, threshold, guardian1.address, sig1)
    → returns { id, emoji, status: "PENDING" }
  // Guardian 2..N verify the emoji matches, then sign and submit:
  → guardian2Account.signTypedData({ primaryType: EXECUTE_RECOVERY_PRIMARY_TYPE, ...eip712Data })
  → recoveryService.submitGuardianSignatureForRecoveryRequest(requestId, guardian2.address, sig2)
  → recoveryService.executeRecoveryRequest(requestId)
  → [wait grace period]
  → recoveryService.finalizeRecoveryRequest(requestId)
  → smartAccount.getOwners(nodeUrl)  // verify
```

**Query helpers** (useful for dashboards / monitoring):
- `recoveryService.getRecoveryRequestsForLatestNonce(safeAddress)` — all requests for current nonce
- `recoveryService.getPendingRecoveryRequestsForLatestNonce(safeAddress)` — only PENDING requests

**Reference file**: comment block at the bottom of `examples/03-recovery-flow/index.ts`

---

## Step 4 — Output format

After reading the project and selecting the scenario, produce:

1. **A single fenced code block** with the complete integration snippet, adapted to the project's language and existing patterns.

2. **Required config values** — a short bullet list of every variable or value the developer must supply (e.g. `serviceUrl`, `chainId`, `safeAddress`, `ownerPrivateKey`), with a one-line note on where each comes from.

3. **Auth pattern note** — one or two sentences explaining which signature scheme is used and why, so the developer understands the choice:
   - EIP-1271 (`getSafeMessageEip712Data` → `signTypedData` → `buildSignaturesFromSingerSignaturePairs`): required when the Candide service verifies the signature against the Safe contract.
   - Plain `signMessage`: sufficient when only the EOA identity needs to be proven (alerts), not the Safe contract.
   - EIP-712 `signTypedData` with `EXECUTE_RECOVERY_PRIMARY_TYPE`: required when submitting guardian signatures for an on-chain recovery module call.
   - OTP challenge flow: used by the custodial recovery scenario — no app-side signing, the Candide service signs after OTP verification.
