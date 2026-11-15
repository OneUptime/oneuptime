import AggregationIntervalUtil from "Common/Types/BaseDatabase/AggregationIntervalUtil";
import Timezone from "Common/Types/Timezone";

/*
 * What an Ask AI question, or the approval that resumes its answer, says of
 * the reader's time zone: the zone they read the Dashboard's charts in
 * (OneUptimeDate.getCurrentTimezone(): User Settings', else the browser's),
 * when the Timezone list names it. A chart Ask AI draws over more than a
 * week reads its days on the server, and cuts them at that zone's midnight,
 * as every other day chart does since issue #7277 - in UTC's days each
 * day's total sat under the day before in New York (issue #7922). A zone
 * the list does not name is not sent, and those days stay UTC's.
 */
export function getAskAiReaderTimezone(): { timezone?: Timezone } {
  const timezone: Timezone | undefined =
    AggregationIntervalUtil.getListedReaderTimezone();

  return timezone ? { timezone } : {};
}
