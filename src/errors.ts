//credits:https://medium.com/with-orus/the-5-commandments-of-clean-error-handling-in-typescript-93a9cbdf1af5

/**
 * Wrapper for a dictionary type
 */
export interface Dictionary<T> {
	[Key: string]: T;
}

export type BasicErrorCode =
	| "UNKNOWN_ERROR"
	| "TIMEOUT"
	| "SIWE_ERROR"
	| "HTTP_ERROR"
	| "BAD_DATA";

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
