import MaterializedShiftUtil, {
  MaterializedShift,
  MaterializedShiftJson,
} from "../../../Types/OnCallDutyPolicy/MaterializedShift";
import { at, shift } from "./CalendarFeedTestFixtures";

describe("MaterializedShiftUtil.toJSON / fromJSON", () => {
  test("round-trips a shift with every optional field", () => {
    const full: MaterializedShift = shift({
      start: at("2026-09-01T07:00:00Z"),
      end: at("2026-09-01T15:00:00Z"),
      projectName: "Acme",
      layerId: "layer-1",
      layerName: "Primary",
      override: {
        originalUserId: "user-b",
        originalUserName: "Bob",
        overrideStartsAt: at("2026-09-01T06:00:00Z"),
        overrideEndsAt: at("2026-09-01T18:00:00Z"),
        onCallDutyPolicyId: "pol-1",
      },
      policyVariantOf: {
        policyId: "pol-1",
        policyName: "Payments Policy",
        globalUserId: "user-b",
      },
      isPast: true,
    });

    const json: MaterializedShiftJson = MaterializedShiftUtil.toJSON(full);

    expect(json.start).toBe("2026-09-01T07:00:00.000Z");
    expect(json.end).toBe("2026-09-01T15:00:00.000Z");
    expect(json.lastModifiedAt).toBe("2026-08-01T10:00:00.000Z");
    expect(json.scheduleTimezone).toBe("Europe/Stockholm");
    expect(json.override!.overrideStartsAt).toBe("2026-09-01T06:00:00.000Z");
    expect(json.override!.onCallDutyPolicyId).toBe("pol-1");
    expect(json.policyVariantOf).toEqual(full.policyVariantOf);

    // It is plain JSON: a serialize/parse cycle changes nothing.
    const reparsed: MaterializedShiftJson = JSON.parse(JSON.stringify(json));
    const back: MaterializedShift = MaterializedShiftUtil.fromJSON(reparsed);

    expect(back).toEqual(full);
    expect(back.start).toBeInstanceOf(Date);
    expect(back.override!.overrideEndsAt).toBeInstanceOf(Date);
  });

  test("omits optional keys that are absent instead of writing undefined", () => {
    const minimal: MaterializedShift = shift({
      start: at("2026-09-01T07:00:00Z"),
      end: at("2026-09-01T15:00:00Z"),
      scheduleTimezone: undefined,
    });

    const json: MaterializedShiftJson = MaterializedShiftUtil.toJSON(minimal);

    expect("projectName" in json).toBe(false);
    expect("layerId" in json).toBe(false);
    expect("layerName" in json).toBe(false);
    expect("override" in json).toBe(false);
    expect("policyVariantOf" in json).toBe(false);
    expect(json.scheduleTimezone).toBeNull();

    const back: MaterializedShift = MaterializedShiftUtil.fromJSON(json);

    expect("scheduleTimezone" in back).toBe(false);
    expect("override" in back).toBe(false);
    expect("layerId" in back).toBe(false);
    expect(back).toEqual(minimal);
  });

  test("a global override has no onCallDutyPolicyId key on either side", () => {
    const withGlobal: MaterializedShift = shift({
      start: at("2026-09-01T07:00:00Z"),
      end: at("2026-09-01T15:00:00Z"),
      override: {
        originalUserId: "user-b",
        originalUserName: "Bob",
        overrideStartsAt: at("2026-09-01T06:00:00Z"),
        overrideEndsAt: at("2026-09-01T18:00:00Z"),
      },
    });

    const json: MaterializedShiftJson =
      MaterializedShiftUtil.toJSON(withGlobal);
    expect("onCallDutyPolicyId" in json.override!).toBe(false);

    const back: MaterializedShift = MaterializedShiftUtil.fromJSON(json);
    expect("onCallDutyPolicyId" in back.override!).toBe(false);
  });

  test("toJSON copies the policies array so later mutation does not leak", () => {
    const source: MaterializedShift = shift({
      start: at("2026-09-01T07:00:00Z"),
      end: at("2026-09-01T15:00:00Z"),
    });

    const json: MaterializedShiftJson = MaterializedShiftUtil.toJSON(source);
    json.policies[0]!.policyName = "changed";

    expect(source.policies[0]!.policyName).toBe("Payments Policy");
  });

  test("fromJSON tolerates a missing policies array", () => {
    const json: MaterializedShiftJson = MaterializedShiftUtil.toJSON(
      shift({
        start: at("2026-09-01T07:00:00Z"),
        end: at("2026-09-01T15:00:00Z"),
      }),
    );
    delete (json as Partial<MaterializedShiftJson>).policies;

    expect(MaterializedShiftUtil.fromJSON(json).policies).toEqual([]);
  });

  test("array helpers map element-wise", () => {
    const shifts: Array<MaterializedShift> = [
      shift({
        start: at("2026-09-01T07:00:00Z"),
        end: at("2026-09-01T15:00:00Z"),
      }),
      shift({
        start: at("2026-09-02T07:00:00Z"),
        end: at("2026-09-02T15:00:00Z"),
        userId: "user-b",
        userName: "Bob",
      }),
    ];

    const json: Array<MaterializedShiftJson> =
      MaterializedShiftUtil.toJSONArray(shifts);
    expect(json).toHaveLength(2);
    expect(json[1]!.userId).toBe("user-b");

    expect(MaterializedShiftUtil.fromJSONArray(json)).toEqual(shifts);
  });
});

describe("MaterializedShiftUtil.sortByStart", () => {
  test("orders by start, then schedule id, then shift key, without mutating the input", () => {
    const later: MaterializedShift = shift({
      start: at("2026-09-02T07:00:00Z"),
      end: at("2026-09-02T15:00:00Z"),
    });
    const schedB: MaterializedShift = shift({
      start: at("2026-09-01T07:00:00Z"),
      end: at("2026-09-01T15:00:00Z"),
      scheduleId: "sched-b",
    });
    const schedA: MaterializedShift = shift({
      start: at("2026-09-01T07:00:00Z"),
      end: at("2026-09-01T15:00:00Z"),
      scheduleId: "sched-a",
    });
    const schedAVariant: MaterializedShift = shift({
      start: at("2026-09-01T07:00:00Z"),
      end: at("2026-09-01T15:00:00Z"),
      scheduleId: "sched-a",
      policyVariantOf: {
        policyId: "pol-9",
        policyName: "P9",
        globalUserId: "user-a",
      },
    });

    const input: Array<MaterializedShift> = [
      later,
      schedB,
      schedAVariant,
      schedA,
    ];
    const sorted: Array<MaterializedShift> =
      MaterializedShiftUtil.sortByStart(input);

    expect(sorted).toEqual([schedA, schedAVariant, schedB, later]);
    expect(input).toEqual([later, schedB, schedAVariant, schedA]);
  });
});

describe("MaterializedShiftUtil.buildShiftKey", () => {
  test("is schedule:epochSeconds, plus the policy id for variants", () => {
    const start: Date = at("2026-09-01T07:00:00.900Z");
    const epoch: number = Math.floor(start.getTime() / 1000);

    expect(
      MaterializedShiftUtil.buildShiftKey({ scheduleId: "s1", start }),
    ).toBe(`s1:${epoch}`);
    expect(
      MaterializedShiftUtil.buildShiftKey({
        scheduleId: "s1",
        start,
        policyId: "p1",
      }),
    ).toBe(`s1:${epoch}:p1`);
  });
});
