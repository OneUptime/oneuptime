/** @timezone UTC */

import describeWholeIntervalTrims from "./WholeIntervalTrimInReaderZoneCases";

/*
 * The whole-interval trims on the reader's calendar, with the process in
 * UTC (see WholeIntervalTrimInReaderZoneCases): only the reader's
 * zone may move where an interval closes.
 */

describeWholeIntervalTrims("UTC");
