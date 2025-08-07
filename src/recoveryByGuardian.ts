import {SocialRecoveryModule} from "abstractionkit";
import { ethers } from "ethers";
import { SafeRecoveryServiceSdkError, ensureError } from "./errors";
import { sendHttpRequest, SocialRecoveryModuleGracePeriodSelector } from "./utils";

export type RecoveryByGuardianRequest = {
    id: string,
    emoji: string,
    account: string
    newOwners: string[],
    newThreshold: number,
    chainId: number,
    nonce: bigint,
    signatures: string[],
    executeData: {sponsored: boolean, transactionHash?: string},
    finalizeData: {sponsored: boolean, transactionHash?: string},
    status: "PENDING" | "EXECUTED" | "FINALIZED",
    discoverable: boolean,
    createdAt: string,
    updatedAt: string
}

export class RecoveryByGuardianService {
  readonly serviceEndpoint;
  readonly chainId;
  readonly recoveryModuleAddress: SocialRecoveryModuleGracePeriodSelector;

  constructor(
      serviceEndpoint: string,
      chainId: bigint,
      recoveryModuleAddress: SocialRecoveryModuleGracePeriodSelector
  ) {
      this.serviceEndpoint = serviceEndpoint;
      this.chainId = chainId;
      this.recoveryModuleAddress = recoveryModuleAddress;
  }

  async getPendingRecoveryRequestsForLatestNonce(
      rpcNode: string,
      accountAddress: string,
  ):Promise<RecoveryByGuardianRequest[]>{
      return this.getRecoveryRequestsForLatestNonce(
          rpcNode, accountAddress, "PENDING"
      )
  }

  async getExecutedRecoveryRequestForLatestNonce(
      rpcNode: string,
      accountAddress: string,
  ):Promise<RecoveryByGuardianRequest | null>{
      const recoveryRequests = await this.getRecoveryRequestsForLatestNonce(
          rpcNode, accountAddress, "EXECUTED"
      )
      if(recoveryRequests.length == 0){
          return null;
      }else if(recoveryRequests.length == 1){
          return recoveryRequests[0];
      }else{
        throw new SafeRecoveryServiceSdkError(
            "BAD_DATA",
            'getExecutedRecoveryRequestsForLatestNonce failed',
            {
                cause: ensureError("there can be only one EXECUTED recovery per nonce"),
            }
        );
      }
  }

  async getFinalizedRecoveryRequestForLatestNonce(
      rpcNode: string,
      accountAddress: string,
  ):Promise<RecoveryByGuardianRequest | null>{
      const recoveryRequests = await this.getRecoveryRequestsForLatestNonce(
          rpcNode, accountAddress, "FINALIZED"
      )
      if(recoveryRequests.length == 0){
          return null;
      }else if(recoveryRequests.length == 1){
          return recoveryRequests[0];
      }else{
        throw new SafeRecoveryServiceSdkError(
            "BAD_DATA",
            'getFinalizedRecoveryRequestsForLatestNonce failed',
            {
                cause: ensureError(
                    "there can be only one FINALIZED recovery per nonce"
                ),
            }
        );
      }
  }

  async getRecoveryRequestsForLatestNonce(
      rpcNode: string,
      accountAddress: string,
      status: "PENDING" | "EXECUTED" | "FINALIZED"
  ):Promise<RecoveryByGuardianRequest[]>{
    let recoveryNonce;
    try {
       const socialRecoveryModule = new SocialRecoveryModule(
            this.recoveryModuleAddress
        );
        recoveryNonce = await socialRecoveryModule.nonce(rpcNode, accountAddress);
    } catch (err) {
        const error = ensureError(err);

        throw new SafeRecoveryServiceSdkError(
            "UNKNOWN_ERROR",
            "failed fetching nonce",
            {
                cause: error,
                context:{
                    accountAddress,
                    rpcNode
                }
            }
        );
    }

    if(recoveryNonce == 0n && status != "PENDING"){
        return [];
    }

    if(status != "PENDING"){
        recoveryNonce = recoveryNonce - 1n; // only PENDING are on the latest nonce
    }

    const result = await this.getRecoveryRequests(accountAddress, recoveryNonce);
    const recoveryRequests = [];

    for(const recoveryRequest of result){
        if(recoveryRequest.status == status){
            recoveryRequests.push(recoveryRequest)
        }
    }
    return recoveryRequests;
  }

  async getRecoveryRequests(
      accountAddress: string,
      recoveryNonce: bigint,
  ):Promise<RecoveryByGuardianRequest[]>{
    const fullServiceEndpointUrl =
        `${this.serviceEndpoint}/v1/recoveries/fetchByAddress`;
    const chainId = this.chainId as bigint;
    const response = await sendHttpRequest(
        fullServiceEndpointUrl,
        {
            account: accountAddress,
            chainId: parseInt(chainId.toString()),
            nonce: ethers.toQuantity(recoveryNonce)
        },
        "get"
    ) as RecoveryByGuardianRequest[];

    for(const request of response){
        request.nonce = BigInt(request.nonce);
    }
    return response;
  }

  async createRecoveryRequest(
      accountAddress: string,
      newOwners: string[],
      newThreshold: number,
      guardianAddress: string,
      guardianSignature: string,
  ):Promise<RecoveryByGuardianRequest>{
    const fullServiceEndpointUrl = `${this.serviceEndpoint}/v1/recoveries/create`;
    const chainId = this.chainId as bigint;

    const response = await sendHttpRequest(fullServiceEndpointUrl, {
        account: accountAddress,
        newOwners,
        newThreshold,
        chainId: parseInt(chainId.toString()),
        signer: guardianAddress,
        signature: guardianSignature
    }) as RecoveryByGuardianRequest;
   
    response.nonce = BigInt(response.nonce);
    return response;
  }

  async submitGuardianSignatureForRecoveryRequest(
      id: string, guardianAddress: string, guardianSignature: string
  ): Promise<boolean>{
    const fullServiceEndpointUrl = `${this.serviceEndpoint}/v1/recoveries/sign`;
    const response = await sendHttpRequest(fullServiceEndpointUrl, {
        id,
        signer: guardianAddress,
        signature: guardianSignature
    });
    if (
        typeof response !== 'object' ||
        response === null ||
        ! ("success" in response) ||
        ! (typeof response["success"] === 'boolean')
    ){
        throw new SafeRecoveryServiceSdkError(
            "BAD_DATA",
            `${fullServiceEndpointUrl} failed`,
            {
                cause:ensureError(response),
                context:{
                    id,
                    signer: guardianAddress,
                    signature: guardianSignature
                }
            }
        );
    }else{
        return response["success"];
    }
  }

  async executeRecoveryRequest(id: string): Promise<boolean>{
    const fullServiceEndpointUrl = `${this.serviceEndpoint}/v1/recoveries/execute`;
    const response = await sendHttpRequest(fullServiceEndpointUrl, {id});
    if (
        typeof response !== 'object' ||
        response === null ||
        ! ("success" in response) ||
        ! (typeof response["success"] === 'boolean')
    ){
        throw new SafeRecoveryServiceSdkError(
            "BAD_DATA",
            `${fullServiceEndpointUrl} failed`,
            {
                cause:ensureError(response),
                context:{
                    id,
                }
            }
        );
    }else{
        return response["success"];
    }
  }

  async finalizeRecoveryRequest(id: string): Promise<boolean>{
    const fullServiceEndpointUrl = `${this.serviceEndpoint}/v1/recoveries/finalize`;
    const response = await sendHttpRequest(fullServiceEndpointUrl, {id});

    if (
        typeof response !== 'object' ||
        response === null ||
        ! ("success" in response) ||
        ! (typeof response["success"] === 'boolean')
    ){
        throw new SafeRecoveryServiceSdkError(
            "BAD_DATA",
            `${fullServiceEndpointUrl} failed`,
            {
                cause:ensureError(response),
                context:{
                    id,
                }
            }
        );
    }else{
        return response["success"];
    }
  }
}
