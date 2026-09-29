/*
 * Android delivers a notification with the settings of the channel it names,
 * not the settings in the payload - importance, sound and Do Not Disturb
 * bypass are all fixed when the app creates the channel and cannot be raised
 * afterwards. So "ring through silent mode" is expressed by picking a channel,
 * and these ids are the contract for that choice.
 *
 * The app creates channels with exactly these ids in
 * MobileApp/src/notifications/channels.ts. An id sent from here that the app
 * never created does not fail loudly: Android falls back to a default channel
 * and the page arrives with default settings, which for an on-call page means
 * silently. Keep the two lists in step.
 */
enum AndroidNotificationChannel {
  /*
   * Do Not Disturb bypass, alarm audio stream, MAX importance. Reserved for
   * on-call pages from a device whose owner opted in and granted the app Do
   * Not Disturb access.
   */
  Critical = "oncall_critical",
  High = "oncall_high",
  Normal = "oncall_normal",
  Low = "oncall_low",
}

export default AndroidNotificationChannel;
