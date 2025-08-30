import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import {
    CandidePaymaster,
    getSafeMessageEip712Data,
    SAFE_MESSAGE_PRIMARY_TYPE,
    SafeAccountV0_3_0 as SafeAccount,
    SocialRecoveryModule,
    SocialRecoveryModuleGracePeriodSelector,
} from "abstractionkit";
import { RecoveryByCustodialGuardian } from "../src/recoveryByCustodialGuardian";
import { TypedDataDomain } from 'viem';
import { RecoveryByGuardian } from '../src/recoveryByGuardian';
require('dotenv').config()

jest.setTimeout(300000);

const chainId = BigInt(process.env.CHAIN_ID as string)
const serviceUrl =process.env.RECOVERY_SERVICE_URL as string
const bundlerUrl = process.env.BUNDLER_URL as string
const nodeUrl = process.env.NODE_URL as string
const paymasterUrl = process.env.PAYMASTER_URL as string;
const email = process.env.EMAIL as string;

const recoveryByGuardian = new RecoveryByGuardian(
    serviceUrl,
    chainId,
    SocialRecoveryModuleGracePeriodSelector.After3Minutes
);

const firstOwnerPrivateKey = generatePrivateKey();
const firstOwnerAccount =  privateKeyToAccount(firstOwnerPrivateKey)
const firstOwnerPublicAddress =  firstOwnerAccount.address;

const secondOwnerPrivateKey = generatePrivateKey();
const secondOwnerAccount =  privateKeyToAccount(secondOwnerPrivateKey)
const secondOwnerPublicAddress =  secondOwnerAccount.address;

const newOwnerPrivateKey = generatePrivateKey();
const newOwner =  privateKeyToAccount(newOwnerPrivateKey);
const newOwnerPublicAddress = newOwner.address; 

let smartAccount = SafeAccount.initializeNewAccount(
    [firstOwnerPublicAddress, secondOwnerPublicAddress],
    {threshold:2}
)
const srm = new SocialRecoveryModule(recoveryByGuardian.recoveryModuleAddress)
const recoveryByCustodialGuardian = new RecoveryByCustodialGuardian(
    serviceUrl, chainId)

beforeAll(async() => {
    const transction1 = srm.createEnableModuleMetaTransaction(
        smartAccount.accountAddress
    );

    let userOperation = await smartAccount.createUserOperation(
        [transction1, /*transction2, transction3 */],
        nodeUrl,
        bundlerUrl,
    )

    const paymaster = new CandidePaymaster(paymasterUrl)

    let [paymasterUserOperation, _sponsorMetadata] = await paymaster.createSponsorPaymasterUserOperation(
        userOperation, bundlerUrl)
    userOperation = paymasterUserOperation;

    userOperation.signature = smartAccount.signUserOperation(
        userOperation,
        [firstOwnerPrivateKey, secondOwnerPrivateKey],
        chainId,
    )

    const sendUserOperationResponse = await smartAccount.sendUserOperation(
        userOperation, bundlerUrl
    )

    console.log("Useroperation sent. Waiting to be included ......")
    let userOperationReceiptResult = await sendUserOperationResponse.included()

    console.log("Useroperation receipt received.")
});

let registrationChallengeId: string;
let registrationId: string;
let guardianAddress: string;
let requestId: string;
let submitChallengeId: string;
let custodianGuardianAddress: string;
let custodianGuardianSignature: string;

describe('RecoveryByCustodialGuardian', () => {
    describe('createRegistrationToEmailRecovery', () => { 
        it('getSubscriptions should return an empty array if there is no subscriptions', async ()=>{
            const siweMessage =
                recoveryByCustodialGuardian.getRegistrationsSiweStatementToSign(
                    smartAccount.accountAddress
                )
            const safeTypedData = getSafeMessageEip712Data(
                smartAccount.accountAddress,
                chainId,
                siweMessage
            )
            const owner1signature = await firstOwnerAccount.signTypedData(
                {
                  domain:safeTypedData.domain as TypedDataDomain,
                  types:safeTypedData.types,
                  primaryType: SAFE_MESSAGE_PRIMARY_TYPE,
                  message: safeTypedData.messageValue            
                }
            );

            const owner2signature = await secondOwnerAccount.signTypedData(
                {
                  domain:safeTypedData.domain as TypedDataDomain,
                  types:safeTypedData.types,
                  primaryType: SAFE_MESSAGE_PRIMARY_TYPE,
                  message: safeTypedData.messageValue            
                }
            );

            const signature = SafeAccount.buildSignaturesFromSingerSignaturePairs(
                [
                    {signer: firstOwnerPublicAddress, signature: owner1signature},
                    {signer: secondOwnerPublicAddress, signature: owner2signature},
                ]
            )
            expect(recoveryByCustodialGuardian.getRegistrations(
                smartAccount.accountAddress,
                siweMessage,
                signature
            )).resolves.toStrictEqual([]);
        });

        it('should fail if only one owner signed', async () => {
            const siweMessage =
                recoveryByCustodialGuardian.createRegistrationToEmailRecoverySiweStatementToSign(
                    smartAccount.accountAddress,
                    email
                )
            const safeTypedData = getSafeMessageEip712Data(
                smartAccount.accountAddress,
                chainId,
                siweMessage
            )
            const owner1signature = await firstOwnerAccount.signTypedData(
                {
                  domain:safeTypedData.domain as TypedDataDomain,
                  types:safeTypedData.types,
                  primaryType: SAFE_MESSAGE_PRIMARY_TYPE,
                  message: safeTypedData.messageValue            
                }
            );

            const signature = SafeAccount.buildSignaturesFromSingerSignaturePairs(
                [
                    {signer: firstOwnerPublicAddress, signature: owner1signature},
                ]
            )
            expect(recoveryByCustodialGuardian.createRegistrationToEmailRecovery(
                smartAccount.accountAddress,
                email,
                siweMessage,
                signature
            )).rejects.toThrow("invalid signature");;
        });

        it('should succeed if correct signature', async () => {
            const siweMessage =
                recoveryByCustodialGuardian.createRegistrationToEmailRecoverySiweStatementToSign(
                    smartAccount.accountAddress,
                    email
                )
            const safeTypedData = getSafeMessageEip712Data(
                smartAccount.accountAddress,
                chainId,
                siweMessage
            )
            const owner1signature = await firstOwnerAccount.signTypedData(
                {
                  domain:safeTypedData.domain as TypedDataDomain,
                  types:safeTypedData.types,
                  primaryType: SAFE_MESSAGE_PRIMARY_TYPE,
                  message: safeTypedData.messageValue            
                }
            );

            const owner2signature = await secondOwnerAccount.signTypedData(
                {
                  domain:safeTypedData.domain as TypedDataDomain,
                  types:safeTypedData.types,
                  primaryType: SAFE_MESSAGE_PRIMARY_TYPE,
                  message: safeTypedData.messageValue            
                }
            );

            const signature = SafeAccount.buildSignaturesFromSingerSignaturePairs(
                [
                    {signer: firstOwnerPublicAddress, signature: owner1signature},
                    {signer: secondOwnerPublicAddress, signature: owner2signature},
                ]
            )
            registrationChallengeId =
                await recoveryByCustodialGuardian.createRegistrationToEmailRecovery(
                    smartAccount.accountAddress,
                    email,
                    siweMessage,
                    signature
                );
        });
    });

    describe('submitRegistrationChallenge', () => { 
        it('should fail to activate if invalid subscriptionId', async ()=>{
            expect(recoveryByCustodialGuardian.submitRegistrationChallenge(
                "challengeid", "wrongotp"
            )).rejects.toThrow("challengeId not found");
        });

        it('should fail to activate if invalid otp', async ()=>{
            expect(recoveryByCustodialGuardian.submitRegistrationChallenge(
                registrationChallengeId, "wrongotp"
            )).rejects.toThrow("Invalid challenge");
        });

        it('requestCustodialGuardianSignatureChallenge should fail if no registration ', async ()=>{
            expect(recoveryByCustodialGuardian.requestCustodialGuardianSignatureChallenge(
                smartAccount.accountAddress,
                [newOwnerPublicAddress],
                1
            )).rejects.toThrow("No registrations found for this account on this chainId");
        });

        it('should succeed if correct challengeId and otp', async () => {
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

            const registrationResult =
                await recoveryByCustodialGuardian.submitRegistrationChallenge(
                    registrationChallengeId, otp
                );
            registrationId = registrationResult.registrationId;
            guardianAddress = registrationResult.guardianAddress;
        });

        it('getRegistrations should return an array with registrations', async ()=>{
            const siweMessage =
                recoveryByCustodialGuardian.getRegistrationsSiweStatementToSign(
                    smartAccount.accountAddress
                )
            const safeTypedData = getSafeMessageEip712Data(
                smartAccount.accountAddress,
                chainId,
                siweMessage
            )
            const owner1signature = await firstOwnerAccount.signTypedData(
                {
                  domain:safeTypedData.domain as TypedDataDomain,
                  types:safeTypedData.types,
                  primaryType: SAFE_MESSAGE_PRIMARY_TYPE,
                  message: safeTypedData.messageValue            
                }
            );

            const owner2signature = await secondOwnerAccount.signTypedData(
                {
                  domain:safeTypedData.domain as TypedDataDomain,
                  types:safeTypedData.types,
                  primaryType: SAFE_MESSAGE_PRIMARY_TYPE,
                  message: safeTypedData.messageValue            
                }
            );

            const signature = SafeAccount.buildSignaturesFromSingerSignaturePairs(
                [
                    {signer: firstOwnerPublicAddress, signature: owner1signature},
                    {signer: secondOwnerPublicAddress, signature: owner2signature},
                ]
            )
            const registrations = await recoveryByCustodialGuardian.getRegistrations(
                smartAccount.accountAddress,
                siweMessage,
                signature
            );
            expect(registrations[0].id).toBe(registrationId);
            expect(registrations[0].target).toBe(email);
            expect(registrations[0].channel).toBe("email");
        });
    });

    describe('deleteRegistration', () => { 
        it('should fail if only one owner signed', async () => {
            const siweMessage =
                recoveryByCustodialGuardian.deleteRegistrationSiweStatementToSign(
                    smartAccount.accountAddress,
                    registrationId
                )
            const safeTypedData = getSafeMessageEip712Data(
                smartAccount.accountAddress,
                chainId,
                siweMessage
            )
            const owner1signature = await firstOwnerAccount.signTypedData(
                {
                  domain:safeTypedData.domain as TypedDataDomain,
                  types:safeTypedData.types,
                  primaryType: SAFE_MESSAGE_PRIMARY_TYPE,
                  message: safeTypedData.messageValue            
                }
            );

            const signature = SafeAccount.buildSignaturesFromSingerSignaturePairs(
                [
                    {signer: firstOwnerPublicAddress, signature: owner1signature},
                ]
            )
            expect(recoveryByCustodialGuardian.deleteRegistration(
                registrationId,
                siweMessage,
                signature
            )).rejects.toThrow("invalid signature");;
        });

        it('should succeed if correct signature', async () => {
            const siweMessage =
                recoveryByCustodialGuardian.deleteRegistrationSiweStatementToSign(
                    smartAccount.accountAddress,
                    registrationId
                )
            const safeTypedData = getSafeMessageEip712Data(
                smartAccount.accountAddress,
                chainId,
                siweMessage
            )
            const owner1signature = await firstOwnerAccount.signTypedData(
                {
                  domain:safeTypedData.domain as TypedDataDomain,
                  types:safeTypedData.types,
                  primaryType: SAFE_MESSAGE_PRIMARY_TYPE,
                  message: safeTypedData.messageValue            
                }
            );

            const owner2signature = await secondOwnerAccount.signTypedData(
                {
                  domain:safeTypedData.domain as TypedDataDomain,
                  types:safeTypedData.types,
                  primaryType: SAFE_MESSAGE_PRIMARY_TYPE,
                  message: safeTypedData.messageValue            
                }
            );

            const signature = SafeAccount.buildSignaturesFromSingerSignaturePairs(
                [
                    {signer: firstOwnerPublicAddress, signature: owner1signature},
                    {signer: secondOwnerPublicAddress, signature: owner2signature},
                ]
            )
            expect(recoveryByCustodialGuardian.deleteRegistration(
                    registrationId,
                    siweMessage,
                    signature
            )).resolves.toBe(true);
        });

        it('getSubscriptions should return an empty array after deletion', async ()=>{
            await new Promise(resolve => setTimeout(resolve, 5*1000)); //5 seconds

            const siweMessage =
                recoveryByCustodialGuardian.getRegistrationsSiweStatementToSign(
                    smartAccount.accountAddress
                )
            const safeTypedData = getSafeMessageEip712Data(
                smartAccount.accountAddress,
                chainId,
                siweMessage
            )
            const owner1signature = await firstOwnerAccount.signTypedData(
                {
                  domain:safeTypedData.domain as TypedDataDomain,
                  types:safeTypedData.types,
                  primaryType: SAFE_MESSAGE_PRIMARY_TYPE,
                  message: safeTypedData.messageValue            
                }
            );

            const owner2signature = await secondOwnerAccount.signTypedData(
                {
                  domain:safeTypedData.domain as TypedDataDomain,
                  types:safeTypedData.types,
                  primaryType: SAFE_MESSAGE_PRIMARY_TYPE,
                  message: safeTypedData.messageValue            
                }
            );

            const signature = SafeAccount.buildSignaturesFromSingerSignaturePairs(
                [
                    {signer: firstOwnerPublicAddress, signature: owner1signature},
                    {signer: secondOwnerPublicAddress, signature: owner2signature},
                ]
            )
            expect(recoveryByCustodialGuardian.getRegistrations(
                smartAccount.accountAddress,
                siweMessage,
                signature
            )).resolves.toStrictEqual([]);
        });

        it('can create a new registration with the same parameters after deletion', async ()=>{
            const siweMessage =
                recoveryByCustodialGuardian.createRegistrationToEmailRecoverySiweStatementToSign(
                    smartAccount.accountAddress,
                    email
                )
            const safeTypedData = getSafeMessageEip712Data(
                smartAccount.accountAddress,
                chainId,
                siweMessage
            )
            const owner1signature = await firstOwnerAccount.signTypedData(
                {
                  domain:safeTypedData.domain as TypedDataDomain,
                  types:safeTypedData.types,
                  primaryType: SAFE_MESSAGE_PRIMARY_TYPE,
                  message: safeTypedData.messageValue            
                }
            );

            const owner2signature = await secondOwnerAccount.signTypedData(
                {
                  domain:safeTypedData.domain as TypedDataDomain,
                  types:safeTypedData.types,
                  primaryType: SAFE_MESSAGE_PRIMARY_TYPE,
                  message: safeTypedData.messageValue            
                }
            );

            const signature = SafeAccount.buildSignaturesFromSingerSignaturePairs(
                [
                    {signer: firstOwnerPublicAddress, signature: owner1signature},
                    {signer: secondOwnerPublicAddress, signature: owner2signature},
                ]
            )
            registrationChallengeId =
                await recoveryByCustodialGuardian.createRegistrationToEmailRecovery(
                    smartAccount.accountAddress,
                    email,
                    siweMessage,
                    signature
                );

            
            await new Promise(resolve => setTimeout(resolve, 5*1000)); //5 seconds

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

            const registrationResult =
                await recoveryByCustodialGuardian.submitRegistrationChallenge(
                    registrationChallengeId, otp
                );
            registrationId = registrationResult.registrationId;
            guardianAddress = registrationResult.guardianAddress;

        });
    });

    describe('requestCustodialGuardianSignatureChallenge', () => { 
        it('should fail if custodial guardian is not added as a guardian', async ()=>{
            expect(recoveryByCustodialGuardian.requestCustodialGuardianSignatureChallenge(
                smartAccount.accountAddress,
                [newOwnerPublicAddress],
                1
            )).rejects.toThrow(
                "This account has not set '" +
                guardianAddress.toLowerCase() +
                "' as a guardian"
            );
        });

        it('should succeed if custodial guardian is added as a guardian', async ()=>{
            const transction = srm.createAddGuardianWithThresholdMetaTransaction(
                guardianAddress,
                1n //threshold
            );
            let userOperation = await smartAccount.createUserOperation(
                [transction],
                nodeUrl,
                bundlerUrl,
            )

            const paymaster = new CandidePaymaster(paymasterUrl)

            let [paymasterUserOperation, _sponsorMetadata] = await paymaster.createSponsorPaymasterUserOperation(
                userOperation, bundlerUrl)
            userOperation = paymasterUserOperation;

            userOperation.signature = smartAccount.signUserOperation(
                userOperation,
                [firstOwnerPrivateKey, secondOwnerPrivateKey],
                chainId,
            )

            const sendUserOperationResponse = await smartAccount.sendUserOperation(
                userOperation, bundlerUrl
            )

            console.log("Useroperation sent. Waiting to be included ......")
            let userOperationReceiptResult = await sendUserOperationResponse.included()

            console.log("Useroperation receipt received.")

            const signatureRequest =
                await recoveryByCustodialGuardian.requestCustodialGuardianSignatureChallenge(
                    smartAccount.accountAddress,
                    [newOwnerPublicAddress],
                    1
                );
            await new Promise(resolve => setTimeout(resolve, 5*1000)); //5 seconds

            expect(signatureRequest.auths.length).toBe(1);
            requestId = signatureRequest.requestId;
            submitChallengeId = signatureRequest.auths[0].challengeId;
        });
    });

    describe('submitCustodialGuardianSignatureChallenge', () => { 
        it('should fail to activate if invalid requestId', async ()=>{
            expect(recoveryByCustodialGuardian.submitCustodialGuardianSignatureChallenge(
                "wrongrequestid", "wrongchallengeid", "wrongotp"
            )).rejects.toThrow("requestId not found");
        });

        it('should fail to activate if invalid otp', async ()=>{
            expect(recoveryByCustodialGuardian.submitCustodialGuardianSignatureChallenge(
                requestId, submitChallengeId, "wrongotp"
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
            const submitChallengeResult = 
                await recoveryByCustodialGuardian.submitCustodialGuardianSignatureChallenge(
                    requestId, submitChallengeId, otp
                );
            expect(submitChallengeResult.success).toBe(true);
            expect(submitChallengeResult.custodianGuardianAddress).toBe(
                guardianAddress.toLowerCase());

            custodianGuardianAddress = 
                submitChallengeResult.custodianGuardianAddress as string;
            custodianGuardianSignature =
                submitChallengeResult.custodianGuardianSignature as string;
        });
    });

    describe('createAndExecuteRecoveryRequest', () => { 
        it('should succeed to finalize the recovery request', async () => {
            const recoveryRequest =
                await recoveryByCustodialGuardian.createAndExecuteRecoveryRequest(
                    smartAccount.accountAddress,
                    [newOwnerPublicAddress],
                    1,
                    custodianGuardianAddress,
                    custodianGuardianSignature
                );
            const oldOwners = await smartAccount.getOwners(nodeUrl);
            expect(oldOwners).toStrictEqual(
                [firstOwnerPublicAddress, secondOwnerPublicAddress]
            )

            console.log("start waiting for recovery grace period");
            await new Promise(resolve => setTimeout(resolve, 4*60*1000)); //3 minutes
            console.log("stop waiting for recovery grace period");

            expect(await recoveryByGuardian.finalizeRecoveryRequest(
                recoveryRequest.id
            )).toBe(true);

            await new Promise(resolve => setTimeout(resolve, 20*1000)); //20 seconds
            const newOwners = await smartAccount.getOwners(nodeUrl);
            expect(newOwners).toStrictEqual(
                [newOwnerPublicAddress]
            )
        });
    });
});
