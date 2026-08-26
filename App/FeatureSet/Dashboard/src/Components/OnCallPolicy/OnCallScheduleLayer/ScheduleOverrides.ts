import Dictionary from "Common/Types/Dictionary";
import ObjectID from "Common/Types/ObjectID";
import EqualToOrNull from "Common/Types/BaseDatabase/EqualToOrNull";
import GreaterThanOrEqual from "Common/Types/BaseDatabase/GreaterThanOrEqual";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import LessThanOrEqual from "Common/Types/BaseDatabase/LessThanOrEqual";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { UserOverrideRecord } from "Common/Types/OnCallDutyPolicy/UserOverrideUtil";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import OnCallDutyPolicyEscalationRuleSchedule from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import OnCallDutyPolicyUserOverride from "Common/Models/DatabaseModels/OnCallDutyPolicyUserOverride";
import { useEffect, useMemo, useState } from "react";

/*
 * Shared resolution of "which user overrides does this schedule's UI have to
 * honour, and whose substitution is it".
 *
 * Every on-call surface answers one question — who is covering — and they must
 * all answer it the same way alert routing does. Routing resolves a schedule
 * through OnCallDutyPolicyScheduleService with the escalating policy's id, so it
 * applies GLOBAL overrides plus that policy's POLICY-SCOPED ones. Before this
 * module each dashboard surface improvised: the calendar fetched global
 * overrides only, and the per-layer cards fetched none at all, so the same page
 * could name three different people as "on call now".
 * https://github.com/OneUptime/oneuptime/issues/3411
 */

export interface OverrideUserInfo {
  name: string;
  email: string;
}

export enum PolicyContextState {
  // Still discovering which policies escalate to this schedule.
  Resolving = "Resolving",
  // Exactly one policy escalates here; its scoped overrides apply.
  SinglePolicy = "SinglePolicy",
  // Zero, or more than one — only global overrides can apply.
  PolicyAgnostic = "PolicyAgnostic",
}

export interface ScheduleOverrideResolution {
  /*
   * Ready to hand straight to UserOverrideUtil.applyOverridesToEvents, already
   * narrowed to overrides that target a user who actually appears in this
   * schedule.
   */
  records: Array<UserOverrideRecord>;
  /*
   * The policy whose scoped overrides apply, or "" when policy-agnostic. Pass
   * it as `currentOnCallDutyPolicyId` — applyOverridesToEvents drops every
   * policy-scoped override without it, so fetching them is only half the job.
   */
  policyContextId: string;
  policyContextState: PolicyContextState;
  // Distinct policies escalating to this schedule. For explanatory copy only.
  attachedPolicyCount: number;
  // userId -> display info, for substitutes and the users they are covering.
  userInfoById: Dictionary<OverrideUserInfo>;
}

/*
 * POLICY CONTEXT
 *
 * A schedule is not owned by a policy: any number of policies can escalate to it
 * through their escalation rules. The server resolves this the only way a single
 * stored roster can — if the schedule is attached to EXACTLY ONE policy it
 * resolves in that policy's context
 * (OnCallDutyPolicyScheduleService.getSingleAttachedPolicyId), otherwise it
 * stays policy-agnostic, because one roster row cannot represent divergent
 * per-policy substitutions. The dashboard mirrors that rule exactly, so the
 * calendar can never contradict the roster banner printed above it.
 */
async function resolvePolicyContext(
  scheduleId: string,
): Promise<{ policyContextId: string; attachedPolicyCount: number }> {
  const result: ListResult<OnCallDutyPolicyEscalationRuleSchedule> =
    await ModelAPI.getList<OnCallDutyPolicyEscalationRuleSchedule>({
      modelType: OnCallDutyPolicyEscalationRuleSchedule,
      query: {
        onCallDutyPolicyScheduleId: new ObjectID(scheduleId),
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      select: {
        onCallDutyPolicyId: true,
      },
      sort: {},
    });

  /*
   * A policy can reference the same schedule from several escalation rules (a
   * first-page rule and a re-page rule, say). That is still ONE policy context,
   * so count DISTINCT policies — counting rows would misread an ordinary
   * two-rule policy as ambiguous and silently drop its overrides.
   */
  const distinctPolicyIds: Set<string> = new Set<string>();
  for (const join of result.data) {
    const policyId: string | undefined = join.onCallDutyPolicyId?.toString();
    if (policyId) {
      distinctPolicyIds.add(policyId);
    }
  }

  return {
    policyContextId:
      distinctPolicyIds.size === 1 ? Array.from(distinctPolicyIds)[0]! : "",
    attachedPolicyCount: distinctPolicyIds.size,
  };
}

/*
 * Mirrors OnCallDutyPolicyScheduleService.fetchOverridesForSchedule: overrides
 * overlapping the window, in scope for the policy context, and targeting a user
 * who is actually on this schedule.
 */
async function fetchOverrides(params: {
  projectId: ObjectID;
  policyContextId: string;
  scheduleUserIds: Set<string>;
  windowStart: Date;
  windowEnd: Date;
}): Promise<Array<OnCallDutyPolicyUserOverride>> {
  const result: ListResult<OnCallDutyPolicyUserOverride> =
    await ModelAPI.getList<OnCallDutyPolicyUserOverride>({
      modelType: OnCallDutyPolicyUserOverride,
      query: {
        projectId: params.projectId,
        startsAt: new LessThanOrEqual<Date>(params.windowEnd),
        endsAt: new GreaterThanOrEqual<Date>(params.windowStart),
        /*
         * With a policy context: that policy's overrides PLUS the global ones.
         * Without one: global only. Never another policy's overrides — those
         * apply when that policy escalates, not here.
         */
        onCallDutyPolicyId: params.policyContextId
          ? new EqualToOrNull<string>(params.policyContextId)
          : new IsNull(),
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      select: {
        startsAt: true,
        endsAt: true,
        overrideUserId: true,
        routeAlertsToUserId: true,
        onCallDutyPolicyId: true,
        overrideUser: {
          name: true,
          email: true,
        },
        routeAlertsToUser: {
          name: true,
          email: true,
        },
      },
      sort: {
        startsAt: SortOrder.Ascending,
      },
    });

  return result.data.filter((override: OnCallDutyPolicyUserOverride) => {
    return params.scheduleUserIds.has(
      override.overrideUserId?.toString() || "",
    );
  });
}

/*
 * Nothing resolved, and nothing to resolve: no project, or a schedule with
 * nobody on any layer. There is no policy context to discover, so this is a
 * final answer rather than a pending one.
 */
const NOTHING_TO_RESOLVE: ScheduleOverrideResolution = {
  records: [],
  policyContextId: "",
  policyContextState: PolicyContextState.PolicyAgnostic,
  attachedPolicyCount: 0,
  userInfoById: {},
};

/*
 * The initial state, before the first effect runs. Deliberately Resolving and
 * not PolicyAgnostic: a caller that renders an explanation of which overrides
 * were applied would otherwise print the global-only wording for one frame and
 * then replace it, which reads as the screen changing its mind.
 */
const PENDING_RESOLUTION: ScheduleOverrideResolution = {
  ...NOTHING_TO_RESOLVE,
  policyContextState: PolicyContextState.Resolving,
};

export interface UseScheduleUserOverridesParams {
  /*
   * The schedule being displayed. Without it there is nothing to resolve a
   * policy context against (an unsaved schedule, say) and only global overrides
   * can be claimed to apply.
   */
  onCallDutyPolicyScheduleId?: ObjectID | undefined;
  // Users appearing on the schedule's layers; overrides for anyone else are noise.
  scheduleUserIds: Set<string>;
  windowStart: Date;
  windowEnd: Date;
}

/**
 * Resolve the overrides in force for a schedule over a time window.
 *
 * Returns a policy-agnostic empty resolution while the policy context is still
 * being discovered, so callers never render a global-only answer that a later
 * render contradicts — a roster screen that names one person and then swaps in
 * another a moment later is worse than one that renders a beat late.
 */
export function useScheduleUserOverrides(
  params: UseScheduleUserOverridesParams,
): ScheduleOverrideResolution {
  const [resolution, setResolution] =
    useState<ScheduleOverrideResolution>(PENDING_RESOLUTION);

  const scheduleIdString: string =
    params.onCallDutyPolicyScheduleId?.toString() || "";

  /*
   * Effects key on primitives, not on the Set / Date objects themselves: those
   * are rebuilt on every render by the callers, and a reference dependency
   * would refetch forever.
   */
  const userIdKey: string = useMemo(() => {
    return Array.from(params.scheduleUserIds).sort().join(",");
  }, [params.scheduleUserIds]);

  const windowStartMs: number = params.windowStart.getTime();
  const windowEndMs: number = params.windowEnd.getTime();

  useEffect(() => {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (!projectId || params.scheduleUserIds.size === 0) {
      setResolution(NOTHING_TO_RESOLVE);
      return;
    }

    let isCancelled: boolean = false;

    setResolution((previous: ScheduleOverrideResolution) => {
      return { ...previous, policyContextState: PolicyContextState.Resolving };
    });

    const load: () => Promise<void> = async (): Promise<void> => {
      let policyContextId: string = "";
      let attachedPolicyCount: number = 0;

      if (scheduleIdString) {
        try {
          const context: {
            policyContextId: string;
            attachedPolicyCount: number;
          } = await resolvePolicyContext(scheduleIdString);
          policyContextId = context.policyContextId;
          attachedPolicyCount = context.attachedPolicyCount;
        } catch {
          /*
           * Fail closed to global-only. Showing fewer substitutions than really
           * apply is a smaller lie than inventing one from a policy we could
           * not confirm.
           */
          policyContextId = "";
          attachedPolicyCount = 0;
        }
      }

      if (isCancelled) {
        return;
      }

      let overrides: Array<OnCallDutyPolicyUserOverride> = [];

      try {
        overrides = await fetchOverrides({
          projectId: projectId,
          policyContextId: policyContextId,
          scheduleUserIds: params.scheduleUserIds,
          windowStart: new Date(windowStartMs),
          windowEnd: new Date(windowEndMs),
        });
      } catch {
        overrides = [];
      }

      if (isCancelled) {
        return;
      }

      const userInfoById: Dictionary<OverrideUserInfo> = {};
      for (const override of overrides) {
        const overriddenId: string = override.overrideUserId?.toString() || "";
        const substituteId: string =
          override.routeAlertsToUserId?.toString() || "";

        if (
          overriddenId &&
          override.overrideUser &&
          !userInfoById[overriddenId]
        ) {
          userInfoById[overriddenId] = {
            name: override.overrideUser.name?.toString() || "",
            email: override.overrideUser.email?.toString() || "",
          };
        }

        if (
          substituteId &&
          override.routeAlertsToUser &&
          !userInfoById[substituteId]
        ) {
          userInfoById[substituteId] = {
            name: override.routeAlertsToUser.name?.toString() || "",
            email: override.routeAlertsToUser.email?.toString() || "",
          };
        }
      }

      setResolution({
        records: overrides.map(
          (override: OnCallDutyPolicyUserOverride): UserOverrideRecord => {
            return {
              overrideUserId: override.overrideUserId?.toString() || "",
              routeAlertsToUserId:
                override.routeAlertsToUserId?.toString() || "",
              startsAt: override.startsAt!,
              endsAt: override.endsAt!,
              onCallDutyPolicyId:
                override.onCallDutyPolicyId?.toString() || null,
            };
          },
        ),
        policyContextId,
        policyContextState: policyContextId
          ? PolicyContextState.SinglePolicy
          : PolicyContextState.PolicyAgnostic,
        attachedPolicyCount,
        userInfoById,
      });
    };

    load();

    return () => {
      isCancelled = true;
    };
    /*
     * params.scheduleUserIds is read in the body but absent here on purpose:
     * userIdKey is its stable, order-independent projection, and depending on
     * the Set itself would refetch on every render.
     */
  }, [scheduleIdString, userIdKey, windowStartMs, windowEndMs]);

  return resolution;
}
