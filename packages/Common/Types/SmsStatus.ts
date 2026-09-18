enum SmsStatus {
  /*
   * Legacy / synchronous statuses.
   * "Success" was historically set the moment Twilio accepted the message (before
   * delivery tracking existed). It is kept for backward compatibility with rows
   * written before delivery receipts were introduced.
   */
  Success = "Success",
  Error = "Error",
  LowBalance = "Low Balance",

  /*
   * Delivery lifecycle statuses, driven by Twilio status callbacks.
   * Sending -> Sent -> Delivered (terminal) | Undelivered (terminal) | Failed (terminal)
   */
  Sending = "Sending", // queued / accepted / sending — handed to Twilio, not yet at carrier
  Sent = "Sent", // accepted by the carrier, awaiting a delivery receipt
  Delivered = "Delivered", // carrier confirmed delivery to the handset
  Undelivered = "Undelivered", // carrier could not deliver (e.g. filtered, unreachable)
  Failed = "Failed", // Twilio could not send the message
}

export default SmsStatus;
