/** @timezone America/New_York */

import describeDaysAsLengthsOfTime from "./DaysAsLengthsOfTimeCases";

/*
 * "The last N days" as N x 24 hours, with the server in America/New_York: west of UTC
 * (DaysAsLengthsOfTimeCases, issue #8236).
 */

describeDaysAsLengthsOfTime({
  zone: "America/New_York",
  clockChangeMinutes: [60, 60],
});
