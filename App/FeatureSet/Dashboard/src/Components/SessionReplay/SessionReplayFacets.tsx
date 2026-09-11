import React, { FunctionComponent, ReactElement, useMemo } from "react";
import IconProp from "Common/Types/Icon/IconProp";
import SessionReplayTriggerReason from "Common/Types/Rum/SessionReplayTriggerReason";
import { Countries, CountryOption } from "Common/UI/Utils/Countries";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import FilterChipDropdown from "../ResourceOwners/FilterChipDropdown";
import { FilterChipDropdownOption } from "../ResourceOwners/FilterChipDropdownTypes";
import {
  SessionReplayAdvancedFilters,
  SESSION_REPLAY_SIGNAL_OPTIONS,
  SessionReplaySignalOption,
} from "./SessionReplayListFilters";
import {
  DEVICE_TYPE_OPTIONS,
  TRIGGER_REASON_OPTIONS,
} from "./SessionReplayFilterFields";
import { SessionReplaySummary } from "./SessionReplayTable";

export type SessionReplayFacetField =
  | "browserName"
  | "osName"
  | "deviceType"
  | "countryCode"
  | "triggerReason"
  | "minDurationSeconds";

export interface SessionReplayFacet {
  field: SessionReplayFacetField;
  label: string;
  options: Array<FilterChipDropdownOption>;
}

const toOptions: (values: Array<string>) => Array<FilterChipDropdownOption> = (
  values: Array<string>,
): Array<FilterChipDropdownOption> => {
  return values.map((value: string): FilterChipDropdownOption => {
    return { value, label: value };
  });
};
const fromDropdownOptions: (
  values: Array<DropdownOption>,
) => Array<FilterChipDropdownOption> = (
  values: Array<DropdownOption>,
): Array<FilterChipDropdownOption> => {
  return values.map((option: DropdownOption): FilterChipDropdownOption => {
    return {
      value: option.value.toString(),
      label: option.label,
    };
  });
};

export const SESSION_REPLAY_FACETS: Array<SessionReplayFacet> = [
  {
    field: "browserName",
    label: "Browser",
    options: toOptions([
      "Chrome",
      "Safari",
      "Mobile Safari",
      "Firefox",
      "Edge",
      "Samsung Internet",
      "Opera",
    ]),
  },
  {
    field: "osName",
    label: "Operating system",
    options: toOptions([
      "Windows",
      "macOS",
      "iOS",
      "Android",
      "Linux",
      "Chrome OS",
    ]),
  },
  {
    field: "deviceType",
    label: "Device",
    options: fromDropdownOptions(DEVICE_TYPE_OPTIONS),
  },
  {
    field: "countryCode",
    label: "Country",
    options: Countries.map(
      (country: CountryOption): FilterChipDropdownOption => {
        return {
          value: country.value,
          label: `${country.label} (${country.value})`,
        };
      },
    ),
  },
  {
    field: "triggerReason",
    label: "Capture reason",
    options: fromDropdownOptions(TRIGGER_REASON_OPTIONS),
  },
  {
    field: "minDurationSeconds",
    label: "Duration",
    options: [
      { value: "30", label: "At least 30 seconds" },
      { value: "60", label: "At least 1 minute" },
      { value: "120", label: "At least 2 minutes" },
      { value: "300", label: "At least 5 minutes" },
      { value: "600", label: "At least 10 minutes" },
    ],
  },
];

/** Match the normalization and signal precedence of the list endpoint. */
export function getSessionReplayFacetValue(
  field: SessionReplayFacetField,
  filters: SessionReplayAdvancedFilters,
  signal: string,
): string {
  const value: string = filters[field].trim();
  if (field === "countryCode") {
    return value.toUpperCase();
  }
  if (field === "triggerReason" && signal === "slow") {
    return SessionReplayTriggerReason.Performance;
  }
  if (field === "minDurationSeconds") {
    const seconds: number = parseFloat(value);
    return Number.isFinite(seconds) && seconds > 0 ? seconds.toString() : "";
  }
  return value;
}

/** Suggestions supplement known values; they never claim counts for an entire query. */
export function getSessionReplayFacetOptions(
  facet: SessionReplayFacet,
  rows: Array<SessionReplaySummary>,
  selected: string,
): Array<FilterChipDropdownOption> {
  const options: Map<string, FilterChipDropdownOption> = new Map(
    facet.options.map(
      (
        option: FilterChipDropdownOption,
      ): [string, FilterChipDropdownOption] => {
        return [option.value, option];
      },
    ),
  );
  const values: Array<string> = [selected];
  if (facet.field !== "minDurationSeconds") {
    const field: Exclude<SessionReplayFacetField, "minDurationSeconds"> =
      facet.field;
    values.push(
      ...rows.map((row: SessionReplaySummary): string => {
        return row[field];
      }),
    );
  }
  for (const value of values) {
    if (value.trim() && !options.has(value)) {
      options.set(value, {
        value,
        label:
          facet.field === "minDurationSeconds"
            ? `At least ${value} seconds`
            : value,
      });
    }
  }
  return Array.from(options.values());
}

interface SessionReplayFacetsProps {
  rows: Array<SessionReplaySummary>;
  filters: SessionReplayAdvancedFilters;
  signal: string;
  onFiltersChange: (filters: SessionReplayAdvancedFilters) => void;
  onSignalChange: (signal: string) => void;
}

const SIGNAL_OPTIONS: Array<FilterChipDropdownOption> =
  SESSION_REPLAY_SIGNAL_OPTIONS.filter(
    (option: SessionReplaySignalOption): boolean => {
      return option.value !== "all";
    },
  ).map((option: SessionReplaySignalOption): FilterChipDropdownOption => {
    return {
      value: option.value,
      label: option.label,
      sublabel: option.description,
    };
  });

const SessionReplayFacets: FunctionComponent<SessionReplayFacetsProps> = (
  props: SessionReplayFacetsProps,
): ReactElement => {
  const facets: Array<SessionReplayFacet> =
    useMemo((): Array<SessionReplayFacet> => {
      return SESSION_REPLAY_FACETS.map(
        (facet: SessionReplayFacet): SessionReplayFacet => {
          return {
            ...facet,
            options: getSessionReplayFacetOptions(
              facet,
              props.rows,
              getSessionReplayFacetValue(
                facet.field,
                props.filters,
                props.signal,
              ),
            ),
          };
        },
      );
    }, [props.rows, props.filters, props.signal]);
  return (
    <div
      className="mb-4 flex flex-wrap items-center gap-2"
      aria-label="Session replay facets"
      data-testid="session-replay-facets"
    >
      <span className="text-xs font-medium text-gray-500">Filter by</span>
      <div data-testid="session-facet-signal">
        <FilterChipDropdown
          label="Signal"
          emptyIcon={IconProp.Filter}
          options={SIGNAL_OPTIONS}
          value={props.signal === "all" ? null : props.signal}
          supportedOperators={["is"]}
          onChange={(value: string | Array<string> | null): void => {
            return props.onSignalChange(
              typeof value === "string" ? value : "all",
            );
          }}
        />
      </div>
      {facets.map((facet: SessionReplayFacet): ReactElement => {
        return (
          <div key={facet.field} data-testid={`session-facet-${facet.field}`}>
            <FilterChipDropdown
              label={facet.label}
              options={facet.options}
              value={
                getSessionReplayFacetValue(
                  facet.field,
                  props.filters,
                  props.signal,
                ) || null
              }
              supportedOperators={["is"]}
              onChange={(value: string | Array<string> | null): void => {
                if (
                  facet.field === "triggerReason" &&
                  props.signal === "slow"
                ) {
                  props.onSignalChange("all");
                }
                props.onFiltersChange({
                  ...props.filters,
                  [facet.field]: typeof value === "string" ? value : "",
                });
              }}
            />
          </div>
        );
      })}
    </div>
  );
};

export default SessionReplayFacets;
