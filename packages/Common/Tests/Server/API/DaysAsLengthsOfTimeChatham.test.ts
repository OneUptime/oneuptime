/** @timezone Pacific/Chatham */

import describeDaysAsLengthsOfTime from "./DaysAsLengthsOfTimeCases";

/*
 * "The last N days" as N x 24 hours, with the server in Pacific/Chatham: 45 minutes off the hour, east of UTC, and changing its clocks
 * (DaysAsLengthsOfTimeCases, issue #8236).
 */

describeDaysAsLengthsOfTime({
  zone: "Pacific/Chatham",
  clockChangeMinutes: [60, 60],
});
