import { describe, expect, test } from "@jest/globals";
import { ResourceOwnerEntry } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/OwnerEntry";
import {
  MONITOR_OWNERS_ACCESS_REASON,
  MONITOR_OWNERS_PARTIAL_REASONS,
  OwnerListOutcome,
  combineOwnerLists,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/useMonitorOwners";
import {
  OverviewSection,
  getLoadingSection,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/OverviewSection";
import Team from "../../../Models/DatabaseModels/Team";
import User from "../../../Models/DatabaseModels/User";

/*
 * combineOwnerLists turns the two owner reads (users and teams, each gated
 * and read on its own) into the hero's owners section, given what the page
 * showed before. The rule pinned here: an earlier answer only stands in for
 * the half it actually read. A partial answer (one half, with the other's
 * failure as refreshError) must never be kept as if it were complete, or a
 * refresh would throw away the half it just read.
 *
 * The hook around it (reads, gating, refresh token) is covered in
 * MonitorOpenWorkHook.test.tsx.
 */

const MONITOR_ID: string = "9a1f0c2e-5b3d-4c7a-8e1f-2d3c4b5a6978";
const OTHER_MONITOR_ID: string = "4e5f6071-8293-4a4b-b5c6-d7e8f90a1b2c";

const USER_1: string = "e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1";
const USER_2: string = "e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2";
const TEAM_1: string = "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1";
const TEAM_2: string = "f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2";

const USERS_FAILED: string = "Users are unavailable.";
const TEAMS_FAILED: string = "Teams are unavailable.";

type EntryFunction = (id: string) => ResourceOwnerEntry;

const user: EntryFunction = (id: string): ResourceOwnerEntry => {
  const model: User = new User();
  model._id = id;
  return { kind: "user", user: model };
};

const team: EntryFunction = (id: string): ResourceOwnerEntry => {
  const model: Team = new Team();
  model._id = id;
  return { kind: "team", team: model };
};

type LoadedFunction = (entries: Array<ResourceOwnerEntry>) => OwnerListOutcome;

const loaded: LoadedFunction = (
  entries: Array<ResourceOwnerEntry>,
): OwnerListOutcome => {
  return { kind: "loaded", entries: entries };
};

type FailedFunction = (message: string) => OwnerListOutcome;

const failed: FailedFunction = (message: string): OwnerListOutcome => {
  return { kind: "failed", message: message };
};

type CombineFunction = (data: {
  users: OwnerListOutcome;
  teams: OwnerListOutcome;
  previous?: OverviewSection<Array<ResourceOwnerEntry>>;
}) => OverviewSection<Array<ResourceOwnerEntry>>;

const combine: CombineFunction = (data: {
  users: OwnerListOutcome;
  teams: OwnerListOutcome;
  previous?: OverviewSection<Array<ResourceOwnerEntry>>;
}): OverviewSection<Array<ResourceOwnerEntry>> => {
  return combineOwnerLists({
    users: data.users,
    teams: data.teams,
    previous: data.previous || getLoadingSection<Array<ResourceOwnerEntry>>(),
    subjectId: MONITOR_ID,
  });
};

// "user:<id>" and "team:<id>", in the order the hero shows them.
type IdsFunction = (
  section: OverviewSection<Array<ResourceOwnerEntry>>,
) => Array<string> | null;

const ids: IdsFunction = (
  section: OverviewSection<Array<ResourceOwnerEntry>>,
): Array<string> | null => {
  if (!section.value) {
    return null;
  }

  return section.value.map((entry: ResourceOwnerEntry) => {
    return entry.kind === "user"
      ? `user:${entry.user._id?.toString()}`
      : `team:${entry.team._id?.toString()}`;
  });
};

// Refresh 1: users [U1], and the teams read failed.
const PARTIAL: () => OverviewSection<
  Array<ResourceOwnerEntry>
> = (): OverviewSection<Array<ResourceOwnerEntry>> => {
  return combine({
    users: loaded([user(USER_1)]),
    teams: failed(TEAMS_FAILED),
  });
};

// Both halves read: users [U1], teams [T1].
const COMPLETE: () => OverviewSection<
  Array<ResourceOwnerEntry>
> = (): OverviewSection<Array<ResourceOwnerEntry>> => {
  return combine({
    users: loaded([user(USER_1)]),
    teams: loaded([team(TEAM_1)]),
  });
};

describe("combineOwnerLists", () => {
  test("both halves read: the owners, users first, with nothing to note", () => {
    const section: OverviewSection<Array<ResourceOwnerEntry>> = COMPLETE();

    expect(section.status).toBe("loaded");
    expect(ids(section)).toEqual([`user:${USER_1}`, `team:${TEAM_1}`]);
    expect(section.refreshError).toBe("");
  });

  test("a partial answer is not kept as complete: the half just read is shown", () => {
    const partial: OverviewSection<Array<ResourceOwnerEntry>> = PARTIAL();

    expect(ids(partial)).toEqual([`user:${USER_1}`]);
    expect(partial.refreshError).toBe(TEAMS_FAILED);

    // Refresh 2: users now [U1, U2], and the teams read fails again.
    const next: OverviewSection<Array<ResourceOwnerEntry>> = combine({
      users: loaded([user(USER_1), user(USER_2)]),
      teams: failed(TEAMS_FAILED),
      previous: partial,
    });

    expect(next.status).toBe("loaded");
    expect(ids(next)).toEqual([`user:${USER_1}`, `user:${USER_2}`]);
    expect(next.refreshError).toBe(TEAMS_FAILED);
  });

  test("after a partial answer, the other half failing keeps the half that was read and shows the one just read", () => {
    // Refresh 2: the users read fails, the teams read works for once.
    const next: OverviewSection<Array<ResourceOwnerEntry>> = combine({
      users: failed(USERS_FAILED),
      teams: loaded([team(TEAM_1)]),
      previous: PARTIAL(),
    });

    expect(next.status).toBe("loaded");
    // U1 is from the users read that worked last time; T1 was just read.
    expect(ids(next)).toEqual([`user:${USER_1}`, `team:${TEAM_1}`]);
    expect(next.refreshError).toBe(USERS_FAILED);
  });

  test("a half that fails after a complete answer keeps that half's owners next to the half just read", () => {
    const next: OverviewSection<Array<ResourceOwnerEntry>> = combine({
      users: loaded([user(USER_1), user(USER_2)]),
      teams: failed(TEAMS_FAILED),
      previous: COMPLETE(),
    });

    expect(ids(next)).toEqual([
      `user:${USER_1}`,
      `user:${USER_2}`,
      `team:${TEAM_1}`,
    ]);
    expect(next.refreshError).toBe(TEAMS_FAILED);

    // It keeps doing so while the failure lasts, and lets go once it ends.
    const again: OverviewSection<Array<ResourceOwnerEntry>> = combine({
      users: loaded([user(USER_1), user(USER_2)]),
      teams: failed(TEAMS_FAILED),
      previous: next,
    });

    expect(ids(again)).toEqual(ids(next));

    const recovered: OverviewSection<Array<ResourceOwnerEntry>> = combine({
      users: loaded([user(USER_1), user(USER_2)]),
      teams: loaded([team(TEAM_2)]),
      previous: again,
    });

    expect(ids(recovered)).toEqual([
      `user:${USER_1}`,
      `user:${USER_2}`,
      `team:${TEAM_2}`,
    ]);
    expect(recovered.refreshError).toBe("");
  });

  test("a complete answer's empty half is known, so 'No owners' can stand through a failure", () => {
    const none: OverviewSection<Array<ResourceOwnerEntry>> = combine({
      users: loaded([]),
      teams: loaded([]),
    });

    const next: OverviewSection<Array<ResourceOwnerEntry>> = combine({
      users: loaded([]),
      teams: failed(TEAMS_FAILED),
      previous: none,
    });

    expect(next.status).toBe("loaded");
    expect(ids(next)).toEqual([]);
    expect(next.refreshError).toBe(TEAMS_FAILED);
  });

  test("an empty half next to one never read is unknown, and an earlier answer it contradicts is dropped", () => {
    // U1 has since been removed: the users read now names nobody.
    const next: OverviewSection<Array<ResourceOwnerEntry>> = combine({
      users: loaded([]),
      teams: failed(TEAMS_FAILED),
      previous: PARTIAL(),
    });

    expect(next.status).toBe("error");
    expect(next.value).toBeNull();
    expect(next.error).toBe(TEAMS_FAILED);
  });

  test("both halves failing keeps whatever was shown, with the failure", () => {
    const next: OverviewSection<Array<ResourceOwnerEntry>> = combine({
      users: failed(USERS_FAILED),
      teams: failed(TEAMS_FAILED),
      previous: COMPLETE(),
    });

    expect(ids(next)).toEqual([`user:${USER_1}`, `team:${TEAM_1}`]);
    expect(next.refreshError).toBe(USERS_FAILED);

    const first: OverviewSection<Array<ResourceOwnerEntry>> = combine({
      users: failed(USERS_FAILED),
      teams: failed(TEAMS_FAILED),
    });

    expect(first.status).toBe("error");
    expect(first.value).toBeNull();
  });

  test("an earlier answer for another monitor is never used", () => {
    const elsewhere: OverviewSection<Array<ResourceOwnerEntry>> =
      combineOwnerLists({
        users: loaded([user(USER_1)]),
        teams: loaded([team(TEAM_1)]),
        previous: getLoadingSection<Array<ResourceOwnerEntry>>(),
        subjectId: OTHER_MONITOR_ID,
      });

    const next: OverviewSection<Array<ResourceOwnerEntry>> = combine({
      users: loaded([user(USER_2)]),
      teams: failed(TEAMS_FAILED),
      previous: elsewhere,
    });

    expect(ids(next)).toEqual([`user:${USER_2}`]);
    expect(next.loadedFor).toBe(MONITOR_ID);
  });

  test("a half that cannot be read is never filled from an earlier answer", () => {
    const next: OverviewSection<Array<ResourceOwnerEntry>> = combine({
      users: loaded([user(USER_1)]),
      teams: {
        kind: "forbidden",
        reason: MONITOR_OWNERS_PARTIAL_REASONS.teams,
      },
      previous: COMPLETE(),
    });

    expect(ids(next)).toEqual([`user:${USER_1}`]);
    expect(next.refreshError).toBe(MONITOR_OWNERS_PARTIAL_REASONS.teams);

    const neither: OverviewSection<Array<ResourceOwnerEntry>> = combine({
      users: {
        kind: "forbidden",
        reason: MONITOR_OWNERS_PARTIAL_REASONS.users,
      },
      teams: {
        kind: "forbidden",
        reason: MONITOR_OWNERS_PARTIAL_REASONS.teams,
      },
      previous: COMPLETE(),
    });

    expect(neither.status).toBe("forbidden");
    expect(neither.error).toBe(MONITOR_OWNERS_ACCESS_REASON);
  });
});
