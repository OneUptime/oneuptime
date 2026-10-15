import CalendarEvent from "../Calendar/CalendarEvent";
import OneUptimeDate from "../Date";
import LayerUtil, {
  ExpandedLayer,
  ExpandedLayers,
  LayerEventsResult,
  LayerProps,
  MultiLayerProps,
  PriorityCalendarEvents,
  ROTATION_TURN_INDEX_KEY,
} from "./Layer";
import UserOverrideUtil, {
  OverrideEventMeta,
  UserOverrideRecord,
} from "./UserOverrideUtil";

/*
 * WHO IS ON CALL IN A SCHEDULE, AND WHEN - THE ONE ANSWER.
 *
 * Paging, the stored roster and its hand-off notifications, "on call now"
 * and the upcoming shifts, the final-schedule preview, the layer cards, the
 * schedule timeline, the calendar feeds and the shift reminders all ask the
 * same question, and must all give the same answer. They all answer it here,
 * in four steps, in this order:
 *
 *   1. expand    each layer's rotation over the window, on its own;
 *   2. skip      in each layer, hand the turns of people who are away with
 *                nobody named to cover to the next person in that layer's
 *                turn order who is not away (UserOverrideUtil.
 *                applySkipsToLayerEvents) - a layer left with nobody leaves
 *                its time to the layers below it;
 *   3. merge     the layers by priority: the highest layer with somebody on
 *                call wins (LayerUtil.mergeLayerEvents);
 *   4. cover     hand what is left of each away person's time to the person
 *                named to cover them (UserOverrideUtil.applyOverridesToEvents).
 *
 * Step 2 has to come before step 3: "the next person in the rotation" only
 * means something inside one layer, and a layer whose people are all away
 * must fall through to the layers below exactly as an empty layer does - the
 * merge would already have given its time away. Step 4 comes after it, as it
 * always has: a named cover takes the away person's time wherever the merged
 * schedule has them on call.
 *
 * "Who is next in the rotation" - the backup an escalation rule pages after
 * the on-call person - is answered here too, from the same four steps
 * (resolveNextInRotation): the layer that has whoever is on call, and the
 * next person in its turn order who is not away.
 *
 * The expansion is the expensive step. A caller that resolves the same
 * window in several policy contexts (the calendar feeds' per-policy
 * variants) expands once (expand) and resolves each context from it
 * (resolveExpanded); everyone else calls resolve.
 */

export interface ScheduleResolutionInput extends MultiLayerProps {
  /*
   * The user overrides of the schedule's people - with a cover, or a skip -
   * in any scope. The ones that do not apply in this policy context are left
   * out here (UserOverrideUtil.isOverrideApplicable).
   */
  overrides?: Array<UserOverrideRecord> | undefined;
  // The on-call policy the schedule is resolved for; none for policy-blind.
  currentOnCallDutyPolicyId?: string | null | undefined;
}

export interface ScheduleResolutionOptions {
  // Only the first N segments, counted after the merge (as getMultiLayerEvents counts).
  getNumberOfEvents?: number | undefined;
  // See LayerExpansionOptions.maxSimulationIterations.
  maxSimulationIterations?: number | undefined;
}

export interface ResolveExpandedOptions {
  overrides?: Array<UserOverrideRecord> | undefined;
  currentOnCallDutyPolicyId?: string | null | undefined;
  getNumberOfEvents?: number | undefined;
}

/*
 * The schedule's layers at one moment, for "who is next in the rotation"
 * (resolveNextInRotation): the layers, the people's overrides, the policy
 * the schedule is paged through, and the moment.
 */
export interface NextInRotationInput {
  layers: Array<LayerProps>;
  at: Date;
  overrides?: Array<UserOverrideRecord> | undefined;
  currentOnCallDutyPolicyId?: string | null | undefined;
}

export interface ResolveNextInRotationOptions {
  at: Date;
  overrides?: Array<UserOverrideRecord> | undefined;
  currentOnCallDutyPolicyId?: string | null | undefined;
}

/*
 * Who is on call at a moment, and who is next in their rotation: the
 * person an escalation rule's "Next in rotation" of the schedule pages.
 */
export interface NextInRotation {
  // Who is on call: the person a page to the schedule goes to.
  onCallUserId: string;
  /*
   * Whose turn it is in the rotation: the person on call, or - while a user
   * override puts somebody in their place - the person away.
   */
  turnUserId: string;
  // The next person in the same rotation who is not away; null for nobody.
  nextUserId: string | null;
  // The layer the turn is in, when the caller named its layers.
  layerId?: string | undefined;
  layerName?: string | undefined;
}

// The moment a resolution "at" a time looks at: one second from it.
const ONE_MOMENT_IN_SECONDS: number = 1;

export default class ScheduleResolution {
  /*
   * Who is on call over the window: every segment, in start order, its title
   * the user id of who is on call. A segment somebody has because the person
   * whose turn it was is away carries the override meta
   * (UserOverrideUtil.getOverrideMeta; isSkip when the rotation picked them).
   */
  public static resolve(
    input: ScheduleResolutionInput,
    options?: ScheduleResolutionOptions | undefined,
  ): LayerEventsResult {
    const expanded: ExpandedLayers = ScheduleResolution.expand(input, {
      maxSimulationIterations: options?.maxSimulationIterations,
    });

    return {
      events: ScheduleResolution.resolveExpanded(expanded, {
        overrides: input.overrides,
        currentOnCallDutyPolicyId: input.currentOnCallDutyPolicyId,
        getNumberOfEvents: options?.getNumberOfEvents,
      }),
      truncated: expanded.truncated,
    };
  }

  /*
   * Step 1 alone: each layer expanded over the window, each event stamped
   * with its place in its layer's turn order, ready for resolveExpanded -
   * as many times as there are contexts to resolve.
   */
  public static expand(
    input: MultiLayerProps,
    options?: { maxSimulationIterations?: number | undefined } | undefined,
  ): ExpandedLayers {
    return new LayerUtil().getLayerEventsWithMeta(
      {
        layers: input.layers,
        calendarStartDate: input.calendarStartDate,
        calendarEndDate: input.calendarEndDate,
      },
      {
        withTurnIndex: true,
        ...(options?.maxSimulationIterations !== undefined
          ? { maxSimulationIterations: options.maxSimulationIterations }
          : {}),
      },
    );
  }

  /*
   * Steps 2-4 for one policy context, from an expansion. Never changes the
   * expansion, so it can be resolved again for another context.
   */
  public static resolveExpanded(
    expanded: ExpandedLayers,
    options?: ResolveExpandedOptions | undefined,
  ): Array<CalendarEvent> {
    const applicable: Array<UserOverrideRecord> =
      UserOverrideUtil.getApplicableOverrides(
        options?.overrides || [],
        options?.currentOnCallDutyPolicyId,
      );

    const skips: Array<UserOverrideRecord> = applicable.filter(
      (record: UserOverrideRecord) => {
        return UserOverrideUtil.isSkip(record);
      },
    );

    const events: Array<PriorityCalendarEvents> = [];

    for (const layer of expanded.layers) {
      events.push(...ScheduleResolution.skipLayer(layer, applicable, skips));
    }

    const layerUtil: LayerUtil = new LayerUtil();

    let merged: Array<CalendarEvent> = layerUtil.mergeLayerEvents(events, {
      getNumberOfEvents: options?.getNumberOfEvents,
    });

    if (applicable.length > skips.length && merged.length > 0) {
      merged = UserOverrideUtil.applyOverridesToEvents({
        events: merged,
        overrides: applicable,
        currentOnCallDutyPolicyId: options?.currentOnCallDutyPolicyId,
      });
    }

    return merged;
  }

  /*
   * WHO IS NEXT IN THE ROTATION - THE BACKUP TO WHOEVER IS ON CALL.
   *
   * An escalation rule can page "the next person in the rotation" of an
   * on-call schedule: page the schedule's on-call person at one level and,
   * when they do not acknowledge, the person after them in the same
   * rotation at the next - one schedule, with no second "backup" schedule to
   * keep in step with it.
   *
   * The answer is read from the same resolution as "who is on call"
   * (resolve), at one moment:
   *
   *   1. who is on call: the layers expanded, skipped, merged and covered,
   *      as a page to the schedule finds them. Nobody on call - a gap, or
   *      everybody away - and there is nobody next either: null;
   *   2. the rotation: the layer that supplied whoever is on call - the
   *      highest layer with somebody on call, as the merge decides - and the
   *      turn in it at that moment (whose turn it is, and its place in the
   *      layer's turn order);
   *   3. the next person: the first after that turn in the layer's turn
   *      order, wrapping round, who is not away (a user override, with a
   *      cover or without one) and is not on call already - neither the
   *      person whose turn it is nor whoever has it in their place
   *      (UserOverrideUtil.getNextInRotation).
   *
   * Only the same rotation: a layer with nobody else in it, or everybody
   * else in it away, has nobody next (nextUserId null) - the layers below it
   * are other rotations, which the policy's later levels can page.
   */
  public static resolveNextInRotation(
    input: NextInRotationInput,
  ): NextInRotation | null {
    const at: Date = OneUptimeDate.fromString(input.at);

    const expanded: ExpandedLayers = ScheduleResolution.expand({
      layers: input.layers,
      calendarStartDate: at,
      calendarEndDate: OneUptimeDate.addRemoveSeconds(at, ONE_MOMENT_IN_SECONDS),
    });

    return ScheduleResolution.resolveNextInRotationExpanded(expanded, {
      at: at,
      overrides: input.overrides,
      currentOnCallDutyPolicyId: input.currentOnCallDutyPolicyId,
    });
  }

  /*
   * resolveNextInRotation from an expansion that holds the moment (expand,
   * over a window that starts at it): a caller reads the overrides only once
   * it knows somebody is on call, as the schedule service does.
   */
  public static resolveNextInRotationExpanded(
    expanded: ExpandedLayers,
    options: ResolveNextInRotationOptions,
  ): NextInRotation | null {
    const at: Date = OneUptimeDate.fromString(options.at);
    const moment: number = at.getTime();

    const onCallEvents: Array<CalendarEvent> =
      ScheduleResolution.resolveExpanded(expanded, {
        overrides: options.overrides,
        currentOnCallDutyPolicyId: options.currentOnCallDutyPolicyId,
      });

    const onCall: CalendarEvent | undefined = onCallEvents.find(
      (event: CalendarEvent): boolean => {
        return ScheduleResolution.coversMoment(event, moment);
      },
    );

    if (!onCall || !onCall.title) {
      return null;
    }

    const onCallUserId: string = onCall.title;

    // Whose turn it is: the person a user override puts somebody in place of.
    const override: OverrideEventMeta | null =
      UserOverrideUtil.getOverrideMeta(onCall);
    const coveredUserId: string | null =
      override?.originalUserId && override.originalUserId !== onCallUserId
        ? override.originalUserId
        : null;

    const priority: unknown = (onCall as unknown as Record<string, unknown>)[
      "priority"
    ];

    const layer: ExpandedLayer | undefined = expanded.layers.find(
      (candidate: ExpandedLayer): boolean => {
        return candidate.priority === priority;
      },
    );

    if (!layer) {
      return {
        onCallUserId: onCallUserId,
        turnUserId: coveredUserId || onCallUserId,
        nextUserId: null,
      };
    }

    // The turn in the rotation at the moment, before anybody was skipped.
    const turn: PriorityCalendarEvents | undefined = layer.events.find(
      (event: PriorityCalendarEvents): boolean => {
        return ScheduleResolution.coversMoment(event, moment);
      },
    );

    const turnUserId: string = turn?.title || coveredUserId || onCallUserId;
    const turnIndex: number = ScheduleResolution.getTurnIndex({
      turn: turn,
      turnUserId: turnUserId,
      userIds: layer.userIds,
    });

    const nextUserId: string | null =
      turnIndex < 0
        ? null
        : UserOverrideUtil.getNextInRotation({
            userIds: layer.userIds,
            turnIndex: turnIndex,
            start: at,
            end: OneUptimeDate.addRemoveSeconds(at, ONE_MOMENT_IN_SECONDS),
            overrides: UserOverrideUtil.getApplicableOverrides(
              options.overrides || [],
              options.currentOnCallDutyPolicyId,
            ),
            excludeUserIds: [onCallUserId, turnUserId],
          });

    const result: NextInRotation = {
      onCallUserId: onCallUserId,
      turnUserId: turnUserId,
      nextUserId: nextUserId,
    };

    if (layer.layerId !== undefined) {
      result.layerId = layer.layerId;
    }

    if (layer.layerName !== undefined) {
      result.layerName = layer.layerName;
    }

    return result;
  }

  // Whether an event is in force at a moment: [start, end).
  private static coversMoment(event: CalendarEvent, moment: number): boolean {
    const start: number = OneUptimeDate.fromString(event.start).getTime();
    const end: number = OneUptimeDate.fromString(event.end).getTime();

    return start <= moment && end > moment;
  }

  /*
   * A turn's place in its layer's turn order: stamped by the engine
   * (ROTATION_TURN_INDEX_KEY) when it names the turn's person, or else that
   * person's first place in the list; -1 when they are not in it.
   */
  private static getTurnIndex(data: {
    turn: PriorityCalendarEvents | undefined;
    turnUserId: string;
    userIds: Array<string>;
  }): number {
    const stamped: unknown = data.turn
      ? (data.turn as unknown as Record<string, unknown>)[
          ROTATION_TURN_INDEX_KEY
        ]
      : undefined;

    if (
      typeof stamped === "number" &&
      Number.isInteger(stamped) &&
      stamped >= 0 &&
      stamped < data.userIds.length &&
      data.userIds[stamped] === data.turnUserId
    ) {
      return stamped;
    }

    return data.userIds.indexOf(data.turnUserId);
  }

  /*
   * One layer's events after step 2, as fresh objects: the merge trims the
   * events it is given in place, and the expansion must stay as it was.
   */
  private static skipLayer(
    layer: ExpandedLayer,
    applicable: Array<UserOverrideRecord>,
    skips: Array<UserOverrideRecord>,
  ): Array<PriorityCalendarEvents> {
    const layerUserIds: Set<string> = new Set<string>(layer.userIds);

    const isSkipInLayer: boolean = skips.some((record: UserOverrideRecord) => {
      return layerUserIds.has(record.overrideUserId);
    });

    if (!isSkipInLayer) {
      return layer.events.map(
        (event: PriorityCalendarEvents): PriorityCalendarEvents => {
          return ScheduleResolution.copyEvent(event);
        },
      );
    }

    return UserOverrideUtil.applySkipsToLayerEvents({
      events: layer.events,
      userIds: layer.userIds,
      overrides: applicable,
    }).map((event: CalendarEvent): PriorityCalendarEvents => {
      return ScheduleResolution.copyEvent(event as PriorityCalendarEvents);
    });
  }

  private static copyEvent(
    event: PriorityCalendarEvents,
  ): PriorityCalendarEvents {
    const copy: PriorityCalendarEvents = {
      ...event,
      start: new Date(OneUptimeDate.fromString(event.start).getTime()),
      end: new Date(OneUptimeDate.fromString(event.end).getTime()),
    };

    delete (copy as unknown as Record<string, unknown>)[
      ROTATION_TURN_INDEX_KEY
    ];

    return copy;
  }
}
