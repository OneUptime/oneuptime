/** @timezone America/St_Johns */

import describeDaysAsLengthsOfTime from "./DaysAsLengthsOfTimeCases";

/*
 * "The last N days" as N x 24 hours, with the server in America/St_Johns: half an hour off the hour, west of UTC
 * (DaysAsLengthsOfTimeCases, issue #8236).
 */

describeDaysAsLengthsOfTime({
  zone: "America/St_Johns",
  clockChangeMinutes: [60, 60],
});
