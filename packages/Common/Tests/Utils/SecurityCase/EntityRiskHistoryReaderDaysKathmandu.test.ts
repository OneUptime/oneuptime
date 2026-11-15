/** @timezone Asia/Kathmandu */

import describeEntityRiskHistoryReaderDays from "./EntityRiskHistoryReaderDaysCases";

/*
 * Entity Risk's history bars on the reader's days, with the process in
 * Kathmandu, 45 minutes off the hour (EntityRiskHistoryReaderDaysCases, issue #8207): only the
 * reader's zone may move a bar.
 */

describeEntityRiskHistoryReaderDays("Asia/Kathmandu");
