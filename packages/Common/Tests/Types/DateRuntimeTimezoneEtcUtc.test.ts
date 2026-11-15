/** @timezone Etc/UTC */

import describeRuntimeTimezone from "./DateRuntimeTimezoneCases";
import Timezone from "../../Types/Timezone";

/*
 * A machine set to Etc/UTC, as a container often is: Intl names it "UTC",
 * and it reads as UTC (DateRuntimeTimezoneCases, issue #8475).
 */

describeRuntimeTimezone({ intlName: "UTC", expected: Timezone.UTC });
