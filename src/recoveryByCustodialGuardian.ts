import { generateSIWEMessage, getNetworkConfig, sendHttpRequest } from "./utils";
import { SafeRecoveryServiceSdkError, ensureError } from "./errors";
import { RecoveryByGuardianRequest, RecoveryByGuardianService } from "./recoveryByGuardian";

export type Registration = {
    id: string;
    channel: string;
    target: string;
}

export type SignatureRequest = {
    requestId: string;
    requiredVerifications: number;
    auths: {
        challengeId: string;
        channel: string;
        target: string;
    }[];
}

/**
 * RecoveryByCustodialGuardian provides an interface to interact with the
 * Safe Recovery Service using custodial guardians (via email or SMS).
 *
 * It supports:
 * - Registering and removing recovery methods (email or SMS).
 * - Submitting OTP challenges to complete registration.
 * - Requesting and executing account recovery flows.
 * - Managing SIWE (Sign-In With Ethereum) statements for all flows.
 *
 * @example
 * ```ts
 * const recovery = new RecoveryByCustodialGuardian(
 *  "https://service.endpoint",
 *  1n //chainId
 * );
 *
 * // Create a SIWE statement for email registration
 * const siweMessage = recovery.createRegistrationToEmailRecoverySiweStatementToSign(
 *   "0xSafeAccount",
 *   "user@example.com"
 * );
 *
 * // Register an email recovery method
 * const challengeId = await recovery.createRegistrationToEmailRecovery(
 *   "0xSafeAccount",
 *   "user@example.com",
 *   "0xSignature"
 * );
 * ```
 *
 * @throws {SafeRecoveryServiceSdkError}
 */
export class RecoveryByCustodialGuardian {
  readonly serviceEndpoint;
  readonly chainId;
  readonly siweDomain;
  readonly siweUri;

  /**
   * Creates a new RecoveryByCustodialGuardian instance.
   * @param serviceEndpoint - Base URL of the recovery service.
   * @param chainId - Blockchain chain ID.
   * @param overrides - Optional overrides for SIWE domain and URI.
   */
  constructor(
      serviceEndpoint: string,
      chainId: bigint,
      overrides: {
        siweDomain?: string,
        siweUri?: string
      } = {}
  ) {
      this.serviceEndpoint = serviceEndpoint;
      this.chainId = chainId;
      this.siweDomain = overrides.siweDomain?? "service://safe-recovery-service";
      this.siweUri = overrides.siweUri?? "service://safe-recovery-service";
  }

  /**
   * Generates a SIWE statement for retrieving all authentication methods.
   * @param accountAddress - a safe account address.
   * @returns SIWE message string.
   */
  getRegistrationsSiweStatementToSign(accountAddress: string): string{
    let statement =
        "I request to retrieve all authentication methods currently registered to my account with Safe Recovery Service";
    try {
        return generateSIWEMessage(
          accountAddress,
          statement,
          this.chainId,
          this.siweDomain,
          this.siweUri
        );
    } catch (err) {
        const error = ensureError(err);

        throw new SafeRecoveryServiceSdkError(
            "SIWE_ERROR",
            error.message,
            {
                cause: error,
                context:{
                    accountAddress,
                    statement,
                    chainId: parseInt(this.chainId.toString()),
                }
            }
        );
    }
  }

  /**
   * Retrieves all registered authentication methods for an account.
   * @param accountAddress - a safe account address.
   * @param siweMessage - SIWE message to sign by an owner.
   * @param eip1271SiweContractSignature - EIP-1271 contract signature for SIWE.
   * @returns Array of Registration objects.
   */
  async getRegistrations(
      accountAddress: string,
      siweMessage: string,
      eip1271SiweContractSignature: string
  ): Promise<Registration[]> {
    const fullServiceEndpointUrl = `${this.serviceEndpoint}/v1/auth/registrations`;

    const response = await sendHttpRequest(
        fullServiceEndpointUrl,
        {
            account: accountAddress,
            chainId: parseInt(this.chainId.toString()),
            message: siweMessage,
            signature: eip1271SiweContractSignature
        },
        "get"
    )as {registrations:Registration[]}; 
    const registrations = response["registrations"] as Registration[];

    for(const element of registrations){
        if (
            typeof element !== 'object' || element === null ||
            ! ("id" in element) || ! (typeof element["id"] === 'string') ||
            ! ("channel" in element) || ! (typeof element["channel"] === 'string') ||
            ! ("target" in element) || ! (typeof element["target"] === 'string')
        ){
            throw new SafeRecoveryServiceSdkError(
                "BAD_DATA",
                `${fullServiceEndpointUrl} failed`,
                {
                    context:{
                        response:JSON.stringify(response),
                    }
                }
            );
        }
    }
    return registrations;
  }

  /**
   * Generates a SIWE statement for registering an email recovery method.
   * @param accountAddress - User's account address.
   * @param email - Email to register.
   * @returns SIWE message string.
   */
   createRegistrationToEmailRecoverySiweStatementToSign(
    accountAddress: string,
    email: string,
  ): string{
      return this.createRegistrationToRecoverySiweStatementToSign(
          accountAddress, "email", email
      ); 
  } 

  /**
   * Registers an email recovery method.
   * @param accountAddress - User's account address.
   * @param email - Email to register.
   * @param eip1271SiweContractSignature - EIP-1271 contract signature.
   * @returns Challenge ID string.
   */
   async createRegistrationToEmailRecovery(
      accountAddress: string,
      email: string,
      siweMessage: string,
      eip1271SiweContractSignature: string
  ): Promise<string>{
    return await this.createRegistrationToRecovery(
        accountAddress,
        "email",
        email,
        siweMessage,
        eip1271SiweContractSignature
    )
  }

  /**
   * Generates a SIWE statement for registering an SMS recovery method.
   * @param accountAddress - User's account address.
   * @param phoneNumber - Phone number to register.
   * @returns SIWE message string.
   */
   createRegistrationToSmsRecoverySiweStatementToSign(
    accountAddress: string,
    phoneNumber: string,
  ): string{
      return this.createRegistrationToRecoverySiweStatementToSign(
          accountAddress, "sms", phoneNumber
      ); 
  } 

  /**
   * Registers an SMS recovery method.
   * @param accountAddress - User's account address.
   * @param phoneNumber - Phone number to register.
   * @param eip1271SiweContractSignature - EIP-1271 contract signature.
   * @returns Challenge ID string.
   */
  async createRegistrationToSmsRecovery(
      accountAddress: string,
      phoneNumber: string,
      siweMessage: string,
      eip1271SiweContractSignature: string
  ): Promise<string>{
    return await this.createRegistrationToRecovery(
        accountAddress,
        "sms",
        phoneNumber,
        siweMessage,
        eip1271SiweContractSignature
    )
  }

  /**
   * Generates a SIWE statement for registering a recovery method.
   * @param accountAddress - User's account address.
   * @param channel - Recovery channel ("sms" or "email").
   * @param channelTarget - Target (email address or phone number).
   * @returns SIWE message string.
   */
  createRegistrationToRecoverySiweStatementToSign(
    accountAddress: string,
    channel: "sms" | "email",
    channelTarget: string,
  ): string{
    let statement =
        "I authorize Safe Recovery Service to sign a recovery request for my account after I authenticate using {{target}} (via {{channel}})";
    statement = statement.replace(
          "{{target}}", channelTarget).replace("{{channel}}", channel);
        return generateSIWEMessage(
          accountAddress,
          statement,
          this.chainId,
          this.siweDomain,
          this.siweUri
        );
  }

  /**
   * Registers a recovery method.
   * @param accountAddress - User's account address.
   * @param channel - Recovery channel ("sms" or "email").
   * @param channelTarget - Target (email address or phone number).
   * @param siweMessage - SIWE message to sign by an owner.
   * @param eip1271SiweContractSignature - EIP-1271 contract signature.
   * @returns Challenge ID string.
   */
  async createRegistrationToRecovery(
      accountAddress: string,
      channel: "sms" | "email",
      channelTarget: string,
      siweMessage: string,
      eip1271SiweContractSignature: string
  ): Promise<string>{
    const fullServiceEndpointUrl = `${this.serviceEndpoint}/v1/auth/register`;
    const response = await sendHttpRequest(
        fullServiceEndpointUrl,
        {
            account: accountAddress,
            chainId: parseInt(this.chainId.toString()),
            channel,
            target: channelTarget,
            message: siweMessage,
            signature: eip1271SiweContractSignature
        }
    );

    if (
        typeof response !== 'object' || response === null ||
        ! ("challengeId" in response) || ! (typeof response["challengeId"] === 'string')
    ){
        throw new SafeRecoveryServiceSdkError(
            "BAD_DATA",
            `${fullServiceEndpointUrl} failed`,
            {
                cause:ensureError(response),
                context:{
                    account: accountAddress,
                    chainId: parseInt(this.chainId.toString()),
                    channel,
                    channelTarget,
                    message: siweMessage,
                    eip1271SiweContractSignature
                }
            }
        );
    }else{
        return response["challengeId"];
    }
  }


  /**
   * Submits the OTP challenge for a registration.
   * @param challengeId - Challenge ID from registration.
   * @param otpChallenge - OTP value.
   * @returns Object containing registrationId and guardianAddress.
   */
  async submitRegistrationChallenge(
      challengeId: string, otpChallenge: string
  ) :Promise<{registrationId: string, guardianAddress: string}>{
    const fullServiceEndpointUrl = `${this.serviceEndpoint}/v1/auth/submit`;
    const response = await sendHttpRequest(
        fullServiceEndpointUrl,
        {
            challengeId,
            challenge: otpChallenge
        }
    );

    if (
        typeof response !== 'object' ||
        response === null ||
        ! ("registrationId" in response) ||
        ! (typeof response["registrationId"] === 'string') ||
        ! ("guardianAddress" in response) ||
        ! (typeof response["guardianAddress"] === 'string')
    ){
        throw new SafeRecoveryServiceSdkError(
            "BAD_DATA",
            `${fullServiceEndpointUrl} failed`,
            {
                cause:ensureError(response),
                context:{
                    challengeId,
                    challenge: otpChallenge
                }
            }
        );
    }else{
        return response as {registrationId: string, guardianAddress: string};
    }
  }

  /**
   * Generates a SIWE statement for deleting a registration.
   * @param accountAddress - Safe's account address.
   * @param registrationId - Registration ID to remove.
   * @returns SIWE message string.
   */
  deleteRegistrationSiweStatementToSign(
      accountAddress: string, registrationId: string
  ): string{
    let statement =
        "I request to remove the authentication method with registration ID {{id}} from my account on Safe Recovery Service";

    statement = statement.replace("{{id}}", registrationId);
        return generateSIWEMessage(
          accountAddress,
          statement,
          this.chainId,
          this.siweDomain,
          this.siweUri
        );
  }

  /**
   * Deletes a registration from the service.
   * @param registrationId - Registration ID to remove.
   * @param siweMessage - SIWE message to sign by an owner.
   * @param eip1271SiweContractSignature - EIP-1271 contract signature.
   * @returns Boolean true if successful.
   */
  async deleteRegistration(
      registrationId: string,
      siweMessage: string,
      eip1271SiweContractSignature: string
  ): Promise<boolean>{
    const fullServiceEndpointUrl = `${this.serviceEndpoint}/v1/auth/delete`;
    const response = await sendHttpRequest(
        fullServiceEndpointUrl,
        {
            registrationId,
            message: siweMessage,
            signature: eip1271SiweContractSignature
        }
    );

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
                    registrationId,
                    message: siweMessage,
                    eip1271SiweContractSignature,
                }
            }
        );
    }else{
        return response["success"];
    }
  }

  /**
   * Requests custodial guardian signature challenge.
   * @param accountAddress - Safe's account address.
   * @param newOwners - List of new owners for the Safe.
   * @param newThreshold - New threshold value.
   * @returns SignatureRequest object.
   */
  async requestCustodialGuardianSignatureChallenge(
      accountAddress: string, newOwners: string[], newThreshold: number
  ) :Promise<SignatureRequest>{
    const fullServiceEndpointUrl = `${this.serviceEndpoint}/v1/auth/signature/request`;
    const response = await sendHttpRequest(
        fullServiceEndpointUrl,
        {
            account: accountAddress,
            newOwners,
            newThreshold,
            chainId: parseInt(this.chainId.toString()),
        }
    ) as SignatureRequest;
    if (
        typeof response !== 'object' || response === null ||
        ! ("requestId" in response) || ! (typeof response["requestId"] === 'string') ||
        ! ("requiredVerifications" in response) ||
        ! (typeof response["requiredVerifications"] === 'number')
    ){
        throw new SafeRecoveryServiceSdkError(
            "BAD_DATA",
            `${fullServiceEndpointUrl} failed`,
            {
                cause:ensureError(response),
                context:{
                    account: accountAddress,
                    newOwners,
                    newThreshold,
                    chainId: parseInt(this.chainId.toString()),
                }
            }
        );
    }else{
        return response;
    }
  }

  /**
   * Submit custodial guardian signature challenge.
   * @param requestId - ID of the signature request.
   * @param challengeId - ID of the OTP challenge.
   * @param otpChallenge - OTP value.
   * @returns Object with success flag,
   * custodianGuardianAddress and custodianGuardianSignature are
   * retuned if collectedVerifications >= signatureRequest.requiredVerifications
   */
  async submitCustodialGuardianSignatureChallenge(
      requestId: string, challengeId: string, otpChallenge: string
  ) :Promise<{
        success: boolean;
        custodianGuardianAddress?: string;
        custodianGuardianSignature?: string;
    }>
  {
    const fullServiceEndpointUrl = `${this.serviceEndpoint}/v1/auth/signature/submit`;

    const response = await sendHttpRequest(
        fullServiceEndpointUrl,
        {
            requestId,
            challengeId,
            challenge: otpChallenge
        }
    )as {
        success: boolean,
        signer?: string,
        signature?: string
    };

    return {
        success: response.success,
        custodianGuardianAddress: response.signer,
        custodianGuardianSignature: response.signature
    };
  }

  /**
   * Creates and executes a recovery request for a Safe account using a guardian.
   *
   * This function performs the following steps:
   * 1. Fetches the network configuration for the given chain.
   * 2. Initializes the `RecoveryByGuardianService`.
   * 3. Creates a recovery request with the provided account, owners, threshold, and guardian details.
   * 4. Executes the recovery request.
   *
   * If execution fails, it throws a `SafeRecoveryServiceSdkError`.
   *
   * @param accountAddress - The Safe account address to recover.
   * @param newOwners - An array of new owner addresses for the Safe.
   * @param newThreshold - The new threshold.
   * @param custodianGuardianAddress - The address of the custodian guardian authorizing the recovery.
   * @param custodianGuardianSignature - The signature from the custodian guardian.
   * @returns RecoveryByGuardianRequest - The created recovery request object.
   */
  async createAndExecuteRecoveryRequest(
      accountAddress: string,
      newOwners: string[],
      newThreshold: number,
      custodianGuardianAddress:string,
      custodianGuardianSignature:string
  ) :Promise<RecoveryByGuardianRequest>{
      const networkConfig = await getNetworkConfig(this.serviceEndpoint, this.chainId);
      const recoveryByGuardianService = new RecoveryByGuardianService(
          this.serviceEndpoint,
          this.chainId,
          networkConfig.moduleAddress
      );

      const recoveryRequest = await recoveryByGuardianService.createRecoveryRequest(
          accountAddress,
          newOwners,
          newThreshold,
          custodianGuardianAddress,
          custodianGuardianSignature
      )
      const success = await recoveryByGuardianService.executeRecoveryRequest(
          recoveryRequest.id
      )

      if(!success){
        throw new SafeRecoveryServiceSdkError(
            "BAD_DATA",
            "executeRecoveryRequest failed",
            {
                context:{
                    recoveryRequestId: recoveryRequest.id
                }
            }
        );
      }

      return recoveryRequest;
  }
}
