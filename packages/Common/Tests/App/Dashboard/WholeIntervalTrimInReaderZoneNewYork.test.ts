/** @timezone America/New_York */

import describeWholeIntervalTrims from "./WholeIntervalTrimInReaderZoneCases";

/*
 * The whole-interval trims on the reader's calendar, with the process in
 * America/New_York (see WholeIntervalTrimInReaderZoneCases): only the reader's
 * zone may move where an interval closes.
 */

describeWholeIntervalTrims("America/New_York");
