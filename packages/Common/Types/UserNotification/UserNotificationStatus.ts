enum UserNotificationStatus {
  Sent = "Sent",
  Acknowledged = "Acknowledged",
  Error = "Error",
  Sending = "Sending",
  Skipped = "Skipped",
  // The notification the person passed their page on from (OnCallPagePassOn).
  PassedOn = "Passed On",
  /*
   * A phone call that went out and rang, and that the person did not pick
   * up - it rang out, or the line was busy - as Twilio tells when the call
   * ends (the notification server's call status callback). It reached their
   * phone, so it counts as out (OnCallPageChannel); the record's feed says
   * they did not answer it.
   */
  NotAnswered = "Not Answered",
}

export default UserNotificationStatus;
