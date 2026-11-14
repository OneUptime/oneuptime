import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import Route from "Common/Types/API/Route";
import Includes from "Common/Types/BaseDatabase/Includes";
import Query from "Common/Types/BaseDatabase/Query";
import Select from "Common/Types/BaseDatabase/Select";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import {
  OpenStackResourceKind,
  OpenStackServiceType,
} from "Common/Types/OpenStack/OpenStackResourceKind";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import Link from "Common/UI/Components/Link/Link";
import Filter from "Common/UI/Components/ModelFilter/Filter";
import Column from "Common/UI/Components/ModelTable/Column";
import Columns from "Common/UI/Components/ModelTable/Columns";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import {
  translateTemplate,
  translateText,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  RESOURCE_COLUMN_TONE_CLASS_NAMES,
  ResourceColumnTone,
} from "../Infrastructure/ResourceTable";
import {
  countOpenStackRows,
  fetchOpenStackApiStates,
  fetchOpenStackNames,
} from "../../Pages/OpenStack/Utils/OpenStackPartData";
import {
  formatOpenStackBytes,
  formatOpenStackChartBytes,
  formatOpenStackCount,
  formatOpenStackPercent,
} from "../../Pages/OpenStack/Utils/OpenStackFigures";
import {
  OPENSTACK_SERVICE_OF_KIND,
  OpenStackAllocationKey,
  OpenStackAllocationLine,
  OpenStackApiState,
  OpenStackEmptyWords,
  OpenStackRowState,
  formatOpenStackAllocationRatio,
  getOpenStackAllocationLines,
  getOpenStackEmptyWords,
  getOpenStackRowState,
  getOpenStackTimeInState,
} from "../../Pages/OpenStack/Utils/OpenStackPartFacts";
import {
  fetchOpenStackHypervisorOptions,
  fetchOpenStackProjectNames,
  fetchOpenStackProjectOptions,
  fetchOpenStackRegionOptions,
  getOpenStackFact,
} from "../../Pages/OpenStack/Utils/OpenStackResourceUtils";
import useResourceOwners from "../ResourceOwners/useResourceOwners";
import { ResourceFacet } from "../ResourceOwners/ResourceFacet";
import { ResourceAttentionText } from "../ResourcePart/ResourceAttention";
import {
  OPENSTACK_PROJECT_FACET_KEY,
  OPENSTACK_STATE_FACET_KEY,
  OpenStackStatePreset,
  getOpenStackStateFacet,
} from "./OpenStackListFacets";
import {
  OpenStackRegionState,
  useOpenStackRegion,
} from "./OpenStackRegionContext";
import OpenStackResourceListAPI from "./OpenStackResourceListAPI";
import { OPENSTACK_STATUS_WORDS } from "./OpenStackStatus";
import useOpenStackDomainFilter, {
  OPENSTACK_PROJECT_OWNED_KINDS,
  OpenStackDomainFilter,
} from "./UseOpenStackDomainFilter";
import { getOpenStackBareMetalProvisionUpdatedAt } from "../../Pages/OpenStack/Utils/OpenStackHealth";
import OpenStackStatusCell from "./OpenStackStatusCell";
import {
  OpenStackPartRoutes,
  getOpenStackPartRoutes,
} from "./Part/OpenStackPartRoutes";
import useIsOpenStackProbeCollected from "./Part/UseIsOpenStackProbeCollected";

/*
 * Every inventory list of an OpenStack cloud. A cloud can hold hundreds of
 * thousands of rows, so the table only ever holds a page of them: it pages, sorts
 * and filters on the server, by openStackCloudId and kind (the leading columns of
 * OpenStackResource's indexes). Nothing here reads a whole kind into the browser.
 *
 * A page says which rows it lists, which of the standard columns and filters they
 * have, and what to say when there are none: a list a credential cannot read looks
 * empty, and only the page knows what to say about that.
 *
 * A column that holds nothing for every row on the page is left out rather than drawn
 * as a column of dashes: what isn't collected (an instance's addresses, say) has no
 * place in a list, and its own page says it isn't collected.
 */

// Keystone's, rather than any one region's.
const OPENSTACK_KINDS_IN_NO_REGION: ReadonlySet<OpenStackResourceKind> =
  new Set<OpenStackResourceKind>([
    OpenStackResourceKind.Project,
    OpenStackResourceKind.Domain,
  ]);

export enum OpenStackColumn {
  Status = "status",
  AdminState = "adminState",
  DisabledReason = "disabledReason",
  Region = "region",
  AvailabilityZone = "availabilityZone",
  Hypervisor = "hypervisor",
  Project = "project",
  // How long since OneUptime saw its status change. Sorts on the server.
  TimeInState = "timeInState",
}

/*
 * A column a page adds. `hasValue` says whether a row holds anything for it: a column no
 * row on the page holds is left out. `getLink` makes its cell a step to another part's
 * page, by the part's name when the list can find it.
 */
export interface OpenStackPartLink {
  kind: OpenStackResourceKind;
  externalId: string;
  // Its name when the row already knows it.
  text?: string | undefined;
  // What it reads when nothing names it: a flavor's own id, without its region.
  fallbackText?: string | undefined;
}

export interface OpenStackListColumn extends Column<OpenStackResource> {
  hasValue?: ((row: OpenStackResource) => boolean) | undefined;
  getLink?: ((row: OpenStackResource) => OpenStackPartLink | null) | undefined;
}

export enum OpenStackFilter {
  Status = "status",
  AdminState = "adminState",
  Region = "region",
  Hypervisor = "hypervisor",
  Project = "project",
}

export interface ComponentProps {
  openStackCloudId: ObjectID;
  kind: OpenStackResourceKind;
  // Narrows the kind's rows: one family of services.
  query?: Query<OpenStackResource> | undefined;
  // Unique on the page: the table's id, its saved layout and its place in the URL.
  tableId: string;
  title: string;
  description: string;
  singularName: string;
  pluralName: string;
  emptyTitle: string;
  emptyDescription: string;
  nameTitle?: string | undefined;
  // How a row names itself, when its name column is not its name.
  getName?: ((row: OpenStackResource) => string) | undefined;
  statusTitle?: string | undefined;
  // The columns after the name, in order. Stable: a page declares them once.
  columns: Array<OpenStackColumn | OpenStackListColumn>;
  filters: Array<OpenStackFilter>;
  /*
   * The chips over the list. Each is a filter on the server, kept in the address.
   * Stable, as the columns are.
   */
  facets?: Array<ResourceFacet> | undefined;
  // States the list can be asked for by name, such as stuck.
  statePresets?: Array<OpenStackStatePreset> | undefined;
  // What opening a row opens: the part's own page.
  getViewRoute?: ((row: OpenStackResource) => Route | undefined) | undefined;
  /*
   * Asks whether the service answering for this list is up, and when it is and a kind a
   * working cloud always has reads empty, says this credential can't list it.
   */
  checkAccess?: boolean | undefined;
  // A family of services' own words for what an operator can set.
  adminStateWords?: ReadonlyArray<string> | undefined;
  searchPlaceholder?: string | undefined;
  sortBy?: keyof OpenStackResource | undefined;
  sortOrder?: SortOrder | undefined;
  // A page of rows arrived: a page that shows more than the row reads it here.
  onRowsFetched?: ((rows: Array<OpenStackResource>) => void) | undefined;
}

const SELECT_MORE: Select<OpenStackResource> = {
  kind: true,
  externalId: true,
  status: true,
  adminState: true,
  disabledReason: true,
  stateChangedAt: true,
  facts: true,
  regionName: true,
  hypervisorName: true,
  openStackProjectId: true,
  vcpuCapacity: true,
  vcpuAllocated: true,
  memoryCapacityBytes: true,
  memoryAllocatedBytes: true,
  diskCapacityBytes: true,
  diskAllocatedBytes: true,
};

// A word OpenStack wrote: never looked up, in the filter as in the cell.
function toWordOptions(words: ReadonlyArray<string>): Array<DropdownOption> {
  return words.map((word: string): DropdownOption => {
    return { value: word, label: word, isUserContent: true };
  });
}

function getFactCellText(value: string): ReactElement {
  return value ? <bdi>{value}</bdi> : <span className="text-gray-400">-</span>;
}

/*
 * What is promised out of what can be, in a cell. One value on its own reads
 * its own way ("۶٫۰ TiB", getFactCellText). A pair is a sentence: it reads
 * the page's way with each value set apart, so a Persian cell draws "۴۸۰ GiB
 * از ۱٫۰ TiB" from the right with each number before its unit. In a bdi the
 * pair would take the direction of its first size's unit, and a Persian
 * reader would read it backwards (issue #7191).
 */
function getAmountCell(data: {
  taken: number | null | undefined;
  capacity: number | null | undefined;
  format: (value: number) => string;
  // After the pair, in the same line: " (۱۹%)".
  after?: string | undefined;
}): ReactElement {
  const isPair: boolean =
    data.taken !== null &&
    data.taken !== undefined &&
    data.capacity !== null &&
    data.capacity !== undefined;
  const text: string = formatOpenStackAmount({
    taken: data.taken,
    capacity: data.capacity,
    format: data.format,
    setsValuesApart: isPair,
  });

  if (!text) {
    return getFactCellText("");
  }

  return isPair ? (
    <span data-testid="openstack-amount-cell">{`${text}${data.after || ""}`}</span>
  ) : (
    getFactCellText(`${text}${data.after || ""}`)
  );
}

/*
 * A column read from `facts`, what OpenStack says about one kind and no other.
 * Never sorted: the server orders by columns, and facts is not one.
 */
export function getOpenStackFactColumn(data: {
  id: string;
  title: string;
  getText: (row: OpenStackResource) => string;
  hideOnMobile?: boolean | undefined;
  // The colour a value at the rules' lines reads in.
  getTone?:
    | ((row: OpenStackResource) => ResourceColumnTone | undefined)
    | undefined;
  description?: string | undefined;
  // Off until the viewer asks for it in Customize Columns.
  isHiddenByDefault?: boolean | undefined;
  // Read after the rows, so the rows can't say it is empty: it stays, and fills in.
  isReadLater?: boolean | undefined;
}): OpenStackListColumn {
  return {
    id: data.id,
    field: { facts: true },
    title: data.title,
    type: FieldType.Element,
    disableSort: true,
    hideOnMobile: data.hideOnMobile,
    headerTooltip: data.description,
    isHiddenByDefault: data.isHiddenByDefault,
    hasValue: (row: OpenStackResource): boolean => {
      return Boolean(data.isReadLater) || Boolean(data.getText(row));
    },
    getElement: (row: OpenStackResource): ReactElement => {
      const tone: ResourceColumnTone | undefined = data.getTone?.(row);
      return tone ? (
        <span className={RESOURCE_COLUMN_TONE_CLASS_NAMES[tone]}>
          {getFactCellText(data.getText(row))}
        </span>
      ) : (
        getFactCellText(data.getText(row))
      );
    },
    getExportValue: (row: OpenStackResource): string => {
      return data.getText(row);
    },
  };
}

// A step to another part's page, by its name when the list can find it.
export function getOpenStackLinkColumn(data: {
  id: string;
  title: string;
  field?: Column<OpenStackResource>["field"] | undefined;
  getLink: (row: OpenStackResource) => OpenStackPartLink | null;
  hideOnMobile?: boolean | undefined;
  description?: string | undefined;
  // Off until the viewer asks for it in Customize Columns.
  isHiddenByDefault?: boolean | undefined;
}): OpenStackListColumn {
  return {
    id: data.id,
    field: data.field || { facts: true },
    title: data.title,
    type: FieldType.Element,
    disableSort: true,
    hideOnMobile: data.hideOnMobile,
    headerTooltip: data.description,
    isHiddenByDefault: data.isHiddenByDefault,
    hasValue: (row: OpenStackResource): boolean => {
      return Boolean(data.getLink(row));
    },
    getLink: data.getLink,
  };
}

/*
 * What is promised on a hypervisor out of what can be: "12 of 64 (19%)". Its colour is
 * the allocation templates' line, its ratio is Placement's, and a hypervisor Nova lost
 * says its numbers are last known, because that is all they are.
 */
export function getOpenStackAllocationColumn(data: {
  key: OpenStackAllocationKey;
  title: string;
  field: "vcpuAllocated" | "memoryAllocatedBytes" | "diskAllocatedBytes";
  format: (value: number) => string;
  hideOnMobile?: boolean | undefined;
}): OpenStackListColumn {
  const lineOf: (
    row: OpenStackResource,
  ) => OpenStackAllocationLine | undefined = (
    row: OpenStackResource,
  ): OpenStackAllocationLine | undefined => {
    return getOpenStackAllocationLines(row).find(
      (line: OpenStackAllocationLine): boolean => {
        return line.key === data.key;
      },
    );
  };

  const getText: (row: OpenStackResource) => string = (
    row: OpenStackResource,
  ): string => {
    const line: OpenStackAllocationLine | undefined = lineOf(row);
    return line
      ? formatOpenStackAmount({
          taken: line.taken,
          capacity: line.capacity,
          format: data.format,
        })
      : "";
  };

  return {
    field: { [data.field]: true },
    title: data.title,
    type: FieldType.Element,
    hideOnMobile: data.hideOnMobile,
    hasValue: (row: OpenStackResource): boolean => {
      return Boolean(getText(row));
    },
    getElement: (row: OpenStackResource): ReactElement => {
      const line: OpenStackAllocationLine | undefined = lineOf(row);
      const text: string = getText(row);
      if (!line || !text) {
        return getFactCellText("");
      }
      const percent: string =
        line.percent === null
          ? ""
          : ` (${formatOpenStackPercent(line.percent)})`;
      const ratio: string = formatOpenStackAllocationRatio(line.ratio);
      return (
        <div className="flex flex-col">
          <span
            className={
              line.isLastKnown
                ? "text-gray-400"
                : line.isOverLine
                  ? RESOURCE_COLUMN_TONE_CLASS_NAMES.warning
                  : undefined
            }
          >
            {getAmountCell({
              taken: line.taken,
              capacity: line.capacity,
              format: data.format,
              after: percent,
            })}
          </span>
          {line.isLastKnown ? (
            <span className="text-xs text-gray-500">
              {translateText("last known")}
            </span>
          ) : ratio ? (
            <span className="text-xs text-gray-400">
              {translateTemplate("ratio {{ratio}}", { ratio })}
            </span>
          ) : (
            <></>
          )}
        </div>
      );
    },
    getExportValue: getText,
  };
}

/*
 * setsValuesApart: the pair is drawn on the page and nowhere else, so each
 * value is set apart from its words (SentenceOptions): "۴۸۰ GiB" reads with
 * its number first in a Persian sentence. Never for what is exported.
 */
export function formatOpenStackAmount(data: {
  taken: number | null | undefined;
  capacity: number | null | undefined;
  format: (value: number) => string;
  setsValuesApart?: boolean | undefined;
}): string {
  const taken: string =
    data.taken === null || data.taken === undefined
      ? ""
      : data.format(data.taken);
  const capacity: string =
    data.capacity === null || data.capacity === undefined
      ? ""
      : data.format(data.capacity);

  if (taken && capacity) {
    return translateTemplate(
      "{{used}} of {{total}}",
      {
        used: taken,
        total: capacity,
      },
      { setsValuesApart: Boolean(data.setsValuesApart) },
    );
  }
  return taken || capacity;
}

// Where they have always been read from; written in OpenStackFigures (React-free).
export {
  formatOpenStackBytes,
  formatOpenStackChartBytes,
  formatOpenStackCount,
  formatOpenStackPercent,
};

// "12 of 64": what is promised, and what can be. Its title says "allocated".
export function getOpenStackAmountColumn(data: {
  title: string;
  field: "vcpuAllocated" | "memoryAllocatedBytes" | "diskAllocatedBytes";
  capacityField: "vcpuCapacity" | "memoryCapacityBytes" | "diskCapacityBytes";
  format: (value: number) => string;
  hideOnMobile?: boolean | undefined;
  // The colour a value at the rules' lines reads in.
  getTone?:
    | ((row: OpenStackResource) => ResourceColumnTone | undefined)
    | undefined;
}): OpenStackListColumn {
  const getText: (row: OpenStackResource) => string = (
    row: OpenStackResource,
  ): string => {
    return formatOpenStackAmount({
      taken: row[data.field],
      capacity: row[data.capacityField],
      format: data.format,
    });
  };

  return {
    field: { [data.field]: true },
    title: data.title,
    type: FieldType.Element,
    hideOnMobile: data.hideOnMobile,
    hasValue: (row: OpenStackResource): boolean => {
      return Boolean(getText(row));
    },
    getElement: (row: OpenStackResource): ReactElement => {
      const tone: ResourceColumnTone | undefined = data.getTone?.(row);
      const cell: ReactElement = getAmountCell({
        taken: row[data.field],
        capacity: row[data.capacityField],
        format: data.format,
      });
      return tone ? (
        <span className={RESOURCE_COLUMN_TONE_CLASS_NAMES[tone]}>{cell}</span>
      ) : (
        cell
      );
    },
    getExportValue: getText,
  };
}

// A number on the row that is a size, not a share of anything.
export function getOpenStackSizeColumn(data: {
  title: string;
  field:
    | "vcpuCapacity"
    | "memoryCapacityBytes"
    | "diskCapacityBytes"
    | "diskAllocatedBytes";
  format: (value: number) => string;
  hideOnMobile?: boolean | undefined;
}): OpenStackListColumn {
  const getText: (row: OpenStackResource) => string = (
    row: OpenStackResource,
  ): string => {
    const value: number | undefined = row[data.field];
    return value === null || value === undefined ? "" : data.format(value);
  };

  return {
    field: { [data.field]: true },
    title: data.title,
    type: FieldType.Element,
    hideOnMobile: data.hideOnMobile,
    hasValue: (row: OpenStackResource): boolean => {
      return Boolean(getText(row));
    },
    getElement: (row: OpenStackResource): ReactElement => {
      return getFactCellText(getText(row));
    },
    getExportValue: getText,
  };
}

// The rows of the standard columns that can be missing from every row of a page.
const STANDARD_COLUMN_FIELDS: Partial<
  Record<OpenStackColumn, keyof OpenStackResource>
> = {
  [OpenStackColumn.AdminState]: "adminState",
  [OpenStackColumn.DisabledReason]: "disabledReason",
  [OpenStackColumn.Region]: "regionName",
  [OpenStackColumn.AvailabilityZone]: "availabilityZone",
  [OpenStackColumn.Hypervisor]: "hypervisorName",
  [OpenStackColumn.Project]: "openStackProjectId",
};

function isCustomColumn(
  column: OpenStackColumn | OpenStackListColumn,
): column is OpenStackListColumn {
  return typeof column !== "string";
}

function columnHasValue(
  column: OpenStackColumn | OpenStackListColumn,
  row: OpenStackResource,
): boolean {
  if (isCustomColumn(column)) {
    return column.hasValue ? column.hasValue(row) : true;
  }
  const field: keyof OpenStackResource | undefined =
    STANDARD_COLUMN_FIELDS[column];
  return field ? Boolean(row[field]) : true;
}

// A key for a page's set of columns with nothing in them, so a read that changes none of them redraws none of them.
function getEmptyColumnKey(
  columns: Array<OpenStackColumn | OpenStackListColumn>,
  rows: Array<OpenStackResource>,
): string {
  return columns
    .map((column: OpenStackColumn | OpenStackListColumn, index: number) => {
      return rows.some((row: OpenStackResource): boolean => {
        return columnHasValue(column, row);
      })
        ? ""
        : `${index}`;
    })
    .join(",");
}

/*
 * What a row's state column says beyond OpenStack's word. Not for an API's or a worker's
 * row: those read their own word and nothing more, and the Services page says the rest.
 */
function getOpenStackListState(
  row: OpenStackResource,
): OpenStackRowState | null {
  if (
    row.kind === OpenStackResourceKind.Api ||
    row.kind === OpenStackResourceKind.Service
  ) {
    return null;
  }
  return getOpenStackRowState(row, OneUptimeDate.getCurrentDate());
}

const OpenStackResourceList: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  /*
   * Rows hold a project's ID, because Nova, Cinder and Neutron report only that.
   * Each page of rows looks up the names it needs, once.
   */
  const [projectNames, setProjectNames] = useState<Record<string, string>>({});
  const askedProjectIds: MutableRefObject<Set<string>> = useRef<Set<string>>(
    new Set<string>(),
  );

  // The same for what a row links to: an instance's flavor, a volume's instance.
  const [partNames, setPartNames] = useState<Record<string, string>>({});
  const askedPartIds: MutableRefObject<Set<string>> = useRef<Set<string>>(
    new Set<string>(),
  );

  const routes: OpenStackPartRoutes = useMemo(() => {
    return getOpenStackPartRoutes(props.openStackCloudId);
  }, [props.openStackCloudId]);

  const isProbeCollected: boolean = useIsOpenStackProbeCollected(
    props.openStackCloudId,
  );

  /*
   * A column no row on the page holds is left out. Until a page has arrived, none of the
   * ones that can be empty are drawn, so a column never appears and then goes.
   */
  const [emptyColumnKey, setEmptyColumnKey] = useState<string>(
    getEmptyColumnKey(props.columns, []),
  );

  const showsProject: boolean = props.columns.includes(OpenStackColumn.Project);

  // Nothing can be said of what its API says until that has been read.
  const [apiState, setApiState] = useState<OpenStackApiState>("not-read");
  const [hypervisorsAreListed, setHypervisorsAreListed] = useState<
    boolean | undefined
  >(undefined);

  const serviceType: OpenStackServiceType | undefined =
    OPENSTACK_SERVICE_OF_KIND[props.kind];

  // An empty list of instances can be a cloud with none: only a closed list of hosts says otherwise.
  useEffect(() => {
    if (!props.checkAccess || props.kind !== OpenStackResourceKind.Instance) {
      return;
    }
    let ignore: boolean = false;
    countOpenStackRows({
      openStackCloudId: props.openStackCloudId,
      kind: OpenStackResourceKind.Hypervisor,
    })
      .then((count: number) => {
        if (!ignore) {
          setHypervisorsAreListed(count > 0);
        }
      })
      .catch(() => {
        // The page's own words for an empty list are still true.
      });
    // eslint-disable-next-line consistent-return
    return () => {
      ignore = true;
    };
  }, [props.checkAccess, props.openStackCloudId.toString(), props.kind]);

  useEffect(() => {
    if (!props.checkAccess || !serviceType) {
      return;
    }
    let ignore: boolean = false;
    fetchOpenStackApiStates(props.openStackCloudId)
      .then((states: Record<string, OpenStackApiState>) => {
        if (!ignore) {
          setApiState(states[serviceType] || "not-reported");
        }
      })
      .catch(() => {
        // The page's own words for an empty list are still true.
      });
    // eslint-disable-next-line consistent-return
    return () => {
      ignore = true;
    };
  }, [props.checkAccess, props.openStackCloudId.toString(), serviceType]);

  const facets: Array<ResourceFacet> = useMemo(() => {
    return [
      ...(props.statePresets && props.statePresets.length > 0
        ? [getOpenStackStateFacet(props.statePresets)]
        : []),
      ...(props.facets || []),
    ];
  }, [props.facets, props.statePresets]);

  const {
    filterBar,
    emptyState: facetEmptyState,
    mergeFiltersIntoQuery,
    facetSelections,
    setFacetSelection,
  } = useResourceOwners<OpenStackResource>({
    showOwnerFacet: false,
    showLabelsFacet: false,
    extraFacets: facets,
    persistKey: facets.length > 0 ? props.tableId : undefined,
  });

  const statePresetValue: string | undefined =
    facetSelections[OPENSTACK_STATE_FACET_KEY]?.[0];

  /*
   * Worked out once for a choice of state, not on every draw: a time that moved with each
   * draw would be a new query each time, and the table reads again for a new query.
   */
  const statePresetQuery: Query<OpenStackResource> = useMemo(() => {
    const preset: OpenStackStatePreset | undefined = props.statePresets?.find(
      (candidate: OpenStackStatePreset): boolean => {
        return candidate.value === statePresetValue;
      },
    );
    return preset ? preset.getQuery(OneUptimeDate.getCurrentDate()) : {};
  }, [statePresetValue, props.statePresets]);

  const onFetchSuccess: (rows: Array<OpenStackResource>) => void = (
    rows: Array<OpenStackResource>,
  ): void => {
    props.onRowsFetched?.(rows);

    setEmptyColumnKey(getEmptyColumnKey(props.columns, rows));

    const idsByKind: Map<OpenStackResourceKind, Array<string>> = new Map();

    for (const column of props.columns) {
      if (!isCustomColumn(column) || !column.getLink) {
        continue;
      }
      for (const row of rows) {
        const link: OpenStackPartLink | null = column.getLink(row);
        const key: string = link ? `${link.kind}/${link.externalId}` : "";
        if (link && !link.text && !askedPartIds.current.has(key)) {
          askedPartIds.current.add(key);
          idsByKind.set(link.kind, [
            ...(idsByKind.get(link.kind) || []),
            link.externalId,
          ]);
        }
      }
    }

    for (const [kind, externalIds] of idsByKind.entries()) {
      fetchOpenStackNames({
        openStackCloudId: props.openStackCloudId,
        kind,
        externalIds,
      })
        .then((names: Record<string, string>) => {
          setPartNames((known: Record<string, string>) => {
            const next: Record<string, string> = { ...known };
            for (const externalId of Object.keys(names)) {
              next[`${kind}/${externalId}`] = names[externalId] as string;
            }
            return next;
          });
        })
        .catch(() => {
          // Its ID stands in for its name, and is just as true.
        });
    }

    if (!showsProject) {
      return;
    }

    const projectIds: Array<string> = [];

    for (const row of rows) {
      const projectId: string | undefined = row.openStackProjectId;
      if (projectId && !askedProjectIds.current.has(projectId)) {
        askedProjectIds.current.add(projectId);
        projectIds.push(projectId);
      }
    }

    fetchOpenStackProjectNames({
      openStackCloudId: props.openStackCloudId,
      projectIds: projectIds,
    })
      .then((names: Record<string, string>) => {
        if (Object.keys(names).length > 0) {
          setProjectNames((known: Record<string, string>) => {
            return { ...known, ...names };
          });
        }
      })
      .catch(() => {
        // The project's ID stands in for its name, and is just as true.
      });
  };

  const scopedQuery: Query<OpenStackResource> = useMemo(() => {
    return {
      openStackCloudId: props.openStackCloudId,
      kind: props.kind,
      ...(props.query || {}),
    };
  }, [props.openStackCloudId, props.kind, props.query]);

  /*
   * The chips, then the state the list was asked for. A status chip beside a state chip
   * narrows it, rather than being written over.
   */
  const merged: Query<OpenStackResource> = mergeFiltersIntoQuery(scopedQuery);
  const domainFilter: OpenStackDomainFilter = useOpenStackDomainFilter({
    openStackCloudId: props.openStackCloudId,
    kind: props.kind,
    chosenProjectIds: facetSelections[OPENSTACK_PROJECT_FACET_KEY],
  });
  const { region }: OpenStackRegionState = useOpenStackRegion();

  /*
   * A list with a Project chip has one Project filter, and it is the chip: its choices
   * are searched on the server, so a cloud of thousands of projects can reach them all.
   * A link that opens the list on a project lights that chip, where it can be cleared
   * like any other, and the first read already asks for that project alone.
   */
  const hasProjectChip: boolean = facets.some(
    (facet: ResourceFacet): boolean => {
      return facet.key === OPENSTACK_PROJECT_FACET_KEY;
    },
  );
  const [linkedProjectId, setLinkedProjectId] = useState<string | null>(
    hasProjectChip && !facetSelections[OPENSTACK_PROJECT_FACET_KEY]?.length
      ? domainFilter.initialProjectId
      : null,
  );

  useEffect(() => {
    if (linkedProjectId) {
      setFacetSelection(OPENSTACK_PROJECT_FACET_KEY, [linkedProjectId]);
      setLinkedProjectId(null);
    }
  }, [linkedProjectId]);

  const query: Query<OpenStackResource> = {
    // A list asked for one region keeps it, and a project is in no region at all.
    ...(region && !OPENSTACK_KINDS_IN_NO_REGION.has(props.kind)
      ? { regionName: region }
      : {}),
    ...merged,
    ...statePresetQuery,
    ...(statePresetQuery.status && merged.status
      ? { status: merged.status }
      : {}),
    ...(linkedProjectId
      ? { openStackProjectId: new Includes([linkedProjectId]) }
      : {}),
    ...domainFilter.query,
  };

  // Every list of what a project owns can be narrowed to one, whichever page draws it.
  const filterChoices: Array<OpenStackFilter> =
    OPENSTACK_PROJECT_OWNED_KINDS.has(props.kind) &&
    !hasProjectChip &&
    !props.filters.includes(OpenStackFilter.Project)
      ? [...props.filters, OpenStackFilter.Project]
      : props.filters;

  const emptyWords: OpenStackEmptyWords | null = getOpenStackEmptyWords({
    kind: props.kind,
    api: apiState,
    hypervisorsAreListed: hypervisorsAreListed,
    isProbeCollected: isProbeCollected,
  });

  const filters: Array<Filter<OpenStackResource>> = useMemo(() => {
    return filterChoices.map(
      (filter: OpenStackFilter): Filter<OpenStackResource> => {
        switch (filter) {
          case OpenStackFilter.Status:
            return {
              field: { status: true },
              title: props.statusTitle || "Status",
              type: FieldType.Dropdown,
              filterDropdownOptions: toWordOptions(
                OPENSTACK_STATUS_WORDS[props.kind] || [],
              ),
            };
          case OpenStackFilter.AdminState:
            return {
              field: { adminState: true },
              title: "Admin State",
              type: FieldType.Dropdown,
              filterDropdownOptions: toWordOptions(props.adminStateWords || []),
            };
          case OpenStackFilter.Region:
            return {
              field: { regionName: true },
              title: "Region",
              type: FieldType.Dropdown,
              filterEntityType: OpenStackResource,
              filterDropdownField: {
                label: "regionName",
                value: "regionName",
              },
              fetchFilterDropdownOptions: () => {
                return fetchOpenStackRegionOptions(props.openStackCloudId);
              },
            };
          case OpenStackFilter.Hypervisor:
            return {
              field: { hypervisorName: true },
              title: "Hypervisor",
              type: FieldType.Dropdown,
              filterEntityType: OpenStackResource,
              filterDropdownField: { label: "name", value: "name" },
              fetchFilterDropdownOptions: () => {
                return fetchOpenStackHypervisorOptions(props.openStackCloudId);
              },
            };
          case OpenStackFilter.Project:
            return {
              field: { openStackProjectId: true },
              title: "Project",
              type: FieldType.Dropdown,
              filterEntityType: OpenStackResource,
              filterDropdownField: { label: "name", value: "externalId" },
              fetchFilterDropdownOptions: () => {
                return fetchOpenStackProjectOptions(props.openStackCloudId);
              },
            };
          default:
            throw new Error(`Unknown OpenStack filter: ${filter as string}`);
        }
      },
    );
  }, [
    props.filters,
    props.openStackCloudId,
    props.kind,
    props.statusTitle,
    props.adminStateWords,
  ]);

  const columns: Columns<OpenStackResource> = useMemo(() => {
    const getName: (row: OpenStackResource) => string = (
      row: OpenStackResource,
    ): string => {
      return (
        (props.getName ? props.getName(row) : row.name) || row.externalId || ""
      );
    };

    const getProjectText: (row: OpenStackResource) => string = (
      row: OpenStackResource,
    ): string => {
      const projectId: string = row.openStackProjectId || "";
      return projectNames[projectId] || projectId;
    };

    const toColumn: (
      column: OpenStackColumn | OpenStackListColumn,
    ) => Column<OpenStackResource> = (
      column: OpenStackColumn | OpenStackListColumn,
    ): Column<OpenStackResource> => {
      if (isCustomColumn(column)) {
        const getLink:
          | ((row: OpenStackResource) => OpenStackPartLink | null)
          | undefined = column.getLink;

        if (!getLink) {
          return column;
        }

        const getLinkText: (link: OpenStackPartLink) => string = (
          link: OpenStackPartLink,
        ): string => {
          return (
            link.text ||
            partNames[`${link.kind}/${link.externalId}`] ||
            link.fallbackText ||
            link.externalId
          );
        };

        return {
          ...column,
          getElement: (row: OpenStackResource): ReactElement => {
            const link: OpenStackPartLink | null = getLink(row);
            if (!link) {
              return getFactCellText("");
            }
            const route: Route | undefined = routes.getPartRoute(
              link.kind,
              link.externalId,
            );
            return route ? (
              <Link
                to={route}
                className="text-indigo-600 hover:text-indigo-700 hover:underline"
              >
                <bdi>{getLinkText(link)}</bdi>
              </Link>
            ) : (
              getFactCellText(getLinkText(link))
            );
          },
          getExportValue: (row: OpenStackResource): string => {
            const link: OpenStackPartLink | null = getLink(row);
            return link ? getLinkText(link) : "";
          },
        };
      }

      switch (column) {
        case OpenStackColumn.Status:
          return {
            field: { status: true },
            title: props.statusTitle || "Status",
            type: FieldType.Element,
            // Beside a Reason column, the reason is not said twice.
            getElement: (row: OpenStackResource): ReactElement => {
              const state: OpenStackRowState | null =
                getOpenStackListState(row);
              return (
                <OpenStackStatusCell
                  kind={row.kind}
                  status={row.status}
                  adminState={row.adminState}
                  disabledReason={row.disabledReason}
                  isScrapeFailed={
                    getOpenStackFact(row, "scrapeFailed") === true
                  }
                  stateChangedAt={row.stateChangedAt}
                  provisionUpdatedAt={getOpenStackBareMetalProvisionUpdatedAt(
                    row,
                  )}
                  now={OneUptimeDate.getCurrentDate()}
                  label={state?.label}
                  isOpenStackWord={state?.isOpenStackWord}
                  tone={state?.tone}
                  reasons={state?.reasons as Array<ResourceAttentionText>}
                  showReason={
                    !props.columns.includes(OpenStackColumn.DisabledReason)
                  }
                />
              );
            },
            getExportValue: (row: OpenStackResource): string => {
              return row.status || "";
            },
          };
        case OpenStackColumn.TimeInState:
          return {
            field: { stateChangedAt: true },
            title: "In state for",
            type: FieldType.Element,
            hideOnMobile: true,
            headerTooltip: translationKey(
              "How long since OneUptime saw its status change. A part that was already in this state when OneUptime first saw it counts from then.",
            ),
            getElement: (row: OpenStackResource): ReactElement => {
              return getFactCellText(
                getOpenStackTimeInState(row, OneUptimeDate.getCurrentDate()),
              );
            },
            getExportValue: (row: OpenStackResource): string => {
              return getOpenStackTimeInState(
                row,
                OneUptimeDate.getCurrentDate(),
              );
            },
          };
        case OpenStackColumn.AdminState:
          return {
            field: { adminState: true },
            title: "Admin State",
            type: FieldType.Text,
            hideOnMobile: true,
          };
        case OpenStackColumn.DisabledReason:
          return {
            field: { disabledReason: true },
            title: "Reason",
            type: FieldType.Text,
            wrapContent: true,
          };
        case OpenStackColumn.Region:
          return {
            field: { regionName: true },
            title: "Region",
            type: FieldType.Text,
            hideOnMobile: true,
          };
        case OpenStackColumn.AvailabilityZone:
          return {
            field: { availabilityZone: true },
            title: "Availability Zone",
            type: FieldType.Text,
            hideOnMobile: true,
          };
        case OpenStackColumn.Hypervisor:
          return {
            field: { hypervisorName: true },
            title: "Hypervisor",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (row: OpenStackResource): ReactElement => {
              if (!row.hypervisorName) {
                return getFactCellText("");
              }
              const route: Route | undefined = routes.getHypervisorRoute(
                row.regionName,
                row.hypervisorName,
              );
              return route ? (
                <Link
                  to={route}
                  className="text-indigo-600 hover:text-indigo-700 hover:underline"
                >
                  <bdi>{row.hypervisorName}</bdi>
                </Link>
              ) : (
                getFactCellText(row.hypervisorName)
              );
            },
            getExportValue: (row: OpenStackResource): string => {
              return row.hypervisorName || "";
            },
          };
        case OpenStackColumn.Project:
          return {
            field: { openStackProjectId: true },
            title: "Project",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (row: OpenStackResource): ReactElement => {
              const text: string = getProjectText(row);
              const route: Route | undefined = row.openStackProjectId
                ? routes.getPartRoute(
                    OpenStackResourceKind.Project,
                    row.openStackProjectId,
                  )
                : undefined;
              return route && text ? (
                <Link
                  to={route}
                  className="text-indigo-600 hover:text-indigo-700 hover:underline"
                >
                  <bdi>{text}</bdi>
                </Link>
              ) : (
                getFactCellText(text)
              );
            },
            getExportValue: getProjectText,
          };
        default:
          throw new Error(`Unknown OpenStack column: ${column as string}`);
      }
    };

    return [
      {
        field: { name: true },
        title: props.nameTitle || "Name",
        type: FieldType.Element,
        // Whatever else a viewer hides, a row stays nameable.
        isNotCustomizable: true,
        // The words it shows, which are not the field as stored.
        getLineText: (row: OpenStackResource): string | undefined => {
          return getName(row);
        },
        getElement: (row: OpenStackResource): ReactElement => {
          return (
            <span className="text-sm font-medium text-gray-900">
              <bdi>{getName(row)}</bdi>
            </span>
          );
        },
        getExportValue: getName,
      },
      ...props.columns
        .filter(
          (
            _column: OpenStackColumn | OpenStackListColumn,
            index: number,
          ): boolean => {
            return !emptyColumnKey.split(",").includes(`${index}`);
          },
        )
        .map(toColumn),
    ];
  }, [
    props.columns,
    props.getName,
    props.nameTitle,
    props.statusTitle,
    projectNames,
    partNames,
    routes,
    emptyColumnKey,
  ]);

  return (
    <ModelTable<OpenStackResource>
      modelType={OpenStackResource}
      modelAPI={OpenStackResourceListAPI}
      id={props.tableId}
      userPreferencesKey={props.tableId}
      name={props.title}
      singularName={props.singularName}
      pluralName={props.pluralName}
      query={query}
      isDeleteable={false}
      isEditable={false}
      isCreateable={false}
      isViewable={Boolean(props.getViewRoute)}
      {...(props.getViewRoute
        ? {
            onViewPage: async (row: OpenStackResource): Promise<Route> => {
              return (
                props.getViewRoute?.(row) || routes.getPartListRoute(props.kind)
              );
            },
          }
        : {})}
      showRefreshButton={true}
      cardProps={{
        title: props.title,
        description: props.description,
      }}
      {...(domainFilter.initialProjectId && !hasProjectChip
        ? {
            initialFilterData: {
              openStackProjectId: domainFilter.initialProjectId,
            },
          }
        : {})}
      topContent={
        facets.length > 0 || domainFilter.control ? (
          <>
            {domainFilter.control}
            {facets.length > 0 ? filterBar : null}
          </>
        ) : undefined
      }
      emptyState={{
        ...(facets.length > 0 ? facetEmptyState : {}),
        // A domain narrows from outside the table too, so its way back has to stay.
        ...(domainFilter.isNarrowed
          ? {
              isFiltered: true,
              onClearFilters: () => {
                domainFilter.clear();
                facetEmptyState.onClearFilters?.();
              },
            }
          : {}),
        title: emptyWords?.title || props.emptyTitle,
        description: emptyWords?.description || props.emptyDescription,
        hideCreateButton: true,
      }}
      searchableFields={["name", "externalId"]}
      searchPlaceholder={props.searchPlaceholder}
      filters={filters}
      columns={columns}
      selectMoreFields={SELECT_MORE}
      sortBy={props.sortBy || "name"}
      sortOrder={props.sortOrder || SortOrder.Ascending}
      onFetchSuccess={onFetchSuccess}
    />
  );
};

export default OpenStackResourceList;
