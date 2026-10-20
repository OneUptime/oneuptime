import { describe, expect, test } from "@jest/globals";
import {
  DEFAULT_PROFILE_CATEGORY,
  PROFILE_CATEGORY_ORDER,
  ProfileCategory,
  ProfileCategoryAvailability,
  ProfileTypeActivity,
  ProfileValueUnit,
  formatProfileShare,
  formatProfileValue,
  getAvailableProfileCategories,
  getOtherProfileTypes,
  getProfileCategory,
  getProfileCategoryNoun,
  getProfileValueUnit,
  getQueryProfileTypes,
  isProfileCategory,
  parseProfileValueUnit,
} from "../../../Utils/Profiles/ProfileTypes";

/*
 * What each profiler's raw type names mean, and how the Profiler reads a
 * kind of profile in one unit. The raw names come from the profilers
 * OneUptime ingests: the Go, Node.js, .NET, Python and Ruby Pyroscope SDKs,
 * Grafana Alloy, and the OpenTelemetry eBPF profiler the Kubernetes agent
 * runs.
 */

describe("getProfileCategory", () => {
  test.each([
    // Go CPU and Grafana Alloy.
    ["cpu", ProfileCategory.Cpu],
    ["process_cpu", ProfileCategory.Cpu],
    // The OpenTelemetry eBPF profiler's one count per sample.
    ["samples", ProfileCategory.Cpu],
    ["wall", ProfileCategory.Wall],
    // Go heap: live bytes and objects.
    ["inuse_space", ProfileCategory.Memory],
    ["inuse_objects", ProfileCategory.Memory],
    // The Node.js SDK's live heap.
    ["space", ProfileCategory.Memory],
    ["objects", ProfileCategory.Memory],
    ["heap", ProfileCategory.Memory],
    // Go and .NET allocations.
    ["alloc_space", ProfileCategory.Allocations],
    ["alloc_objects", ProfileCategory.Allocations],
    ["alloc_size", ProfileCategory.Allocations],
    ["alloc_samples", ProfileCategory.Allocations],
    // Go mutex and block profiles, the .NET lock profiler.
    ["delay", ProfileCategory.Locks],
    ["contentions", ProfileCategory.Locks],
    ["mutex", ProfileCategory.Locks],
    ["block", ProfileCategory.Locks],
    ["lock_time", ProfileCategory.Locks],
    ["lock_count", ProfileCategory.Locks],
    ["goroutine", ProfileCategory.Goroutines],
    ["goroutines", ProfileCategory.Goroutines],
  ])("reads %s as %s", (rawType: string, category: ProfileCategory) => {
    expect(getProfileCategory(rawType)).toBe(category);
  });

  test("reads names in any case and with stray spaces", () => {
    expect(getProfileCategory("  CPU ")).toBe(ProfileCategory.Cpu);
    expect(getProfileCategory("Inuse_Space")).toBe(ProfileCategory.Memory);
  });

  test("a name OneUptime does not know is Other", () => {
    expect(getProfileCategory("exception")).toBe(ProfileCategory.Other);
    expect(getProfileCategory("my_custom_type")).toBe(ProfileCategory.Other);
    expect(getProfileCategory("")).toBe(ProfileCategory.Other);
    expect(getProfileCategory(undefined)).toBe(ProfileCategory.Other);
    expect(getProfileCategory(null)).toBe(ProfileCategory.Other);
  });
});

describe("getProfileValueUnit", () => {
  test.each([
    ["cpu", ProfileValueUnit.Nanoseconds],
    ["wall", ProfileValueUnit.Nanoseconds],
    ["delay", ProfileValueUnit.Nanoseconds],
    ["lock_time", ProfileValueUnit.Nanoseconds],
    ["samples", ProfileValueUnit.Count],
    ["inuse_space", ProfileValueUnit.Bytes],
    ["space", ProfileValueUnit.Bytes],
    ["alloc_size", ProfileValueUnit.Bytes],
    ["inuse_objects", ProfileValueUnit.Count],
    ["contentions", ProfileValueUnit.Count],
    ["goroutine", ProfileValueUnit.Count],
  ])("%s is measured in %s", (rawType: string, unit: ProfileValueUnit) => {
    expect(getProfileValueUnit(rawType)).toBe(unit);
  });

  test("a known name's unit wins over what its row declares", () => {
    expect(getProfileValueUnit("cpu", "count")).toBe(
      ProfileValueUnit.Nanoseconds,
    );
  });

  test("an unknown name is read in the unit its row declares", () => {
    expect(getProfileValueUnit("custom_time", "nanoseconds")).toBe(
      ProfileValueUnit.Nanoseconds,
    );
    expect(getProfileValueUnit("custom_bytes", "bytes")).toBe(
      ProfileValueUnit.Bytes,
    );
    expect(getProfileValueUnit("custom", "")).toBe(ProfileValueUnit.Count);
    expect(getProfileValueUnit("custom", undefined)).toBe(
      ProfileValueUnit.Count,
    );
  });

  test("parseProfileValueUnit reads the spellings profilers use", () => {
    expect(parseProfileValueUnit("ns")).toBe(ProfileValueUnit.Nanoseconds);
    expect(parseProfileValueUnit("Nanosecond")).toBe(
      ProfileValueUnit.Nanoseconds,
    );
    expect(parseProfileValueUnit("byte")).toBe(ProfileValueUnit.Bytes);
    expect(parseProfileValueUnit("objects")).toBe(ProfileValueUnit.Count);
  });
});

describe("getQueryProfileTypes", () => {
  test("nothing picked reads every type", () => {
    expect(getQueryProfileTypes(undefined)).toBeUndefined();
    expect(getQueryProfileTypes("")).toBeUndefined();
    expect(getQueryProfileTypes("   ")).toBeUndefined();
  });

  test("a kind expands to the raw names that measure it", () => {
    expect(getQueryProfileTypes("cpu")).toEqual([
      "cpu",
      "process_cpu",
      "cpu_time",
      "samples",
    ]);
    expect(getQueryProfileTypes("memory")).toEqual([
      "inuse_space",
      "heap",
      "space",
    ]);
    expect(getQueryProfileTypes("allocations")).toEqual([
      "alloc_space",
      "alloc_size",
    ]);
    expect(getQueryProfileTypes("wall")).toEqual(["wall"]);
    expect(getQueryProfileTypes("goroutines")).toEqual([
      "goroutine",
      "goroutines",
    ]);
  });

  test("memory and allocations are read in bytes only: objects are never added to bytes", () => {
    for (const category of [
      ProfileCategory.Memory,
      ProfileCategory.Allocations,
    ]) {
      for (const rawType of getQueryProfileTypes(category)!) {
        expect(getProfileValueUnit(rawType)).toBe(ProfileValueUnit.Bytes);
      }
    }
  });

  test("a raw name is read as itself", () => {
    expect(getQueryProfileTypes("alloc_objects")).toEqual(["alloc_objects"]);
    expect(getQueryProfileTypes(" my_type ")).toEqual(["my_type"]);
  });

  test("Other is never queried as a kind: it has no names of its own", () => {
    expect(getQueryProfileTypes("other")).toBeUndefined();
  });

  test("every raw name a kind expands to belongs to that kind", () => {
    for (const category of PROFILE_CATEGORY_ORDER) {
      for (const rawType of getQueryProfileTypes(category) || []) {
        expect({ rawType, category: getProfileCategory(rawType) }).toEqual({
          rawType,
          category,
        });
      }
    }
  });
});

describe("getAvailableProfileCategories", () => {
  test("lists the kinds a scope has data for, in the order a person looks for them", () => {
    const activity: Array<ProfileTypeActivity> = [
      { profileType: "inuse_space", unit: "bytes", sampleCount: 40, profileCount: 4 },
      { profileType: "goroutine", unit: "count", sampleCount: 5, profileCount: 1 },
      { profileType: "cpu", unit: "nanoseconds", sampleCount: 900, profileCount: 30 },
      { profileType: "wall", unit: "nanoseconds", sampleCount: 300, profileCount: 30 },
    ];

    expect(
      getAvailableProfileCategories(activity).map(
        (entry: ProfileCategoryAvailability) => {
          return entry.category;
        },
      ),
    ).toEqual([
      ProfileCategory.Cpu,
      ProfileCategory.Wall,
      ProfileCategory.Memory,
      ProfileCategory.Goroutines,
    ]);
  });

  test("CPU time from the eBPF agent (counts) next to an SDK (nanoseconds) is read in the unit with more samples", () => {
    const available: Array<ProfileCategoryAvailability> =
      getAvailableProfileCategories([
        { profileType: "cpu", unit: "nanoseconds", sampleCount: 100, profileCount: 10 },
        { profileType: "samples", unit: "count", sampleCount: 5000, profileCount: 50 },
      ]);

    expect(available).toEqual([
      {
        category: ProfileCategory.Cpu,
        queryTypes: ["samples"],
        unit: ProfileValueUnit.Count,
        sampleCount: 5000,
        profileCount: 50,
      },
    ]);
  });

  test("one unit's raw names are read together", () => {
    const available: Array<ProfileCategoryAvailability> =
      getAvailableProfileCategories([
        { profileType: "process_cpu", unit: "nanoseconds", sampleCount: 30, profileCount: 3 },
        { profileType: "cpu", unit: "nanoseconds", sampleCount: 70, profileCount: 7 },
      ]);

    expect(available[0]).toEqual({
      category: ProfileCategory.Cpu,
      queryTypes: ["cpu", "process_cpu"],
      unit: ProfileValueUnit.Nanoseconds,
      sampleCount: 100,
      profileCount: 10,
    });
  });

  test("a tie in samples keeps time over bytes over counts", () => {
    const available: Array<ProfileCategoryAvailability> =
      getAvailableProfileCategories([
        { profileType: "samples", unit: "count", sampleCount: 50, profileCount: 5 },
        { profileType: "cpu", unit: "nanoseconds", sampleCount: 50, profileCount: 5 },
      ]);

    expect(available[0]!.unit).toBe(ProfileValueUnit.Nanoseconds);
    expect(available[0]!.queryTypes).toEqual(["cpu"]);
  });

  test("memory read in bytes leaves the object counts for a pick of their own", () => {
    const available: Array<ProfileCategoryAvailability> =
      getAvailableProfileCategories([
        { profileType: "inuse_space", unit: "bytes", sampleCount: 10, profileCount: 1 },
        { profileType: "inuse_objects", unit: "count", sampleCount: 9, profileCount: 1 },
      ]);

    expect(available).toEqual([
      {
        category: ProfileCategory.Memory,
        queryTypes: ["inuse_space"],
        unit: ProfileValueUnit.Bytes,
        sampleCount: 10,
        profileCount: 1,
      },
    ]);
  });

  test("types with no samples, no name, and Other types are not kinds", () => {
    expect(
      getAvailableProfileCategories([
        { profileType: "cpu", unit: "nanoseconds", sampleCount: 0, profileCount: 2 },
        { profileType: "", unit: "bytes", sampleCount: 10, profileCount: 1 },
        { profileType: "exception", unit: "count", sampleCount: 10, profileCount: 1 },
      ]),
    ).toEqual([]);
  });

  test("an empty scope has no kinds", () => {
    expect(getAvailableProfileCategories([])).toEqual([]);
  });

  test("the default kind is CPU time", () => {
    expect(DEFAULT_PROFILE_CATEGORY).toBe(ProfileCategory.Cpu);
  });
});

describe("getOtherProfileTypes", () => {
  test("lists the types no kind holds, busiest first, each once", () => {
    expect(
      getOtherProfileTypes([
        { profileType: "cpu", unit: "nanoseconds", sampleCount: 999, profileCount: 9 },
        { profileType: "exception", unit: "count", sampleCount: 4, profileCount: 1 },
        { profileType: "custom", unit: "count", sampleCount: 10, profileCount: 2 },
        { profileType: "exception", unit: "count", sampleCount: 7, profileCount: 1 },
      ]),
    ).toEqual([
      { profileType: "exception", unit: "count", sampleCount: 11, profileCount: 2 },
      { profileType: "custom", unit: "count", sampleCount: 10, profileCount: 2 },
    ]);
  });
});

describe("isProfileCategory", () => {
  test("knows the kinds and nothing else", () => {
    for (const category of Object.values(ProfileCategory)) {
      expect(isProfileCategory(category)).toBe(true);
    }
    expect(isProfileCategory("CPU")).toBe(false);
    expect(isProfileCategory("inuse_space")).toBe(false);
    expect(isProfileCategory(3)).toBe(false);
  });
});

describe("words and numbers", () => {
  test("every kind has a noun for a sentence", () => {
    for (const category of Object.values(ProfileCategory)) {
      expect(getProfileCategoryNoun(category).length).toBeGreaterThan(0);
    }
    expect(getProfileCategoryNoun(ProfileCategory.Cpu)).toBe("CPU time");
    expect(getProfileCategoryNoun(ProfileCategory.Allocations)).toBe(
      "memory allocations",
    );
  });

  test.each([
    [2_410_000_000, ProfileValueUnit.Nanoseconds, "2.41 s"],
    [12_500_000, ProfileValueUnit.Nanoseconds, "12.5 ms"],
    [4_200, ProfileValueUnit.Nanoseconds, "4.2 µs"],
    [17, ProfileValueUnit.Nanoseconds, "17 ns"],
    [3 * 1_073_741_824, ProfileValueUnit.Bytes, "3.00 GB"],
    [12.5 * 1_048_576, ProfileValueUnit.Bytes, "12.50 MB"],
    [2_048, ProfileValueUnit.Bytes, "2.0 KB"],
    [100, ProfileValueUnit.Bytes, "100 B"],
    [2_500_000, ProfileValueUnit.Count, "2.5M"],
    [1_234, ProfileValueUnit.Count, "1.2K"],
    [7, ProfileValueUnit.Count, "7"],
  ])(
    "formats %d %s as %s",
    (value: number, unit: ProfileValueUnit, text: string) => {
      expect(formatProfileValue(value, unit)).toBe(text);
    },
  );

  test("a value that is not a number reads as nothing", () => {
    expect(formatProfileValue(Number.NaN, ProfileValueUnit.Bytes)).toBe("0 B");
    expect(formatProfileValue(-5, ProfileValueUnit.Count)).toBe("0");
  });

  test.each([
    [41.3, "41%"],
    [3.25, "3.3%"],
    [0.05, "<0.1%"],
    [0, "0%"],
    [-2, "0%"],
    [Number.NaN, "-"],
  ])("formats a share of %d as %s", (percent: number, text: string) => {
    expect(formatProfileShare(percent)).toBe(text);
  });
});
