/** @timezone Asia/Kolkata */

import describeDaysAsLengthsOfTime from "./DaysAsLengthsOfTimeCases";

/*
 * "The last N days" as N x 24 hours, with the server in Asia/Kolkata: half an hour off the hour, with no clock change
 * (DaysAsLengthsOfTimeCases, issue #8236).
 */

describeDaysAsLengthsOfTime({
  zone: "Asia/Kolkata",
  clockChangeMinutes: [],
});
