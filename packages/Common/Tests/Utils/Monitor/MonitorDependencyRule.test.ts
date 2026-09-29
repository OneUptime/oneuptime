import MonitorDependencyRule, {
  ParentMonitorStatusRef,
  SuppressingParent,
} from "../../../Utils/Monitor/MonitorDependencyRule";

const parent: (
  overrides: Partial<ParentMonitorStatusRef>,
) => ParentMonitorStatusRef = (
  overrides: Partial<ParentMonitorStatusRef>,
): ParentMonitorStatusRef => {
  return {
    monitorId: "m1",
    monitorName: "Router",
    statusId: "s-online",
    statusName: "Online",
    isOfflineState: false,
    ...overrides,
  };
};

describe("MonitorDependencyRule.getSuppressingParents", () => {
  describe("with a configured suppression status list", () => {
    const configured: Set<string> = new Set<string>([
      "s-offline",
      "s-degraded",
    ]);

    test("a parent whose status is in the list suppresses", () => {
      const result: Array<SuppressingParent> =
        MonitorDependencyRule.getSuppressingParents({
          parents: [
            parent({
              monitorId: "m1",
              monitorName: "Core Router",
              statusId: "s-offline",
              statusName: "Offline",
            }),
          ],
          configuredSuppressionStatusIds: configured,
        });

      expect(result).toEqual([
        { monitorId: "m1", monitorName: "Core Router", statusName: "Offline" },
      ]);
    });

    test("a parent whose status is not in the list does not suppress", () => {
      const result: Array<SuppressingParent> =
        MonitorDependencyRule.getSuppressingParents({
          parents: [parent({ statusId: "s-online" })],
          configuredSuppressionStatusIds: configured,
        });

      expect(result).toEqual([]);
    });

    test("the configured list wins even when the parent is offline", () => {
      /*
       * isOfflineState is only the fallback signal. With an explicit list
       * configured, an offline parent whose status id is not listed must NOT
       * suppress — otherwise the operator's narrower rule is ignored.
       */
      const result: Array<SuppressingParent> =
        MonitorDependencyRule.getSuppressingParents({
          parents: [parent({ statusId: "s-online", isOfflineState: true })],
          configuredSuppressionStatusIds: configured,
        });

      expect(result).toEqual([]);
    });

    test("a parent with no current status never suppresses", () => {
      // A never-evaluated parent (undefined statusId) must not silence children.
      const result: Array<SuppressingParent> =
        MonitorDependencyRule.getSuppressingParents({
          parents: [parent({ statusId: undefined, isOfflineState: true })],
          configuredSuppressionStatusIds: configured,
        });

      expect(result).toEqual([]);
    });
  });

  describe("with no configured list (offline fallback)", () => {
    const empty: Set<string> = new Set<string>();

    test("an offline parent suppresses", () => {
      const result: Array<SuppressingParent> =
        MonitorDependencyRule.getSuppressingParents({
          parents: [
            parent({
              monitorName: "Switch",
              statusName: "Offline",
              isOfflineState: true,
            }),
          ],
          configuredSuppressionStatusIds: empty,
        });

      expect(result).toEqual([
        { monitorId: "m1", monitorName: "Switch", statusName: "Offline" },
      ]);
    });

    test("a non-offline parent does not suppress", () => {
      const result: Array<SuppressingParent> =
        MonitorDependencyRule.getSuppressingParents({
          parents: [parent({ isOfflineState: false })],
          configuredSuppressionStatusIds: empty,
        });

      expect(result).toEqual([]);
    });

    test("falls back to the label 'Offline' when statusName is missing", () => {
      const result: Array<SuppressingParent> =
        MonitorDependencyRule.getSuppressingParents({
          parents: [parent({ statusName: undefined, isOfflineState: true })],
          configuredSuppressionStatusIds: empty,
        });

      expect(result[0]?.statusName).toBe("Offline");
    });
  });

  test("returns only the suppressing subset, preserving input order", () => {
    const result: Array<SuppressingParent> =
      MonitorDependencyRule.getSuppressingParents({
        parents: [
          parent({ monitorId: "a", statusId: "s-offline" }),
          parent({ monitorId: "b", statusId: "s-online" }),
          parent({ monitorId: "c", statusId: "s-offline" }),
        ],
        configuredSuppressionStatusIds: new Set<string>(["s-offline"]),
      });

    expect(
      result.map((p: SuppressingParent) => {
        return p.monitorId;
      }),
    ).toEqual(["a", "c"]);
  });

  test("an empty parent list yields no suppressors", () => {
    expect(
      MonitorDependencyRule.getSuppressingParents({
        parents: [],
        configuredSuppressionStatusIds: new Set<string>(["s-offline"]),
      }),
    ).toEqual([]);
  });
});

describe("MonitorDependencyRule.buildSuppressionReason", () => {
  test("uses the singular noun for a single parent", () => {
    const reason: string = MonitorDependencyRule.buildSuppressionReason([
      { monitorId: "m1", monitorName: "Router", statusName: "Offline" },
    ]);
    expect(reason).toBe('parent monitor "Router" is Offline');
  });

  test("uses the plural noun and comma-joins multiple parents", () => {
    const reason: string = MonitorDependencyRule.buildSuppressionReason([
      { monitorId: "m1", monitorName: "Router", statusName: "Offline" },
      { monitorId: "m2", monitorName: "Switch", statusName: "Degraded" },
    ]);
    expect(reason).toBe(
      'parent monitors "Router" is Offline, "Switch" is Degraded',
    );
  });

  test("quotes each monitor name so odd names stay legible", () => {
    const reason: string = MonitorDependencyRule.buildSuppressionReason([
      {
        monitorId: "m1",
        monitorName: "us-east, primary",
        statusName: "Offline",
      },
    ]);
    // The name itself contains a comma; the quotes keep it from reading as two.
    expect(reason).toBe('parent monitor "us-east, primary" is Offline');
  });

  test("an empty parent list produces the singular stem with no names", () => {
    // Degenerate input still returns a string rather than throwing.
    expect(MonitorDependencyRule.buildSuppressionReason([])).toBe(
      "parent monitor ",
    );
  });
});
