import { describe, expect, test } from "@jest/globals";
import {
  CLOUD_COST_MAX_TAGS,
  CLOUD_COST_SUMMARY_TAG_KEYS,
  CLOUD_COST_TAG_KEY_MAX_LENGTH,
  CLOUD_COST_TAG_VALUE_MAX_LENGTH,
  CloudAccountCostSummary,
  CloudCostState,
  CloudCostTagKey,
  getCloudCostTagsKey,
  normalizeCloudCostTags,
  readCloudAccountCostSummary,
  summarizeCloudCostTagKeys,
} from "../../../Types/Cloud/CloudCost";

/*
 * The tags a cost keeps: as text, trimmed and cut, keys in order so one
 * set is always written the same way (and its costs are one series); which
 * of them an account's costs carry, the costliest first, on its summary;
 * and what a stored summary says of tags and of AWS's costs per resource.
 */

describe("a cost's tags, as they are kept", () => {
  test("keys in order, keys and values trimmed, empty keys left out, values as text", () => {
    const tags: Record<string, string> = normalizeCloudCostTags({
      " team ": " payments ",
      env: "prod",
      "": "nobody",
      "   ": "nobody",
      cost_center: 4021 as unknown as string,
      archived: false as unknown as string,
      owner: null as unknown as string,
    });

    expect(Object.keys(tags)).toEqual([
      "archived",
      "cost_center",
      "env",
      "owner",
      "team",
    ]);
    expect(tags).toEqual({
      archived: "false",
      cost_center: "4021",
      env: "prod",
      owner: "",
      team: "payments",
    });
  });

  test("none, or not an object, is no tags", () => {
    expect(normalizeCloudCostTags(undefined)).toEqual({});
    expect(normalizeCloudCostTags(null)).toEqual({});
    expect(
      normalizeCloudCostTags(["a", "b"] as unknown as Record<string, string>),
    ).toEqual({});
  });

  test(`at most ${CLOUD_COST_MAX_TAGS}, each key and value cut to its length`, () => {
    const many: Record<string, string> = {};

    for (let index: number = 0; index < 70; index++) {
      many[`key-${String(index).padStart(2, "0")}`] = "v";
    }

    const kept: Record<string, string> = normalizeCloudCostTags(many);

    expect(Object.keys(kept)).toHaveLength(CLOUD_COST_MAX_TAGS);
    expect(Object.keys(kept)[0]).toBe("key-00");
    expect(Object.keys(kept)[CLOUD_COST_MAX_TAGS - 1]).toBe("key-49");

    const long: Record<string, string> = normalizeCloudCostTags({
      ["k".repeat(500)]: "v".repeat(900),
    });
    const [key, value] = Object.entries(long)[0]!;

    expect(key).toHaveLength(CLOUD_COST_TAG_KEY_MAX_LENGTH);
    expect(value).toHaveLength(CLOUD_COST_TAG_VALUE_MAX_LENGTH);
  });

  test("one set of tags is one text, however its keys were ordered", () => {
    expect(getCloudCostTagsKey({ team: "a", env: "prod" })).toBe(
      getCloudCostTagsKey({ env: "prod", team: "a" }),
    );
    expect(getCloudCostTagsKey({ team: "a" })).not.toBe(
      getCloudCostTagsKey({ team: "b" }),
    );
    expect(getCloudCostTagsKey({})).toBe("[]");
  });
});

describe("the tags an account's costs carry", () => {
  test("each key by what the costs that carry it cost, the costliest first, ties by key", () => {
    const keys: Array<CloudCostTagKey> = summarizeCloudCostTagKeys([
      { tags: { team: "web", env: "prod" }, amount: 100 },
      { tags: { team: "data" }, amount: 40 },
      { tags: { owner: "ana" }, amount: 40 },
      { tags: {}, amount: 999 },
      { amount: 5 },
      // A correction that leaves a key's costs at nothing drops it.
      { tags: { retired: "yes" }, amount: 3 },
      { tags: { retired: "yes" }, amount: -3 },
    ]);

    expect(keys).toEqual([
      { key: "team", amount: 140 },
      { key: "env", amount: 100 },
      { key: "owner", amount: 40 },
    ]);
  });

  test(`at most ${CLOUD_COST_SUMMARY_TAG_KEYS}`, () => {
    const points: Array<{ tags: Record<string, string>; amount: number }> =
      Array.from({ length: 40 }, (_: unknown, index: number) => {
        return { tags: { [`key-${index}`]: "v" }, amount: index + 1 };
      });

    const keys: Array<CloudCostTagKey> = summarizeCloudCostTagKeys(points);

    expect(keys).toHaveLength(CLOUD_COST_SUMMARY_TAG_KEYS);
    expect(keys[0]).toEqual({ key: "key-39", amount: 40 });
  });
});

describe("a stored cost summary, read back", () => {
  const BASE: Record<string, unknown> = {
    state: "reading",
    currency: "USD",
    monthToDate: 100,
    lastMonth: 200,
    monthFullDays: 90,
    lastMonthToDate: 80,
    projectedMonth: 210,
    last30Days: 190,
    topServices: [],
    readAt: "2026-11-20T06:00:00.000Z",
  };

  test("its tags, the well-formed ones", () => {
    const read: CloudAccountCostSummary | null = readCloudAccountCostSummary({
      ...BASE,
      tagKeys: [
        { key: "team", amount: "140.5" },
        { key: "", amount: 3 },
        { amount: 9 },
        "env",
        { key: "env", amount: "x" },
      ],
    });

    expect(read!.tagKeys).toEqual([
      { key: "team", amount: 140.5 },
      { key: "env", amount: 0 },
    ]);
    // Written before costs kept their tags: none said.
    expect(readCloudAccountCostSummary(BASE)!.tagKeys).toBeUndefined();
  });

  test("whether AWS's costs per resource could be read, and why not", () => {
    expect(
      readCloudAccountCostSummary({
        ...BASE,
        resources: {
          state: "not-allowed",
          message:
            "The role may not read costs per resource (ce:GetCostAndUsageWithResources). Run the setup command again to allow it.",
        },
      })!.resources,
    ).toEqual({
      state: CloudCostState.NotAllowed,
      message:
        "The role may not read costs per resource (ce:GetCostAndUsageWithResources). Run the setup command again to allow it.",
    });
    expect(
      readCloudAccountCostSummary({
        ...BASE,
        resources: { state: "reading", message: "" },
      })!.resources,
    ).toEqual({ state: CloudCostState.Reading, message: undefined });
    // Not one of the states: nothing said.
    expect(
      readCloudAccountCostSummary({ ...BASE, resources: { state: "maybe" } })!
        .resources,
    ).toBeUndefined();
    expect(
      readCloudAccountCostSummary({ ...BASE, resources: "reading" })!.resources,
    ).toBeUndefined();
    expect(readCloudAccountCostSummary(BASE)!.resources).toBeUndefined();
  });
});
