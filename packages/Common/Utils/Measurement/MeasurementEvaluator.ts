import MeasurementAnchorKind from "../../Types/Measurement/MeasurementAnchorKind";
import MeasurementOccurrence from "../../Types/Measurement/MeasurementOccurrence";
import MeasurementStatus from "../../Types/Measurement/MeasurementStatus";
import OneUptimeDate from "../../Types/Date";

/*
 * One row of an entity's state timeline, flattened to the fields a
 * measurement cares about. Domain services map IncidentStateTimeline,
 * AlertStateTimeline or ScheduledMaintenanceStateTimeline onto this.
 */
export interface MeasurementTimelineEntry {
  id: string;
  stateId: string;
  stateName?: string | undefined;
  /*
   * The state's position in the project's ordered state list. Used only to
   * decide whether an unreached state can still be reached -- the timeline
   * services enforce strictly increasing order, so a state at or below the
   * current position will never be entered again.
   */
  stateOrder?: number | undefined;
  // Role flags this state carries, e.g. ["Acknowledged"].
  stateRoles?: Array<string> | undefined;
  startsAt: Date;
}

export interface MeasurementAnchorSpec {
  kind: MeasurementAnchorKind;

  // Human-readable name of this endpoint, used verbatim in status messages.
  label: string;

  // Kind === Timestamp: the already-resolved value, or undefined if unset.
  timestamp?: Date | undefined;

  // Kind === StateEntered.
  stateId?: string | undefined;
  stateOrder?: number | undefined;

  // Kind === StateRoleEntered.
  stateRole?: string | undefined;

  occurrence?: MeasurementOccurrence | undefined;

  /*
   * True when the definition references a state that has since been deleted.
   * The FK is SET NULL rather than RESTRICT so that deleting a state never
   * blocks a project from reordering its states; the measurement degrades to
   * NotApplicable and says so instead of throwing.
   */
  isDanglingStateReference?: boolean | undefined;

  /*
   * Timestamp anchors that legitimately land after the entity reaches a
   * terminal state -- a postmortem is posted after resolution -- must stay
   * Pending rather than being declared unreachable.
   */
  canResolveAfterTerminalState?: boolean | undefined;
}

export interface MeasurementDefinitionSpec {
  id: string;
  name: string;
  start: MeasurementAnchorSpec;
  end: MeasurementAnchorSpec;
}

export interface EvaluatedMeasurement {
  measurementId: string;
  status: MeasurementStatus;
  statusMessage?: string | undefined;
  startedAt?: Date | undefined;
  endedAt?: Date | undefined;
  valueInSeconds?: number | undefined;
  startTimelineEntryId?: string | undefined;
  endTimelineEntryId?: string | undefined;
}

interface ResolvedAnchor {
  at?: Date | undefined;
  timelineEntryId?: string | undefined;
  status: MeasurementStatus;
  statusMessage?: string | undefined;
}

/*
 * Evaluates measurement definitions against an entity's timeline.
 *
 * Two properties make this correct where the previous hand-rolled metric
 * blocks were not:
 *
 *   1. It is a TOTAL FUNCTION of the data it is handed. It never reads its
 *      own prior output, so a backdated timestamp, a deleted timeline row, a
 *      state id edited through the API or a duplicated state all converge on
 *      the right answer with no per-case handling and no repair path.
 *
 *   2. It is PURE -- no I/O, no clock, no database. The same function serves
 *      the server-side recompute and can be run in the browser over a
 *      timeline the page has already fetched, so a rendered number and a
 *      stored number can never disagree.
 */
export default class MeasurementEvaluator {
  public static evaluate(data: {
    definitions: Array<MeasurementDefinitionSpec>;
    timeline: Array<MeasurementTimelineEntry>;
  }): Array<EvaluatedMeasurement> {
    const timeline: Array<MeasurementTimelineEntry> =
      MeasurementEvaluator.sortTimeline(data.timeline);

    return data.definitions.map((definition: MeasurementDefinitionSpec) => {
      return MeasurementEvaluator.evaluateOne({
        definition: definition,
        timeline: timeline,
      });
    });
  }

  public static evaluateOne(data: {
    definition: MeasurementDefinitionSpec;
    timeline: Array<MeasurementTimelineEntry>;
  }): EvaluatedMeasurement {
    const { definition } = data;
    const timeline: Array<MeasurementTimelineEntry> = data.timeline;

    const start: ResolvedAnchor = MeasurementEvaluator.resolveAnchor({
      anchor: definition.start,
      timeline: timeline,
    });

    const end: ResolvedAnchor = MeasurementEvaluator.resolveAnchor({
      anchor: definition.end,
      timeline: timeline,
    });

    /*
     * NotApplicable outranks Pending: if one end can never resolve, the
     * measurement can never complete, however much of it is still in flight.
     */
    const unresolved: Array<ResolvedAnchor> = [start, end].filter(
      (anchor: ResolvedAnchor) => {
        return !anchor.at;
      },
    );

    if (unresolved.length > 0) {
      const notApplicable: ResolvedAnchor | undefined = unresolved.find(
        (anchor: ResolvedAnchor) => {
          return anchor.status === MeasurementStatus.NotApplicable;
        },
      );

      const chosen: ResolvedAnchor = notApplicable || unresolved[0]!;

      return {
        measurementId: definition.id,
        status: chosen.status,
        statusMessage: chosen.statusMessage,
        startedAt: start.at,
        endedAt: end.at,
        startTimelineEntryId: start.timelineEntryId,
        endTimelineEntryId: end.timelineEntryId,
      };
    }

    const startMs: number = OneUptimeDate.fromString(start.at!).getTime();
    const endMs: number = OneUptimeDate.fromString(end.at!).getTime();

    if (endMs < startMs) {
      /*
       * The end really did land before the start. Reporting Invalid rather
       * than clamping to zero is the entire point: a recorded timestamp is
       * wrong and somebody needs to see it.
       */
      return {
        measurementId: definition.id,
        status: MeasurementStatus.Invalid,
        statusMessage: `${definition.end.label} precedes ${
          definition.start.label
        } by ${MeasurementEvaluator.formatDuration(
          Math.round((startMs - endMs) / 1000),
        )}`,
        startedAt: start.at,
        endedAt: end.at,
        startTimelineEntryId: start.timelineEntryId,
        endTimelineEntryId: end.timelineEntryId,
      };
    }

    return {
      measurementId: definition.id,
      status: MeasurementStatus.Recorded,
      startedAt: start.at,
      endedAt: end.at,
      valueInSeconds: Math.round((endMs - startMs) / 1000),
      startTimelineEntryId: start.timelineEntryId,
      endTimelineEntryId: end.timelineEntryId,
    };
  }

  /*
   * startsAt alone is not a total order -- the timeline tables carry no
   * unique constraint and an operator correcting timestamps can produce
   * ties -- so the row id breaks them. Without this, "first occurrence"
   * could differ between two queries over identical data.
   */
  public static sortTimeline(
    timeline: Array<MeasurementTimelineEntry>,
  ): Array<MeasurementTimelineEntry> {
    return [...timeline].sort(
      (a: MeasurementTimelineEntry, b: MeasurementTimelineEntry) => {
        const aMs: number = OneUptimeDate.fromString(a.startsAt).getTime();
        const bMs: number = OneUptimeDate.fromString(b.startsAt).getTime();

        if (aMs !== bMs) {
          return aMs - bMs;
        }

        return a.id.localeCompare(b.id);
      },
    );
  }

  private static resolveAnchor(data: {
    anchor: MeasurementAnchorSpec;
    timeline: Array<MeasurementTimelineEntry>;
  }): ResolvedAnchor {
    const { anchor, timeline } = data;

    if (anchor.isDanglingStateReference) {
      return {
        status: MeasurementStatus.NotApplicable,
        statusMessage: `The state this measurement's "${anchor.label}" pointed at has been deleted`,
      };
    }

    if (anchor.kind === MeasurementAnchorKind.Timestamp) {
      if (anchor.timestamp) {
        return { at: anchor.timestamp, status: MeasurementStatus.Recorded };
      }

      /*
       * A timestamp that is filled in later (a postmortem, an
       * operator-recorded impact start) is still coming. One that is only
       * ever written at creation and is missing never will be.
       */
      if (anchor.canResolveAfterTerminalState) {
        return {
          status: MeasurementStatus.Pending,
          statusMessage: `${anchor.label} has not been recorded yet`,
        };
      }

      return {
        status: MeasurementStatus.NotApplicable,
        statusMessage: `${anchor.label} was never recorded`,
      };
    }

    const matches: Array<MeasurementTimelineEntry> = timeline.filter(
      (entry: MeasurementTimelineEntry) => {
        if (anchor.kind === MeasurementAnchorKind.StateEntered) {
          return entry.stateId === anchor.stateId;
        }

        return (entry.stateRoles || []).includes(anchor.stateRole || "");
      },
    );

    if (matches.length > 0) {
      const entry: MeasurementTimelineEntry =
        anchor.occurrence === MeasurementOccurrence.Last
          ? matches[matches.length - 1]!
          : matches[0]!;

      return {
        at: entry.startsAt,
        timelineEntryId: entry.id,
        status: MeasurementStatus.Recorded,
      };
    }

    if (
      MeasurementEvaluator.isStateStillReachable({
        anchor: anchor,
        timeline: timeline,
      })
    ) {
      return {
        status: MeasurementStatus.Pending,
        statusMessage: `${anchor.label} has not been reached yet`,
      };
    }

    return {
      status: MeasurementStatus.NotApplicable,
      statusMessage: `${anchor.label} was skipped`,
    };
  }

  /*
   * A state anchor is unreachable once the entity has moved past it.
   *
   * The order comparison -- rather than "is the entity resolved?" -- is what
   * makes this exact. Projects are encouraged to add states after Resolved,
   * so keying on a resolved flag would wrongly declare those unreachable,
   * and keying on nothing would leave a skipped state Pending forever.
   */
  private static isStateStillReachable(data: {
    anchor: MeasurementAnchorSpec;
    timeline: Array<MeasurementTimelineEntry>;
  }): boolean {
    const { anchor, timeline } = data;

    if (timeline.length === 0) {
      // Nothing has happened yet, so everything is still ahead.
      return true;
    }

    /*
     * A role anchor has no single order to compare against -- any number of
     * states may carry the role, and a project may have none at all. Leaving
     * it Pending is the honest answer: nothing rules it out.
     */
    if (anchor.kind === MeasurementAnchorKind.StateRoleEntered) {
      return true;
    }

    const currentOrder: number | undefined =
      timeline[timeline.length - 1]!.stateOrder;

    if (currentOrder === undefined || anchor.stateOrder === undefined) {
      return true;
    }

    return currentOrder < anchor.stateOrder;
  }

  public static formatDuration(seconds: number): string {
    if (seconds < 60) {
      return `${seconds}s`;
    }

    const minutes: number = Math.floor(seconds / 60);

    if (minutes < 60) {
      return `${minutes}m`;
    }

    const hours: number = Math.floor(minutes / 60);

    if (hours < 24) {
      return minutes % 60 === 0 ? `${hours}h` : `${hours}h ${minutes % 60}m`;
    }

    const days: number = Math.floor(hours / 24);

    return hours % 24 === 0 ? `${days}d` : `${days}d ${hours % 24}h`;
  }
}
