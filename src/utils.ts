import {SiweMessage} from "siwe";
import * as fetchImport from "isomorphic-unfetch";
import {ethers} from "ethers";
import { ensureError, SafeRecoveryServiceSdkError } from "./errors";
import { RecoveryByGuardianRequest } from "./recoveryByGuardian";

export enum SocialRecoveryModuleGracePeriodSelector {
	After3Minutes = "0x949d01d424bE050D09C16025dd007CB59b3A8c66",
	After3Days = "0x38275826E1933303E508433dD5f289315Da2541c",
	After7Days = "0x088f6cfD8BB1dDb1BB069CCb3fc1A98927D233f2",
	After14Days = "0x9BacD92F4687Db306D7ded5d4513a51EA05df25b",
}

export type JsonRpcResult =
    RecoveryByGuardianRequest |
    RecoveryByGuardianRequest[];

export type JsonRpcParam = string | bigint | boolean | object | JsonRpcParam[];

export async function sendHttpRequest(
	rpcUrl: string,
    body: JsonRpcParam,
    method: "post" | "get" = "post",
    headers: Record<string, string> = { "Content-Type": "application/json" },
): Promise<JsonRpcResult> {
	const fetch = fetchImport.default || fetchImport;
    let response;
    let requestOptions: RequestInit;
    let params;
    const rawBody = JSON.stringify(
        body,
        (key, value) =>
            // change all bigint values to "0x" prefixed hex strings
            // eslint-disable-next-line @typescript-eslint/no-unsafe-return
            typeof value === "bigint" ? "0x" + value.toString(16) : value,
    );
    if(method == "post"){
        params = rpcUrl;
        requestOptions = {
            method: "POST",
            headers, 
            body: rawBody,
            redirect: "follow",
        };
    }else{
        const getParams = new URLSearchParams(body as Record<string, string>);
        params = `${rpcUrl}?${getParams.toString()}`
        requestOptions = {
            method: "GET",
            headers, 
            redirect: "follow",
        };
    }

    try{
        const fetchResult = await fetch(params, requestOptions);
        response = await fetchResult.json();
    }catch(err){
        const error = ensureError(err);
        throw new SafeRecoveryServiceSdkError(
            "UNKNOWN_ERROR", 
            error.message, 
            {
                cause: error,
                context: {
                    url: rpcUrl,
                    requestOptions: JSON.stringify(requestOptions),
                }
            }
        );
    }
	if ("code" in response) {
        const err = response.error as JsonRpcError;
		const codeString = String(err.code);

		if (codeString in HttpErrorCodeDict) {
			throw new SafeRecoveryServiceSdkError(
				HttpErrorCodeDict[codeString],
				err.message,
				{
					errno: err.code,
					context: {
						url: rpcUrl,
						requestOptions: JSON.stringify(requestOptions),
					},
				},
			);
		} else {
			throw new SafeRecoveryServiceSdkError("UNKNOWN_ERROR", err.message, {
				errno: err.code,
				context: {
					url: rpcUrl,
					requestOptions: JSON.stringify(requestOptions),
				},
			});
		}
	} else {
		return response;
	}
}

