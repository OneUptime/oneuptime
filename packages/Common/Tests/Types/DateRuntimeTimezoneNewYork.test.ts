/** @timezone America/New_York */

import describeRuntimeTimezone from "./DateRuntimeTimezoneCases";
import Timezone from "../../Types/Timezone";

/*
 * A browser in New York reads as New York, as it always did
 * (DateRuntimeTimezoneCases, issue #8475).
 */

describeRuntimeTimezone({
  intlName: "America/New_York",
  expected: Timezone.AmericaNew_York,
});
