import { generatePrivateKey, privateKeyToAccount, signMessage } from 'viem/accounts'
import {
    CandidePaymaster,
    EXECUTE_RECOVERY_PRIMARY_TYPE,
    RecoveryRequest,
    SAFE_MESSAGE_PRIMARY_TYPE,
    SafeAccountV0_3_0,
    SocialRecoveryModule,
    SocialRecoveryModuleGracePeriodSelector,
} from "abstractionkit";
import { 
    RecoveryByGuardianRequest,
    RecoveryByGuardianService 
} from "../src/recoveryByGuardian";
import { Alerts } from "../src/alerts"

import { hashMessage, TypedDataDomain } from 'viem';
import { SafeAccount } from 'abstractionkit/dist/account/Safe/SafeAccount';

require('dotenv').config()

jest.setTimeout(300000);

const chainId = BigInt(process.env.CHAIN_ID as string)
const serviceUrl =process.env.RECOVERY_SERVICE_URL as string
const bundlerUrl = process.env.BUNDLER_URL as string
const nodeUrl = process.env.NODE_URL as string
const paymasterUrl = process.env.PAYMASTER_URL as string;
const email = process.env.EMAIL as string;

const recoveryByGuardianService = new RecoveryByGuardianService(
    serviceUrl,
    chainId,
    SocialRecoveryModuleGracePeriodSelector.After3Minutes
);
const alerts = new Alerts(
    serviceUrl,
    chainId,
);

const ownerPrivateKey = generatePrivateKey();
const ownerAccount =  privateKeyToAccount(ownerPrivateKey)
const ownerPublicAddress =  ownerAccount.address;

const newOwnerPrivateKey = generatePrivateKey();
const newOwner =  privateKeyToAccount(newOwnerPrivateKey);
const newOwnerPublicAddress = newOwner.address; 

const firstGuardianPrivateKey = generatePrivateKey();
const firstGuardianAccount =  privateKeyToAccount(firstGuardianPrivateKey);
const firstGuardianPublicAddress =  firstGuardianAccount.address;

let smartAccount = SafeAccountV0_3_0.initializeNewAccount(
    [ownerPublicAddress],
)
const srm = new SocialRecoveryModule(recoveryByGuardianService.recoveryModuleAddress)

beforeAll(async() => {
    const transction1 = srm.createEnableModuleMetaTransaction(
        smartAccount.accountAddress
    );

    const transction2 = srm.createAddGuardianWithThresholdMetaTransaction(
        firstGuardianPublicAddress,
        1n //threshold
    );

    let userOperation = await smartAccount.createUserOperation(
        [transction1, transction2],
        nodeUrl,
        bundlerUrl,
    )

    const paymaster = new CandidePaymaster(paymasterUrl)

    let [paymasterUserOperation, _sponsorMetadata] = await paymaster.createSponsorPaymasterUserOperation(
        userOperation, bundlerUrl)
    userOperation = paymasterUserOperation;

    userOperation.signature = smartAccount.signUserOperation(
        userOperation,
        [ownerPrivateKey],
        chainId,
    )

    const sendUserOperationResponse = await smartAccount.sendUserOperation(
        userOperation, bundlerUrl
    )

    console.log("Useroperation sent. Waiting to be included ......")
    let userOperationReceiptResult = await sendUserOperationResponse.included()

    console.log("Useroperation receipt received.")
});

let subscriptionId:string;

describe('Alerts', () => {
    describe('createEmailSubscription', () => { 
        it('getSubscriptions should return an empty array if there is no subscriptions', async ()=>{
            const siweMessage = alerts.getSubscriptionsSiweStatementToSign(
                ownerPublicAddress
            )

            const signature = await ownerAccount.signMessage({message:siweMessage});
            expect(alerts.getActiveSubscriptions(
                smartAccount.accountAddress,
                ownerPublicAddress,
                siweMessage,
                signature
            )).resolves.toStrictEqual([]);
        });
        it('should fail to register if invalid signature or wrong message', async ()=>{
            const signature = await ownerAccount.signMessage({message:"wrong message"});
            const siweMessage = alerts.createSubscriptionSiweStatementToSign(
                smartAccount.accountAddress,
                ownerPublicAddress,
                "email",
                email
            )

            expect(alerts.createEmailSubscription(
                smartAccount.accountAddress,
                ownerPublicAddress,
                email,
                siweMessage,
                signature,
            )).rejects.toThrow("invalid signature");
        });
        it('should succeed if correct signature', async () => {
            const siweMessage = alerts.createSubscriptionSiweStatementToSign(
                smartAccount.accountAddress,
                ownerPublicAddress,
                "email",
                email
            )
            const signature = await ownerAccount.signMessage({message:siweMessage});

            subscriptionId = await alerts.createEmailSubscription(
                smartAccount.accountAddress,
                ownerPublicAddress,
                email,
                siweMessage,
                signature,
            );
        });
        it('getSubscriptions should return an empty array if there is no active subscriptions', async ()=>{
            const siweMessage = alerts.getSubscriptionsSiweStatementToSign(
                ownerPublicAddress
            )

            const signature = await ownerAccount.signMessage({message:siweMessage});
            expect(alerts.getActiveSubscriptions(
                smartAccount.accountAddress,
                ownerPublicAddress,
                siweMessage,
                signature
            )).resolves.toStrictEqual([]);
        });
    });

    describe('activateSubscription', () => { 
        it('should fail to activate if invalid subscriptionId', async ()=>{
            expect(alerts.activateSubscription(
                "wronfsubscriptionid", "wrongotp"
            )).rejects.toThrow("Alert subscription not found");
        });
        it('should fail to activate if invalid otp', async ()=>{
            expect(alerts.activateSubscription(
                subscriptionId, "wrongotp"
            )).rejects.toThrow("Invalid challenge");
        });

        it('should succeed if correct subscriptionId and otp', async () => {
            const fetchResponse = await fetch('http://localhost:8025/api/v1/messages')
            const responseJson = await fetchResponse.json();
            const emails = responseJson['messages'];
            const lastEmail = emails[0];
            const regex = /-?\d{6}/gm;
            const otpRes = regex.exec(lastEmail['Snippet'] as string)
            if(otpRes == null){
               return 
            }
            const otp = otpRes[0]

            expect(alerts.activateSubscription(
                subscriptionId, otp
            )).resolves.toBe(true);
        });
        it('getSubscriptions should return an array with active subscriptions', async ()=>{
            const siweMessage = alerts.getSubscriptionsSiweStatementToSign(
                ownerPublicAddress
            )

            const signature = await ownerAccount.signMessage({message:siweMessage});
            const subscriptions = await alerts.getActiveSubscriptions(
                smartAccount.accountAddress,
                ownerPublicAddress,
                siweMessage,
                signature
            );
            expect(subscriptions[0]["id"]).toBe(subscriptionId);
        });
    });

    describe('unsubscribe', () => { 
        it('should fail to unsubscribe if invalid subscriptionId', async ()=>{
            const siweMessage = alerts.unsubscribeSiweStatementToSign(
                ownerPublicAddress
            )

            const signature = await ownerAccount.signMessage({message:siweMessage});
            expect(alerts.unsubscribe(
                "wrongsubscriptionid",
                ownerPublicAddress,
                siweMessage,
                signature
            )).rejects.toThrow("Could not find an alert subscription with this id");
        });

        it('should fail to unsubscribe if wrong signature', async ()=>{
            const siweMessage = alerts.unsubscribeSiweStatementToSign(
                ownerPublicAddress
            )

            expect(alerts.unsubscribe(
                subscriptionId,
                ownerPublicAddress,
                siweMessage,
                "0xff"
            )).rejects.toThrow("invalid signature");
        });

        it('should succeed if correct subscriptionId', async () => {
            const siweMessage = alerts.unsubscribeSiweStatementToSign(
                ownerPublicAddress
            )

            const signature = await ownerAccount.signMessage({message:siweMessage});
            const unsubscribeSuccess = await alerts.unsubscribe(
                subscriptionId,
                ownerPublicAddress,
                siweMessage,
                signature
            );
            expect(unsubscribeSuccess).toBe(true);
        });
        it('getSubscriptions should return an empty array if there is no active subscriptions', async ()=>{
            const siweMessage = alerts.getSubscriptionsSiweStatementToSign(
                ownerPublicAddress
            )

            const signature = await ownerAccount.signMessage({message:siweMessage});
            expect(alerts.getActiveSubscriptions(
                smartAccount.accountAddress,
                ownerPublicAddress,
                siweMessage,
                signature
            )).resolves.toStrictEqual([]);
        });
    });
});
