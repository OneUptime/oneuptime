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
import { getHandDrawnButtonStateClassName } from "Common/UI/Components/Button/ButtonStates";
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
  /*
   * Issue #5378: which layout the map opens on, and - for a Project Owner
   * or Admin - the controls that make the layout on screen everyone's
   * default or clear it. Left out, the layouts are offered with no default.
   */
  defaultLayout?: DefaultLayoutControls | undefined;
}

export interface DefaultLayoutControls {
  /*
   * The layout this map opens on: the project's default when it has one,
   * the map's own otherwise. Its button is tagged "Default".
   */
  layoutMode: TopologyLayoutMode;
  // Whether the project chose it - only then is there a default to clear.
  isSetByProject: boolean;
  /*
   * Whether this reader may change the project's default (Project Owners
   * and Admins). Everyone else sees which layout is the default, and no
   * controls.
   */
  canChange: boolean;
  isSaving: boolean;
  // Why the last change did not save; empty when it did.
  error: string;
  // Make the layout on screen the default for everyone in the project.
  onMakeDefault: () => void;
  // Clear the project's default, so each map opens on its own again.
  onClear: () => void;
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

  /*
   * Issue #5378: what a Project Owner or Admin may do about the default,
   * under the layouts. On another layout than the default, make it the
   * default for everyone; on a default the project chose, clear it. On the
   * map's own default there is nothing to do, and nothing is shown. The
   * layout on screen never moves: the default is where the map OPENS.
   */
  const renderDefaultLayoutControls: () => ReactElement = (): ReactElement => {
    const controls: DefaultLayoutControls | undefined = props.defaultLayout;

    if (!controls || !controls.canChange) {
      return <></>;
    }

    const savingText: string = translateString("Saving…") || "Saving…";
    const error: ReactElement = controls.error ? (
      <p
        role="alert"
        data-testid="network-topology-default-error"
        className="w-full text-xs text-red-600"
      >
        {controls.error}
      </p>
    ) : (
      <></>
    );

    if (props.layoutMode !== controls.layoutMode) {
      return (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="network-topology-make-default"
            title={
              translateString(
                "Every network map in this project will open on this layout. People can still switch while they look.",
              ) ||
              "Every network map in this project will open on this layout. People can still switch while they look."
            }
            disabled={controls.isSaving}
            className={`rounded-lg border border-indigo-200 bg-white px-2.5 py-1.5 text-xs font-medium text-indigo-700 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 ${getHandDrawnButtonStateClassName(
              {
                isBusy: controls.isSaving,
                hoverClassName: "hover:bg-indigo-50",
              },
            )}`}
            onClick={controls.onMakeDefault}
          >
            {controls.isSaving
              ? savingText
              : translateString("Make default for everyone") ||
                "Make default for everyone"}
          </button>
          {error}
        </div>
      );
    }

    if (!controls.isSetByProject) {
      return <></>;
    }

    return (
      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-5 text-gray-500">
        <span
          role="status"
          aria-live="polite"
          data-testid="network-topology-default-status"
        >
          {translateString(
            "Everyone in this project opens network maps on this layout.",
          ) || "Everyone in this project opens network maps on this layout."}
        </span>
        <button
          type="button"
          data-testid="network-topology-clear-default"
          title={
            translateString(
              "Each map opens on its own default again: Automatic for all devices, By network layer for a site.",
            ) ||
            "Each map opens on its own default again: Automatic for all devices, By network layer for a site."
          }
          disabled={controls.isSaving}
          className={`rounded font-medium text-indigo-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 ${getHandDrawnButtonStateClassName(
            {
              isBusy: controls.isSaving,
              hoverClassName: "hover:text-indigo-800",
            },
          )}`}
          onClick={controls.onClear}
        >
          {controls.isSaving
            ? savingText
            : translateString("Clear default") || "Clear default"}
        </button>
        {error}
      </div>
    );
  };

  return (
    <div className="mb-4 space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="w-full sm:max-w-sm">
          <Input
            isSearchOrFilter={true}
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
                const isDefault: boolean =
                  props.defaultLayout?.layoutMode === option.mode;
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
                    {isDefault ? (
                      <span
                        data-testid="network-topology-layout-default-tag"
                        className={`ml-1.5 rounded px-1 py-px text-[10px] font-semibold uppercase tracking-wide ${isActive ? "bg-indigo-100 text-indigo-700" : "bg-gray-100 text-gray-500"}`}
                      >
                        {translateString("Default") || "Default"}
                      </span>
                    ) : (
                      <></>
                    )}
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
            {renderDefaultLayoutControls()}
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
