/** @timezone Asia/Kathmandu */

import describeDaysAsLengthsOfTime from "./DaysAsLengthsOfTimeCases";

/*
 * "The last N days" as N x 24 hours, with the server in Asia/Kathmandu: 45 minutes off the hour, with no clock change
 * (DaysAsLengthsOfTimeCases, issue #8236).
 */

describeDaysAsLengthsOfTime({
  zone: "Asia/Kathmandu",
  clockChangeMinutes: [],
});
