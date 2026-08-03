import ObjectID from "../../ObjectID";
import DashboardComponentType from "../DashboardComponentType";
import BaseComponent from "./DashboardBaseComponent";

/** How the time is drawn — digits, or a drawn clock face. */
export enum ClockWidgetFace {
  Digital = "Digital",
  Analog = "Analog",
}

/**
 * 12h vs 24h. `Auto` follows whatever the viewer's browser locale implies
 * (OneUptimeDate.getUserPrefers12HourFormat), so a dashboard shared between a
 * US and a European team reads naturally for both without either of them
 * having to re-configure the widget.
 */
export enum ClockWidgetHourFormat {
  Auto = "Auto",
  TwelveHour = "12 Hour",
  TwentyFourHour = "24 Hour",
}

export default interface DashboardClockComponent extends BaseComponent {
  componentType: DashboardComponentType.Clock;
  componentId: ObjectID;
  arguments: {
    /*
     * IANA zone name (e.g. "America/New_York"), matching the values in the
     * Timezone enum. Empty means "the zone the viewer is reading this in",
     * which is what a single clock on a personal dashboard should do.
     */
    timezone?: string | undefined;
    /*
     * Caption under the time. Empty falls back to the city in the IANA name
     * ("Asia/Kolkata" -> "Kolkata"), so an unconfigured clock is still
     * labelled.
     */
    label?: string | undefined;
    clockFace?: ClockWidgetFace | undefined;
    hourFormat?: ClockWidgetHourFormat | undefined;
    showSeconds?: boolean | undefined;
    showDate?: boolean | undefined;
    showTimezoneAbbreviation?: boolean | undefined;
  };
}
