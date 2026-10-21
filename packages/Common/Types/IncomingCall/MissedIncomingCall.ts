import IncomingCallStatus from "./IncomingCallStatus";

/*
 * The status messages the incoming call webhook stores on a call log when
 * it ends the call itself, before ringing anyone. They are stored text, so
 * existing rows keep these exact values.
 */
export enum IncomingCallStatusMessage {
  PolicyDisabled = "Policy is disabled",
  NoOneAvailable = "No on-call user available in any escalation rule",
}

/*
 * Why a call reached nobody. NoAnswer and CallerHungUp happen after people
 * were rung; NoOneAvailable and PolicyDisabled before anyone was.
 */
export enum MissedIncomingCallReason {
  NoAnswer = "NoAnswer",
  CallerHungUp = "CallerHungUp",
  NoOneAvailable = "NoOneAvailable",
  PolicyDisabled = "PolicyDisabled",
  Failed = "Failed",
}

/*
 * A call log is missed when it ended without connecting the caller to
 * anyone: nobody answered, the caller hung up first, or the call could not
 * be routed at all. Completed is the only other final status.
 */
export const MISSED_INCOMING_CALL_STATUSES: ReadonlyArray<IncomingCallStatus> =
  Object.freeze([
    IncomingCallStatus.NoAnswer,
    IncomingCallStatus.CallerHungUp,
    IncomingCallStatus.Failed,
  ]);

export default class MissedIncomingCall {
  public static isMissed(
    status: IncomingCallStatus | undefined | null,
  ): boolean {
    if (!status) {
      return false;
    }

    return MISSED_INCOMING_CALL_STATUSES.includes(status);
  }

  // Null when the call was not missed.
  public static getReason(data: {
    status: IncomingCallStatus | undefined | null;
    statusMessage?: string | undefined | null;
  }): MissedIncomingCallReason | null {
    switch (data.status) {
      case IncomingCallStatus.NoAnswer:
        return MissedIncomingCallReason.NoAnswer;
      case IncomingCallStatus.CallerHungUp:
        return MissedIncomingCallReason.CallerHungUp;
      case IncomingCallStatus.Failed:
        if (data.statusMessage === IncomingCallStatusMessage.PolicyDisabled) {
          return MissedIncomingCallReason.PolicyDisabled;
        }

        if (data.statusMessage === IncomingCallStatusMessage.NoOneAvailable) {
          return MissedIncomingCallReason.NoOneAvailable;
        }

        return MissedIncomingCallReason.Failed;
      default:
        return null;
    }
  }
}
