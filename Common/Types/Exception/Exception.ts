import ExceptionCode from "./ExceptionCode";

export default class Exception extends Error {
  private _code: ExceptionCode = ExceptionCode.GeneralException;

  public get code(): ExceptionCode {
    return this._code;
  }

  public set code(value: ExceptionCode) {
    this._code = value;
  }

  public constructor(code: ExceptionCode, message: unknown) {
    super(Exception.formatMessage(message));
    this.code = code;
  }

  public getMessage(): string {
    return this.message;
  }

  // Normalizes unknown message types to a string to avoid `[object Object]` in API responses.
  private static formatMessage(message: unknown): string {
    if (message === undefined || message === null) {
      return "An error occurred"; // generic fallback
    }
    if (typeof message === "string") {
      return message;
    }
    if (message instanceof Error) {
      const base: string = message.message || message.toString();
      return message.name && !base.startsWith(message.name)
        ? `${message.name}: ${base}`
        : base;
    }
    try {
      return JSON.stringify(message);
    } catch (_error: unknown) {
      return Object.prototype.toString.call(message);
    }
  }
}
