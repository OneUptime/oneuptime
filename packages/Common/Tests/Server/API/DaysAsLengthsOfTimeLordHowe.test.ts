/** @timezone Australia/Lord_Howe */

import describeDaysAsLengthsOfTime from "./DaysAsLengthsOfTimeCases";

/*
 * "The last N days" as N x 24 hours, with the server in Australia/Lord_Howe: east of UTC, moving its clocks by half an hour
 * (DaysAsLengthsOfTimeCases, issue #8236).
 */

describeDaysAsLengthsOfTime({
  zone: "Australia/Lord_Howe",
  clockChangeMinutes: [30, 30],
});
