import { SafeRecoveryServiceSdkError, ensureError } from "./errors";
import { generateSIWEMessage, sendHttpRequest } from "./utils";

/**
 * A subscription record for Social Recovery Module alerts.
 * @public
 */
export type AlertsSubscription = {
    /** Unique subscription ID. */
    id: string;
    /** Delivery channel (e.g., "email" or "sms"). */
    channel: "email" | "sms";
    /** Target identifier for the channel (e.g., email address or phone number). */
    target: string;
};

/**
 * Service class for creating, retrieving, activating, and removing alert subscriptions.
 *
 * @remarks
 * - Network calls can throw {@link SafeRecoveryServiceSdkError} with useful `context`.
 *
 * @example
 * ```ts
 * const alerts = new Alerts("https://api.example.com", 8453n);
 * const msg = alerts.getSubscriptionsSiweStatementToSign("0xabc...");
 * // Sign `msg`, then:
 * const subs = await alerts.getSubscriptions("0xabc...", "0xcontractSig...");
 * ```
 *
 * @public
 */
export class Alerts {
  /** Base URL of the alerts service API. */
  readonly serviceEndpoint;
  /** EVM chain ID as a bigint. */
  readonly chainId;  
  /** Target SIWE domain */
  readonly siweDomain;
  /** Target SIWE URI. */
  readonly siweUri;

  /**
   * Create an `Alerts` client.
   * @param serviceEndpoint - Base URL of the alerts service API.
   * @param chainId - EVM chain ID (bigint form).
   * @param overrides.siweDomain - Target SIWE domain.
   * @param overrides.siweUri - Target SIWE URI..
   * @example
   * ```ts
   * const alerts = new Alerts("https://safe-recovery.example", 1n, {
   *   siweDomain: "service://safe-recovery-service",
   *   siweUri: "service://safe-recovery-service"
   * });
   * ```
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
   * Generate a SIWE statement to retrieve all subscriptions for `accountAddress`.
   * @param ownerAddress - The safe owner address.
   * @returns SIWE message string to sign by an owner.
   * @example
   * ```ts
   * const msg = alerts.getSubscriptionsSiweStatementToSign("0xabc...");
   * ```
   */
  getSubscriptionsSiweStatementToSign(ownerAddress: string): string{
    let statement =
        "I request to retrieve all Social Recovery Module alert subscriptions linked to my account";
    try {
        return generateSIWEMessage(
          ownerAddress,
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
                    owner: ownerAddress,
                    statement,
                    chainId: parseInt(this.chainId.toString()),
                }
            }
        );
    }
  }

  /**
   * Retrieve all active alert subscriptions linked to `ownerAddress`
   * with `accountAddress`.
   * @param accountAddress - The safe address whose subscriptions to fetch.
   * @param ownerAddress - The safe owner address.
   * @param siweMessage - SIWE message to sign by an owner.
   * @param siweOwnerSignature - Signature attesting to the SIWE message.
   * @returns Promise resolving to an array of {@link AlertsSubscription}.
   * @example
   * ```ts
   * const siweMsg = alerts.getSubscriptionsSiweStatementToSign(owner);
   * // sign externally, then:
   * const subs = await alerts.getSubscriptions(owner, contractSig);
   * ```
   */
  async getActiveSubscriptions(
      accountAddress: string,
      ownerAddress: string,
      siweMessage: string,
      siweOwnerSignature: string 
  ):Promise<AlertsSubscription[]> {
    const fullServiceEndpointUrl = `${this.serviceEndpoint}/v1/alerts/subscriptions`;
    const response = await sendHttpRequest(
        fullServiceEndpointUrl,
        {
            account: accountAddress,
            owner: ownerAddress,
            chainId: parseInt(this.chainId.toString()),
            message: siweMessage,
            signature: siweOwnerSignature
        },
        "get"
    ) as {subscriptions:AlertsSubscription[]};
    const subscriptions = response["subscriptions"] as AlertsSubscription[];
    for(const element of subscriptions){
        if (
            typeof element !== 'object' ||
            element === null ||
            ! ("id" in element) ||
            ! (typeof element["id"] === 'string') ||
            ! ("channel" in element) ||
            ! (typeof element["channel"] === 'string') ||
            ! ("target" in element) ||
            ! (typeof element["target"] === 'string')
        ){
            throw new SafeRecoveryServiceSdkError(
                "BAD_DATA",
                `${fullServiceEndpointUrl} failed`,
                {
                    context:{
                        response:JSON.stringify(
                            response,
                            (key, value) =>
                            typeof value === "bigint" ? "0x" + value.toString(16) : value,
                        ),
                    }
                }
            );
        }
    }
    return subscriptions;
  }

 /**
   * Generate a SIWE statement to create an **email** subscription.
   * @param accountAddress - The safe address.
   * @param ownerAddress - The safe owner address.
   * @param email - Target email address to receive alerts.
   * @returns SIWE message string to sign by an owner.
   * @example
   * ```ts
   * const msg = alerts.createEmailSubscriptionSiweStatementToSign("0xabc...", "alice@example.com");
   * ```
   */
  createEmailSubscriptionSiweStatementToSign(
    accountAddress: string, ownerAddress: string, email: string
  ): string{
      return this.createSubscriptionSiweStatementToSign(
          accountAddress, ownerAddress, "email", email
      );
  }

  /**
   * Create a new **email** subscription.
   * @param accountAddress - The safe address.
   * @param ownerAddress - The safe owner address.
   * @param email - Target email address to receive alerts.
   * @param siweMessage - SIWE message to sign by an owner.
   * @param siweOwnerSignature - An owner's signature attesting to the SIWE message.
   * @returns Promise resolving to the new `subscriptionId`.
   * @example
   * ```ts
   * const subId = await alerts.createEmailSubscription("0xabc...", "alice@example.com", sig);
   * ```
   */
  async createEmailSubscription(
      accountAddress: string,
      ownerAddress: string,
      email: string,
      siweMessage: string,
      siweOwnerSignature: string
  ):Promise<string> {
      return this.createSubscription(
          accountAddress,
          ownerAddress,
          "email",
          email,
          siweMessage,
          siweOwnerSignature
      );
  }

  /**
   * Generate a SIWE statement to create a subscription.
   * @param accountAddress - The safe address.
   * @param ownerAddress - The safe owner address.
   * @param channel - Delivery channel ("sms" | "email").
   * @param channelTarget - Target identifier (phone number for SMS, email address for email).
   * @returns SIWE message string to sign by an owner.
   * @example
   * ```ts
   * const msg = alerts.createSubscriptionSiweStatementToSign("0xabc...", "sms", "+15555550123");
   * ```
   */
  createSubscriptionSiweStatementToSign(
    accountAddress: string,
    ownerAddress: string,
    channel: "sms" | "email",
    channelTarget: string,
  ): string{
    let statement =
        "I agree to receive Social Recovery Module alert notifications for {{account}} on all supported chains sent to {{target}} (via {{channel}})";
    statement = statement.replace(
        "{{account}}", accountAddress.toLowerCase()
    ).replace(
        "{{target}}", channelTarget
    ).replace(
        "{{channel}}", channel
    );
    return generateSIWEMessage(
      ownerAddress,
      statement,
      this.chainId,
      this.siweDomain,
      this.siweUri
    );
  }

  /**
   * Create a new subscription.
   * @param accountAddress - The safe address.
   * @param ownerAddress - The safe owner address.
   * @param channel - Delivery channel ("sms" | "email").
   * @param channelTarget - Target identifier (phone number for SMS, email address for email).
   * @param siweMessage - SIWE message to sign by an owner.
   * @param siweOwnerSignature - Signature attesting to the SIWE message.
   * @returns Promise resolving to the new `subscriptionId`.
   */
  async createSubscription(
      accountAddress: string,
      ownerAddress: string,
      channel: "sms" | "email",
      channelTarget: string,
      siweMessage: string,
      siweOwnerSignature: string
  ):Promise<string> {
    const fullServiceEndpointUrl = `${this.serviceEndpoint}/v1/alerts/subscribe`;
    const response = await sendHttpRequest(
        fullServiceEndpointUrl,
        {
            account: accountAddress,
            owner: ownerAddress,
            chainId: parseInt(this.chainId.toString()),
            channel,
            target: channelTarget,
            message: siweMessage,
            signature: siweOwnerSignature
        }
    )
    if (
        typeof response !== 'object' ||
        response === null ||
        ! ("subscriptionId" in response) ||
        ! (typeof response["subscriptionId"] === 'string')
    ){
        throw new SafeRecoveryServiceSdkError(
            "BAD_DATA",
            `${fullServiceEndpointUrl} failed`,
            {
                context:{
                    account: accountAddress,
                    owner: ownerAddress,
                    chainId: parseInt(this.chainId.toString()),
                    channel,
                    target: channelTarget,
                    siweMessage,
                    signature: siweOwnerSignature,
                    response: JSON.stringify(
                        response,
                        (key, value) =>
                        typeof value === "bigint" ? "0x" + value.toString(16) : value,
                    )
                }
            }
        );
    }else{
        return response["subscriptionId"];
    }
  }

  /**
   * Activate a subscription using an OTP challenge delivered to the channel target.
   * @param subscriptionId - The subscription to activate.
   * @param otpChallenge - The OTP received by the user.
   * @returns Promise resolving to `true` if activation succeeds.
   */
  async activateSubscription(
      subscriptionId: string, otpChallenge: string
  ): Promise<boolean>{
    const fullServiceEndpointUrl = `${this.serviceEndpoint}/v1/alerts/activate`;
    const response = await sendHttpRequest(fullServiceEndpointUrl, {
        subscriptionId,
        challenge: otpChallenge
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
                    subscriptionId,
                }
            }
        );
    }else{
        return response["success"];
    }
  }

  /**
   * Unsubscribe (remove) a subscription.
   * @param subscriptionId - The subscription to remove.
   * @param ownerAddress - Owner address (used in the SIWE statement),
   * @param siweMessage - SIWE message to sign by an owner.
   * @param siweOwnerSignature - Signature attesting to the SIWE message.
   * @returns Promise resolving to `true` if unsubscribe succeeds.
   */
  async unsubscribe(
      subscriptionId: string,
      ownerAddress: string,
      siweMessage: string,
      siweOwnerSignature: string
  ): Promise<boolean>{
    const fullServiceEndpointUrl = `${this.serviceEndpoint}/v1/alerts/unsubscribe`;
    const response = await sendHttpRequest(fullServiceEndpointUrl, {
        subscriptionId,
        owner: ownerAddress,
        chainId: parseInt(this.chainId.toString()),
        message: siweMessage,
        signature: siweOwnerSignature
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
                    subscriptionId,
                }
            }
        );
    }else{
        return response["success"];
    }
  }

  /**
   * Generate a SIWE statement to unsubscribe from **all** alert subscriptions for `owner`.
   * @param ownerAddress - The safe owner address.
   * @returns SIWE message string to sign.
   * @example
   * ```ts
   * const msg = alerts.unsubscribeSiweStatementToSign("0xabc...");
   * ```
   */
  unsubscribeSiweStatementToSign(ownerAddress: string): string{
    const statement =
        "I request to unsubscribe from all Social Recovery Module alert subscriptions linked to my account";
        return generateSIWEMessage(
          ownerAddress,
          statement,
          this.chainId,
          this.siweDomain,
          this.siweUri
        );
  }
}
