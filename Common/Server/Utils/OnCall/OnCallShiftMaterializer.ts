import crypto from "crypto";
import OnCallDutyPolicyScheduleService, {
  ResolvedShiftSegments,
} from "../../Services/OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyScheduleLayerUserService from "../../Services/OnCallDutyPolicyScheduleLayerUserService";
import OnCallDutyPolicyUserOverrideService from "../../Services/OnCallDutyPolicyUserOverrideService";
import ProjectService from "../../Services/ProjectService";
import UserService from "../../Services/UserService";
import QueryHelper from "../../Types/Database/QueryHelper";
import CaptureSpan from "../Telemetry/CaptureSpan";
import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import OnCallDutyPolicyScheduleLayerUser from "../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayerUser";
import OnCallDutyPolicyUserOverride from "../../../Models/DatabaseModels/OnCallDutyPolicyUserOverride";
import Project from "../../../Models/DatabaseModels/Project";
import User from "../../../Models/DatabaseModels/User";
import CalendarEvent from "../../../Types/Calendar/CalendarEvent";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { FEED_SIMULATION_ITERATION_CAP } from "../../../Types/OnCallDutyPolicy/CalendarFeedWindow";
import { LayerProps } from "../../../Types/OnCallDutyPolicy/Layer";
import MaterializedShiftUtil, {
  MaterializedShift,
  MaterializedShiftOverride,
  MaterializedShiftPolicy,
} from "../../../Types/OnCallDutyPolicy/MaterializedShift";
import OnCallCalendarFeedUtil from "../../../Types/OnCallDutyPolicy/OnCallCalendarFeedUtil";
import ScheduleShiftUtil, {
  OnCallShift,
} from "../../../Types/OnCallDutyPolicy/ScheduleShiftUtil";
import ShiftSeamUtil from "../../../Types/OnCallDutyPolicy/ShiftSeamUtil";
import { UserOverrideRecord } from "../../../Types/OnCallDutyPolicy/UserOverrideUtil";

/*
 * Turns the resolver's raw coverage segments into MaterializedShifts — the
 * one shape the calendar feeds, /my-shifts and the shift reminders consume.
 *
 * Per schedule, in this order:
 *   1. ScheduleShiftUtil.groupEventsIntoShifts with mergeAcrossGaps = false
 *      and a group key of user + override identity + layer, so a restricted
 *      layer yields one shift per active block, an override split yields
 *      A / B / A as three shifts, and a layer handover is a boundary.
 *   2. ShiftSeamUtil.normalizeSeams: the engine's one-second seams become
 *      touching, minute-aligned boundaries. Every identity below (shiftKey,
 *      the calendar UID, the reminder idempotency key) is derived AFTER this
 *      step, which is what makes it stable across windows and edits.
 *   3. Policy-variant diffing: for a schedule attached to several policies
 *      with a policy-scoped override, the per-policy resolution is compared
 *      with the base one and every interval where a DIFFERENT person is
 *      paged becomes an extra shift tagged policyVariantOf.
 *   4. One user lookup for display names and timezones, one project lookup
 *      for project names.
 *
 * The public entry points differ only in how they choose schedules:
 *   - materializeForSchedule(s): everything on those schedules (shared feeds,
 *     the schedule-level cache, the reminder sweep);
 *   - materializeForUser: the schedules the user is rostered on, plus (when
 *     includeCoveringShifts) the schedules of people the user substitutes
 *     for, filtered down to the user's own shifts;
 *   - materializeForProject: every schedule in the project.
 * Standing escalation targets (direct users, teams) have no start and end
 * and are deliberately never emitted.
 */

export interface MaterializedUserInfo {
  userId: string;
  userName: string;
  email?: string;
  timezone?: string;
}

export interface MaterializedScheduleInfo {
  scheduleId: string;
  scheduleName: string;
  projectId: string;
  projectName?: string;
  scheduleTimezone?: string;
  shiftConfigVersion: number;
  lastModifiedAt: Date;
  truncated: boolean;
  attachedPolicies: Array<MaterializedShiftPolicy>;
  // The engine input, for the coverage envelope (OnCallCalendarFeedUtil).
  layerProps: Array<LayerProps>;
  scheduleUserIds: Array<string>;
}

export interface MaterializeResult {
  shifts: Array<MaterializedShift>;
  // True when any schedule's expansion hit the iteration cap.
  truncated: boolean;
  schedules: Array<MaterializedScheduleInfo>;
  users: Array<MaterializedUserInfo>;
  generatedAt: Date;
}

interface MaterializeWindowOptions {
  windowStart: Date;
  windowEnd: Date;
  // "now" for isPast; defaults to the clock.
  now?: Date | undefined;
  // Defaults to FEED_SIMULATION_ITERATION_CAP.
  maxSimulationIterations?: number | undefined;
}

export interface MaterializeForScheduleOptions
  extends MaterializeWindowOptions {
  scheduleId: ObjectID;
}

export interface MaterializeForSchedulesOptions
  extends MaterializeWindowOptions {
  scheduleIds: Array<ObjectID>;
}

export interface MaterializeForUserOptions extends MaterializeWindowOptions {
  userId: ObjectID;
  // Restrict to these projects; every project the user is rostered in otherwise.
  projectIds?: Array<ObjectID> | undefined;
  // Restrict to one schedule (the `?schedule=` feed filter).
  scheduleId?: ObjectID | undefined;
  // Include shifts the user covers as a substitute on other people's schedules.
  includeCoveringShifts: boolean;
}

export interface MaterializeForProjectOptions extends MaterializeWindowOptions {
  projectId: ObjectID;
}

export interface MaterializeResolvedOptions {
  now: Date;
  users: Map<string, MaterializedUserInfo>;
  projectName?: string | undefined;
}

export default class OnCallShiftMaterializer {
  // -- Entry points -----------------------------------------------------

  @CaptureSpan()
  public static async materializeForSchedule(
    options: MaterializeForScheduleOptions,
  ): Promise<MaterializeResult> {
    return await OnCallShiftMaterializer.materializeForSchedules({
      scheduleIds: [options.scheduleId],
      windowStart: options.windowStart,
      windowEnd: options.windowEnd,
      now: options.now,
      maxSimulationIterations: options.maxSimulationIterations,
    });
  }

  @CaptureSpan()
  public static async materializeForSchedules(
    options: MaterializeForSchedulesOptions,
  ): Promise<MaterializeResult> {
    OnCallShiftMaterializer.validateWindow(
      options.windowStart,
      options.windowEnd,
    );

    const now: Date = options.now || OneUptimeDate.getCurrentDate();
    const scheduleIds: Array<ObjectID> = OnCallShiftMaterializer.dedupeIds(
      options.scheduleIds,
    );

    if (scheduleIds.length === 0) {
      return OnCallShiftMaterializer.emptyResult(now);
    }

    const resolved: Array<ResolvedShiftSegments> =
      await OnCallDutyPolicyScheduleService.getResolvedShiftSegmentsForSchedules(
        {
          scheduleIds,
          windowStart: options.windowStart,
          windowEnd: options.windowEnd,
          maxSimulationIterations:
            options.maxSimulationIterations ?? FEED_SIMULATION_ITERATION_CAP,
        },
      );

    if (resolved.length === 0) {
      return OnCallShiftMaterializer.emptyResult(now);
    }

    const users: Map<string, MaterializedUserInfo> =
      await OnCallShiftMaterializer.loadUsers(
        OnCallShiftMaterializer.collectUserIds(resolved),
      );

    const projectNames: Map<string, string> =
      await OnCallShiftMaterializer.loadProjectNames(
        resolved.map((item: ResolvedShiftSegments) => {
          return item.schedule.projectId;
        }),
      );

    const shifts: Array<MaterializedShift> = [];
    const schedules: Array<MaterializedScheduleInfo> = [];
    let truncated: boolean = false;

    for (const item of resolved) {
      const projectName: string | undefined = projectNames.get(
        item.schedule.projectId,
      );

      shifts.push(
        ...OnCallShiftMaterializer.materializeResolved(item, {
          now,
          users,
          projectName,
        }),
      );

      const info: MaterializedScheduleInfo = {
        scheduleId: item.schedule.id,
        scheduleName: item.schedule.name,
        projectId: item.schedule.projectId,
        shiftConfigVersion: item.schedule.shiftConfigVersion,
        lastModifiedAt: item.lastModifiedAt,
        truncated: item.truncated,
        attachedPolicies: item.attachedPolicies,
        layerProps: item.layerProps,
        scheduleUserIds: item.scheduleUserIds,
      };

      if (projectName !== undefined) {
        info.projectName = projectName;
      }

      if (item.schedule.timezone !== undefined) {
        info.scheduleTimezone = item.schedule.timezone;
      }

      schedules.push(info);
      truncated = truncated || item.truncated;
    }

    return {
      shifts: MaterializedShiftUtil.sortByStart(shifts),
      truncated,
      schedules,
      users: Array.from(users.values()),
      generatedAt: now,
    };
  }

  @CaptureSpan()
  public static async materializeForUser(
    options: MaterializeForUserOptions,
  ): Promise<MaterializeResult> {
    OnCallShiftMaterializer.validateWindow(
      options.windowStart,
      options.windowEnd,
    );

    const now: Date = options.now || OneUptimeDate.getCurrentDate();

    const candidateScheduleIds: Array<ObjectID> =
      await OnCallShiftMaterializer.getCandidateScheduleIdsForUser({
        userId: options.userId,
        projectIds: options.projectIds,
        scheduleId: options.scheduleId,
        windowStart: options.windowStart,
        windowEnd: options.windowEnd,
        includeCoveringShifts: options.includeCoveringShifts,
      });

    if (candidateScheduleIds.length === 0) {
      return OnCallShiftMaterializer.emptyResult(now);
    }

    const result: MaterializeResult =
      await OnCallShiftMaterializer.materializeForSchedules({
        scheduleIds: candidateScheduleIds,
        windowStart: options.windowStart,
        windowEnd: options.windowEnd,
        now,
        maxSimulationIterations: options.maxSimulationIterations,
      });

    return {
      ...result,
      shifts: OnCallShiftMaterializer.filterShiftsForUser(
        result.shifts,
        options.userId,
      ),
    };
  }

  @CaptureSpan()
  public static async materializeForProject(
    options: MaterializeForProjectOptions,
  ): Promise<MaterializeResult> {
    OnCallShiftMaterializer.validateWindow(
      options.windowStart,
      options.windowEnd,
    );

    const now: Date = options.now || OneUptimeDate.getCurrentDate();

    const schedules: Array<OnCallDutyPolicySchedule> =
      await OnCallDutyPolicyScheduleService.findBy({
        query: {
          projectId: options.projectId,
        },
        select: {
          _id: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    const scheduleIds: Array<ObjectID> = schedules
      .map((schedule: OnCallDutyPolicySchedule) => {
        return schedule.id;
      })
      .filter((id: ObjectID | null | undefined): id is ObjectID => {
        return Boolean(id);
      });

    if (scheduleIds.length === 0) {
      return OnCallShiftMaterializer.emptyResult(now);
    }

    return await OnCallShiftMaterializer.materializeForSchedules({
      scheduleIds,
      windowStart: options.windowStart,
      windowEnd: options.windowEnd,
      now,
      maxSimulationIterations: options.maxSimulationIterations,
    });
  }

  // -- Candidate schedules ----------------------------------------------

  /**
   * The schedules whose materialization can contain the user's shifts:
   * distinct schedule ids from the user's layer-user rows (optionally within
   * `projectIds`), plus — when includeCoveringShifts — the schedules of every
   * user the caller substitutes for through an override overlapping the
   * window. Optionally narrowed to one schedule. Root reads: the caller has
   * already decided the user may see these.
   */
  @CaptureSpan()
  public static async getCandidateScheduleIdsForUser(data: {
    userId: ObjectID;
    projectIds?: Array<ObjectID> | undefined;
    scheduleId?: ObjectID | undefined;
    windowStart: Date;
    windowEnd: Date;
    includeCoveringShifts: boolean;
  }): Promise<Array<ObjectID>> {
    const projectFilter: Array<ObjectID> | undefined =
      data.projectIds && data.projectIds.length > 0
        ? OnCallShiftMaterializer.dedupeIds(data.projectIds)
        : undefined;

    const ownRows: Array<OnCallDutyPolicyScheduleLayerUser> =
      await OnCallDutyPolicyScheduleLayerUserService.findBy({
        query: projectFilter
          ? {
              userId: data.userId,
              projectId: QueryHelper.any(projectFilter),
            }
          : {
              userId: data.userId,
            },
        select: {
          onCallDutyPolicyScheduleId: true,
          projectId: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    const candidates: Array<ObjectID> = ownRows
      .map((row: OnCallDutyPolicyScheduleLayerUser) => {
        return row.onCallDutyPolicyScheduleId;
      })
      .filter((id: ObjectID | undefined): id is ObjectID => {
        return Boolean(id);
      });

    if (data.includeCoveringShifts) {
      const coveringOverrides: Array<OnCallDutyPolicyUserOverride> =
        await OnCallDutyPolicyUserOverrideService.findBy({
          query: projectFilter
            ? {
                routeAlertsToUserId: data.userId,
                projectId: QueryHelper.any(projectFilter),
                startsAt: QueryHelper.lessThanEqualTo(data.windowEnd),
                endsAt: QueryHelper.greaterThanEqualTo(data.windowStart),
              }
            : {
                routeAlertsToUserId: data.userId,
                startsAt: QueryHelper.lessThanEqualTo(data.windowEnd),
                endsAt: QueryHelper.greaterThanEqualTo(data.windowStart),
              },
          select: {
            projectId: true,
            overrideUserId: true,
            startsAt: true,
            endsAt: true,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          props: {
            isRoot: true,
          },
        });

      // (project, overridden user) pairs the caller substitutes for.
      const pairs: Set<string> = new Set<string>();
      const overriddenUserIds: Array<ObjectID> = [];
      const overrideProjectIds: Array<ObjectID> = [];

      for (const override of coveringOverrides) {
        const overriddenUserId: ObjectID | undefined = override.overrideUserId;
        const projectId: ObjectID | undefined = override.projectId;

        if (!overriddenUserId || !projectId) {
          continue;
        }

        if (
          override.startsAt &&
          override.endsAt &&
          (OneUptimeDate.isAfter(override.startsAt, data.windowEnd) ||
            OneUptimeDate.isBefore(override.endsAt, data.windowStart))
        ) {
          continue;
        }

        pairs.add(`${projectId.toString()}:${overriddenUserId.toString()}`);
        overriddenUserIds.push(overriddenUserId);
        overrideProjectIds.push(projectId);
      }

      if (pairs.size > 0) {
        const coveredRows: Array<OnCallDutyPolicyScheduleLayerUser> =
          await OnCallDutyPolicyScheduleLayerUserService.findBy({
            query: {
              userId: QueryHelper.any(
                OnCallShiftMaterializer.dedupeIds(overriddenUserIds),
              ),
              projectId: QueryHelper.any(
                OnCallShiftMaterializer.dedupeIds(overrideProjectIds),
              ),
            },
            select: {
              onCallDutyPolicyScheduleId: true,
              projectId: true,
              userId: true,
            },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            props: {
              isRoot: true,
            },
          });

        for (const row of coveredRows) {
          const key: string = `${row.projectId?.toString() || ""}:${
            row.userId?.toString() || ""
          }`;
          if (pairs.has(key) && row.onCallDutyPolicyScheduleId) {
            candidates.push(row.onCallDutyPolicyScheduleId);
          }
        }
      }
    }

    let deduped: Array<ObjectID> =
      OnCallShiftMaterializer.dedupeIds(candidates);

    if (data.scheduleId) {
      const wanted: string = data.scheduleId.toString();
      deduped = deduped.filter((id: ObjectID) => {
        return id.toString() === wanted;
      });
    }

    return deduped;
  }

  // -- Pure materialization ---------------------------------------------

  /**
   * Materialize ONE resolved schedule: base shifts plus policy-variant
   * shifts. Pure — every lookup has already happened.
   */
  public static materializeResolved(
    resolved: ResolvedShiftSegments,
    options: MaterializeResolvedOptions,
  ): Array<MaterializedShift> {
    const baseShifts: Array<OnCallShift> = OnCallShiftMaterializer.toShifts(
      resolved.segments,
    );

    const shifts: Array<MaterializedShift> = baseShifts.map(
      (shift: OnCallShift) => {
        return OnCallShiftMaterializer.toMaterializedShift({
          shift,
          resolved,
          options,
          policyVariant: null,
        });
      },
    );

    for (const variant of resolved.policyVariants) {
      const variantShifts: Array<OnCallShift> =
        OnCallShiftMaterializer.toShifts(variant.segments);

      const differing: Array<{ shift: OnCallShift; globalUserId: string }> =
        OnCallShiftMaterializer.diffPolicyVariant(baseShifts, variantShifts);

      for (const entry of differing) {
        shifts.push(
          OnCallShiftMaterializer.toMaterializedShift({
            shift: entry.shift,
            resolved,
            options,
            policyVariant: {
              policyId: variant.policyId,
              policyName: variant.policyName,
              globalUserId: entry.globalUserId,
            },
          }),
        );
      }
    }

    return MaterializedShiftUtil.sortByStart(shifts);
  }

  /*
   * Group + seam-normalise raw segments into shifts. Exposed so tests and
   * the coverage-gap logic can reproduce exactly what the feed sees.
   */
  public static toShifts(segments: Array<CalendarEvent>): Array<OnCallShift> {
    const grouped: Array<OnCallShift> = ScheduleShiftUtil.groupEventsIntoShifts(
      segments,
      {
        mergeAcrossGaps: false,
        groupKey: ScheduleShiftUtil.groupKeyByUserOverrideAndLayer,
      },
    );

    /*
     * Seam normalisation widens a shift by the engine's one-second seams;
     * with mergeAcrossGaps = false every shift is one contiguous block, so
     * its honest active time is exactly its span. Recompute rather than
     * carry the pre-normalisation sum, which would read 28799 for an 8-hour
     * block.
     */
    return ShiftSeamUtil.normalizeSeams(grouped)
      .filter((shift: OnCallShift) => {
        return shift.end.getTime() > shift.start.getTime();
      })
      .map((shift: OnCallShift) => {
        return {
          ...shift,
          coverageSeconds: Math.round(
            (shift.end.getTime() - shift.start.getTime()) / 1000,
          ),
        };
      });
  }

  /*
   * The variant shifts during which a DIFFERENT person is paged than in the
   * base resolution. A variant shift whose whole span is covered by base
   * shifts of the same user is identical for the subscriber and dropped; one
   * that overlaps a base shift of another user (or no base shift at all) is
   * kept, together with who the base resolution pages at its start.
   */
  public static diffPolicyVariant(
    baseShifts: Array<OnCallShift>,
    variantShifts: Array<OnCallShift>,
  ): Array<{ shift: OnCallShift; globalUserId: string }> {
    const result: Array<{ shift: OnCallShift; globalUserId: string }> = [];

    for (const variant of variantShifts) {
      const overlapping: Array<OnCallShift> = baseShifts.filter(
        (base: OnCallShift) => {
          return (
            base.start.getTime() < variant.end.getTime() &&
            base.end.getTime() > variant.start.getTime()
          );
        },
      );

      const differingBase: OnCallShift | undefined = overlapping.find(
        (base: OnCallShift) => {
          return base.userId !== variant.userId;
        },
      );

      if (overlapping.length > 0 && !differingBase) {
        continue; // same person throughout: nothing policy-specific here.
      }

      const globalUserId: string =
        differingBase?.userId ||
        variant.override?.originalUserId ||
        variant.userId;

      result.push({ shift: variant, globalUserId });
    }

    return result;
  }

  /** Keep only the shifts where `userId` is the person on call. */
  public static filterShiftsForUser(
    shifts: Array<MaterializedShift>,
    userId: ObjectID | string,
  ): Array<MaterializedShift> {
    const wanted: string = userId.toString();
    return shifts.filter((shift: MaterializedShift) => {
      return shift.userId === wanted;
    });
  }

  /*
   * sha256 over every field that changes what a subscriber sees for this
   * shift, excluding the identity (shiftKey), the version and the
   * modification stamp, so two renders of an unchanged shift hash the same
   * and any content change — the person, the end, the layer, the policies,
   * the override provenance — changes the hash.
   */
  public static computeContentHash(
    shift: Omit<
      MaterializedShift,
      "contentHash" | "shiftKey" | "lastModifiedAt" | "shiftConfigVersion"
    >,
  ): string {
    const payload: Record<string, unknown> = {
      scheduleId: shift.scheduleId,
      scheduleName: shift.scheduleName,
      scheduleTimezone: shift.scheduleTimezone ?? null,
      projectName: shift.projectName ?? null,
      userId: shift.userId,
      userName: shift.userName,
      start: shift.start.toISOString(),
      end: shift.end.toISOString(),
      coverageSeconds: shift.coverageSeconds,
      layerId: shift.layerId ?? null,
      layerName: shift.layerName ?? null,
      override: shift.override
        ? {
            originalUserId: shift.override.originalUserId,
            originalUserName: shift.override.originalUserName,
            overrideStartsAt: shift.override.overrideStartsAt.toISOString(),
            overrideEndsAt: shift.override.overrideEndsAt.toISOString(),
            onCallDutyPolicyId: shift.override.onCallDutyPolicyId ?? null,
          }
        : null,
      policyVariantOf: shift.policyVariantOf
        ? {
            policyId: shift.policyVariantOf.policyId,
            policyName: shift.policyVariantOf.policyName,
            globalUserId: shift.policyVariantOf.globalUserId,
          }
        : null,
      policies: shift.policies.map((policy: MaterializedShiftPolicy) => {
        return {
          policyId: policy.policyId,
          policyName: policy.policyName,
          ruleId: policy.ruleId,
          ruleName: policy.ruleName,
          ruleOrder: policy.ruleOrder,
        };
      }),
    };

    return crypto
      .createHash("sha256")
      .update(JSON.stringify(payload), "utf8")
      .digest("hex");
  }

  // -- Internals ---------------------------------------------------------

  private static toMaterializedShift(data: {
    shift: OnCallShift;
    resolved: ResolvedShiftSegments;
    options: MaterializeResolvedOptions;
    policyVariant: {
      policyId: string;
      policyName: string;
      globalUserId: string;
    } | null;
  }): MaterializedShift {
    const { shift, resolved, options } = data;

    const base: Omit<
      MaterializedShift,
      "contentHash" | "shiftKey" | "lastModifiedAt" | "shiftConfigVersion"
    > = {
      projectId: resolved.schedule.projectId,
      scheduleId: resolved.schedule.id,
      scheduleName: resolved.schedule.name,
      userId: shift.userId,
      userName: OnCallShiftMaterializer.displayName(
        options.users,
        shift.userId,
      ),
      start: shift.start,
      end: shift.end,
      coverageSeconds: shift.coverageSeconds,
      policies: resolved.attachedPolicies.map(
        (policy: MaterializedShiftPolicy) => {
          return { ...policy };
        },
      ),
      isPast: shift.start.getTime() < options.now.getTime(),
    };

    if (options.projectName !== undefined) {
      base.projectName = options.projectName;
    }

    if (resolved.schedule.timezone !== undefined) {
      base.scheduleTimezone = resolved.schedule.timezone;
    }

    if (shift.layerId !== undefined) {
      base.layerId = shift.layerId;
    }

    if (shift.layerName !== undefined) {
      base.layerName = shift.layerName;
    }

    if (shift.override) {
      const override: MaterializedShiftOverride = {
        originalUserId: shift.override.originalUserId,
        originalUserName: OnCallShiftMaterializer.displayName(
          options.users,
          shift.override.originalUserId,
        ),
        overrideStartsAt: new Date(shift.override.overrideStartsAt.getTime()),
        overrideEndsAt: new Date(shift.override.overrideEndsAt.getTime()),
      };

      const policyId: string | null =
        OnCallShiftMaterializer.findOverridePolicyId(resolved.overrides, {
          originalUserId: shift.override.originalUserId,
          substituteUserId: shift.userId,
          startsAt: shift.override.overrideStartsAt,
          endsAt: shift.override.overrideEndsAt,
          preferredPolicyId: data.policyVariant?.policyId,
        });

      if (policyId) {
        override.onCallDutyPolicyId = policyId;
      }

      base.override = override;
    }

    if (data.policyVariant) {
      base.policyVariantOf = {
        policyId: data.policyVariant.policyId,
        policyName: data.policyVariant.policyName,
        globalUserId: data.policyVariant.globalUserId,
      };
    }

    return {
      ...base,
      shiftKey: MaterializedShiftUtil.buildShiftKey({
        scheduleId: resolved.schedule.id,
        start: shift.start,
        policyId: data.policyVariant?.policyId,
      }),
      contentHash: OnCallShiftMaterializer.computeContentHash(base),
      lastModifiedAt: resolved.lastModifiedAt,
      shiftConfigVersion: resolved.schedule.shiftConfigVersion,
    };
  }

  /*
   * Map a segment's override meta back to the override record that produced
   * it, to learn its policy scope. Prefers a record scoped to
   * `preferredPolicyId` (the variant being materialized); falls back to any
   * record with the same users and window.
   */
  private static findOverridePolicyId(
    overrides: Array<UserOverrideRecord>,
    data: {
      originalUserId: string;
      substituteUserId: string;
      startsAt: Date;
      endsAt: Date;
      preferredPolicyId?: string | undefined;
    },
  ): string | null {
    const matches: Array<UserOverrideRecord> = overrides.filter(
      (record: UserOverrideRecord) => {
        return (
          record.overrideUserId === data.originalUserId &&
          record.routeAlertsToUserId === data.substituteUserId &&
          record.startsAt.getTime() === data.startsAt.getTime() &&
          record.endsAt.getTime() === data.endsAt.getTime()
        );
      },
    );

    if (matches.length === 0) {
      return null;
    }

    if (data.preferredPolicyId) {
      const preferred: UserOverrideRecord | undefined = matches.find(
        (record: UserOverrideRecord) => {
          return record.onCallDutyPolicyId === data.preferredPolicyId;
        },
      );
      if (preferred) {
        return preferred.onCallDutyPolicyId || null;
      }
    }

    // A global match wins over a scoped one for the base resolution.
    const global: UserOverrideRecord | undefined = matches.find(
      (record: UserOverrideRecord) => {
        return !record.onCallDutyPolicyId;
      },
    );

    if (global) {
      return null;
    }

    return matches[0]!.onCallDutyPolicyId || null;
  }

  private static displayName(
    users: Map<string, MaterializedUserInfo>,
    userId: string,
  ): string {
    return (
      users.get(userId)?.userName || OnCallCalendarFeedUtil.FALLBACK_USER_NAME
    );
  }

  private static collectUserIds(
    resolved: Array<ResolvedShiftSegments>,
  ): Array<string> {
    const ids: Set<string> = new Set<string>();

    for (const item of resolved) {
      for (const segment of item.segments) {
        if (segment.title) {
          ids.add(segment.title);
        }
      }
      for (const variant of item.policyVariants) {
        for (const segment of variant.segments) {
          if (segment.title) {
            ids.add(segment.title);
          }
        }
      }
      for (const override of item.overrides) {
        if (override.overrideUserId) {
          ids.add(override.overrideUserId);
        }
        if (override.routeAlertsToUserId) {
          ids.add(override.routeAlertsToUserId);
        }
      }
      for (const userId of item.scheduleUserIds) {
        ids.add(userId);
      }
    }

    return Array.from(ids);
  }

  /*
   * One root user lookup for names and timezones. Name falls back to email;
   * the feed mapper masks emails where they must not appear (shared feeds).
   */
  private static async loadUsers(
    userIds: Array<string>,
  ): Promise<Map<string, MaterializedUserInfo>> {
    const users: Map<string, MaterializedUserInfo> = new Map<
      string,
      MaterializedUserInfo
    >();

    if (userIds.length === 0) {
      return users;
    }

    const rows: Array<User> = await UserService.findBy({
      query: {
        _id: QueryHelper.any(userIds),
      },
      select: {
        _id: true,
        name: true,
        email: true,
        timezone: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    for (const row of rows) {
      const userId: string | undefined = row.id?.toString();
      if (!userId) {
        continue;
      }

      const name: string = row.name?.toString().trim() || "";
      const email: string = row.email?.toString().trim() || "";
      const timezone: string = row.timezone?.toString() || "";

      const info: MaterializedUserInfo = {
        userId,
        userName: name || email || OnCallCalendarFeedUtil.FALLBACK_USER_NAME,
      };

      if (email) {
        info.email = email;
      }

      if (timezone) {
        info.timezone = timezone;
      }

      users.set(userId, info);
    }

    return users;
  }

  private static async loadProjectNames(
    projectIds: Array<string>,
  ): Promise<Map<string, string>> {
    const names: Map<string, string> = new Map<string, string>();
    const distinct: Array<string> = Array.from(
      new Set<string>(
        projectIds.filter((id: string) => {
          return Boolean(id);
        }),
      ),
    );

    if (distinct.length === 0) {
      return names;
    }

    const projects: Array<Project> = await ProjectService.findBy({
      query: {
        _id: QueryHelper.any(distinct),
      },
      select: {
        _id: true,
        name: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    for (const project of projects) {
      const id: string | undefined = project.id?.toString();
      if (id && project.name) {
        names.set(id, project.name);
      }
    }

    return names;
  }

  private static validateWindow(windowStart: Date, windowEnd: Date): void {
    if (
      !(windowStart instanceof Date) ||
      !(windowEnd instanceof Date) ||
      Number.isNaN(windowStart.getTime()) ||
      Number.isNaN(windowEnd.getTime())
    ) {
      throw new BadDataException("windowStart and windowEnd must be dates");
    }

    if (windowStart.getTime() >= windowEnd.getTime()) {
      throw new BadDataException("windowStart must be before windowEnd");
    }
  }

  private static emptyResult(now: Date): MaterializeResult {
    return {
      shifts: [],
      truncated: false,
      schedules: [],
      users: [],
      generatedAt: now,
    };
  }

  private static dedupeIds(ids: Array<ObjectID>): Array<ObjectID> {
    const seen: Set<string> = new Set<string>();
    const result: Array<ObjectID> = [];
    for (const id of ids) {
      if (!id) {
        continue;
      }
      const key: string = id.toString();
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      result.push(id);
    }
    return result;
  }
}
