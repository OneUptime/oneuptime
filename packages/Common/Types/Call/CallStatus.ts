enum CallStatus {
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

export default CallStatus;
