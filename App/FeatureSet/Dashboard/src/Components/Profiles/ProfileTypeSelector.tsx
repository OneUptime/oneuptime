import React, { FunctionComponent, ReactElement } from "react";
import ProfileUtil, { ProfileCategory } from "../../Utils/ProfileUtil";

export interface ProfileTypeSelectorProps {
  selectedProfileType: string | undefined;
  onChange: (profileType: string | undefined) => void;
  /**
   * When true, show the extended list (including Wall time, Goroutines)
   * in a secondary dropdown. Defaults to false: the three primary pills
   * are enough for most users.
   */
  showAdvanced?: boolean | undefined;
}

interface Pill {
  label: string;
  description: string;
  /*
   * The profileType value sent to the backend. `undefined` means "any".
   * For Memory we pick `inuse_space` as the canonical representative;
   * the backend can aggregate across all memory subtypes at a later date.
   */
  value: string | undefined;
  category: ProfileCategory | "all";
  icon: string;
}

/*
 * The three pills are the primary mental model for "what am I looking
 * at". Anything more specific goes into the advanced dropdown.
 */
const PRIMARY_PILLS: Array<Pill> = [
  {
    label: "Everything",
    description: "All profile types",
    value: undefined,
    category: "all",
    icon: "●",
  },
  {
    label: "CPU time",
    description: "Where CPU cycles are being spent",
    value: "cpu",
    category: "cpu",
    icon: "⚡",
  },
  {
    label: "Memory",
    description: "What's holding or allocating memory",
    value: "inuse_space",
    category: "memory",
    icon: "◧",
  },
  {
    label: "Locks",
    description: "Where code is waiting on locks",
    value: "mutex",
    category: "locks",
    icon: "⏸",
  },
];

const ADVANCED_OPTIONS: Array<{ label: string; value: string }> = [
  { label: "CPU samples", value: "samples" },
  { label: "Wall time", value: "wall" },
  { label: "Memory (live objects)", value: "inuse_objects" },
  { label: "Memory (live bytes)", value: "inuse_space" },
  { label: "Allocations (count)", value: "alloc_objects" },
  { label: "Allocations (bytes)", value: "alloc_space" },
  { label: "Heap memory", value: "heap" },
  { label: "Goroutines", value: "goroutine" },
  { label: "Mutex contention", value: "mutex" },
  { label: "Lock contention", value: "contention" },
  { label: "Blocking operations", value: "block" },
];

const ProfileTypeSelector: FunctionComponent<ProfileTypeSelectorProps> = (
  props: ProfileTypeSelectorProps,
): ReactElement => {
  const selectedCategory: ProfileCategory | "all" = props.selectedProfileType
    ? ProfileUtil.getProfileCategory(props.selectedProfileType)
    : "all";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex items-center rounded-lg border border-gray-200 bg-gray-50 p-1">
        {PRIMARY_PILLS.map((pill: Pill) => {
          const isActive: boolean =
            (pill.value === undefined && !props.selectedProfileType) ||
            (pill.category !== "all" && pill.category === selectedCategory);

          return (
            <button
              key={pill.label}
              type="button"
              title={pill.description}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                isActive
                  ? "bg-white text-gray-900 shadow-sm ring-1 ring-gray-200"
                  : "text-gray-600 hover:text-gray-900"
              }`}
              onClick={() => {
                props.onChange(pill.value);
              }}
            >
              <span className="mr-1.5 text-gray-400">{pill.icon}</span>
              {pill.label}
            </button>
          );
        })}
      </div>

      {props.showAdvanced !== false && (
        <select
          className="px-3 py-1.5 text-sm border border-gray-300 rounded-md bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          value={props.selectedProfileType || ""}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
            const value: string = e.target.value;
            props.onChange(value === "" ? undefined : value);
          }}
          title="Pick a specific profile type"
        >
          <option value="">Specific type…</option>
          {ADVANCED_OPTIONS.map(
            (option: { label: string; value: string }, index: number) => {
              return (
                <option key={index} value={option.value}>
                  {option.label}
                </option>
              );
            },
          )}
        </select>
      )}
    </div>
  );
};

export default ProfileTypeSelector;
