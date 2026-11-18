import NetworkSite from "Common/Models/DatabaseModels/NetworkSite";
import Includes from "Common/Types/BaseDatabase/Includes";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import Query from "Common/Types/BaseDatabase/Query";
import Search from "Common/Types/BaseDatabase/Search";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { DiscoveredDeviceFilterField } from "Common/Types/NetworkDevice/DiscoveredDevice";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import FacetFilterBar from "../../ResourceOwners/FacetFilterBar";
import FilterChipDateRange from "../../ResourceOwners/FilterChipDateRange";
import FilterChipDropdown from "../../ResourceOwners/FilterChipDropdown";
import {
  FilterChipDropdownOption,
  FilterOperator,
} from "../../ResourceOwners/FilterChipDropdownTypes";
import FilterChipValueInput from "../../ResourceOwners/FilterChipValueInput";
import {
  DISCOVERED_DEVICE_FILTERS_LABEL,
  DISCOVERED_DEVICE_SOURCE_OPTIONS,
  DiscoveredDeviceChip,
  DiscoveredDeviceChipState,
  EMPTY_DISCOVERED_DEVICE_CHIP_STATE,
  countActiveDiscoveredDeviceChips,
  setDiscoveredDeviceChip,
} from "./DiscoveredDeviceFilters";

/*
 * The Discovered Devices list's chips (OneUptime issue #9304), in the row
 * every list's chips sit in (FacetFilterBar) and drawn by the same chips the
 * Devices list uses, so the two lists filter alike: a typed value with its
 * operator, a site picked from the project's sites, what saw the device, and
 * when it was last seen. What the chips ask for is DiscoveredDeviceFilters'.
 */

// Sites a chip offers at a time; typing narrows them.
const SITE_PICKER_PAGE_SIZE: number = 50;

export interface ComponentProps {
  chips: ReadonlyArray<DiscoveredDeviceChip>;
  state: DiscoveredDeviceChipState;
  onChange: (state: DiscoveredDeviceChipState) => void;
}

function toSiteOptions(
  sites: Array<NetworkSite>,
): Array<FilterChipDropdownOption> {
  return sites.map((site: NetworkSite): FilterChipDropdownOption => {
    return {
      value: site.id?.toString() || "",
      label: site.name?.toString() || "",
    };
  });
}

async function loadSites(
  searchTerm: string,
): Promise<Array<FilterChipDropdownOption>> {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  if (!projectId) {
    return [];
  }

  const query: Query<NetworkSite> = {
    projectId: projectId,
  } as Query<NetworkSite>;

  if (searchTerm.trim()) {
    (query as unknown as Record<string, unknown>)["name"] = new Search(
      searchTerm.trim(),
    );
  }

  const result: ListResult<NetworkSite> = await ModelAPI.getList<NetworkSite>({
    modelType: NetworkSite,
    query: query,
    limit: SITE_PICKER_PAGE_SIZE,
    skip: 0,
    select: { _id: true, name: true },
    sort: { name: SortOrder.Ascending },
  });

  return toSiteOptions(result.data);
}

async function resolveSites(
  values: Array<string>,
): Promise<Array<FilterChipDropdownOption>> {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  if (!projectId || values.length === 0) {
    return [];
  }

  const result: ListResult<NetworkSite> = await ModelAPI.getList<NetworkSite>({
    modelType: NetworkSite,
    query: {
      projectId: projectId,
      _id: new Includes(values),
    } as Query<NetworkSite>,
    limit: values.length,
    skip: 0,
    select: { _id: true, name: true },
    sort: {},
  });

  return toSiteOptions(result.data);
}

const DiscoveredDeviceFilterBar: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const activeCount: number = countActiveDiscoveredDeviceChips(
    props.chips,
    props.state,
  );

  const change: (
    field: DiscoveredDeviceFilterField,
    values: Array<string>,
    operator: FilterOperator,
  ) => void = (
    field: DiscoveredDeviceFilterField,
    values: Array<string>,
    operator: FilterOperator,
  ): void => {
    props.onChange(
      setDiscoveredDeviceChip(props.state, field, values, operator),
    );
  };

  // The Seen By choices, in the reader's words: the chip draws them as given.
  const sourceOptions: Array<FilterChipDropdownOption> =
    DISCOVERED_DEVICE_SOURCE_OPTIONS.map(
      (option: FilterChipDropdownOption): FilterChipDropdownOption => {
        return {
          ...option,
          label: translator.translateText(option.label) || option.label,
        };
      },
    );

  return (
    <FacetFilterBar
      activeCount={activeCount}
      onClearAll={
        activeCount > 0
          ? () => {
              // The chips, not the search: it has its own x.
              props.onChange(EMPTY_DISCOVERED_DEVICE_CHIP_STATE);
            }
          : undefined
      }
      dataTestId="discovered-devices-filters"
      ariaLabel={DISCOVERED_DEVICE_FILTERS_LABEL}
    >
      {props.chips.map((chip: DiscoveredDeviceChip): ReactElement => {
        const values: Array<string> = props.state.values[chip.field] || [];
        const operator: FilterOperator =
          props.state.operators[chip.field] || "is";
        const testId: string = `discovered-devices-filter-${chip.field}`;

        if (chip.type === "dateRange") {
          return (
            <div key={chip.field} data-testid={testId}>
              <FilterChipDateRange
                label={chip.label}
                emptyIcon={chip.icon}
                values={values}
                operator={operator}
                supportedOperators={chip.supportedOperators}
                onChange={(
                  nextValues: Array<string>,
                  nextOperator: FilterOperator,
                ) => {
                  change(chip.field, nextValues, nextOperator);
                }}
              />
            </div>
          );
        }

        if (chip.type === "text") {
          return (
            <div key={chip.field} data-testid={testId}>
              <FilterChipValueInput
                label={chip.label}
                emptyIcon={chip.icon}
                values={values}
                valueType="text"
                operator={operator}
                supportedOperators={chip.supportedOperators}
                onChange={(
                  nextValues: Array<string>,
                  nextOperator: FilterOperator,
                ) => {
                  change(chip.field, nextValues, nextOperator);
                }}
              />
            </div>
          );
        }

        const isSite: boolean = chip.field === DiscoveredDeviceFilterField.Site;

        return (
          <div key={chip.field} data-testid={testId}>
            <FilterChipDropdown
              label={chip.label}
              emptyIcon={chip.icon}
              options={isSite ? undefined : sourceOptions}
              loadOptions={isSite ? loadSites : undefined}
              resolveOptions={isSite ? resolveSites : undefined}
              isMultiSelect={chip.isMultiSelect}
              searchPlaceholder={isSite ? "Search sites..." : undefined}
              value={chip.isMultiSelect ? values : values[0] || null}
              operator={operator}
              supportedOperators={chip.supportedOperators}
              popoverWidthClassName="w-60"
              onClear={() => {
                change(chip.field, [], "is");
              }}
              onOperatorChange={(nextOperator: FilterOperator) => {
                change(chip.field, values, nextOperator);
              }}
              onChange={(next: string | Array<string> | null) => {
                change(
                  chip.field,
                  next === null ? [] : Array.isArray(next) ? next : [next],
                  operator,
                );
              }}
            />
          </div>
        );
      })}
    </FacetFilterBar>
  );
};

export default DiscoveredDeviceFilterBar;
