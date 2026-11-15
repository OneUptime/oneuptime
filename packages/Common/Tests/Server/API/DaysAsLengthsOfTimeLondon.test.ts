/** @timezone Europe/London */

import describeDaysAsLengthsOfTime from "./DaysAsLengthsOfTimeCases";

/*
 * "The last N days" as N x 24 hours, with the server in Europe/London: on UTC's clock in winter and an hour east of it in summer
 * (DaysAsLengthsOfTimeCases, issue #8236).
 */

describeDaysAsLengthsOfTime({
  zone: "Europe/London",
  clockChangeMinutes: [60, 60],
});
