import OneUptimeDate from "../../Types/Date";
import IncidentSlaStatus from "../../Types/Incident/IncidentSlaStatus";
import ObjectID from "../../Types/ObjectID";
import { StateListType } from "../StateOrder";
import ResolvedStateUtil from "../ResolvedState";

/*
 * WHAT AN SLA ADDED TO AN INCIDENT STARTS WITH (#10053).
 *
 * A person adds an SLA rule to an incident - Incidents > SLA > Add SLA rule,
 * the API, Terraform - by naming the incident and the rule. Everything else
 * an SLA record holds is OneUptime's to work out from them: when it started
 * (when the incident was declared), its deadlines (the rule's times from
 * then), whether the incident was already responded to and resolved, and so
 * whether the SLA is on track, at risk, met or breached. The Dashboard used
 * to work it out in the browser and send it; a create through the API takes
 * no value for a column only OneUptime writes, so IncidentSlaService works it
 * out here instead, as the page did.
 */

export interface IncidentSlaStart {
  slaStartedAt: Date;
  responseDeadline?: Date | undefined;
  resolutionDeadline?: Date | undefined;
  status: IncidentSlaStatus;
  respondedAt?: Date | undefined;
  resolvedAt?: Date | undefined;
}

// A row of the incident's state timeline, with whether its state is the created one.
export interface IncidentSlaTimelineRow {
  incidentStateId?: ObjectID | string | null | undefined;
  startsAt?: Date | null | undefined;
  isCreatedState?: boolean | undefined;
}

// How much of the resolution time may pass before an SLA is at risk.
export const AT_RISK_SHARE: number = 0.8;

export default class IncidentSlaStartUtil {
  /*
   * When the incident was first responded to: the first move out of the
   * created state, by its timeline.
   */
  public static getRespondedAt(
    timeline: Array<IncidentSlaTimelineRow>,
  ): Date | undefined {
    const sorted: Array<IncidentSlaTimelineRow> = [...timeline]
      .filter((row: IncidentSlaTimelineRow): boolean => {
        return Boolean(row.startsAt);
      })
      .sort((a: IncidentSlaTimelineRow, b: IncidentSlaTimelineRow): number => {
        return (
          new Date(a.startsAt as Date).getTime() -
          new Date(b.startsAt as Date).getTime()
        );
      });

    const responded: IncidentSlaTimelineRow | undefined = sorted.find(
      (row: IncidentSlaTimelineRow): boolean => {
        return !row.isCreatedState;
      },
    );

    return responded?.startsAt ? new Date(responded.startsAt) : undefined;
  }

  /*
   * When the incident was last resolved: its latest move into a state that
   * counts as resolved - the project's resolved state, or one placed after
   * it (ResolvedStateUtil).
   */
  public static getResolvedAt(data: {
    timeline: Array<IncidentSlaTimelineRow>;
    // The project's incident states: id, place and flags.
    states: Array<unknown>;
  }): Date | undefined {
    const rows: Array<{ startsAt?: Date | null | undefined }> =
      ResolvedStateUtil.getResolutionRows({
        list: StateListType.IncidentState,
        states: data.states,
        timeline: data.timeline.map(
          (
            row: IncidentSlaTimelineRow,
          ): {
            stateId?: ObjectID | string | null | undefined;
            startsAt?: Date | null | undefined;
          } => {
            return { stateId: row.incidentStateId, startsAt: row.startsAt };
          },
        ),
      });

    const last: Date | null | undefined = rows[rows.length - 1]?.startsAt;

    return last ? new Date(last) : undefined;
  }

  // What the SLA starts with: its start, its deadlines, and where it stands.
  public static compute(data: {
    declaredAt: Date;
    responseTimeInMinutes?: number | undefined;
    resolutionTimeInMinutes?: number | undefined;
    respondedAt?: Date | undefined;
    resolvedAt?: Date | undefined;
    now: Date;
  }): IncidentSlaStart {
    const slaStartedAt: Date = data.declaredAt;

    const responseDeadline: Date | undefined = data.responseTimeInMinutes
      ? OneUptimeDate.addRemoveMinutes(slaStartedAt, data.responseTimeInMinutes)
      : undefined;

    const resolutionDeadline: Date | undefined = data.resolutionTimeInMinutes
      ? OneUptimeDate.addRemoveMinutes(
          slaStartedAt,
          data.resolutionTimeInMinutes,
        )
      : undefined;

    let status: IncidentSlaStatus = IncidentSlaStatus.OnTrack;

    if (data.resolvedAt) {
      // Resolved: met, or which deadline it missed.
      const responseMet: boolean =
        !responseDeadline ||
        !data.respondedAt ||
        OneUptimeDate.isBefore(data.respondedAt, responseDeadline);
      const resolutionMet: boolean =
        !resolutionDeadline ||
        OneUptimeDate.isBefore(data.resolvedAt, resolutionDeadline);

      if (responseMet && resolutionMet) {
        status = IncidentSlaStatus.Met;
      } else if (!resolutionMet) {
        status = IncidentSlaStatus.ResolutionBreached;
      } else {
        status = IncidentSlaStatus.ResponseBreached;
      }
    } else if (data.respondedAt && resolutionDeadline) {
      // Responded, not resolved: breached, at risk, or on track.
      if (OneUptimeDate.isAfter(data.now, resolutionDeadline)) {
        status = IncidentSlaStatus.ResolutionBreached;
      } else {
        const total: number = OneUptimeDate.getDifferenceInMinutes(
          resolutionDeadline,
          slaStartedAt,
        );
        const elapsed: number = OneUptimeDate.getDifferenceInMinutes(
          data.now,
          slaStartedAt,
        );

        if (total > 0 && elapsed / total >= AT_RISK_SHARE) {
          status = IncidentSlaStatus.AtRisk;
        }
      }
    }

    return {
      slaStartedAt,
      responseDeadline,
      resolutionDeadline,
      status,
      respondedAt: data.respondedAt,
      resolvedAt: data.resolvedAt,
    };
  }
}
