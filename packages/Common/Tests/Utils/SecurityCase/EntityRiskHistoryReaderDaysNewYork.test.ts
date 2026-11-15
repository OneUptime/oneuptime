/** @timezone America/New_York */

import describeEntityRiskHistoryReaderDays from "./EntityRiskHistoryReaderDaysCases";

/*
 * Entity Risk's history bars on the reader's days, with the process in
 * New York, west of UTC and changing its clocks (EntityRiskHistoryReaderDaysCases, issue #8207): only the
 * reader's zone may move a bar.
 */

describeEntityRiskHistoryReaderDays("America/New_York");
