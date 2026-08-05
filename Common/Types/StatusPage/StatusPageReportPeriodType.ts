/*
 * What stretch of time a scheduled status page report covers.
 *
 * The report used to only ever cover "the last N days counted back from the
 * moment the email went out", which can never line up with a calendar month -
 * a monthly report sent on 1 Aug covered 2 Jul - 1 Aug rather than the July
 * everyone reading it expects, and consecutive reports silently overlapped or
 * left gaps whenever the day count did not match the send frequency.
 */
enum StatusPageReportPeriodType {
  // The window ends when the email is sent and runs back `reportDataInDays`.
  Rolling = "Rolling",
  /*
   * The last whole calendar period before the email is sent, sized by the send
   * frequency: a report sent monthly covers 1 Jul 00:00 - 31 Jul 23:59:59.999
   * in the status page's report timezone.
   */
  PreviousCalendarPeriod = "Previous Calendar Period",
}

export default StatusPageReportPeriodType;
