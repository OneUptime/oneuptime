import ScheduledMaintenancesTable from "../../Components/ScheduledMaintenance/ScheduledMaintenanceTable";
import { ScheduledMaintenanceView } from "../../Components/ScheduledMaintenance/ScheduledMaintenanceView";
import PageComponentProps from "../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement } from "react";
import { useParams } from "react-router-dom";

/*
 * Scheduled Maintenance > Calendar > Maintenance Calendar: every event of
 * the project by month, week or day, in the reader's time zone - with the
 * filter chips of the list, Schedule maintenance on a day still to come,
 * Subscribe to calendar, and the calendars from outside the project that
 * Calendar Settings adds, drawn beside the events.
 *
 * Its own page under its own side menu section, as the maintainer asked:
 * it was the Calendar half of a List | Calendar switch on All Events. The
 * card, the filters and the buttons are the list's (ScheduledMaintenanceTable).
 */
export const MAINTENANCE_CALENDAR_TITLE: string = translationKey(
  "Maintenance Calendar",
);

export const MAINTENANCE_CALENDAR_DESCRIPTION: string = translationKey(
  "Every scheduled maintenance event by month, week or day, in your own time zone.",
);

const ScheduledMaintenanceCalendarPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { projectId } = useParams();

  return (
    <ScheduledMaintenancesTable
      view={ScheduledMaintenanceView.Calendar}
      title={MAINTENANCE_CALENDAR_TITLE}
      description={MAINTENANCE_CALENDAR_DESCRIPTION}
      query={{
        projectId: new ObjectID(projectId || ""),
      }}
      saveFilterProps={{
        tableId: "scheduled-maintenance-calendar",
      }}
    />
  );
};

export default ScheduledMaintenanceCalendarPage;
