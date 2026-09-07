import { TopologyLayoutMode } from "./TopologyPositionOverrides";
import { TopologyNodeKind } from "./NetworkTopologyViewModel";
import {
  TopologyHealthFilterMode,
  TopologyHealthSummary,
} from "./TopologyHealthFilter";
import StatusChipGroup, { StatusChipOption } from "../Filters/StatusChipGroup";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import Input from "Common/UI/Components/Input/Input";
import useTranslateValue from "Common/UI/Utils/Translation";
import React, { FunctionComponent, ReactElement, useId, useState } from "react";

export interface ComponentProps {
  searchText: string;
  onSearchChange: (value: string) => void;
  layoutMode: TopologyLayoutMode;
  onLayoutChange: (mode: TopologyLayoutMode) => void;
  availableKinds: ReadonlySet<TopologyNodeKind>;
  visibleKinds: ReadonlySet<TopologyNodeKind>;
  onKindToggle: (kind: TopologyNodeKind) => void;
  vlanOptions: Array<DropdownOption>;
  selectedVlan: string;
  onVlanChange: (value: string) => void;
  healthSummary: TopologyHealthSummary;
  healthFilterMode: TopologyHealthFilterMode;
  healthChipOptions: Array<StatusChipOption>;
  healthFilterMatchCount: number;
  onHealthChange: (mode: TopologyHealthFilterMode) => void;
  onResetFilters: () => void;
}

interface LayoutOption {
  mode: TopologyLayoutMode;
  label: string;
  description: string;
}

interface NodeKindOption {
  kind: TopologyNodeKind;
  label: string;
  description: string;
}

const LAYOUTS: Array<LayoutOption> = [
  {
    mode: "force",
    label: "Automatic",
    description: "Groups connected devices together.",
  },
  {
    mode: "tiered",
    label: "By network layer",
    description: "Places core, distribution and access devices in rows.",
  },
  {
    mode: "radial",
    label: "Concentric",
    description: "Arranges devices in rings around the network core.",
  },
  {
    mode: "star",
    label: "Hub and spoke",
    description: "Places each connected group around its hub.",
  },
  {
    mode: "parentChild",
    label: "Parent and child",
    description: "Follows the parent connections defined for your devices.",
  },
];

const NetworkTopologyToolbar: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const [showOptions, setShowOptions] = useState<boolean>(false);
  const optionsId: string = useId();
  const hasHiddenKinds: boolean = Array.from(props.availableKinds).some(
    (kind: TopologyNodeKind): boolean => {
      return !props.visibleKinds.has(kind);
    },
  );
  const optionFilterCount: number =
    Number(hasHiddenKinds) + Number(props.selectedVlan !== "all");
  const hasFilters: boolean =
    Boolean(props.searchText.trim()) ||
    props.healthFilterMode !== "all" ||
    optionFilterCount > 0;
  const layoutDescription: string =
    LAYOUTS.find((option: LayoutOption) => {
      return option.mode === props.layoutMode;
    })?.description || "";

  return (
    <div className="mb-4 space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="w-full sm:max-w-sm">
          <Input
            dataTestId="network-topology-search"
            ariaLabel="Find a network device"
            placeholder="Find a device by name or vendor…"
            value={props.searchText}
            onChange={props.onSearchChange}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          {hasFilters ? (
            <button
              type="button"
              data-testid="network-topology-reset-filters"
              className="rounded-lg px-3 py-2 text-sm font-medium text-indigo-600 hover:bg-indigo-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500"
              onClick={props.onResetFilters}
            >
              {translateString("Clear filters") || "Clear filters"}
            </button>
          ) : (
            <></>
          )}
          <button
            type="button"
            aria-expanded={showOptions}
            aria-controls={optionsId}
            data-testid="network-topology-options-toggle"
            className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 ${showOptions ? "border-indigo-200 bg-indigo-50 text-indigo-700" : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"}`}
            onClick={() => {
              setShowOptions(!showOptions);
            }}
          >
            {translateString("Map options") || "Map options"}
            {optionFilterCount > 0 ? (
              <span className="rounded-full bg-indigo-100 px-1.5 text-xs text-indigo-700">
                {optionFilterCount}
              </span>
            ) : (
              <></>
            )}
            <span aria-hidden="true">{showOptions ? "−" : "+"}</span>
          </button>
        </div>
      </div>

      {showOptions ? (
        <div
          id={optionsId}
          data-testid="network-topology-options"
          className="grid gap-5 rounded-xl border border-gray-200 bg-gray-50 p-4 lg:grid-cols-2"
        >
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              {translateString("Arrange the map") || "Arrange the map"}
            </p>
            <div
              role="group"
              aria-label="Topology layout"
              className="flex flex-wrap gap-1.5"
            >
              {LAYOUTS.map((option: LayoutOption): ReactElement => {
                const isActive: boolean = props.layoutMode === option.mode;
                return (
                  <button
                    key={option.mode}
                    type="button"
                    title={option.description}
                    aria-pressed={isActive}
                    data-testid={`network-topology-layout-mode-${option.mode}`}
                    className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 ${isActive ? "border-indigo-200 bg-indigo-50 text-indigo-700" : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"}`}
                    onClick={() => {
                      props.onLayoutChange(option.mode);
                    }}
                  >
                    {translateString(option.label) || option.label}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-xs leading-5 text-gray-500">
              {translateString(layoutDescription) || layoutDescription}{" "}
              {translateString(
                "Dragged positions are saved for each layout on this browser.",
              ) ||
                "Dragged positions are saved for each layout on this browser."}
            </p>
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              {translateString("Include on the map") || "Include on the map"}
            </p>
            <div
              role="group"
              aria-label="Node types"
              className="flex flex-wrap gap-1.5"
            >
              {(
                [
                  {
                    kind: "device",
                    label: "Monitored devices",
                    description: "Devices you have added to monitoring.",
                  },
                  {
                    kind: "unmanaged",
                    label: "Discovered neighbors",
                    description:
                      "Neighbors reported by your devices that are not monitored yet.",
                  },
                  {
                    kind: "endpoint",
                    label: "Endpoints",
                    description:
                      "Connected hosts learned from switch forwarding tables.",
                  },
                ] as Array<{
                  kind: TopologyNodeKind;
                  label: string;
                  description: string;
                }>
              )
                .filter((option: NodeKindOption) => {
                  return props.availableKinds.has(option.kind);
                })
                .map((option: NodeKindOption): ReactElement => {
                  const isActive: boolean = props.visibleKinds.has(option.kind);
                  return (
                    <button
                      key={option.kind}
                      type="button"
                      title={option.description}
                      aria-pressed={isActive}
                      data-testid={`network-topology-kind-filter-${option.kind}`}
                      className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 ${isActive ? "border-indigo-200 bg-indigo-50 text-indigo-700" : "border-gray-200 bg-white text-gray-500 hover:border-gray-300"}`}
                      onClick={() => {
                        props.onKindToggle(option.kind);
                      }}
                    >
                      {translateString(option.label) || option.label}
                    </button>
                  );
                })}
            </div>
            {props.vlanOptions.length > 1 ? (
              <div
                className="mt-3 max-w-xs"
                data-testid="network-topology-vlan-filter"
              >
                <p className="mb-1 text-xs font-medium text-gray-600">
                  {translateString("Endpoint VLAN") || "Endpoint VLAN"}
                </p>
                <Dropdown
                  ariaLabel="Endpoint VLAN"
                  value={
                    props.vlanOptions.find((option: DropdownOption) => {
                      return option.value === props.selectedVlan;
                    }) || props.vlanOptions[0]
                  }
                  options={props.vlanOptions}
                  onChange={(
                    value: DropdownValue | Array<DropdownValue> | null,
                  ) => {
                    props.onVlanChange(value ? value.toString() : "all");
                  }}
                />
                <p className="mt-1 text-xs text-gray-500">
                  {translateString(
                    "Filters endpoints. Network devices stay visible for context.",
                  ) ||
                    "Filters endpoints. Network devices stay visible for context."}
                </p>
              </div>
            ) : (
              <></>
            )}
          </div>
        </div>
      ) : (
        <></>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-gray-100 pt-3">
        <StatusChipGroup
          dataTestId="network-topology-health-filter"
          ariaLabel="Filter by device health"
          options={props.healthChipOptions}
          value={props.healthFilterMode}
          onChange={(value: string) => {
            props.onHealthChange(value as TopologyHealthFilterMode);
          }}
        />
        <p
          className="text-xs leading-5 text-gray-500"
          data-testid="network-topology-health-filter-hint"
          role="status"
          aria-live="polite"
        >
          {props.healthFilterMode !== "all"
            ? `${props.healthFilterMatchCount} of ${props.healthSummary.total} match this health filter. Connected neighbors stay dimmed for context.`
            : translateString(
                "Select a health filter to focus on a problem.",
              ) || "Select a health filter to focus on a problem."}
        </p>
      </div>
    </div>
  );
};

export default NetworkTopologyToolbar;
