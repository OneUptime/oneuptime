import OneUptimeDate from "../Date";

/*
 * A fully resolved on-call shift: one person, one schedule, one contiguous
 * block of time, with everything a calendar entry or a reminder needs already
 * looked up (names, policies, override provenance). Produced by the server's
 * OnCallShiftMaterializer from LayerUtil -> overrides -> groupEventsIntoShifts
 * -> seam normalisation, cached per schedule, and consumed by the calendar
 * feed mapper (OnCallCalendarFeedUtil), the /my-shifts API and the shift
 * reminder runner.
 *
 * Identity is (schedule, seam-normalised start) — NOT the user — so an
 * override that swaps who is on call updates the same calendar event in place
 * instead of deleting one and creating another. Policy-variant shifts (an
 * extra shift that exists only for one escalation policy because of a
 * policy-scoped override) add the policy id to that identity.
 */

export interface MaterializedShiftOverride {
  originalUserId: string;
  originalUserName: string;
  overrideStartsAt: Date;
  overrideEndsAt: Date;
  // Absent for a global override; set when the override is policy-scoped.
  onCallDutyPolicyId?: string;
}

export interface MaterializedShiftPolicyVariant {
  policyId: string;
  policyName: string;
  // Who the GLOBAL resolution puts on call for the same interval.
  globalUserId: string;
}

export interface MaterializedShiftPolicy {
  policyId: string;
  policyName: string;
  ruleId: string;
  ruleName: string;
  ruleOrder: number;
}

export interface MaterializedShift {
  // `${scheduleId}:${normalizedStartEpochSeconds}` (+ `:${policyId}` for policy variants).
  shiftKey: string;
  // sha256 of {end, userId, summary, description, transparency, policies, override, layer}.
  contentHash: string;
  projectId: string;
  projectName?: string;
  scheduleId: string;
  scheduleName: string;
  // IANA zone the schedule is authored in; absent for legacy schedules.
  scheduleTimezone?: string;
  userId: string;
  userName: string;
  // Seam-normalised (see ShiftSeamUtil); DTEND-style exclusive end.
  start: Date;
  end: Date;
  coverageSeconds: number;
  layerId?: string;
  layerName?: string;
  override?: MaterializedShiftOverride;
  // Set only on the extra, policy-specific shifts.
  policyVariantOf?: MaterializedShiftPolicyVariant;
  policies: Array<MaterializedShiftPolicy>;
  // start < now at materialisation time: "reflects current configuration".
  isPast: boolean;
  lastModifiedAt: Date;
  shiftConfigVersion: number;
}

/*
 * Wire shape (dates as ISO strings, optional strings as null) used by the
 * /my-shifts endpoint and the schedule-level cache.
 */
export interface MaterializedShiftOverrideJson {
  originalUserId: string;
  originalUserName: string;
  overrideStartsAt: string;
  overrideEndsAt: string;
  onCallDutyPolicyId?: string;
}

export interface MaterializedShiftJson {
  shiftKey: string;
  contentHash: string;
  projectId: string;
  projectName?: string;
  scheduleId: string;
  scheduleName: string;
  scheduleTimezone: string | null;
  userId: string;
  userName: string;
  start: string;
  end: string;
  coverageSeconds: number;
  layerId?: string;
  layerName?: string;
  override?: MaterializedShiftOverrideJson;
  policyVariantOf?: MaterializedShiftPolicyVariant;
  policies: Array<MaterializedShiftPolicy>;
  isPast: boolean;
  lastModifiedAt: string;
  shiftConfigVersion: number;
}

export default class MaterializedShiftUtil {
  public static toJSON(shift: MaterializedShift): MaterializedShiftJson {
    const json: MaterializedShiftJson = {
      shiftKey: shift.shiftKey,
      contentHash: shift.contentHash,
      projectId: shift.projectId,
      scheduleId: shift.scheduleId,
      scheduleName: shift.scheduleName,
      scheduleTimezone: shift.scheduleTimezone ?? null,
      userId: shift.userId,
      userName: shift.userName,
      start: shift.start.toISOString(),
      end: shift.end.toISOString(),
      coverageSeconds: shift.coverageSeconds,
      policies: shift.policies.map((policy: MaterializedShiftPolicy) => {
        return { ...policy };
      }),
      isPast: shift.isPast,
      lastModifiedAt: shift.lastModifiedAt.toISOString(),
      shiftConfigVersion: shift.shiftConfigVersion,
    };

    if (shift.projectName !== undefined) {
      json.projectName = shift.projectName;
    }

    if (shift.layerId !== undefined) {
      json.layerId = shift.layerId;
    }

    if (shift.layerName !== undefined) {
      json.layerName = shift.layerName;
    }

    if (shift.override) {
      const override: MaterializedShiftOverrideJson = {
        originalUserId: shift.override.originalUserId,
        originalUserName: shift.override.originalUserName,
        overrideStartsAt: shift.override.overrideStartsAt.toISOString(),
        overrideEndsAt: shift.override.overrideEndsAt.toISOString(),
      };

      if (shift.override.onCallDutyPolicyId !== undefined) {
        override.onCallDutyPolicyId = shift.override.onCallDutyPolicyId;
      }

      json.override = override;
    }

    if (shift.policyVariantOf) {
      json.policyVariantOf = { ...shift.policyVariantOf };
    }

    return json;
  }

  public static fromJSON(json: MaterializedShiftJson): MaterializedShift {
    const shift: MaterializedShift = {
      shiftKey: json.shiftKey,
      contentHash: json.contentHash,
      projectId: json.projectId,
      scheduleId: json.scheduleId,
      scheduleName: json.scheduleName,
      userId: json.userId,
      userName: json.userName,
      start: OneUptimeDate.fromString(json.start),
      end: OneUptimeDate.fromString(json.end),
      coverageSeconds: json.coverageSeconds,
      policies: (json.policies || []).map((policy: MaterializedShiftPolicy) => {
        return { ...policy };
      }),
      isPast: Boolean(json.isPast),
      lastModifiedAt: OneUptimeDate.fromString(json.lastModifiedAt),
      shiftConfigVersion: json.shiftConfigVersion,
    };

    if (json.projectName !== undefined) {
      shift.projectName = json.projectName;
    }

    if (json.scheduleTimezone !== null && json.scheduleTimezone !== undefined) {
      shift.scheduleTimezone = json.scheduleTimezone;
    }

    if (json.layerId !== undefined) {
      shift.layerId = json.layerId;
    }

    if (json.layerName !== undefined) {
      shift.layerName = json.layerName;
    }

    if (json.override) {
      const override: MaterializedShiftOverride = {
        originalUserId: json.override.originalUserId,
        originalUserName: json.override.originalUserName,
        overrideStartsAt: OneUptimeDate.fromString(
          json.override.overrideStartsAt,
        ),
        overrideEndsAt: OneUptimeDate.fromString(json.override.overrideEndsAt),
      };

      if (json.override.onCallDutyPolicyId !== undefined) {
        override.onCallDutyPolicyId = json.override.onCallDutyPolicyId;
      }

      shift.override = override;
    }

    if (json.policyVariantOf) {
      shift.policyVariantOf = { ...json.policyVariantOf };
    }

    return shift;
  }

  public static toJSONArray(
    shifts: Array<MaterializedShift>,
  ): Array<MaterializedShiftJson> {
    return shifts.map((shift: MaterializedShift) => {
      return MaterializedShiftUtil.toJSON(shift);
    });
  }

  public static fromJSONArray(
    json: Array<MaterializedShiftJson>,
  ): Array<MaterializedShift> {
    return json.map((item: MaterializedShiftJson) => {
      return MaterializedShiftUtil.fromJSON(item);
    });
  }

  /*
   * Deterministic order for rendering and hashing: by start, then schedule,
   * then shift key. Returns a sorted copy; never mutates the input.
   */
  public static sortByStart(
    shifts: Array<MaterializedShift>,
  ): Array<MaterializedShift> {
    return [...shifts].sort((a: MaterializedShift, b: MaterializedShift) => {
      const byStart: number = a.start.getTime() - b.start.getTime();
      if (byStart !== 0) {
        return byStart;
      }

      if (a.scheduleId !== b.scheduleId) {
        return a.scheduleId < b.scheduleId ? -1 : 1;
      }

      if (a.shiftKey === b.shiftKey) {
        return 0;
      }

      return a.shiftKey < b.shiftKey ? -1 : 1;
    });
  }

  // `${scheduleId}:${startEpochSeconds}` (+ `:${policyId}` for variants).
  public static buildShiftKey(data: {
    scheduleId: string;
    start: Date;
    policyId?: string | undefined;
  }): string {
    const epochSeconds: number = Math.floor(data.start.getTime() / 1000);
    const base: string = `${data.scheduleId}:${epochSeconds}`;
    return data.policyId ? `${base}:${data.policyId}` : base;
  }
}
