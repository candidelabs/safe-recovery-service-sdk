import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import {
    CandidePaymaster,
    EXECUTE_RECOVERY_PRIMARY_TYPE,
    RecoveryRequest,
    SafeAccountV0_3_0,
    SocialRecoveryModule,
    SocialRecoveryModuleGracePeriodSelector,
} from "abstractionkit";
import { RecoveryByGuardianRequest, RecoveryByGuardianService } from "../src/recoveryByGuardian";
import { TypedDataDomain } from 'viem';
require('dotenv').config()

jest.setTimeout(300000);

const chainId = BigInt(process.env.CHAIN_ID as string)
const serviceUrl =process.env.SERVICE_URL as string
const bundlerUrl = process.env.BUNDLER_URL as string
const nodeUrl = process.env.NODE_URL as string
const paymasterUrl = process.env.PAYMASTER_URL as string;
const recoveryByGuardianService = new RecoveryByGuardianService(
    serviceUrl,
    chainId,
    SocialRecoveryModuleGracePeriodSelector.After3Minutes
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

const secondGuardianPrivateKey = generatePrivateKey();
const secondGuardianAccount =  privateKeyToAccount(secondGuardianPrivateKey);
const secondGuardianPublicAddress =  secondGuardianAccount.address;

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

    const transction3 = srm.createAddGuardianWithThresholdMetaTransaction(
        secondGuardianPublicAddress,
        2n //threshold
    );

    let userOperation = await smartAccount.createUserOperation(
        [transction1, transction2, transction3],
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

describe('RecoveryByGuardianService', () => {
    describe('createRecoveryRequest', () => {
        it('should fail if account is not a safe', async () => {
            
            await expect(recoveryByGuardianService.createRecoveryRequest(
                "0x0000000000000000000000000000000000000000",
                [newOwnerPublicAddress],
                1,
                firstGuardianPublicAddress,
                "0xff"
            )).rejects.toThrow('Account address is not a safe smart contract account');
        });

        it('should fail if wrong signature', async () => {
            await expect(recoveryByGuardianService.createRecoveryRequest(
                smartAccount.accountAddress,
                [newOwnerPublicAddress],
                1,
                firstGuardianPublicAddress,
                "0xff"
            )).rejects.toThrow('Invalid signature');
        });

        it('should succeed if correct signature', async () => {
            const recoveryRequestEip712Data = await srm.getRecoveryRequestEip712Data(
                nodeUrl,
                chainId,
                smartAccount.accountAddress,
                [newOwnerPublicAddress],
                1n,
            )

            const guardianSignature = await firstGuardianAccount.signTypedData({
                primaryType: EXECUTE_RECOVERY_PRIMARY_TYPE,
                domain: recoveryRequestEip712Data.domain as TypedDataDomain,
                types: recoveryRequestEip712Data.types,
                message: recoveryRequestEip712Data.messageValue
            })
            // should succeed
            const recoveryRequest = await recoveryByGuardianService.createRecoveryRequest(
                smartAccount.accountAddress,
                [newOwnerPublicAddress],
                1,
                firstGuardianPublicAddress,
                guardianSignature
            )

            expect(recoveryRequest.account).toBe(
                smartAccount.accountAddress.toLowerCase()
            );
            expect(recoveryRequest.chainId).toBe(Number(chainId));
            expect(recoveryRequest.newOwners).toStrictEqual(
                [newOwner.address.toLowerCase()]
            );
            expect(recoveryRequest.newThreshold).toBe(1);
            expect(recoveryRequest.nonce).toBe(0n);
            expect(recoveryRequest.signatures).toStrictEqual(
                [[firstGuardianPublicAddress, guardianSignature]]
            );
            expect(recoveryRequest.status).toBe("PENDING");
        });
    });

    describe('getRecoveryRequests', () => {
        it('should return an empty array if account is not a safe', async () => {
            const recoveryRequests =
                await recoveryByGuardianService.getRecoveryRequests(
                    "0x0000000000000000000000000000000000000000",
                    0n
                );
            expect(recoveryRequests.length).toBe(0);
        });

        it('should succedd and return a single recovery request', async () => {
            const recoveryRequests =
                await recoveryByGuardianService.getRecoveryRequests(
                    smartAccount.accountAddress,
                    0n
                ); 
            expect(recoveryRequests.length).toBe(1);
        });
    });

    describe('executeRecoveryRequest', () => {
       it('should fail if less than threshold signatures submitted', async () => {
            let pendingRecoveryRequests =
                await recoveryByGuardianService.getPendingRecoveryRequestsForLatestNonce(
                    nodeUrl,
                    smartAccount.accountAddress,
                );
            expect(pendingRecoveryRequests.length).toBe(1);
            const recoveryId = pendingRecoveryRequests[0].id;

            await expect(
                recoveryByGuardianService.executeRecoveryRequest(recoveryId)
            ).rejects.toThrow('This recovery request has insufficient signatures');
        });

        it('should succeed to execute recovery with suffeciant signatures', async () => {
            let executedRecoveryRequest = 
                await recoveryByGuardianService.getExecutedRecoveryRequestForLatestNonce(
                    nodeUrl,
                    smartAccount.accountAddress,
                )
            expect(executedRecoveryRequest).toBe(null);

            let pendingRecoveryRequests =
                await recoveryByGuardianService.getPendingRecoveryRequestsForLatestNonce(
                    nodeUrl,
                    smartAccount.accountAddress,
                );
            expect(pendingRecoveryRequests.length).toBe(1);
            const recoveryId = pendingRecoveryRequests[0].id;

            const recoveryRequestEip712Data = await srm.getRecoveryRequestEip712Data(
                nodeUrl,
                chainId,
                smartAccount.accountAddress,
                [newOwnerPublicAddress],
                1n,
            )
            const secondGuardianSignature = await secondGuardianAccount.signTypedData({
                primaryType: EXECUTE_RECOVERY_PRIMARY_TYPE,
                domain: recoveryRequestEip712Data.domain as TypedDataDomain,
                types: recoveryRequestEip712Data.types,
                message: recoveryRequestEip712Data.messageValue
            })

            //only needed if multiple signatures are needed
            expect(await recoveryByGuardianService.submitGuardianSignatureForRecoveryRequest(
                recoveryId, secondGuardianPublicAddress, secondGuardianSignature
            )).toBe(true);

            expect(await recoveryByGuardianService.executeRecoveryRequest(
                recoveryId
            )).toBe(true);

            console.log("start waiting for executing the recovery");
            await new Promise(resolve => setTimeout(resolve, 1*40*1000)); //30 seconds
            console.log("stop waiting for executing the recovery");

            executedRecoveryRequest = 
                await recoveryByGuardianService.getExecutedRecoveryRequestForLatestNonce(
                    nodeUrl,
                    smartAccount.accountAddress,
                ) as RecoveryByGuardianRequest;
            expect(executedRecoveryRequest.id).toBe(recoveryId);
            expect(executedRecoveryRequest.status).toBe("EXECUTED");

            pendingRecoveryRequests =
                await recoveryByGuardianService.getPendingRecoveryRequestsForLatestNonce(
                    nodeUrl,
                    smartAccount.accountAddress,
                );

            expect(pendingRecoveryRequests.length).toBe(0);
        });
    });

    describe('finalizeRecoveryRequest', () => {
       it('should fail if before grace period', async () => {
            const executedRecoveryRequest = 
                await recoveryByGuardianService.getExecutedRecoveryRequestForLatestNonce(
                    nodeUrl,
                    smartAccount.accountAddress,
                ) as RecoveryByGuardianRequest;

            const recoveryId = executedRecoveryRequest.id;

            await expect(
                recoveryByGuardianService.finalizeRecoveryRequest(recoveryId)
            ).rejects.toThrow('Recovery request is not yet ready for finalization');
        });

        it('should succeed to finalize recovery after grace period', async () => {
            console.log("start waiting for recovery grace period");
            await new Promise(resolve => setTimeout(resolve, 3*60*1000)); //3 minutes
            console.log("stop waiting for recovery grace period");

            let executedRecoveryRequest = 
                await recoveryByGuardianService.getExecutedRecoveryRequestForLatestNonce(
                    nodeUrl,
                    smartAccount.accountAddress,
                ) as RecoveryByGuardianRequest;

            const recoveryId = executedRecoveryRequest.id;
            expect(await recoveryByGuardianService.finalizeRecoveryRequest(
                recoveryId
            )).toBe(true);

            console.log("start waiting for executing the finalization transaction");
            await new Promise(resolve => setTimeout(resolve, 1*60*1000)); //1 minute
            console.log("stop waiting for executing the finalization transaction");
            

            executedRecoveryRequest = 
                await recoveryByGuardianService.getExecutedRecoveryRequestForLatestNonce(
                    nodeUrl,
                    smartAccount.accountAddress,
                ) as RecoveryByGuardianRequest;
            expect(executedRecoveryRequest).toBe(null);

            const finalizedRecoveryRequest = 
                await recoveryByGuardianService.getFinalizedRecoveryRequestForLatestNonce(
                    nodeUrl,
                    smartAccount.accountAddress,
                ) as RecoveryByGuardianRequest;
            expect(finalizedRecoveryRequest.status).toBe("FINALIZED");
        });
    });
});
