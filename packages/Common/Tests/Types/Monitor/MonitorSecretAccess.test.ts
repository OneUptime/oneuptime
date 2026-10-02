import { describe, expect, test } from "@jest/globals";
import MonitorSecretAccess, {
  MonitorSecretAccessUtil,
  MonitorSecretGrant,
  MonitorSecretGrantee,
} from "../../../Types/Monitor/MonitorSecretAccess";

/*
 * The rule that decides which monitors may use a monitor secret (#1467).
 * Every probe fetch cycle and every monitor test runs it, and it fails
 * silently in both directions: too narrow and a monitor runs with a literal
 * {{monitorSecrets.x}} in its request, too wide and a credential reaches a
 * monitor - or a project - it was never given to. So the whole matrix is
 * walked: every mode against every kind of monitor, plus the lists a mode
 * must ignore and the project boundary no mode may cross.
 */

const PROJECT_A: string = "aaaaaaaa-0000-4000-8000-00000000000a";
const PROJECT_B: string = "bbbbbbbb-0000-4000-8000-00000000000b";

const MONITOR_1: string = "11111111-0000-4000-8000-000000000001";
const MONITOR_2: string = "22222222-0000-4000-8000-000000000002";

const LABEL_PROD: string = "cccccccc-0000-4000-8000-0000000000c1";
const LABEL_EDGE: string = "cccccccc-0000-4000-8000-0000000000c2";
const LABEL_OTHER: string = "cccccccc-0000-4000-8000-0000000000c3";

function grant(data: Partial<MonitorSecretGrant>): MonitorSecretGrant {
  return {
    projectId: PROJECT_A,
    monitorAccess: MonitorSecretAccess.SpecificMonitors,
    monitorIds: [],
    labelIds: [],
    ...data,
  };
}

function monitor(data: Partial<MonitorSecretGrantee>): MonitorSecretGrantee {
  return {
    monitorId: MONITOR_1,
    projectId: PROJECT_A,
    labelIds: [],
    ...data,
  };
}

function canUse(
  secret: Partial<MonitorSecretGrant>,
  grantee: Partial<MonitorSecretGrantee>,
): boolean {
  return MonitorSecretAccessUtil.canMonitorUseSecret({
    secret: grant(secret),
    monitor: monitor(grantee),
  });
}

describe("MonitorSecretAccess values", () => {
  /*
   * These strings are stored in MonitorSecret.monitorAccess, are the column's
   * default in the migration, and are what API and Terraform clients send.
   * Renaming one is a data migration, not a refactor.
   */
  test("the stored values are stable", () => {
    expect(MonitorSecretAccess.AllMonitors).toBe("All Monitors");
    expect(MonitorSecretAccess.SpecificMonitors).toBe("Specific Monitors");
    expect(MonitorSecretAccess.MonitorsWithLabels).toBe("Monitors With Labels");
  });

  test("the default is Specific Monitors, the only behaviour before #1467", () => {
    expect(MonitorSecretAccessUtil.DEFAULT_ACCESS).toBe(
      MonitorSecretAccess.SpecificMonitors,
    );
  });

  test("lists every mode exactly once, widest first", () => {
    expect(MonitorSecretAccessUtil.ALL_ACCESS_MODES).toEqual([
      MonitorSecretAccess.AllMonitors,
      MonitorSecretAccess.SpecificMonitors,
      MonitorSecretAccess.MonitorsWithLabels,
    ]);
    expect(Object.values(MonitorSecretAccess).sort()).toEqual(
      [...MonitorSecretAccessUtil.ALL_ACCESS_MODES].sort(),
    );
  });
});

describe("MonitorSecretAccessUtil.isValid", () => {
  test.each(Object.values(MonitorSecretAccess))(
    "accepts %s",
    (value: MonitorSecretAccess) => {
      expect(MonitorSecretAccessUtil.isValid(value)).toBe(true);
    },
  );

  test.each([
    ["the enum key instead of its value", "AllMonitors"],
    ["a different case", "all monitors"],
    ["surrounding whitespace", " All Monitors "],
    ["an empty string", ""],
    ["the old boolean column name", "isAvailableToAllMonitors"],
    ["a boolean", true],
    ["a number", 1],
    ["null", null],
    ["undefined", undefined],
    ["an object", { value: "All Monitors" }],
    ["an array", ["All Monitors"]],
  ])("rejects %s", (_name: string, value: unknown) => {
    expect(MonitorSecretAccessUtil.isValid(value)).toBe(false);
  });
});

describe("MonitorSecretAccessUtil list bookkeeping", () => {
  test("each mode reads at most one list", () => {
    expect(
      MonitorSecretAccessUtil.getListUsedBy(MonitorSecretAccess.AllMonitors),
    ).toBeNull();
    expect(
      MonitorSecretAccessUtil.getListUsedBy(
        MonitorSecretAccess.SpecificMonitors,
      ),
    ).toBe("monitors");
    expect(
      MonitorSecretAccessUtil.getListUsedBy(
        MonitorSecretAccess.MonitorsWithLabels,
      ),
    ).toBe("labels");
  });

  test("a mode leaves unread every list it does not use", () => {
    expect(
      MonitorSecretAccessUtil.getListsUnusedBy(MonitorSecretAccess.AllMonitors),
    ).toEqual(["monitors", "labels"]);
    expect(
      MonitorSecretAccessUtil.getListsUnusedBy(
        MonitorSecretAccess.SpecificMonitors,
      ),
    ).toEqual(["labels"]);
    expect(
      MonitorSecretAccessUtil.getListsUnusedBy(
        MonitorSecretAccess.MonitorsWithLabels,
      ),
    ).toEqual(["monitors"]);
  });
});

describe("MonitorSecretAccessUtil.canMonitorUseSecret - All Monitors", () => {
  const all: Partial<MonitorSecretGrant> = {
    monitorAccess: MonitorSecretAccess.AllMonitors,
  };

  test("reaches any monitor of the project, listed or not, labelled or not", () => {
    expect(canUse(all, { monitorId: MONITOR_1 })).toBe(true);
    expect(canUse(all, { monitorId: MONITOR_2, labelIds: [LABEL_PROD] })).toBe(
      true,
    );
  });

  test("reaches a monitor that is not saved yet (a test from the Create Monitor form)", () => {
    expect(canUse(all, { monitorId: undefined })).toBe(true);
  });

  test("ignores the lists entirely: a leftover list neither narrows nor widens it", () => {
    expect(
      canUse(
        { ...all, monitorIds: [MONITOR_2], labelIds: [LABEL_OTHER] },
        { monitorId: MONITOR_1, labelIds: [LABEL_PROD] },
      ),
    ).toBe(true);
  });

  test("never reaches another project's monitor", () => {
    expect(canUse(all, { projectId: PROJECT_B })).toBe(false);
  });
});

describe("MonitorSecretAccessUtil.canMonitorUseSecret - Specific Monitors", () => {
  const specific: Partial<MonitorSecretGrant> = {
    monitorAccess: MonitorSecretAccess.SpecificMonitors,
    monitorIds: [MONITOR_1],
  };

  test("reaches a listed monitor", () => {
    expect(canUse(specific, { monitorId: MONITOR_1 })).toBe(true);
  });

  test("does not reach a monitor that is not listed", () => {
    expect(canUse(specific, { monitorId: MONITOR_2 })).toBe(false);
  });

  test("an empty list reaches nobody", () => {
    expect(
      canUse({ ...specific, monitorIds: [] }, { monitorId: MONITOR_1 }),
    ).toBe(false);
  });

  test("a monitor that is not saved yet is nobody's listed monitor", () => {
    expect(canUse(specific, { monitorId: undefined })).toBe(false);
    expect(canUse(specific, { monitorId: "" })).toBe(false);
  });

  test("a leftover label list grants nothing, even when the monitor carries the label", () => {
    expect(
      canUse(
        { ...specific, monitorIds: [], labelIds: [LABEL_PROD] },
        { monitorId: MONITOR_1, labelIds: [LABEL_PROD] },
      ),
    ).toBe(false);
  });

  test("a listed monitor that moved to another project is not reached", () => {
    expect(
      canUse(specific, { monitorId: MONITOR_1, projectId: PROJECT_B }),
    ).toBe(false);
  });

  test("compares ids case- and whitespace-insensitively (Postgres reads uuids back in lower case)", () => {
    expect(
      canUse(
        { ...specific, monitorIds: [` ${MONITOR_1.toUpperCase()} `] },
        { monitorId: MONITOR_1 },
      ),
    ).toBe(true);
    expect(
      canUse(
        { ...specific, projectId: PROJECT_A.toUpperCase() },
        { monitorId: MONITOR_1.toUpperCase() },
      ),
    ).toBe(true);
  });
});

describe("MonitorSecretAccessUtil.canMonitorUseSecret - Monitors With Labels", () => {
  const withLabels: Partial<MonitorSecretGrant> = {
    monitorAccess: MonitorSecretAccess.MonitorsWithLabels,
    labelIds: [LABEL_PROD, LABEL_EDGE],
  };

  test("reaches a monitor carrying one of the labels", () => {
    expect(canUse(withLabels, { labelIds: [LABEL_EDGE] })).toBe(true);
  });

  test("reaches a monitor carrying several of them, and other labels besides", () => {
    expect(
      canUse(withLabels, {
        labelIds: [LABEL_OTHER, LABEL_PROD, LABEL_EDGE],
      }),
    ).toBe(true);
  });

  test("does not reach a monitor carrying only other labels", () => {
    expect(canUse(withLabels, { labelIds: [LABEL_OTHER] })).toBe(false);
  });

  test("does not reach a monitor with no labels", () => {
    expect(canUse(withLabels, { labelIds: [] })).toBe(false);
  });

  test("an empty label list reaches nobody", () => {
    expect(
      canUse({ ...withLabels, labelIds: [] }, { labelIds: [LABEL_PROD] }),
    ).toBe(false);
  });

  test("a leftover monitor list grants nothing: a listed monitor without the label is not reached", () => {
    expect(
      canUse(
        { ...withLabels, monitorIds: [MONITOR_1] },
        { monitorId: MONITOR_1, labelIds: [] },
      ),
    ).toBe(false);
  });

  test("a monitor that is not saved yet carries no labels", () => {
    expect(canUse(withLabels, { monitorId: undefined, labelIds: [] })).toBe(
      false,
    );
  });

  test("a shared label id does not carry the secret into another project", () => {
    expect(
      canUse(withLabels, { projectId: PROJECT_B, labelIds: [LABEL_PROD] }),
    ).toBe(false);
  });

  test("ignores blank ids on either side instead of matching them", () => {
    expect(
      canUse({ ...withLabels, labelIds: ["", "  "] }, { labelIds: ["", "  "] }),
    ).toBe(false);
  });

  test("compares label ids case-insensitively", () => {
    expect(canUse(withLabels, { labelIds: [LABEL_EDGE.toUpperCase()] })).toBe(
      true,
    );
  });
});

describe("MonitorSecretAccessUtil.canMonitorUseSecret - what denies in every mode", () => {
  test.each(Object.values(MonitorSecretAccess))(
    "%s: a missing project on either side denies",
    (access: MonitorSecretAccess) => {
      const everything: Partial<MonitorSecretGrant> = {
        monitorAccess: access,
        monitorIds: [MONITOR_1],
        labelIds: [LABEL_PROD],
      };
      const listedAndLabelled: Partial<MonitorSecretGrantee> = {
        monitorId: MONITOR_1,
        labelIds: [LABEL_PROD],
      };

      expect(canUse(everything, listedAndLabelled)).toBe(true);
      expect(
        canUse({ ...everything, projectId: undefined }, listedAndLabelled),
      ).toBe(false);
      expect(
        canUse(everything, { ...listedAndLabelled, projectId: undefined }),
      ).toBe(false);
      expect(canUse(everything, { ...listedAndLabelled, projectId: "" })).toBe(
        false,
      );
      expect(
        canUse(everything, { ...listedAndLabelled, projectId: PROJECT_B }),
      ).toBe(false);
    },
  );

  test.each([
    ["an unknown mode", "Everyone"],
    ["a mode in the wrong case", "all monitors"],
    ["no mode at all", undefined],
  ])(
    "%s grants nothing, whatever the lists say",
    (_name: string, monitorAccess: string | undefined) => {
      expect(
        canUse(
          {
            monitorAccess: monitorAccess,
            monitorIds: [MONITOR_1],
            labelIds: [LABEL_PROD],
          },
          { monitorId: MONITOR_1, labelIds: [LABEL_PROD] },
        ),
      ).toBe(false);
    },
  );
});
