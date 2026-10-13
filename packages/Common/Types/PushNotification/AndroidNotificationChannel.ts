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
  /*
   * The same critical channel once per built-in alarm sound
   * (CriticalAlertSound). Android fixes a channel's sound when the channel is
   * created, so each sound needs a channel of its own. Named only for a device
   * that chose that sound from the app, which only an app that creates these
   * channels can do.
   */
  CriticalKlaxon = "oncall_critical_klaxon",
  CriticalSiren = "oncall_critical_siren",
  CriticalDigital = "oncall_critical_digital",
  CriticalSmokeAlarm = "oncall_critical_smoke_alarm",
  CriticalRising = "oncall_critical_rising",
  High = "oncall_high",
  Normal = "oncall_normal",
  Low = "oncall_low",
}

export default AndroidNotificationChannel;
