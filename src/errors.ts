//credits:https://medium.com/with-orus/the-5-commandments-of-clean-error-handling-in-typescript-93a9cbdf1af5

/**
 * Wrapper for a dictionary type
 */
export interface Dictionary<T> {
	[Key: string]: T;
}

export const HttpErrorCodeDict: Dictionary<HttpErrorCode> = {
	"400": "HTTP_BAD_REQUEST",
	"401": "HTTP_UNAUTHORIZED",
	"403": "HTTP_FORBIDDEN",
	"404": "HTTP_NOT_FOUND",
	"409": "HTTP_CONFLICT",
	"429": "HTTP_TOO_MANY_REQUESTS",
	"500": "HTTP_INTERNAL_ERROR",
	"502": "HTTP_BAD_GATEWAY",
	"503": "HTTP_SERVICE_UNAVAILABLE",
	"504": "HTTP_GATEWAY_TIMEOUT",
};

export type HttpErrorCode =
	| "HTTP_BAD_REQUEST"        // 400
	| "HTTP_UNAUTHORIZED"       // 401
	| "HTTP_FORBIDDEN"          // 403
	| "HTTP_NOT_FOUND"          // 404
	| "HTTP_CONFLICT"           // 409
	| "HTTP_TOO_MANY_REQUESTS"  // 429
	| "HTTP_INTERNAL_ERROR"     // 500
	| "HTTP_BAD_GATEWAY"        // 502
	| "HTTP_SERVICE_UNAVAILABLE"// 503
	| "HTTP_GATEWAY_TIMEOUT";   // 504

export type BasicErrorCode =
	| "UNKNOWN_ERROR"
	| "TIMEOUT"
	| "SIWE_ERROR"
	| "BAD_DATA"
    | HttpErrorCode;

export type Jsonable =
	| string
	| number
	| boolean
	| null
	| undefined
	| readonly Jsonable[]
	| { readonly [key: string]: Jsonable }
	| { toJSON(): Jsonable };

export class SafeRecoveryServiceSdkError extends Error {
	public readonly code: BasicErrorCode;
	public readonly context?: Jsonable;
	public readonly errno?: number;

	constructor(
		code: BasicErrorCode,
		message: string,
		options: { cause?: Error; errno?: number; context?: Jsonable } = {},
	) {
		const { cause, errno, context } = options;

		super(message, { cause });
		this.name = this.constructor.name;

		this.code = code;
		this.errno = errno;
		this.context = context;
	}

	//get a string representation of SafeRecoveryServiceSdk
	//Usefull with React Native, as Error "cause" is not shown in the error trace
	stringify(): string {
		return JSON.stringify(this, [
			"name",
			"code",
			"message",
			"cause",
			"errno",
			"context",
		]);
	}
}

export function ensureError(value: unknown): Error {
	if (value instanceof Error) return value;

	let stringified = "[Unable to stringify the thrown value]";
	try {
		stringified = JSON.stringify(value);
	} catch {
		/* empty */
	}

	const error = new Error(
		`This value was thrown as is, not through an Error: ${stringified}`,
	);
	return error;
}
