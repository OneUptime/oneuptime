/*
 * The two-bit Leap Indicator at the front of every NTP packet (RFC 5905,
 * section 7.3). 1 and 2 only announce a leap second at the end of the day
 * and are perfectly healthy; 3 is the server saying its own clock is not
 * synchronized, so its time must not be trusted.
 */
enum NtpLeapIndicator {
  NoWarning = 0,
  LastMinuteHas61Seconds = 1,
  LastMinuteHas59Seconds = 2,
  Unsynchronized = 3,
}

export default NtpLeapIndicator;
