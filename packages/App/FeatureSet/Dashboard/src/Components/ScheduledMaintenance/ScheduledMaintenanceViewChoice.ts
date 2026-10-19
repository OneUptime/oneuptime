import IconProp from "Common/Types/Icon/IconProp";
import RememberedView from "Common/UI/Components/ViewSwitch/RememberedView";
import { ViewSwitchOption } from "Common/UI/Components/ViewSwitch/ViewSwitch";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * Scheduled Maintenance > Events as a list or as a calendar: List | Calendar
 * in the card's header. The list is what the page opens on until a reader
 * picks the calendar; the choice is theirs, remembered in their browser
 * (RememberedView), the way the status timelines remember Timeline | Table.
 */
export enum ScheduledMaintenanceView {
  List = "list",
  Calendar = "calendar",
}

export const SCHEDULED_MAINTENANCE_VIEW_STORAGE_KEY: string =
  "oneuptime.scheduled-maintenance-view";

export const scheduledMaintenanceViewChoice: RememberedView<ScheduledMaintenanceView> =
  new RememberedView<ScheduledMaintenanceView>({
    storageKey: SCHEDULED_MAINTENANCE_VIEW_STORAGE_KEY,
    values: [ScheduledMaintenanceView.List, ScheduledMaintenanceView.Calendar],
    defaultValue: ScheduledMaintenanceView.List,
  });

// Each view's icon is a picture of the view: the list's rows, the calendar's page.
export const SCHEDULED_MAINTENANCE_VIEW_OPTIONS: ReadonlyArray<
  ViewSwitchOption<ScheduledMaintenanceView>
> = [
  {
    value: ScheduledMaintenanceView.List,
    label: translationKey("List"),
    icon: IconProp.List,
  },
  {
    value: ScheduledMaintenanceView.Calendar,
    label: translationKey("Calendar"),
    icon: IconProp.Calendar,
  },
];

export const SCHEDULED_MAINTENANCE_VIEW_SWITCH_LABEL: string =
  translationKey("Show the events as");

export const SCHEDULED_MAINTENANCE_VIEW_SWITCH_TEST_ID: string =
  "scheduled-maintenance-view-switch";
