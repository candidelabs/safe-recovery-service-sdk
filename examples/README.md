# Safe Recovery Service SDK Examples

Run the three examples **in order** — each builds on the previous one.

## Setup

```bash
cd examples
yarn install
cp .env.example .env
# Edit .env — see notes below
```

## Examples

### 01 — Enable Email/SMS Recovery

Deploys a Safe account with the Social Recovery Module, registers your email and/or SMS
channels with the Candide Guardian Service, and adds the Candide Guardian on-chain.

**Run once** — prints the Safe address you'll need for Examples 02 and 03.

**Requires in `.env`:** `CHAIN_ID`, `RECOVERY_SERVICE_URL`, `BUNDLER_URL`, `NODE_URL`,
`PAYMASTER_URL`, `SPONSORSHIP_POLICY_ID`, `OWNER_PRIVATE_KEY`, `USER_EMAIL` (and `USER_PHONE`
if you want SMS)

```bash
yarn dev:enable-email-sms-recovery
```

After running: copy `SAFE_ACCOUNT_ADDRESS` from the output into your `.env`.

---

### 02 — Alerts Setup

Subscribes your email and SMS to recovery event notifications for the Safe deployed in
Example 01. Uses SIWE for off-chain authentication — no transaction needed.

**Requires in `.env`:** `CHAIN_ID`, `RECOVERY_SERVICE_URL`, `SAFE_ACCOUNT_ADDRESS`,
`OWNER_PRIVATE_KEY`, `USER_EMAIL`, `USER_PHONE`

```bash
yarn dev:alerts-setup
```

---

### 03 — Recovery Flow

Triggers a recovery via the Candide Guardian Service (OTP verification), waits the grace
period, finalizes the recovery, and verifies the new owner on-chain.

**Requires in `.env`:** `CHAIN_ID`, `RECOVERY_SERVICE_URL`, `NODE_URL`,
`SAFE_ACCOUNT_ADDRESS`, `USER_EMAIL`

```bash
yarn dev:recovery-flow
```

---

## Key `.env` Values

| Variable | Notes |
|---|---|
| `OWNER_PRIVATE_KEY` | Generate once: `node -e "console.log(require('viem/accounts').generatePrivateKey())"` — reused across all examples |
| `SAFE_ACCOUNT_ADDRESS` | Fill in after running Example 01 |
| `BUNDLER_URL` / `PAYMASTER_URL` | Required only by Example 01 (deploys the Safe) |

## Requirements

- Node.js 18+
- Valid RPC endpoints for your target network
- Candide Recovery Service URL
