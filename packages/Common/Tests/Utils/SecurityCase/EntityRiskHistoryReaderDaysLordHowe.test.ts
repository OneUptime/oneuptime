/** @timezone Australia/Lord_Howe */

import describeEntityRiskHistoryReaderDays from "./EntityRiskHistoryReaderDaysCases";

/*
 * Entity Risk's history bars on the reader's days, with the process in
 * Lord Howe Island, east of UTC, moving its clocks by half an hour (EntityRiskHistoryReaderDaysCases, issue #8207): only the
 * reader's zone may move a bar.
 */

describeEntityRiskHistoryReaderDays("Australia/Lord_Howe");
