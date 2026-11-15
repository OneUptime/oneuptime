/** @timezone Pacific/Auckland */

import describeDaysAsLengthsOfTime from "./DaysAsLengthsOfTimeCases";

/*
 * "The last N days" as N x 24 hours, with the server in Pacific/Auckland: east of UTC and in the southern hemisphere, so its clocks go back in April and forward in September
 * (DaysAsLengthsOfTimeCases, issue #8236).
 */

describeDaysAsLengthsOfTime({
  zone: "Pacific/Auckland",
  clockChangeMinutes: [60, 60],
});
