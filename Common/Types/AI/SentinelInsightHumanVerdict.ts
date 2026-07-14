/*
 * The one-click human verdict on a SentinelInsight. This IS the G11
 * precision measurement: confirm/dismiss rates per insight type tell us how
 * precise each deterministic detector is in the field. Stored on
 * SentinelInsight.humanVerdict, so these strings are a wire contract — do
 * not rename them.
 */
enum SentinelInsightHumanVerdict {
  // A human confirmed the insight was real and worth surfacing.
  Confirmed = "Confirmed",
  // A human dismissed the insight as noise/not actionable.
  Dismissed = "Dismissed",
}

export default SentinelInsightHumanVerdict;
