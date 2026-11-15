/** @timezone America/St_Johns */

import describeAIChatChartCalendar from "./AIChatChartCalendarCases";

/*
 * An Ask AI chart's days, drawn where they were cut, with the browser in
 * St John's - half an hour off the hour, west of UTC, and changing its
 * clocks (AIChatChartCalendarCases, issue #8206).
 */

describeAIChatChartCalendar("America/St_Johns");
