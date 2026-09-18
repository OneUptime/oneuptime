import { getTimelineColorForUserId } from "./TimelineColors";
import {
  ScheduleTimelineResponse,
  ScheduleTimelineScheduleJson,
  ScheduleTimelineShiftJson,
  ScheduleTimelineTeamJson,
} from "Common/Types/OnCallDutyPolicy/ScheduleTimeline";
import ScheduleTimelineLayout, {
  TimeInterval,
} from "Common/Types/OnCallDutyPolicy/ScheduleTimelineLayout";

/*
 * The schedule timeline's view model: the API response turned into Dates,
 * and every "which rows, in which groups, with which people" decision the
 * page makes. Pure and React-free so each rule is tested on its own.
 */

export interface TimelineOverride {
  originalUserId: string;
  originalUserName: string;
  // The override's own window (it can be wider than the shift it produced).
  start: Date;
  end: Date;
  // Scoped to one on-call policy rather than global.
  isPolicyScoped: boolean;
}

export interface TimelineShift extends TimeInterval {
  key: string;
  userId: string;
  userName: string;
  layerName: string | null;
  override: TimelineOverride | null;
}

export interface TimelineSchedule {
  id: string;
  name: string;
  timezone: string | null;
  ownerTeamIds: Array<string>;
  isCurrentUserOnRoster: boolean;
  truncated: boolean;
  shifts: Array<TimelineShift>;
}

export interface TimelineTeam {
  id: string;
  name: string;
  isCurrentUserMember: boolean;
}

export interface TimelineData {
  schedules: Array<TimelineSchedule>;
  teams: Array<TimelineTeam>;
  // The window the server actually computed (after its clamping).
  servedWindow: TimeInterval | null;
  truncated: boolean;
  totalScheduleCount: number;
  schedulesTruncated: boolean;
}

// Team filter values that are not a team id.
export const ALL_TEAMS: string = "__all_teams__";
export const MY_TEAMS: string = "__my_teams__";

export const NO_TEAM_GROUP_KEY: string = "__no_owner_team__";
export const ALL_SCHEDULES_GROUP_KEY: string = "__all_schedules__";

export enum AttentionFilter {
  None = "none",
  UncoveredNow = "uncovered-now",
  HasGaps = "has-gaps",
}

export interface TimelineFilters {
  search: string;
  // ALL_TEAMS, MY_TEAMS or a team id.
  team: string;
  onlyMine: boolean;
  attention: AttentionFilter;
}

export const DEFAULT_FILTERS: TimelineFilters = {
  search: "",
  team: ALL_TEAMS,
  onlyMine: false,
  attention: AttentionFilter.None,
};

export interface TimelineGroup {
  key: string;
  // null for the single ungrouped list.
  title: string | null;
  teamId: string | null;
  isCurrentUserMember: boolean;
  schedules: Array<TimelineSchedule>;
}

export interface TimelinePerson {
  userId: string;
  userName: string;
  color: string;
  // Summed across schedules, inside the visible window.
  onCallMilliseconds: number;
  scheduleCount: number;
  isOnCallNow: boolean;
}

export interface TimelineSummary {
  total: number;
  // null when "now" is outside the visible window, so nothing can be said.
  coveredNow: number | null;
  uncoveredNow: number | null;
  withGaps: number;
}

// Holes shorter than this are rendering noise, not coverage gaps.
export const MINIMUM_GAP_MILLISECONDS: number = 60 * 1000;

export default class TimelineModel {
  public static fromResponse(response: ScheduleTimelineResponse): TimelineData {
    const from: number = Date.parse(response.from);
    const to: number = Date.parse(response.to);

    return {
      schedules: response.schedules.map(
        (schedule: ScheduleTimelineScheduleJson): TimelineSchedule => {
          return {
            id: schedule.scheduleId,
            name: schedule.scheduleName,
            timezone: schedule.scheduleTimezone,
            ownerTeamIds: [...schedule.ownerTeamIds],
            isCurrentUserOnRoster: schedule.isCurrentUserOnRoster,
            truncated: schedule.truncated,
            shifts: schedule.shifts.map(
              (shift: ScheduleTimelineShiftJson): TimelineShift => {
                return {
                  key: shift.shiftKey,
                  userId: shift.userId,
                  userName: shift.userName,
                  start: new Date(shift.start),
                  end: new Date(shift.end),
                  layerName: shift.layerName,
                  override: shift.override
                    ? {
                        originalUserId: shift.override.originalUserId,
                        originalUserName: shift.override.originalUserName,
                        start: new Date(shift.override.overrideStartsAt),
                        end: new Date(shift.override.overrideEndsAt),
                        isPolicyScoped: Boolean(
                          shift.override.onCallDutyPolicyId,
                        ),
                      }
                    : null,
                };
              },
            ),
          };
        },
      ),
      teams: response.teams.map(
        (team: ScheduleTimelineTeamJson): TimelineTeam => {
          return {
            id: team.teamId,
            name: team.teamName,
            isCurrentUserMember: team.isCurrentUserMember,
          };
        },
      ),
      servedWindow:
        Number.isFinite(from) && Number.isFinite(to) && to > from
          ? { start: new Date(from), end: new Date(to) }
          : null,
      truncated: response.truncated,
      totalScheduleCount: response.totalScheduleCount,
      schedulesTruncated: response.schedulesTruncated,
    };
  }

  /*
   * The part of the visible range the server actually computed. Outside it
   * the page draws "not available" rather than "nobody on call".
   */
  public static getComputedWindow(
    visible: TimeInterval,
    served: TimeInterval | null,
  ): TimeInterval | null {
    if (!served) {
      return null;
    }

    const start: number = Math.max(
      visible.start.getTime(),
      served.start.getTime(),
    );
    const end: number = Math.min(visible.end.getTime(), served.end.getTime());

    if (end <= start) {
      return null;
    }

    return { start: new Date(start), end: new Date(end) };
  }

  public static getGaps(
    schedule: TimelineSchedule,
    window: TimeInterval | null,
  ): Array<TimeInterval> {
    if (!window) {
      return [];
    }

    return ScheduleTimelineLayout.computeGaps(
      schedule.shifts,
      window.start,
      window.end,
      MINIMUM_GAP_MILLISECONDS,
    );
  }

  public static getOnCallNow(
    schedule: TimelineSchedule,
    now: Date,
  ): TimelineShift | null {
    return ScheduleTimelineLayout.findActive(schedule.shifts, now);
  }

  public static filterSchedules(data: {
    schedules: Array<TimelineSchedule>;
    teams: Array<TimelineTeam>;
    filters: TimelineFilters;
    now: Date;
    window: TimeInterval | null;
  }): Array<TimelineSchedule> {
    const search: string = data.filters.search.trim().toLowerCase();

    const teamNameById: Map<string, string> = new Map();
    const myTeamIds: Set<string> = new Set<string>();

    for (const team of data.teams) {
      teamNameById.set(team.id, team.name);

      if (team.isCurrentUserMember) {
        myTeamIds.add(team.id);
      }
    }

    const nowIsVisible: boolean = Boolean(
      data.window &&
        ScheduleTimelineLayout.isWithinRange(data.now, data.window),
    );

    return data.schedules.filter((schedule: TimelineSchedule) => {
      if (data.filters.onlyMine && !schedule.isCurrentUserOnRoster) {
        return false;
      }

      if (data.filters.team === MY_TEAMS) {
        const ownedByMyTeam: boolean = schedule.ownerTeamIds.some(
          (teamId: string) => {
            return myTeamIds.has(teamId);
          },
        );

        if (!ownedByMyTeam) {
          return false;
        }
      } else if (data.filters.team !== ALL_TEAMS) {
        if (!schedule.ownerTeamIds.includes(data.filters.team)) {
          return false;
        }
      }

      if (data.filters.attention === AttentionFilter.UncoveredNow) {
        // "Uncovered now" cannot be judged for a week that is not this one.
        if (
          !nowIsVisible ||
          TimelineModel.getOnCallNow(schedule, data.now) !== null
        ) {
          return false;
        }
      }

      if (data.filters.attention === AttentionFilter.HasGaps) {
        if (TimelineModel.getGaps(schedule, data.window).length === 0) {
          return false;
        }
      }

      if (!search) {
        return true;
      }

      /*
       * Search matches the schedule, its owner teams and the PEOPLE on it,
       * so "where is Alice on call this week" is one query.
       */
      if (schedule.name.toLowerCase().includes(search)) {
        return true;
      }

      for (const teamId of schedule.ownerTeamIds) {
        if ((teamNameById.get(teamId) || "").toLowerCase().includes(search)) {
          return true;
        }
      }

      return schedule.shifts.some((shift: TimelineShift) => {
        return shift.userName.toLowerCase().includes(search);
      });
    });
  }

  /*
   * Rows grouped by owner team, teams by name, "No owner team" last. A
   * schedule owned by two teams appears under both: it is on both teams'
   * plates. Ungrouped, it is one untitled group in the input order.
   *
   * With a team filter active only the teams it selected get a group, so
   * picking "SRE" does not also show a "Payments" group just because one of
   * SRE's schedules is co-owned.
   */
  public static groupSchedules(data: {
    schedules: Array<TimelineSchedule>;
    teams: Array<TimelineTeam>;
    groupByTeam: boolean;
    teamFilter?: string | undefined;
  }): Array<TimelineGroup> {
    if (data.schedules.length === 0) {
      return [];
    }

    if (!data.groupByTeam) {
      return [
        {
          key: ALL_SCHEDULES_GROUP_KEY,
          title: null,
          teamId: null,
          isCurrentUserMember: false,
          schedules: [...data.schedules],
        },
      ];
    }

    const groups: Array<TimelineGroup> = [];

    const teamFilter: string = data.teamFilter || ALL_TEAMS;

    const sortedTeams: Array<TimelineTeam> = data.teams
      .filter((team: TimelineTeam) => {
        if (teamFilter === MY_TEAMS) {
          return team.isCurrentUserMember;
        }

        return teamFilter === ALL_TEAMS || team.id === teamFilter;
      })
      .sort((a: TimelineTeam, b: TimelineTeam) => {
        return a.name.localeCompare(b.name);
      });

    const knownTeamIds: Set<string> = new Set<string>(
      sortedTeams.map((team: TimelineTeam) => {
        return team.id;
      }),
    );

    for (const team of sortedTeams) {
      const schedules: Array<TimelineSchedule> = data.schedules.filter(
        (schedule: TimelineSchedule) => {
          return schedule.ownerTeamIds.includes(team.id);
        },
      );

      if (schedules.length > 0) {
        groups.push({
          key: team.id,
          title: team.name,
          teamId: team.id,
          isCurrentUserMember: team.isCurrentUserMember,
          schedules,
        });
      }
    }

    const unowned: Array<TimelineSchedule> = data.schedules.filter(
      (schedule: TimelineSchedule) => {
        return !schedule.ownerTeamIds.some((teamId: string) => {
          return knownTeamIds.has(teamId);
        });
      },
    );

    if (unowned.length > 0) {
      groups.push({
        key: NO_TEAM_GROUP_KEY,
        title: "No owner team",
        teamId: null,
        isCurrentUserMember: false,
        schedules: unowned,
      });
    }

    return groups;
  }

  /*
   * Everyone with time on call inside `window`, heaviest load first (then by
   * name), with the colour their bars are drawn in.
   */
  public static collectPeople(data: {
    schedules: Array<TimelineSchedule>;
    window: TimeInterval | null;
    now: Date;
  }): Array<TimelinePerson> {
    if (!data.window) {
      return [];
    }

    const window: TimeInterval = data.window;
    const byUser: Map<
      string,
      {
        userName: string;
        intervals: Array<TimeInterval>;
        schedules: Set<string>;
        isOnCallNow: boolean;
      }
    > = new Map();

    for (const schedule of data.schedules) {
      for (const shift of schedule.shifts) {
        if (
          shift.end.getTime() <= window.start.getTime() ||
          shift.start.getTime() >= window.end.getTime()
        ) {
          continue;
        }

        const entry: {
          userName: string;
          intervals: Array<TimeInterval>;
          schedules: Set<string>;
          isOnCallNow: boolean;
        } = byUser.get(shift.userId) || {
          userName: shift.userName,
          intervals: [],
          schedules: new Set<string>(),
          isOnCallNow: false,
        };

        entry.intervals.push(shift);
        entry.schedules.add(schedule.id);
        entry.isOnCallNow =
          entry.isOnCallNow ||
          (shift.start.getTime() <= data.now.getTime() &&
            shift.end.getTime() > data.now.getTime());

        byUser.set(shift.userId, entry);
      }
    }

    const people: Array<TimelinePerson> = [];

    byUser.forEach(
      (
        entry: {
          userName: string;
          intervals: Array<TimeInterval>;
          schedules: Set<string>;
          isOnCallNow: boolean;
        },
        userId: string,
      ) => {
        people.push({
          userId,
          userName: entry.userName,
          color: getTimelineColorForUserId(userId),
          onCallMilliseconds: ScheduleTimelineLayout.sumWithin(
            entry.intervals,
            window,
          ),
          scheduleCount: entry.schedules.size,
          isOnCallNow: entry.isOnCallNow,
        });
      },
    );

    return people.sort((a: TimelinePerson, b: TimelinePerson) => {
      if (b.onCallMilliseconds !== a.onCallMilliseconds) {
        return b.onCallMilliseconds - a.onCallMilliseconds;
      }

      return a.userName.localeCompare(b.userName);
    });
  }

  public static summarize(data: {
    schedules: Array<TimelineSchedule>;
    window: TimeInterval | null;
    now: Date;
  }): TimelineSummary {
    const nowIsVisible: boolean = Boolean(
      data.window &&
        ScheduleTimelineLayout.isWithinRange(data.now, data.window),
    );

    let coveredNow: number = 0;
    let withGaps: number = 0;

    for (const schedule of data.schedules) {
      if (nowIsVisible && TimelineModel.getOnCallNow(schedule, data.now)) {
        coveredNow++;
      }

      if (TimelineModel.getGaps(schedule, data.window).length > 0) {
        withGaps++;
      }
    }

    return {
      total: data.schedules.length,
      coveredNow: nowIsVisible ? coveredNow : null,
      uncoveredNow: nowIsVisible ? data.schedules.length - coveredNow : null,
      withGaps,
    };
  }

  // Distinct people on a schedule inside the window.
  public static countPeople(
    schedule: TimelineSchedule,
    window: TimeInterval | null,
  ): number {
    if (!window) {
      return 0;
    }

    const userIds: Set<string> = new Set<string>();

    for (const shift of schedule.shifts) {
      if (
        shift.end.getTime() > window.start.getTime() &&
        shift.start.getTime() < window.end.getTime()
      ) {
        userIds.add(shift.userId);
      }
    }

    return userIds.size;
  }

  public static hasOverrides(
    schedule: TimelineSchedule,
    window: TimeInterval | null,
  ): boolean {
    if (!window) {
      return false;
    }

    return schedule.shifts.some((shift: TimelineShift) => {
      return (
        shift.override !== null &&
        shift.end.getTime() > window.start.getTime() &&
        shift.start.getTime() < window.end.getTime()
      );
    });
  }
}
