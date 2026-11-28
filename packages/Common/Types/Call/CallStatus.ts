enum CallStatus {
  /*
   * Twilio placed the call, and will say how it ended: its status callback
   * moves it on (#11138). Written for a call whose end Twilio is asked to
   * report - a project's, from a server Twilio can reach - so a call that is
   * still ringing never reads Success.
   */
  Calling = "Calling",
  /*
   * Answered: Twilio said the call was picked up, and ended (its status
   * callback). Also the last status of a call OneUptime is told nothing
   * more about: one the server's own SMS and call gateway took, one placed
   * on a server Twilio cannot call back, and every call placed before
   * Calling was written - which then reads Success for good.
   */
  Success = "Success",
  Error = "Error",
  LowBalance = "Low Balance",
  MissedCall = "Missed Call",
  Busy = "Busy",
  /*
   * An on-call call that voicemail answered (Twilio's answering machine
   * detection, #6594): it reached the phone, and nobody picked up. Not a
   * failure, as a missed call is not.
   */
  Voicemail = "Voicemail",
}

/*
 * The statuses a call's log holds while how it ended may still be written
 * over them: placed (Calling - or Success, for a call placed before Calling
 * was written, still ringing as the server updated), or answered (Success,
 * which voicemail, heard after the call ended, may still move on). The
 * status callback and the answering machine callback write only over these,
 * in the same statement as the check.
 */
export const CALL_STATUSES_BEFORE_AN_OUTCOME: ReadonlyArray<CallStatus> = [
  CallStatus.Calling,
  CallStatus.Success,
];

// Whether a call's log may still be told how the call ended.
export function isCallStatusBeforeAnOutcome(
  status: CallStatus | null | undefined,
): boolean {
  return Boolean(status && CALL_STATUSES_BEFORE_AN_OUTCOME.includes(status));
}

export default CallStatus;
