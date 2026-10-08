import { JSONObject } from "../JSON";

/*
 * Where the verification code of a person's unverified notification method
 * stands - an email address, an SMS or call number, a WhatsApp number, a
 * number for incoming calls - as the channel's verification-status route
 * answers it, and as a resend answers too
 * (Server/API/ChannelVerificationStatusRoute). The server works it out
 * (Server/Utils/ChannelVerification.getStatus); the dashboard's verify
 * dialog reads it, so both sides share this one definition of what goes
 * over the wire.
 */

export enum VerificationCodeState {
  // A code was sent and can still be entered.
  Active = "active",
  // A code was sent, and its time ran out.
  Expired = "expired",
  /*
   * There is no code to enter: none was sent yet, the last one could not be
   * sent, or it was used up by wrong guesses.
   */
  None = "none",
}

export interface VerificationCodeStatus {
  isVerified: boolean;
  codeState: VerificationCodeState;
  // When the code that is (or was) waiting went out. Null with no code.
  codeSentAt: Date | null;
  // When that code stops (or stopped) being accepted. Null with no code.
  codeExpiresAt: Date | null;
  /*
   * Seconds until another code may be sent: the resend cooldown, counted by
   * the server, so a wrong clock on the reader's machine cannot skew it.
   */
  resendAvailableInSeconds: number;
  /*
   * Why no code can be sent right now - the channel is off, the balance is
   * too low, there is no Twilio account - in the words a refused resend
   * would use. Null when one can.
   */
  cannotSendReason: string | null;
}

const toDateOrNull: (value: unknown) => Date | null = (
  value: unknown,
): Date | null => {
  if (typeof value !== "string" && !(value instanceof Date)) {
    return null;
  }

  const date: Date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
};

const isVerificationCodeState: (
  value: unknown,
) => value is VerificationCodeState = (
  value: unknown,
): value is VerificationCodeState => {
  return Object.values(VerificationCodeState).includes(
    value as VerificationCodeState,
  );
};

export default class VerificationCodeStatusJSON {
  // Times go over the wire as ISO 8601 strings.
  public static toJSON(status: VerificationCodeStatus): JSONObject {
    return {
      isVerified: status.isVerified,
      codeState: status.codeState,
      codeSentAt: status.codeSentAt ? status.codeSentAt.toISOString() : null,
      codeExpiresAt: status.codeExpiresAt
        ? status.codeExpiresAt.toISOString()
        : null,
      resendAvailableInSeconds: status.resendAvailableInSeconds,
      cannotSendReason: status.cannotSendReason,
    } as JSONObject;
  }

  /*
   * Read defensively: an answer from an older server, or a resend that
   * answered nothing, reads as "no code, nothing known" rather than as a
   * code that is waiting.
   */
  public static fromJSON(
    json: JSONObject | null | undefined,
  ): VerificationCodeStatus {
    const data: JSONObject = json || {};

    const codeState: VerificationCodeState = isVerificationCodeState(
      data["codeState"],
    )
      ? data["codeState"]
      : VerificationCodeState.None;

    const resendAvailableInSeconds: number = Number(
      data["resendAvailableInSeconds"],
    );

    const cannotSendReason: unknown = data["cannotSendReason"];

    return {
      isVerified: data["isVerified"] === true,
      codeState: codeState,
      codeSentAt: toDateOrNull(data["codeSentAt"]),
      codeExpiresAt: toDateOrNull(data["codeExpiresAt"]),
      resendAvailableInSeconds:
        Number.isFinite(resendAvailableInSeconds) &&
        resendAvailableInSeconds > 0
          ? Math.ceil(resendAvailableInSeconds)
          : 0,
      cannotSendReason:
        typeof cannotSendReason === "string" && cannotSendReason.trim()
          ? cannotSendReason
          : null,
    };
  }
}
