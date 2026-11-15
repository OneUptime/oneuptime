/** @timezone UTC */

import describeDaysAsLengthsOfTime from "./DaysAsLengthsOfTimeCases";

/*
 * "The last N days" as N x 24 hours, with the server in UTC: UTC itself, where a calendar day is always 24 hours
 * (DaysAsLengthsOfTimeCases, issue #8236).
 */

describeDaysAsLengthsOfTime({
  zone: "UTC",
  clockChangeMinutes: [],
});
