/** @timezone America/New_York */

import describeSecurityOverviewReaderDays from "./SecurityOverviewReaderDaysCases";

/*
 * The Security overview's day bars on the reader's calendar, with the
 * process in America/New_York (see SecurityOverviewReaderDaysCases): only the
 * reader's zone may move a bar.
 */

describeSecurityOverviewReaderDays("America/New_York");
