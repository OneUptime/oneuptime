/** @timezone UTC */

import describeSecurityOverviewReaderDays from "./SecurityOverviewReaderDaysCases";

/*
 * The Security overview's day bars on the reader's calendar, with the
 * process in UTC (see SecurityOverviewReaderDaysCases): only the
 * reader's zone may move a bar.
 */

describeSecurityOverviewReaderDays("UTC");
