/*
 * WHAT A PROFILE MEASURES, IN ONE PLACE.
 *
 * Profilers name what they sample in their own words: the Go SDK says
 * "cpu" (nanoseconds) and "inuse_space" (bytes), the Node SDK "space",
 * the .NET profiler "alloc_size" and "lock_time", the OpenTelemetry eBPF
 * profiler "samples" (a count), Grafana Alloy "process_cpu". OneUptime
 * stores each profile under the raw name its profiler gave it
 * (Profile.profileType / ProfileSample.profileType), and everything that
 * reads profiles - the Profiler pages, the Profiles monitor, the AI tools,
 * the "Fix with AI" rule - groups those names into a handful of kinds a
 * person recognises:
 *
 *   CPU time      where the processor time goes
 *   Wall time     where the time goes, waiting included
 *   Memory        what holds memory right now
 *   Allocations   what allocates memory (and keeps the garbage collector busy)
 *   Locks         where code waits on a lock
 *   Goroutines    where a Go program's goroutines are parked
 *   Other         anything else, under its own name
 *
 * A kind is read as the raw names that measure it in ONE unit
 * (getAvailableProfileCategories): adding a count of objects to a number
 * of bytes, or eBPF sample counts to nanoseconds, gives a number that
 * means nothing. Memory and allocations are their byte-valued names; the
 * count-valued ones stay reachable one by one.
 *
 * Pure: the server and the Dashboard import it alike.
 */

export enum ProfileCategory {
  Cpu = "cpu",
  Wall = "wall",
  Memory = "memory",
  Allocations = "allocations",
  Locks = "locks",
  Goroutines = "goroutines",
  Other = "other",
}

// The unit a profile's sample values are in.
export enum ProfileValueUnit {
  Nanoseconds = "nanoseconds",
  Bytes = "bytes",
  Count = "count",
}

interface RawProfileType {
  category: ProfileCategory;
  unit: ProfileValueUnit;
}

/*
 * Every raw name OneUptime recognises, with what it measures. Names are
 * matched lower-cased. A name not listed here is Other, in the unit its
 * profile row declares.
 */
const RAW_PROFILE_TYPES: Readonly<Record<string, RawProfileType>> = {
  // CPU time.
  cpu: { category: ProfileCategory.Cpu, unit: ProfileValueUnit.Nanoseconds },
  process_cpu: {
    category: ProfileCategory.Cpu,
    unit: ProfileValueUnit.Nanoseconds,
  },
  cpu_time: {
    category: ProfileCategory.Cpu,
    unit: ProfileValueUnit.Nanoseconds,
  },
  /*
   * One count per sample: what the OpenTelemetry eBPF profiler reports for
   * CPU, at a fixed rate per core - so its share of a window is the share
   * of CPU time.
   */
  samples: { category: ProfileCategory.Cpu, unit: ProfileValueUnit.Count },

  // Wall time.
  wall: { category: ProfileCategory.Wall, unit: ProfileValueUnit.Nanoseconds },

  // Memory in use.
  inuse_space: {
    category: ProfileCategory.Memory,
    unit: ProfileValueUnit.Bytes,
  },
  heap: { category: ProfileCategory.Memory, unit: ProfileValueUnit.Bytes },
  // The Node.js SDK's live heap.
  space: { category: ProfileCategory.Memory, unit: ProfileValueUnit.Bytes },
  inuse_objects: {
    category: ProfileCategory.Memory,
    unit: ProfileValueUnit.Count,
  },
  objects: { category: ProfileCategory.Memory, unit: ProfileValueUnit.Count },

  // Allocations.
  alloc_space: {
    category: ProfileCategory.Allocations,
    unit: ProfileValueUnit.Bytes,
  },
  // The .NET profiler's allocated bytes.
  alloc_size: {
    category: ProfileCategory.Allocations,
    unit: ProfileValueUnit.Bytes,
  },
  alloc_objects: {
    category: ProfileCategory.Allocations,
    unit: ProfileValueUnit.Count,
  },
  alloc_samples: {
    category: ProfileCategory.Allocations,
    unit: ProfileValueUnit.Count,
  },

  // Locks: time spent waiting, then how often.
  delay: {
    category: ProfileCategory.Locks,
    unit: ProfileValueUnit.Nanoseconds,
  },
  lock_time: {
    category: ProfileCategory.Locks,
    unit: ProfileValueUnit.Nanoseconds,
  },
  mutex: {
    category: ProfileCategory.Locks,
    unit: ProfileValueUnit.Nanoseconds,
  },
  block: {
    category: ProfileCategory.Locks,
    unit: ProfileValueUnit.Nanoseconds,
  },
  contention: {
    category: ProfileCategory.Locks,
    unit: ProfileValueUnit.Nanoseconds,
  },
  contentions: {
    category: ProfileCategory.Locks,
    unit: ProfileValueUnit.Count,
  },
  lock_count: { category: ProfileCategory.Locks, unit: ProfileValueUnit.Count },

  // Goroutines.
  goroutine: {
    category: ProfileCategory.Goroutines,
    unit: ProfileValueUnit.Count,
  },
  goroutines: {
    category: ProfileCategory.Goroutines,
    unit: ProfileValueUnit.Count,
  },
};

/*
 * The kinds in the order a person looks for them - also the order the
 * Profiler offers them in.
 */
export const PROFILE_CATEGORY_ORDER: ReadonlyArray<ProfileCategory> = [
  ProfileCategory.Cpu,
  ProfileCategory.Wall,
  ProfileCategory.Memory,
  ProfileCategory.Allocations,
  ProfileCategory.Locks,
  ProfileCategory.Goroutines,
  ProfileCategory.Other,
];

// The kind a person is shown first when it has data.
export const DEFAULT_PROFILE_CATEGORY: ProfileCategory = ProfileCategory.Cpu;

/*
 * Every raw name of a kind, for a read that does not know which of them a
 * scope has. A read that does (the Profiler pages, the AI tools, the
 * Profiles monitor) asks getAvailableProfileCategories instead, which keeps
 * one unit. Other has none: it is always queried one raw name at a time.
 */
const CATEGORY_QUERY_TYPES: Readonly<Record<ProfileCategory, Array<string>>> = {
  [ProfileCategory.Cpu]: ["cpu", "process_cpu", "cpu_time", "samples"],
  [ProfileCategory.Wall]: ["wall"],
  [ProfileCategory.Memory]: ["inuse_space", "heap", "space"],
  [ProfileCategory.Allocations]: ["alloc_space", "alloc_size"],
  [ProfileCategory.Locks]: [
    "delay",
    "lock_time",
    "mutex",
    "block",
    "contention",
  ],
  [ProfileCategory.Goroutines]: ["goroutine", "goroutines"],
  [ProfileCategory.Other]: [],
};

function normalize(rawType: string | null | undefined): string {
  return (rawType || "").toLowerCase().trim();
}

export function isProfileCategory(value: unknown): value is ProfileCategory {
  return (
    typeof value === "string" &&
    (Object.values(ProfileCategory) as Array<string>).includes(value)
  );
}

// The kind a raw profile type belongs to.
export function getProfileCategory(
  rawType: string | null | undefined,
): ProfileCategory {
  const known: RawProfileType | undefined =
    RAW_PROFILE_TYPES[normalize(rawType)];

  return known ? known.category : ProfileCategory.Other;
}

/*
 * The unit a raw profile type's values are in. A name OneUptime does not
 * know is read in the unit its profile row declares, and as a count when
 * that says nothing usable.
 */
export function getProfileValueUnit(
  rawType: string | null | undefined,
  declaredUnit?: string | null | undefined,
): ProfileValueUnit {
  const known: RawProfileType | undefined =
    RAW_PROFILE_TYPES[normalize(rawType)];

  if (known) {
    return known.unit;
  }

  return parseProfileValueUnit(declaredUnit);
}

// A profile row's declared unit, read as one of the three units.
export function parseProfileValueUnit(
  declaredUnit: string | null | undefined,
): ProfileValueUnit {
  switch (normalize(declaredUnit)) {
    case "nanoseconds":
    case "nanosecond":
    case "ns":
      return ProfileValueUnit.Nanoseconds;
    case "bytes":
    case "byte":
      return ProfileValueUnit.Bytes;
    default:
      return ProfileValueUnit.Count;
  }
}

/*
 * The raw names to query for a selection, which is either a kind
 * ("cpu", "memory") or one raw name ("alloc_objects"). A kind expands to
 * its raw names in their main unit; a raw name is queried as itself.
 * Undefined means "do not filter on type".
 */
export function getQueryProfileTypes(
  selection: string | null | undefined,
): Array<string> | undefined {
  const value: string = normalize(selection);

  if (!value) {
    return undefined;
  }

  if (isProfileCategory(value)) {
    const types: Array<string> = CATEGORY_QUERY_TYPES[value];
    return types.length > 0 ? [...types] : undefined;
  }

  return [selection!.trim()];
}

/*
 * One raw type with data in a scope, as the Profiler's activity read
 * reports it (Profile table: profiles and samples per raw type and unit).
 */
export interface ProfileTypeActivity {
  profileType: string;
  unit?: string | undefined;
  sampleCount: number;
  profileCount: number;
}

// One kind with data in a scope, and the raw types it is read as there.
export interface ProfileCategoryAvailability {
  category: ProfileCategory;
  /*
   * The raw names to query for this kind in this scope: those with data,
   * all in one unit. When the kind's data came in two units (a service
   * profiled in nanoseconds next to one profiled in sample counts), the
   * unit with more samples is kept, so a sum never adds one to the other.
   */
  queryTypes: Array<string>;
  unit: ProfileValueUnit;
  sampleCount: number;
  profileCount: number;
}

/*
 * The kinds a scope has data for, in PROFILE_CATEGORY_ORDER, each with the
 * raw types to query it as. Other is listed per raw name ("other:<name>"
 * is not a thing): its raw types each become their own entry, as a person
 * picks one of them by name.
 */
export function getAvailableProfileCategories(
  activity: ReadonlyArray<ProfileTypeActivity>,
): Array<ProfileCategoryAvailability> {
  interface UnitGroup {
    types: Array<string>;
    sampleCount: number;
    profileCount: number;
  }

  const groups: Map<
    ProfileCategory,
    Map<ProfileValueUnit, UnitGroup>
  > = new Map();

  for (const row of activity) {
    const rawType: string = (row.profileType || "").trim();

    if (!rawType || (row.sampleCount || 0) <= 0) {
      continue;
    }

    const category: ProfileCategory = getProfileCategory(rawType);

    if (category === ProfileCategory.Other) {
      continue;
    }

    const unit: ProfileValueUnit = getProfileValueUnit(rawType, row.unit);
    let byUnit: Map<ProfileValueUnit, UnitGroup> | undefined =
      groups.get(category);

    if (!byUnit) {
      byUnit = new Map();
      groups.set(category, byUnit);
    }

    let group: UnitGroup | undefined = byUnit.get(unit);

    if (!group) {
      group = { types: [], sampleCount: 0, profileCount: 0 };
      byUnit.set(unit, group);
    }

    if (!group.types.includes(rawType)) {
      group.types.push(rawType);
    }

    group.sampleCount += Number(row.sampleCount) || 0;
    group.profileCount += Number(row.profileCount) || 0;
  }

  const available: Array<ProfileCategoryAvailability> = [];

  for (const category of PROFILE_CATEGORY_ORDER) {
    const byUnit: Map<ProfileValueUnit, UnitGroup> | undefined =
      groups.get(category);

    if (!byUnit || byUnit.size === 0) {
      continue;
    }

    let bestUnit: ProfileValueUnit | null = null;
    let best: UnitGroup | null = null;

    for (const [unit, group] of byUnit) {
      if (
        !best ||
        group.sampleCount > best.sampleCount ||
        (group.sampleCount === best.sampleCount &&
          unitPreference(unit) < unitPreference(bestUnit!))
      ) {
        best = group;
        bestUnit = unit;
      }
    }

    available.push({
      category,
      queryTypes: [...best!.types].sort(),
      unit: bestUnit!,
      sampleCount: best!.sampleCount,
      profileCount: best!.profileCount,
    });
  }

  return available;
}

/*
 * A list of raw types narrowed to the ones a scope has data for in one
 * unit - the unit with the most samples among them - so a sum over them
 * never adds sample counts to nanoseconds. The list as given when the scope
 * has data for none of them (the read then finds nothing either way).
 */
export function narrowProfileTypesToOneUnit(
  types: ReadonlyArray<string>,
  activity: ReadonlyArray<ProfileTypeActivity>,
): Array<string> {
  const wanted: Set<string> = new Set(types);
  const byUnit: Map<
    ProfileValueUnit,
    { types: Array<string>; samples: number }
  > = new Map();

  for (const row of activity) {
    const rawType: string = (row.profileType || "").trim();

    if (!wanted.has(rawType) || (row.sampleCount || 0) <= 0) {
      continue;
    }

    const unit: ProfileValueUnit = getProfileValueUnit(rawType, row.unit);
    let group: { types: Array<string>; samples: number } | undefined =
      byUnit.get(unit);

    if (!group) {
      group = { types: [], samples: 0 };
      byUnit.set(unit, group);
    }

    if (!group.types.includes(rawType)) {
      group.types.push(rawType);
    }

    group.samples += Number(row.sampleCount) || 0;
  }

  let best: {
    unit: ProfileValueUnit;
    types: Array<string>;
    samples: number;
  } | null = null;

  for (const [unit, group] of byUnit) {
    if (
      !best ||
      group.samples > best.samples ||
      (group.samples === best.samples &&
        unitPreference(unit) < unitPreference(best.unit))
    ) {
      best = { unit, types: group.types, samples: group.samples };
    }
  }

  return best ? [...best.types].sort() : [...types];
}

/*
 * The kind a list of raw types is, when every one of them belongs to the
 * same kind (what the Profiles monitor's form stores for a kind); null
 * for an empty list or a mix.
 */
export function getCategoryOfProfileTypes(
  types: ReadonlyArray<string> | null | undefined,
): ProfileCategory | null {
  if (!types || types.length === 0) {
    return null;
  }

  const categories: Set<ProfileCategory> = new Set(
    types.map((rawType: string): ProfileCategory => {
      return getProfileCategory(rawType);
    }),
  );

  if (categories.size !== 1) {
    return null;
  }

  const category: ProfileCategory = Array.from(categories)[0]!;

  return category === ProfileCategory.Other ? null : category;
}

/*
 * The raw types of a scope that belong to no kind (Other), each its own
 * entry, busiest first.
 */
export function getOtherProfileTypes(
  activity: ReadonlyArray<ProfileTypeActivity>,
): Array<ProfileTypeActivity> {
  const byType: Map<string, ProfileTypeActivity> = new Map();

  for (const row of activity) {
    const rawType: string = (row.profileType || "").trim();

    if (
      !rawType ||
      (row.sampleCount || 0) <= 0 ||
      getProfileCategory(rawType) !== ProfileCategory.Other
    ) {
      continue;
    }

    const existing: ProfileTypeActivity | undefined = byType.get(rawType);

    if (existing) {
      existing.sampleCount += Number(row.sampleCount) || 0;
      existing.profileCount += Number(row.profileCount) || 0;
    } else {
      byType.set(rawType, {
        profileType: rawType,
        unit: row.unit,
        sampleCount: Number(row.sampleCount) || 0,
        profileCount: Number(row.profileCount) || 0,
      });
    }
  }

  return Array.from(byType.values()).sort(
    (a: ProfileTypeActivity, b: ProfileTypeActivity): number => {
      return b.sampleCount - a.sampleCount;
    },
  );
}

// Time first, then bytes, then counts, when two units tie on samples.
function unitPreference(unit: ProfileValueUnit): number {
  switch (unit) {
    case ProfileValueUnit.Nanoseconds:
      return 0;
    case ProfileValueUnit.Bytes:
      return 1;
    default:
      return 2;
  }
}

/*
 * What a kind is called where a sentence names it, in English: the AI
 * tools and the Code task's evidence use these words, and the Dashboard
 * has its own translated labels.
 */
export function getProfileCategoryNoun(category: ProfileCategory): string {
  switch (category) {
    case ProfileCategory.Cpu:
      return "CPU time";
    case ProfileCategory.Wall:
      return "wall time";
    case ProfileCategory.Memory:
      return "memory in use";
    case ProfileCategory.Allocations:
      return "memory allocations";
    case ProfileCategory.Locks:
      return "time waiting on locks";
    case ProfileCategory.Goroutines:
      return "goroutines";
    default:
      return "samples";
  }
}

interface ProfileValueStep {
  // What the figure is followed by: " s", " MB", "K".
  suffix: string;
  // How many of the raw unit one of it is.
  size: number;
}

// Time steps up to hours: a week of CPU time reads "2,016 h", not seconds.
const TIME_STEPS: ReadonlyArray<ProfileValueStep> = [
  { suffix: " ns", size: 1 },
  { suffix: " µs", size: 1_000 },
  { suffix: " ms", size: 1_000_000 },
  { suffix: " s", size: 1_000_000_000 },
  { suffix: " min", size: 60_000_000_000 },
  { suffix: " h", size: 3_600_000_000_000 },
];

const BYTE_STEPS: ReadonlyArray<ProfileValueStep> = [
  { suffix: " B", size: 1 },
  { suffix: " KB", size: 1_024 },
  { suffix: " MB", size: 1_048_576 },
  { suffix: " GB", size: 1_073_741_824 },
  { suffix: " TB", size: 1_099_511_627_776 },
];

const COUNT_STEPS: ReadonlyArray<ProfileValueStep> = [
  { suffix: "", size: 1 },
  { suffix: "K", size: 1_000 },
  { suffix: "M", size: 1_000_000 },
  { suffix: "B", size: 1_000_000_000 },
];

/*
 * A figure with at most three significant digits and no trailing zeros:
 * 124, 54, 9.5, 2.41. A "124.00" or "2.0" reads as a machine's, not a
 * person's; past 999 the figure is grouped ("2,016").
 */
function formatSignificant(amount: number): string {
  if (amount >= 99.5) {
    return Math.round(amount).toLocaleString("en-US");
  }

  return String(Number(amount.toFixed(amount >= 9.95 ? 1 : 2)));
}

function formatInSteps(
  value: number,
  steps: ReadonlyArray<ProfileValueStep>,
): string {
  for (let index: number = 0; index < steps.length; index++) {
    const step: ProfileValueStep = steps[index]!;
    const next: ProfileValueStep | undefined = steps[index + 1];
    const amount: number = value / step.size;

    // A step holds its figure while it reads under 1,000 once rounded.
    if (!next || amount < 999.5) {
      return `${
        index === 0
          ? Math.round(amount).toLocaleString("en-US")
          : formatSignificant(amount)
      }${step.suffix}`;
    }
  }

  return `${Math.round(value)}`;
}

/*
 * A raw value in its unit as a person reads it, in English: "2.41 s",
 * "124 s", "16.7 min", "12.5 MB", "1.23K". The Dashboard's profile pages
 * format with this too (ProfileUtil.formatProfileValue).
 */
export function formatProfileValue(
  value: number,
  unit: ProfileValueUnit,
): string {
  const safe: number = Number.isFinite(value) ? Math.max(0, value) : 0;

  if (unit === ProfileValueUnit.Nanoseconds) {
    return formatInSteps(safe, TIME_STEPS);
  }

  if (unit === ProfileValueUnit.Bytes) {
    return formatInSteps(safe, BYTE_STEPS);
  }

  return formatInSteps(safe, COUNT_STEPS);
}

// A share (0-100) as a person reads it: "41%", "3.2%", "<0.1%".
export function formatProfileShare(percent: number): string {
  if (!Number.isFinite(percent)) {
    return "-";
  }
  if (percent <= 0) {
    return "0%";
  }
  if (percent < 0.1) {
    return "<0.1%";
  }
  if (percent < 10) {
    return `${percent.toFixed(1)}%`;
  }
  return `${Math.round(percent)}%`;
}
