import CalendarEvent from "../Calendar/CalendarEvent";
import OneUptimeDate from "../Date";
import LayerUtil, {
  ExpandedLayer,
  ExpandedLayers,
  LayerEventsResult,
  MultiLayerProps,
  PriorityCalendarEvents,
  ROTATION_TURN_INDEX_KEY,
} from "./Layer";
import UserOverrideUtil, { UserOverrideRecord } from "./UserOverrideUtil";

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
