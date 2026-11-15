/** @timezone Asia/Kolkata */

import describeRuntimeTimezone from "./DateRuntimeTimezoneCases";
import Timezone from "../../Types/Timezone";

/*
 * A browser in India reads as Asia/Kolkata, the current name of the
 * Asia/Calcutta its Intl reports (DateRuntimeTimezoneCases, issue #8475).
 */

describeRuntimeTimezone({
  intlName: "Asia/Calcutta",
  expected: Timezone.AsiaKolkata,
});
