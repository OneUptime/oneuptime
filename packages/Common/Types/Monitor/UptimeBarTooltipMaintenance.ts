import Color from "../Color";
import ObjectID from "../ObjectID";
import { ScheduledMaintenancePhaseOfState } from "../../Utils/ScheduledMaintenanceStart";

/*
 * A scheduled maintenance event, as the day-by-day uptime history shows it:
 * in the tooltip and the dialog of every day its window touches, beside the
 * incidents, and as the mark on that day's bar (DayUptimeGraph).
 *
 * The history shows only events that have started - in progress or over.
 * One still to come is no part of a day's history; the status page lists it
 * under Scheduled Maintenance instead. UptimeMaintenanceUtil decides which
 * days an event belongs to, from its planned window.
 */
export default interface UptimeBarTooltipMaintenance {
  id: string;
  title: string;
  // The planned window, as the event's Starts At and Ends At hold it.
  startsAt: Date;
  endsAt: Date;
  /*
   * The state the event is in now, by the name the reader's page gives it,
   * in its colour. Absent when the state was not read.
   */
  currentState?:
    | {
        name: string;
        color: Color;
      }
    | undefined;
  /*
   * Where the event is in its life (ScheduledMaintenanceStartUtil.getPhase).
   * An event in progress belongs to every day up to now, however long it
   * runs past its planned end. Null when its state could not be placed.
   */
  phase: ScheduledMaintenancePhaseOfState | null;
  // The monitors it holds, so a status page draws it on their resources only.
  monitorIds: Array<ObjectID>;
}
