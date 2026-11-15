/** @timezone UTC */

import describeEntityRiskHistoryReaderDays from "./EntityRiskHistoryReaderDaysCases";

/*
 * Entity Risk's history bars on the reader's days, with the process in
 * UTC, as CI runs it (EntityRiskHistoryReaderDaysCases, issue #8207): only the
 * reader's zone may move a bar.
 */

describeEntityRiskHistoryReaderDays("UTC");
