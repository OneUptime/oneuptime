enum UserNotificationStatus {
  Sent = "Sent",
  Acknowledged = "Acknowledged",
  Error = "Error",
  Sending = "Sending",
  Skipped = "Skipped",
  // The notification the person passed their page on from (OnCallPagePassOn).
  PassedOn = "Passed On",
}

export default UserNotificationStatus;
