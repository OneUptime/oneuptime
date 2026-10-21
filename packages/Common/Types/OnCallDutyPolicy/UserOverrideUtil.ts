import CalendarEvent from "../Calendar/CalendarEvent";
import OneUptimeDate from "../Date";

/*
 * One user override: somebody is away for a while.
 *
 * With a cover (routeAlertsToUserId), the pages that would go to the person
 * away go to the cover instead - from their schedules, from the teams and
 * escalation rules that name them.
 *
 * Without one, the override is a SKIP: in every schedule layer they are in,
 * each of their turns goes to the next person in that layer's turn order
 * who is not away themselves, and nothing else changes - the rotation does
 * not move, so they are back in their usual place when the override ends. A
 * team or an escalation rule that names them directly does not page them
 * while they are away (nobody stands in for them there: there is no turn
 * order to take the next person from).
 */
export interface UserOverrideRecord {
  // The person who is away.
  overrideUserId: string;
  /*
   * Who covers. Empty (absent, null or "") for a skip: the next person in
   * the rotation takes each turn. See isSkip.
   */
  routeAlertsToUserId?: string | null | undefined;
  startsAt: Date;
  endsAt: Date;
  // null/undefined means global override (applies to all on-call duty policies)
  onCallDutyPolicyId?: string | null | undefined;
}

export interface OverrideEventMeta {
  isOverride: true;
  // The person whose turn it was (who is away).
  originalUserId: string;
  // The person who has the turn now: the cover, or the next person in the rotation.
  overrideUserId: string;
  // The override's own window (the person's time away), not the segment's.
  overrideStartsAt: Date;
  overrideEndsAt: Date;
  /*
   * Which override produced this segment: null/undefined for a GLOBAL override
   * (one that applies through every on-call policy), the policy's id for a
   * policy-scoped one. Carried on the segment so a renderer can say WHY the
   * substitution is in force without having to reverse-map the segment back to
   * the override record that made it - a lookup by (users + window) that cannot
   * distinguish two overrides sharing both. It is the same distinction the user
   * makes when creating one from the project's overrides page (global) versus a
   * policy's own overrides tab (scoped).
   */
  onCallDutyPolicyId?: string | null | undefined;
  /*
   * Present (true) when the override named nobody to cover, and the turn went
   * to the next person in the layer's rotation who was not away. Absent for
   * a named cover, so segments from those look exactly as they always did.
   */
  isSkip?: true;
}

/*
 * CalendarEvent extends JSONObject so it accepts string-indexed metadata.
 * We attach the override info under a known key so downstream consumers can
 * detect and render the substitution distinctly.
 */
export const OVERRIDE_META_KEY: string = "_override";

/*
 * The key the engine stamps on an event with its place in the layer's turn
 * order. Defined in Layer.ts as ROTATION_TURN_INDEX_KEY; repeated here (and
 * pinned equal by a test) so this module does not import the engine.
 */
const TURN_INDEX_KEY: string = "rotationTurnIndex";

// A stretch of time, in epoch milliseconds, [start, end).
interface TimeRange {
  start: number;
  end: number;
}

// A stretch of a skip in force, with the override that skips.
interface SkipRange extends TimeRange {
  record: UserOverrideRecord;
}

/*
 * The time-away records of a context, ready for the skip pass: per person,
 * when they are away at all, and when their turns are skipped.
 */
interface AwayIndex {
  // userId -> every stretch of any override (cover or skip) of theirs.
  awayByUserId: Map<string, Array<TimeRange>>;
  // userId -> the stretches their turns are skipped, with the winning record.
  skipsByUserId: Map<string, Array<SkipRange>>;
}

export default class UserOverrideUtil {
  /**
   * Decides whether an override should affect resolution for a given policy
   * context. Global overrides (no policy id) always apply. Policy-scoped
   * overrides only apply when their policy matches the caller's policy.
   * When the caller has no policy context, only global overrides apply.
   */
  public static isOverrideApplicable(
    override: UserOverrideRecord,
    currentOnCallDutyPolicyId?: string | null | undefined,
  ): boolean {
    if (!override.onCallDutyPolicyId) {
      return true;
    }

    if (!currentOnCallDutyPolicyId) {
      return false;
    }

    return override.onCallDutyPolicyId === currentOnCallDutyPolicyId;
  }

  /*
   * True for an override that names nobody to cover: the person's turns go
   * to the next person in the rotation instead.
   */
  public static isSkip(override: UserOverrideRecord): boolean {
    return !override.routeAlertsToUserId;
  }

  /*
   * Which of two overrides of the same person, in force at the same time,
   * decides who has their turn - lower wins:
   *
   *   0  a policy's own override that names who covers
   *   1  a policy's own skip
   *   2  a global override that names who covers
   *   3  a global skip
   *
   * A policy's own override beats a global one, as it always has: whoever
   * set it up for that policy meant it for that policy. Between two of the
   * same scope, the one that names who covers beats a skip: naming a person
   * is the more specific instruction - a week skipped for a holiday, with a
   * colleague named for the two days of it that matter most.
   */
  public static getPrecedence(override: UserOverrideRecord): number {
    return (
      (override.onCallDutyPolicyId ? 0 : 2) +
      (UserOverrideUtil.isSkip(override) ? 1 : 0)
    );
  }

  /*
   * The overrides that apply in a policy context, in the order they are
   * applied: a policy's own before the global ones (see getPrecedence),
   * otherwise in the order given.
   */
  public static getApplicableOverrides(
    overrides: Array<UserOverrideRecord>,
    currentOnCallDutyPolicyId?: string | null | undefined,
  ): Array<UserOverrideRecord> {
    return overrides
      .filter((o: UserOverrideRecord) => {
        return (
          Boolean(o) &&
          Boolean(o.overrideUserId) &&
          UserOverrideUtil.isOverrideApplicable(o, currentOnCallDutyPolicyId)
        );
      })
      .map((o: UserOverrideRecord, index: number) => {
        return { o, index };
      })
      .sort(
        (
          a: { o: UserOverrideRecord; index: number },
          b: { o: UserOverrideRecord; index: number },
        ) => {
          const aPolicyScoped: number = a.o.onCallDutyPolicyId ? 0 : 1;
          const bPolicyScoped: number = b.o.onCallDutyPolicyId ? 0 : 1;
          return aPolicyScoped - bPolicyScoped || a.index - b.index;
        },
      )
      .map((entry: { o: UserOverrideRecord; index: number }) => {
        return entry.o;
      });
  }

  public static applyOverridesToEvents(data: {
    events: Array<CalendarEvent>;
    overrides: Array<UserOverrideRecord>;
    currentOnCallDutyPolicyId?: string | null | undefined;
  }): Array<CalendarEvent> {
    /*
     * Overrides that name who covers, only: a skip names nobody, and is
     * applied to each layer's own events before the layers are merged
     * (applySkipsToLayerEvents, run by ScheduleResolution), because the next
     * person in the rotation is a question about one layer.
     *
     * Policy-specific overrides go before globals so that when both target
     * the same user/window, the policy-specific substitution wins:
     * splitEventByOverride only matches on the original user id, so the
     * first override that consumes a segment claims it.
     */
    const applicable: Array<UserOverrideRecord> =
      UserOverrideUtil.getApplicableOverrides(
        data.overrides,
        data.currentOnCallDutyPolicyId,
      ).filter((o: UserOverrideRecord) => {
        return !UserOverrideUtil.isSkip(o);
      });

    if (applicable.length === 0) {
      return data.events;
    }

    let working: Array<CalendarEvent> = data.events;

    for (const override of applicable) {
      const next: Array<CalendarEvent> = [];
      for (const event of working) {
        next.push(...UserOverrideUtil.splitEventByOverride(event, override));
      }
      working = next;
    }

    return UserOverrideUtil.reassignEventIds(working);
  }

  /*
   * THE SKIP PASS: one layer's events, with the turns of people who are away
   * with nobody named to cover handed on down the layer's turn order.
   *
   * For each stretch of a turn while its person is skipped, the turn goes to
   * the next person after THAT turn (ROTATION_TURN_INDEX_KEY says which turn
   * it is) who is not away at that time - away with a cover or skipped, in
   * this context - wrapping round to the start of the list. Nobody left: the
   * stretch is dropped, so the layer has nobody on call then and the layers
   * below it decide, exactly as for a layer with nobody in it. The rotation
   * itself never moves: everybody else's turns, and the skipped person's
   * turns outside their time away, are the turns they always were.
   *
   * A turn the skip only partly covers is split where the skip (or a
   * candidate's own time away) starts and ends: a skip that starts or ends
   * mid-shift hands over at that moment. The stretches handed on carry the
   * override meta (isSkip: true) the screens use to say "covering Alice"; the
   * person's own stretches carry none.
   *
   * `overrides` are those that apply in the context (getApplicableOverrides).
   * A skip only acts where no override of higher precedence (getPrecedence)
   * names who covers: there, the covering override is applied after the
   * merge (applyOverridesToEvents) to the person's own turn, which this pass
   * leaves in place.
   *
   * Pure: returns new events, removes the turn index from every one, and
   * never mutates its input.
   */
  public static applySkipsToLayerEvents(data: {
    events: Array<CalendarEvent>;
    // The layer's people as ids, in turn order.
    userIds: Array<string>;
    overrides: Array<UserOverrideRecord>;
  }): Array<CalendarEvent> {
    const index: AwayIndex = UserOverrideUtil.buildAwayIndex(data.overrides);

    const result: Array<CalendarEvent> = [];

    for (const event of data.events) {
      result.push(
        ...UserOverrideUtil.skipEvent({
          event,
          userIds: data.userIds,
          index,
        }),
      );
    }

    return result;
  }

  /*
   * Who is away, and whose turns are skipped when, from the overrides that
   * apply in a context.
   */
  private static buildAwayIndex(
    overrides: Array<UserOverrideRecord>,
  ): AwayIndex {
    const awayByUserId: Map<string, Array<TimeRange>> = new Map<
      string,
      Array<TimeRange>
    >();
    const skipsByUserId: Map<string, Array<SkipRange>> = new Map<
      string,
      Array<SkipRange>
    >();

    const valid: Array<{ record: UserOverrideRecord; range: TimeRange }> = [];

    for (const record of overrides) {
      if (!record || !record.overrideUserId) {
        continue;
      }

      const range: TimeRange | null = UserOverrideUtil.toRange(
        record.startsAt,
        record.endsAt,
      );

      if (!range) {
        continue;
      }

      valid.push({ record, range });

      const away: Array<TimeRange> =
        awayByUserId.get(record.overrideUserId) || [];
      away.push(range);
      awayByUserId.set(record.overrideUserId, away);
    }

    /*
     * Each skip, in precedence order (then as given), less the stretches an
     * override of higher precedence for the same person names a cover for.
     */
    const skips: Array<{ record: UserOverrideRecord; range: TimeRange }> = valid
      .map(
        (
          entry: { record: UserOverrideRecord; range: TimeRange },
          position: number,
        ) => {
          return { ...entry, position };
        },
      )
      .filter(
        (entry: {
          record: UserOverrideRecord;
          range: TimeRange;
          position: number;
        }) => {
          return UserOverrideUtil.isSkip(entry.record);
        },
      )
      .sort(
        (
          a: { record: UserOverrideRecord; position: number },
          b: { record: UserOverrideRecord; position: number },
        ) => {
          return (
            UserOverrideUtil.getPrecedence(a.record) -
              UserOverrideUtil.getPrecedence(b.record) ||
            a.position - b.position
          );
        },
      );

    for (const skip of skips) {
      const precedence: number = UserOverrideUtil.getPrecedence(skip.record);

      const winningCovers: Array<TimeRange> = valid
        .filter((entry: { record: UserOverrideRecord; range: TimeRange }) => {
          return (
            entry.record.overrideUserId === skip.record.overrideUserId &&
            !UserOverrideUtil.isSkip(entry.record) &&
            UserOverrideUtil.getPrecedence(entry.record) < precedence
          );
        })
        .map((entry: { record: UserOverrideRecord; range: TimeRange }) => {
          return entry.range;
        });

      const remaining: Array<TimeRange> = UserOverrideUtil.subtractRanges(
        skip.range,
        winningCovers,
      );

      if (remaining.length === 0) {
        continue;
      }

      const list: Array<SkipRange> =
        skipsByUserId.get(skip.record.overrideUserId) || [];

      for (const range of remaining) {
        list.push({ ...range, record: skip.record });
      }

      skipsByUserId.set(skip.record.overrideUserId, list);
    }

    return { awayByUserId, skipsByUserId };
  }

  // One event through the skip pass: itself, or the stretches it splits into.
  private static skipEvent(data: {
    event: CalendarEvent;
    userIds: Array<string>;
    index: AwayIndex;
  }): Array<CalendarEvent> {
    const event: CalendarEvent = UserOverrideUtil.withoutTurnIndex(data.event);

    const start: number = OneUptimeDate.fromString(data.event.start).getTime();
    const end: number = OneUptimeDate.fromString(data.event.end).getTime();

    const userId: string = data.event.title;

    const skips: Array<SkipRange> = (
      data.index.skipsByUserId.get(userId) || []
    ).filter((skip: SkipRange) => {
      return skip.start < end && skip.end > start;
    });

    /*
     * Not skipped during this turn - or a turn the engine already left
     * empty or inverted, which nothing here should try to hand on.
     */
    if (skips.length === 0 || !(end > start)) {
      return [event];
    }

    const turnIndex: number = UserOverrideUtil.getTurnIndex(
      data.event,
      data.userIds,
    );

    /*
     * Every moment inside the turn where somebody's availability changes:
     * where this person's skip starts or ends, and where any other person of
     * the layer goes away or comes back. Between two of them, who has the
     * turn cannot change.
     */
    const cuts: Set<number> = new Set<number>([start, end]);

    const addCuts: (range: TimeRange) => void = (range: TimeRange): void => {
      if (range.start > start && range.start < end) {
        cuts.add(range.start);
      }

      if (range.end > start && range.end < end) {
        cuts.add(range.end);
      }
    };

    for (const skip of skips) {
      addCuts(skip);
    }

    for (const otherUserId of data.userIds) {
      for (const range of data.index.awayByUserId.get(otherUserId) || []) {
        addCuts(range);
      }
    }

    const points: Array<number> = Array.from(cuts).sort(
      (a: number, b: number) => {
        return a - b;
      },
    );

    const pieces: Array<CalendarEvent> = [];

    for (let i: number = 0; i < points.length - 1; i++) {
      const pieceStart: number = points[i]!;
      const pieceEnd: number = points[i + 1]!;

      if (!(pieceEnd > pieceStart)) {
        continue;
      }

      const skip: SkipRange | undefined = skips.find((range: SkipRange) => {
        return range.start < pieceEnd && range.end > pieceStart;
      });

      if (!skip) {
        pieces.push({
          ...event,
          start: new Date(pieceStart),
          end: new Date(pieceEnd),
        });
        continue;
      }

      const takerUserId: string | null = UserOverrideUtil.getNextAvailable({
        userIds: data.userIds,
        turnIndex,
        start: pieceStart,
        end: pieceEnd,
        index: data.index,
      });

      // Nobody left in the layer: it has nobody on call for this stretch.
      if (!takerUserId) {
        continue;
      }

      const meta: OverrideEventMeta = {
        isOverride: true,
        originalUserId: userId,
        overrideUserId: takerUserId,
        overrideStartsAt: OneUptimeDate.fromString(skip.record.startsAt),
        overrideEndsAt: OneUptimeDate.fromString(skip.record.endsAt),
        onCallDutyPolicyId: skip.record.onCallDutyPolicyId || null,
        isSkip: true,
      };

      pieces.push({
        ...event,
        start: new Date(pieceStart),
        end: new Date(pieceEnd),
        title: takerUserId,
        [OVERRIDE_META_KEY]: meta as unknown as never,
      });
    }

    return UserOverrideUtil.joinTouchingPieces(pieces);
  }

  /*
   * THE NEXT PERSON IN THE ROTATION AFTER A TURN: whom an escalation rule's
   * "Next in rotation" of an on-call schedule pages - the backup to whoever
   * is on call, from the same rotation.
   *
   * The first person after the turn in the layer's turn order, wrapping
   * round to the start of the list, who is not away at any moment of
   * [start, end) - away with a cover or skipped, in this context, exactly as
   * the skip pass passes them over (applySkipsToLayerEvents) - and is none
   * of `excludeUserIds`: whoever has the turn now, and whose turn it is,
   * who are on call already and are never their own backup. Null when there
   * is nobody: the layer has nobody else in it, or everybody else in it is
   * away.
   *
   * `turnIndex` is the turn's place in the layer's turn order
   * (ROTATION_TURN_INDEX_KEY): the same person twice in a list ([Alice, Bob,
   * Alice, Carol]) has a different next person after each of their turns.
   *
   * `overrides` are those that apply in the context (getApplicableOverrides).
   * Pure.
   */
  public static getNextInRotation(data: {
    // The layer's people as ids, in turn order.
    userIds: Array<string>;
    turnIndex: number;
    start: Date;
    end: Date;
    overrides: Array<UserOverrideRecord>;
    excludeUserIds?: Array<string> | undefined;
  }): string | null {
    const count: number = data.userIds.length;

    if (
      count === 0 ||
      !Number.isInteger(data.turnIndex) ||
      data.turnIndex < 0 ||
      data.turnIndex >= count
    ) {
      return null;
    }

    const start: number = OneUptimeDate.fromString(data.start).getTime();
    const end: number = OneUptimeDate.fromString(data.end).getTime();

    if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start)) {
      return null;
    }

    return UserOverrideUtil.getNextAvailable({
      userIds: data.userIds,
      turnIndex: data.turnIndex,
      start,
      end,
      index: UserOverrideUtil.buildAwayIndex(data.overrides),
      excludeUserIds: new Set<string>(data.excludeUserIds || []),
    });
  }

  /*
   * Who has a skipped turn: the first person after it in the layer's turn
   * order, wrapping round, who is not away at any moment of [start, end).
   * The skipped person's own other places in the list are passed over too -
   * they are away. The people in `excludeUserIds` are passed over as well
   * (getNextInRotation: whoever is on call now).
   */
  private static getNextAvailable(data: {
    userIds: Array<string>;
    turnIndex: number;
    start: number;
    end: number;
    index: AwayIndex;
    excludeUserIds?: Set<string> | undefined;
  }): string | null {
    const count: number = data.userIds.length;

    for (let step: number = 1; step < count; step++) {
      const candidate: string | undefined =
        data.userIds[(data.turnIndex + step) % count];

      if (!candidate || data.excludeUserIds?.has(candidate)) {
        continue;
      }

      const isAway: boolean = (
        data.index.awayByUserId.get(candidate) || []
      ).some((range: TimeRange) => {
        return range.start < data.end && range.end > data.start;
      });

      if (!isAway) {
        return candidate;
      }
    }

    return null;
  }

  /*
   * The turn's place in the layer's turn order: stamped by the engine, or -
   * for an event that never carried it - the person's first place in it.
   */
  private static getTurnIndex(
    event: CalendarEvent,
    userIds: Array<string>,
  ): number {
    const stamped: unknown = (event as unknown as Record<string, unknown>)[
      TURN_INDEX_KEY
    ];

    if (
      typeof stamped === "number" &&
      Number.isInteger(stamped) &&
      stamped >= 0 &&
      stamped < userIds.length &&
      userIds[stamped] === event.title
    ) {
      return stamped;
    }

    return Math.max(0, userIds.indexOf(event.title));
  }

  /*
   * Stretches of one turn that touch and say the same thing - the same
   * person, for the same reason - as one segment again: a cut where only
   * somebody else's availability changed must not split the turn.
   */
  private static joinTouchingPieces(
    pieces: Array<CalendarEvent>,
  ): Array<CalendarEvent> {
    const joined: Array<CalendarEvent> = [];

    for (const piece of pieces) {
      const last: CalendarEvent | undefined = joined[joined.length - 1];

      if (
        last &&
        last.end.getTime() === piece.start.getTime() &&
        last.title === piece.title &&
        UserOverrideUtil.getSkipIdentity(last) ===
          UserOverrideUtil.getSkipIdentity(piece)
      ) {
        last.end = piece.end;
        continue;
      }

      joined.push(piece);
    }

    return joined;
  }

  private static getSkipIdentity(event: CalendarEvent): string {
    const meta: OverrideEventMeta | null =
      UserOverrideUtil.getOverrideMeta(event);

    if (!meta) {
      return "";
    }

    return `${meta.originalUserId}@${meta.overrideStartsAt.getTime()}-${meta.overrideEndsAt.getTime()}|${meta.onCallDutyPolicyId || ""}`;
  }

  // A copy of the event without the engine's turn index.
  private static withoutTurnIndex(event: CalendarEvent): CalendarEvent {
    const copy: CalendarEvent = { ...event };
    delete (copy as unknown as Record<string, unknown>)[TURN_INDEX_KEY];
    return copy;
  }

  // [startsAt, endsAt) in milliseconds, or null when it is not a stretch of time.
  private static toRange(
    startsAt: Date | string | undefined,
    endsAt: Date | string | undefined,
  ): TimeRange | null {
    if (!startsAt || !endsAt) {
      return null;
    }

    const start: number = OneUptimeDate.fromString(startsAt).getTime();
    const end: number = OneUptimeDate.fromString(endsAt).getTime();

    if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start)) {
      return null;
    }

    return { start, end };
  }

  // `range` with every one of `minus` cut out of it.
  private static subtractRanges(
    range: TimeRange,
    minus: Array<TimeRange>,
  ): Array<TimeRange> {
    let remaining: Array<TimeRange> = [range];

    for (const cut of minus) {
      const next: Array<TimeRange> = [];

      for (const piece of remaining) {
        if (cut.end <= piece.start || cut.start >= piece.end) {
          next.push(piece);
          continue;
        }

        if (cut.start > piece.start) {
          next.push({ start: piece.start, end: cut.start });
        }

        if (cut.end < piece.end) {
          next.push({ start: cut.end, end: piece.end });
        }
      }

      remaining = next;
    }

    return remaining;
  }

  private static splitEventByOverride(
    event: CalendarEvent,
    override: UserOverrideRecord,
  ): Array<CalendarEvent> {
    /*
     * Overrides are non-transitive: an override must never act on a segment
     * that is itself the RESULT of a previous override. Otherwise a chain
     * (global A->B applied first, then B->C) would double-substitute the same
     * window, and the resolved user would depend on override ordering. A
     * segment produced by a prior override carries OVERRIDE_META_KEY, so we
     * leave it untouched here.
     */
    if (UserOverrideUtil.getOverrideMeta(event)) {
      return [event];
    }

    // A skip names nobody to hand the segment to (see applySkipsToLayerEvents).
    if (!override.routeAlertsToUserId) {
      return [event];
    }

    if (event.title !== override.overrideUserId) {
      return [event];
    }

    /*
     * Override window doesn't overlap event window at all. Use second-precision
     * comparisons consistently (isOnOrAfter / isOnOrBefore) so a sub-second
     * offset cannot slip past as "overlapping" and produce an inverted segment
     * (previously isSame used millisecond precision while isAfter/isBefore used
     * seconds, an inconsistent mix).
     */
    if (
      OneUptimeDate.isOnOrAfter(override.startsAt, event.end) ||
      OneUptimeDate.isOnOrBefore(override.endsAt, event.start)
    ) {
      return [event];
    }

    const overrideStart: Date = OneUptimeDate.isAfter(
      override.startsAt,
      event.start,
    )
      ? override.startsAt
      : event.start;

    const overrideEnd: Date = OneUptimeDate.isBefore(override.endsAt, event.end)
      ? override.endsAt
      : event.end;

    const segments: Array<CalendarEvent> = [];

    // Segment before the override window — original user remains on call.
    if (OneUptimeDate.isBefore(event.start, overrideStart)) {
      segments.push({
        ...event,
        end: overrideStart,
      });
    }

    // Override window — substitute user takes over.
    const meta: OverrideEventMeta = {
      isOverride: true,
      originalUserId: override.overrideUserId,
      overrideUserId: override.routeAlertsToUserId,
      overrideStartsAt: override.startsAt,
      overrideEndsAt: override.endsAt,
      /*
       * Normalise the record's absent/null policy to null so a consumer can
       * test one value for "global" instead of three.
       */
      onCallDutyPolicyId: override.onCallDutyPolicyId || null,
    };

    segments.push({
      ...event,
      start: overrideStart,
      end: overrideEnd,
      title: override.routeAlertsToUserId,
      [OVERRIDE_META_KEY]: meta as unknown as never,
    });

    // Segment after the override window — original user resumes.
    if (OneUptimeDate.isAfter(event.end, overrideEnd)) {
      segments.push({
        ...event,
        start: overrideEnd,
      });
    }

    return segments;
  }

  private static reassignEventIds(
    events: Array<CalendarEvent>,
  ): Array<CalendarEvent> {
    let id: number = 1;
    return events.map((event: CalendarEvent) => {
      return { ...event, id: id++ };
    });
  }

  public static getOverrideMeta(
    event: CalendarEvent,
  ): OverrideEventMeta | null {
    const meta: unknown = (event as unknown as Record<string, unknown>)[
      OVERRIDE_META_KEY
    ];
    if (
      meta &&
      typeof meta === "object" &&
      (meta as { isOverride?: boolean }).isOverride === true
    ) {
      return meta as OverrideEventMeta;
    }
    return null;
  }

  // True when a segment is a turn handed on because its person is skipped.
  public static isSkipMeta(
    meta: OverrideEventMeta | null | undefined,
  ): boolean {
    return Boolean(meta && meta.isSkip === true);
  }
}
