import Label from "../../../../Models/DatabaseModels/Label";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorOwnerUser from "../../../../Models/DatabaseModels/MonitorOwnerUser";
import MonitorProbe from "../../../../Models/DatabaseModels/MonitorProbe";
import OnCallDutyPolicyScheduleLayer from "../../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";
import Runner from "../../../../Models/DatabaseModels/Runner";
import Team from "../../../../Models/DatabaseModels/Team";
import KindsWithOwners, {
  KINDS_WHOSE_READS_THE_OWNED_SCOPE_LEAVES_ALONE,
  KINDS_WITH_OWNER_TABLES,
} from "../../../../Types/Database/AccessControl/KindsWithOwners";
import { describe, expect, test } from "@jest/globals";

/*
 * THE KINDS WITH OWNER TABLES, AS THE DASHBOARD KNOWS THEM (#11436): which
 * kinds' pages ask who owns their records, which models a grant scoped to
 * Owned narrows at all, and which kinds' reads it leaves alone. The guard
 * KindsWithOwnersGuard (Tests/Server/Types/Database/Permissions) holds both
 * lists to the server's registry of owner tables.
 */

describe("the kinds with owner tables", () => {
  test("a monitor, a team, a runner; not a label, nor a monitor's owner table", () => {
    expect(KindsWithOwners.hasOwnerTables("Monitor")).toBe(true);
    expect(KindsWithOwners.hasOwnerTables("Team")).toBe(true);
    expect(KindsWithOwners.hasOwnerTables("Runner")).toBe(true);
    expect(KindsWithOwners.hasOwnerTables("Label")).toBe(false);
    expect(KindsWithOwners.hasOwnerTables("MonitorOwnerUser")).toBe(false);
    expect(KindsWithOwners.hasOwnerTables("")).toBe(false);
    expect(KindsWithOwners.hasOwnerTables(null)).toBe(false);
  });

  test("written in alphabetical order, each kind once; the reads left alone are among them", () => {
    expect([...KINDS_WITH_OWNER_TABLES]).toEqual(
      [...new Set(KINDS_WITH_OWNER_TABLES)].sort(),
    );
    expect([...KINDS_WHOSE_READS_THE_OWNED_SCOPE_LEAVES_ALONE]).toEqual(
      [...new Set(KINDS_WHOSE_READS_THE_OWNED_SCOPE_LEAVES_ALONE)].sort(),
    );

    for (const kind of KINDS_WHOSE_READS_THE_OWNED_SCOPE_LEAVES_ALONE) {
      expect([kind, KINDS_WITH_OWNER_TABLES.includes(kind)]).toEqual([kind, true]);
    }
  });
});

describe("which models have owners for the Owned scope to narrow by", () => {
  test.each([
    ["a kind with owner tables", new Monitor(), true],
    ["a part that takes its owners from one", new MonitorProbe(), true],
    ["a team", new Team(), true],
    ["a label", new Label(), false],
    // Its owners are the monitor's, through the registry: the server's to know.
    ["a monitor's owner table", new MonitorOwnerUser(), false],
  ])("%s: %s", (_name: string, model: unknown, expected: boolean) => {
    expect(KindsWithOwners.hasOwners(model as never)).toBe(expected);
  });
});

describe("which kinds' reads the Owned scope leaves alone", () => {
  test.each([
    ["a runner: picked by every reader of runners", new Runner(), true],
    ["a team", new Team(), true],
    ["a schedule's layer: it takes its owners from the schedule", new OnCallDutyPolicyScheduleLayer(), true],
    ["a monitor: its reads keep to what its reader owns", new Monitor(), false],
    ["a monitor's probe: it takes its owners from the monitor", new MonitorProbe(), false],
  ])("%s", (_name: string, model: unknown, expected: boolean) => {
    expect(KindsWithOwners.leavesReadsAlone(model as never)).toBe(expected);
  });

  test("nothing for no model", () => {
    expect(KindsWithOwners.leavesReadsAlone(null)).toBe(false);
    expect(KindsWithOwners.hasOwners(undefined)).toBe(false);
  });
});
