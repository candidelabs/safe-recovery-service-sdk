import {SocialRecoveryModule} from "abstractionkit";
import {ethers} from "ethers";
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

/**
 * Service client for interacting with the Safe Recovery backend
 * using the Social Recovery Module (guardian-based recovery mechanism).
 *
 * This class provides high-level methods to:
 * - Query pending, executed, or finalized recovery requests.
 * - Create new recovery requests with updated owners and threshold.
 * - Submit guardian signatures for existing recovery requests.
 * - Execute or finalize recovery requests once the necessary conditions are met.
 *
 * Key Features:
 * 1. **Status-based Retrieval** – Fetch recovery requests for the latest relevant nonce,
 *    filtered by status ("PENDING", "EXECUTED", or "FINALIZED").
 * 2. **Nonce Management** – Automatically adjusts which nonce to use based on the
 *    recovery status being queried.
 * 3. **Error Safety** – Wraps unexpected responses and RPC errors in
 *    `SafeRecoveryServiceSdkError` for consistent error handling.
 * 4. **Chain-aware** – Supports specifying `chainId` and recovery module address
 *    for interacting with the correct blockchain network.
 * 5. **Guardian Operations** – Handles guardian signature submission and
 *    recovery execution/finalization lifecycle.
 *
 * Typical Usage:
 * ```ts
 * const recoveryService = new RecoveryByGuardianService(
 *   "https://api.saferecovery.example",
 *   1n, // Ethereum mainnet chainId
 * );
 *
 * // Fetch pending requests
 * const pending = await recoveryService.getPendingRecoveryRequestsForLatestNonce(
 *   "https://mainnet.infura.io/v3/YOUR_KEY",
 *   "0xAccountAddress..."
 * );
 *
 * // Create a recovery request
 * await recoveryService.createRecoveryRequest(
 *   "0xAccountAddress...",
 *   ["0xNewOwner1...", "0xNewOwner2..."],
 *   2,
 *   "0xGuardianAddress...",
 *   guardianSignature
 * );
 * ```
 */
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

  /**
   * Fetches all recovery requests with status = "PENDING" for the latest recovery nonce of a given account.
   * @param rpcNode RPC node URL used to fetch recovery nonce.
   * @param accountAddress Address of the account to recover.
   * @returns List of pending recovery requests.
   */
  async getPendingRecoveryRequestsForLatestNonce(
      rpcNode: string,
      accountAddress: string,
  ):Promise<RecoveryByGuardianRequest[]>{
      return this.getRecoveryRequestsForLatestNonce(
          rpcNode, accountAddress, "PENDING"
      )
  }


  /**
   * Retrieves the single EXECUTED recovery request for the latest nonce of a given account.
   * @param rpcNode RPC node URL.
   * @param accountAddress Address of the account to recover.
   * @returns The executed recovery request or null if none exists.
   */
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

  /**
   * Retrieves the single FINALIZED recovery request for the latest nonce of a given account.
   * @param rpcNode RPC node URL.
   * @param accountAddress Address of the account to recover.
   * @returns The finalized recovery request or null if none exists.
   */
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

   /**
   * Fetches all recovery requests for the latest relevant nonce filtered by a given status.
   * If status is not "PENDING", the nonce is decremented by 1.
   * @param rpcNode RPC node URL.
   * @param accountAddress Account to recover.
   * @param status Status filter ("PENDING" | "EXECUTED" | "FINALIZED").
   * @returns Filtered list of recovery requests.
   */
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

   /**
   * Retrieves all recovery requests for a given account and recovery nonce from the service API.
   * @param accountAddress Account address.
   * @param recoveryNonce Recovery nonce.
   * @returns List of recovery requests.
   */
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

  /**
   * Creates a new recovery request for an account with updated owners and threshold, signed by a guardian.
   * @param accountAddress Account being recovered.
   * @param newOwners New owner addresses.
   * @param newThreshold New threshold for signatures.
   * @param guardianAddress Guardian’s address.
   * @param guardianSignature Guardian’s signature.
   * @returns The newly created recovery request.
   */
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

  /**
   * Submits a guardian’s signature for an existing recovery request.
   * @param id Recovery request ID.
   * @param guardianAddress Guardian’s address.
   * @param guardianSignature Guardian’s signature.
   * @returns True if submission was successful, false otherwise.
   */
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

  /**
   * Executes a recovery request.
   * @param id Recovery request ID.
   * @returns True if execution was successful, false otherwise.
   */
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

  /**
   * Finalizes a recovery request.
   * @param id Recovery request ID.
   * @returns True if finalization was successful, false otherwise.
   */
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
