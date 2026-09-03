import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import AppLink from "../../Components/AppLink/AppLink";
import MonitorStatusElement from "../../Components/MonitorStatus/MonitorStatusElement";
import ImportSitesFromCsvModal from "../../Components/NetworkSite/ImportSitesFromCsvModal";
import {
  fetchAllNetworkSiteTypeOptions,
  fetchParentNetworkSiteOptions,
  isParentSiteRequired,
} from "../../Components/NetworkSite/NetworkSiteFormDropdownOptions";
import SiteHierarchyTree from "../../Components/NetworkSite/SiteHierarchyTree";
import SiteSummaryCards from "../../Components/NetworkSite/SiteSummaryCards";
import { getDeviceListRouteForFacet } from "../../Components/NetworkDevice/DeviceListFacetRoute";
import {
  SiteSummaryTile,
  SiteSummaryTileAction,
  UNASSIGNED_DEVICES_FACET_SELECTION,
} from "../../Components/NetworkSite/SiteSummaryTiles";
import {
  NETWORK_SITES_TABLE_ID,
  SITE_FACET_QUERY_FIELDS,
  SITE_PARENT_FACET_KEY,
  SITE_STATUS_FACET_KEY,
  SITE_TYPE_FACET_KEY,
} from "../../Components/NetworkSite/SiteFacets";
import {
  FacetTileSelection,
  applyFacetTileSelection,
} from "../../Components/ResourceOwners/FacetTileSelection";
import useResourceOwners, {
  ResourceFacet,
  buildEntityFacetQuery,
} from "../../Components/ResourceOwners/useResourceOwners";
import {
  FilterChipDropdownOption,
  FilterOperator,
} from "../../Components/ResourceOwners/FilterChipDropdownTypes";
import Route from "Common/Types/API/Route";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import NetworkSite from "Common/Models/DatabaseModels/NetworkSite";
import NetworkSiteType from "Common/Models/DatabaseModels/NetworkSiteType";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Includes from "Common/Types/BaseDatabase/Includes";
import Query from "Common/Types/BaseDatabase/Query";
import Search from "Common/Types/BaseDatabase/Search";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { CardButtonSchema } from "Common/UI/Components/Card/Card";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useMemo,
  useState,
} from "react";

/*
 * Stable object identity, because ModelTable decides whether to refetch by
 * comparing the query it was handed against the previous render's. The facet bar
 * merges its chips into a copy of this.
 */
const BASE_SITE_QUERY: Query<NetworkSite> = {};

// How many rows an option picker asks for per search.
const FACET_PICKER_PAGE_SIZE: number = 50;

const NetworkSites: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  /*
   * Bumped when sites change — a create from the table, or a CSV import — so
   * the table, the summary cards and the hierarchy tree all refetch without a
   * page reload.
   */
  const [refreshToggle, setRefreshToggle] = useState<string>("");

  const [showImportModal, setShowImportModal] = useState<boolean>(false);

  /*
   * The chips above the table. Built once — every option list is fetched by the
   * chip itself — so the array identity the facet bar memoises against is stable.
   */
  const siteFacets: Array<ResourceFacet> = useMemo(() => {
    return [
      {
        key: SITE_STATUS_FACET_KEY,
        queryField: SITE_FACET_QUERY_FIELDS.status,
        label: "Status",
        icon: IconProp.Heartbeat,
        isMultiSelect: true,
        searchPlaceholder: "Search statuses...",
        /*
         * "is empty" is the one that matters here: a site with no rolled-up
         * status is what the "Sites Without Data" tile counts, and only the
         * foreign key can be asked for NULL — there is no status row to join.
         */
        supportedOperators: ["is", "is_not", "is_empty", "is_not_empty"],
        loadOptions: async (
          projectId: ObjectID,
          searchTerm: string,
        ): Promise<Array<FilterChipDropdownOption>> => {
          const query: Query<MonitorStatus> = {
            projectId: projectId,
          } as Query<MonitorStatus>;

          if (searchTerm.trim()) {
            (query as unknown as Record<string, unknown>)["name"] = new Search(
              searchTerm.trim(),
            );
          }

          const result: ListResult<MonitorStatus> =
            await ModelAPI.getList<MonitorStatus>({
              modelType: MonitorStatus,
              query: query,
              limit: FACET_PICKER_PAGE_SIZE,
              skip: 0,
              select: { _id: true, name: true, color: true, priority: true },
              sort: { priority: SortOrder.Ascending },
            });

          return result.data.map((status: MonitorStatus) => {
            return {
              value: status.id?.toString() || "",
              label: status.name?.toString() || "",
              color: status.color?.toString() || "#9ca3af",
            };
          });
        },
        resolveOptions: async (
          projectId: ObjectID,
          values: Array<string>,
        ): Promise<Array<FilterChipDropdownOption>> => {
          if (values.length === 0) {
            return [];
          }

          const result: ListResult<MonitorStatus> =
            await ModelAPI.getList<MonitorStatus>({
              modelType: MonitorStatus,
              query: {
                projectId: projectId,
                _id: new Includes(values),
              } as Query<MonitorStatus>,
              limit: values.length,
              skip: 0,
              select: { _id: true, name: true, color: true },
              sort: {},
            });

          return result.data.map((status: MonitorStatus) => {
            return {
              value: status.id?.toString() || "",
              label: status.name?.toString() || "",
              color: status.color?.toString() || "#9ca3af",
            };
          });
        },
        toQueryValue: (
          values: Array<string>,
          operator: FilterOperator,
        ): unknown => {
          return buildEntityFacetQuery(values, operator, true);
        },
      },
      {
        key: SITE_TYPE_FACET_KEY,
        queryField: SITE_FACET_QUERY_FIELDS.siteType,
        label: "Site Type",
        icon: IconProp.Cube,
        isMultiSelect: true,
        searchPlaceholder: "Search site types...",
        supportedOperators: ["is", "is_not", "is_empty", "is_not_empty"],
        loadOptions: async (
          projectId: ObjectID,
          searchTerm: string,
        ): Promise<Array<FilterChipDropdownOption>> => {
          const query: Query<NetworkSiteType> = {
            projectId: projectId,
          } as Query<NetworkSiteType>;

          if (searchTerm.trim()) {
            (query as unknown as Record<string, unknown>)["name"] = new Search(
              searchTerm.trim(),
            );
          }

          const result: ListResult<NetworkSiteType> =
            await ModelAPI.getList<NetworkSiteType>({
              modelType: NetworkSiteType,
              query: query,
              limit: FACET_PICKER_PAGE_SIZE,
              skip: 0,
              select: { _id: true, name: true, order: true },
              sort: { order: SortOrder.Ascending },
            });

          return result.data.map((siteType: NetworkSiteType) => {
            return {
              value: siteType.id?.toString() || "",
              label: siteType.name?.toString() || "",
            };
          });
        },
        resolveOptions: async (
          projectId: ObjectID,
          values: Array<string>,
        ): Promise<Array<FilterChipDropdownOption>> => {
          if (values.length === 0) {
            return [];
          }

          const result: ListResult<NetworkSiteType> =
            await ModelAPI.getList<NetworkSiteType>({
              modelType: NetworkSiteType,
              query: {
                projectId: projectId,
                _id: new Includes(values),
              } as Query<NetworkSiteType>,
              limit: values.length,
              skip: 0,
              select: { _id: true, name: true },
              sort: {},
            });

          return result.data.map((siteType: NetworkSiteType) => {
            return {
              value: siteType.id?.toString() || "",
              label: siteType.name?.toString() || "",
            };
          });
        },
        toQueryValue: (
          values: Array<string>,
          operator: FilterOperator,
        ): unknown => {
          return buildEntityFacetQuery(values, operator, true);
        },
      },
      {
        key: SITE_PARENT_FACET_KEY,
        queryField: SITE_FACET_QUERY_FIELDS.parentSite,
        label: "Parent Site",
        icon: IconProp.BuildingOffice,
        isMultiSelect: true,
        searchPlaceholder: "Search sites...",
        // "is empty" here is "root sites" — the tops of the hierarchy.
        supportedOperators: ["is", "is_not", "is_empty", "is_not_empty"],
        loadOptions: async (
          projectId: ObjectID,
          searchTerm: string,
        ): Promise<Array<FilterChipDropdownOption>> => {
          const query: Query<NetworkSite> = {
            projectId: projectId,
          } as Query<NetworkSite>;

          if (searchTerm.trim()) {
            (query as unknown as Record<string, unknown>)["name"] = new Search(
              searchTerm.trim(),
            );
          }

          const result: ListResult<NetworkSite> =
            await ModelAPI.getList<NetworkSite>({
              modelType: NetworkSite,
              query: query,
              limit: FACET_PICKER_PAGE_SIZE,
              skip: 0,
              select: { _id: true, name: true },
              sort: { name: SortOrder.Ascending },
            });

          return result.data.map((site: NetworkSite) => {
            return {
              value: site.id?.toString() || "",
              label: site.name?.toString() || "",
            };
          });
        },
        resolveOptions: async (
          projectId: ObjectID,
          values: Array<string>,
        ): Promise<Array<FilterChipDropdownOption>> => {
          if (values.length === 0) {
            return [];
          }

          const result: ListResult<NetworkSite> =
            await ModelAPI.getList<NetworkSite>({
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

          return result.data.map((site: NetworkSite) => {
            return {
              value: site.id?.toString() || "",
              label: site.name?.toString() || "",
            };
          });
        },
        toQueryValue: (
          values: Array<string>,
          operator: FilterOperator,
        ): unknown => {
          return buildEntityFacetQuery(values, operator, true);
        },
      },
    ];
  }, []);

  const {
    filterBar,
    mergeFiltersIntoQuery,
    hasActiveFilters,
    facetSelections,
    facetOperators,
    setFacetSelection,
    clearAllFacets,
    facetSaveState,
    restoreFacetState,
  } = useResourceOwners<NetworkSite>({
    // Sites have neither owners nor labels — no junction models, no labels column.
    showOwnerFacet: false,
    showLabelsFacet: false,
    extraFacets: siteFacets,
    persistKey: NETWORK_SITES_TABLE_ID,
  });

  type OnSummaryTileClickFunction = (
    tile: SiteSummaryTile,
    selection: FacetTileSelection | null,
  ) => void;

  const onSummaryTileClick: OnSummaryTileClickFunction = (
    tile: SiteSummaryTile,
    selection: FacetTileSelection | null,
  ): void => {
    /*
     * The rows behind "Unassigned Devices" are devices, and this page lists
     * sites — so that tile leaves for the device list with the equivalent chip
     * already set, instead of narrowing the sites table to something the count
     * never described.
     */
    if (tile.action === SiteSummaryTileAction.ShowUnassignedDevices) {
      Navigation.navigate(
        getDeviceListRouteForFacet(UNASSIGNED_DEVICES_FACET_SELECTION),
      );
      return;
    }

    if (!selection) {
      return;
    }

    applyFacetTileSelection({
      selection: selection,
      facetSelections: facetSelections,
      facetOperators: facetOperators,
      setFacetSelection: setFacetSelection,
      clearAllFacets: clearAllFacets,
    });
  };

  return (
    <Fragment>
      <SiteSummaryCards
        refreshToggle={refreshToggle}
        facetSelections={facetSelections}
        facetOperators={facetOperators}
        onTileClick={onSummaryTileClick}
      />
      <div className="mb-5">
        <SiteHierarchyTree refreshToggle={refreshToggle} />
      </div>
      <ModelTable<NetworkSite>
        refreshToggle={refreshToggle}
        query={mergeFiltersIntoQuery(BASE_SITE_QUERY)}
        currentFacetState={facetSaveState}
        onFacetStateRestored={restoreFacetState}
        topContent={filterBar}
        /*
         * "No network site" under a chip that matched nothing reads as an empty
         * project. This says the hierarchy is there and the bar is what is hiding
         * it.
         *
         * Only the chips — `hasActiveFilters` is the bar's own state, so a search
         * term or a popup filter that matches nothing still falls through to the
         * table's default copy.
         */
        noItemsMessage={
          hasActiveFilters
            ? "No network site matches the filters above."
            : undefined
        }
        onCreateSuccess={(item: NetworkSite): Promise<NetworkSite> => {
          setRefreshToggle(Date.now().toString());
          return Promise.resolve(item);
        }}
        modelType={NetworkSite}
        id={NETWORK_SITES_TABLE_ID}
        userPreferencesKey={NETWORK_SITES_TABLE_ID}
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        isViewable={true}
        showRefreshButton={true}
        name="Network Sites"
        searchableFields={["name", "description"]}
        cardProps={{
          title: "Network Sites",
          description:
            "Group your network devices into a drill-down hierarchy — regions, franchisees, markets, units. Each site rolls up the health of everything below it.",
          buttons: [
            /*
             * OUTLINE, not NORMAL/PRIMARY: BaseModelTable promotes the first
             * NORMAL/PRIMARY button to the header slot, and bulk import
             * belongs in the ⋯ overflow next to the other table-wide actions
             * — the same place every other bulk import in the product lives.
             */
            {
              title: "Import from CSV",
              buttonStyle: ButtonStyleType.OUTLINE,
              icon: IconProp.Upload,
              onClick: () => {
                setShowImportModal(true);
              },
            } as CardButtonSchema,
          ],
        }}
        showViewIdButton={true}
        /*
         * Only what the chips cannot express — free text and a date range.
         *
         * Status, Site Type and Parent Site have moved to the facet bar, and their
         * fields have to be gone from here: BaseModelTable spreads this popup's
         * query OVER the page's, so a popup filter on a chip's field would replace
         * the chip's constraint silently — and where the two spell the same column
         * differently (`networkSiteType` vs `networkSiteTypeId`) they survive as an
         * AND that can never match, emptying the table.
         */
        filters={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: {
              address: true,
            },
            title: "Address",
            type: FieldType.Text,
          },
          {
            field: {
              createdAt: true,
            },
            title: "Created",
            type: FieldType.Date,
          },
        ]}
        formSteps={[
          { title: "Site Details", id: "site-details" },
          { title: "Hierarchy", id: "hierarchy" },
          { title: "Location", id: "location" },
        ]}
        formFields={[
          {
            field: {
              networkSiteType: true,
            },
            title: "Site Type",
            stepId: "site-details",
            description:
              "Choose this first. The type's configured parent determines which parent sites are available on the next step.",
            fieldType: FormFieldSchemaType.Dropdown,
            fetchDropdownOptions: fetchAllNetworkSiteTypeOptions,
            onChange: (
              _value: unknown,
              currentFormValues: FormValues<NetworkSite>,
              setNewFormValues: (
                currentFormValues: FormValues<NetworkSite>,
              ) => void,
            ): void => {
              setNewFormValues({
                ...currentFormValues,
                parentSite: null,
              });
            },
            required: true,
            placeholder: "Select Site Type",
          },
          {
            field: {
              name: true,
            },
            title: "Name",
            stepId: "site-details",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Unit 1042 - Springfield",
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            stepId: "site-details",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Flagship location — two switches and a firewall.",
          },
          {
            field: {
              parentSite: true,
            },
            title: "Parent Site",
            stepId: "hierarchy",
            sectionTitle: "Place This Site",
            sectionDescription:
              "Only sites whose type is the configured parent of the selected site type are shown.",
            description:
              "Top-level site types do not have a parent site. A child site type requires one of the matching sites below.",
            fieldType: FormFieldSchemaType.Dropdown,
            fetchDropdownOptions: fetchParentNetworkSiteOptions,
            required: isParentSiteRequired,
            placeholder: "No parent site (top level)",
          },
          {
            field: {
              address: true,
            },
            title: "Address",
            stepId: "location",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "742 Evergreen Terrace, Springfield, IL",
          },
          {
            field: {
              latitude: true,
            },
            title: "Latitude",
            stepId: "location",
            description:
              "Between -90 and 90. Needed to pin this site on the network map.",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            placeholder: "39.7817",
          },
          {
            field: {
              longitude: true,
            },
            title: "Longitude",
            stepId: "location",
            description:
              "Between -180 and 180. Needed to pin this site on the network map.",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            placeholder: "-89.6501",
          },
        ]}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Element,
            getElement: (item: NetworkSite): ReactElement => {
              const route: Route = RouteUtil.populateRouteParams(
                RouteMap[PageMap.NETWORK_SITE_VIEW] as Route,
                {
                  modelId: new ObjectID(item._id as string),
                },
              );
              return (
                <AppLink
                  to={route}
                  className="text-sm font-medium text-gray-900 hover:underline"
                >
                  {(item.name as string) || "—"}
                </AppLink>
              );
            },
          },
          {
            field: {
              networkSiteType: {
                name: true,
              },
            },
            title: "Site Type",
            type: FieldType.Entity,
            getElement: (item: NetworkSite): ReactElement => {
              if (!item.networkSiteType?.name) {
                return <span className="text-sm text-gray-400">Not set</span>;
              }
              return (
                <span className="text-sm text-gray-900">
                  {item.networkSiteType.name}
                </span>
              );
            },
          },
          {
            field: {
              parentSite: {
                name: true,
              },
            },
            title: "Parent Site",
            type: FieldType.Entity,
            hideOnMobile: true,
            getElement: (item: NetworkSite): ReactElement => {
              if (!item.parentSite?.name) {
                return <span className="text-sm text-gray-400">Root</span>;
              }
              return (
                <span className="text-sm text-gray-900">
                  {item.parentSite.name}
                </span>
              );
            },
          },
          {
            field: {
              currentMonitorStatus: {
                name: true,
                color: true,
              },
            },
            title: "Status",
            type: FieldType.Entity,
            getElement: (item: NetworkSite): ReactElement => {
              if (!item.currentMonitorStatus) {
                return <span className="text-sm text-gray-400">No Data</span>;
              }
              return (
                <MonitorStatusElement
                  monitorStatus={item.currentMonitorStatus}
                  shouldAnimate={false}
                />
              );
            },
          },
          {
            field: {
              latitude: true,
            },
            title: "Location",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: NetworkSite): ReactElement => {
              if (
                item.latitude === undefined ||
                item.latitude === null ||
                item.longitude === undefined ||
                item.longitude === null
              ) {
                return (
                  <span className="text-sm text-gray-400">Not pinned</span>
                );
              }
              return (
                <span className="text-sm text-gray-600">
                  {item.latitude}, {item.longitude}
                </span>
              );
            },
          },
          {
            field: {
              createdAt: true,
            },
            title: "Created",
            type: FieldType.DateTime,
            hideOnMobile: true,
          },
        ]}
        selectMoreFields={{
          longitude: true,
        }}
        onViewPage={(item: NetworkSite): Promise<Route> => {
          return Promise.resolve(
            new Route(
              RouteUtil.populateRouteParams(
                RouteMap[PageMap.NETWORK_SITE_VIEW] as Route,
                {
                  modelId: item._id,
                },
              ).toString(),
            ),
          );
        }}
      />

      {showImportModal && (
        <ImportSitesFromCsvModal
          onClose={() => {
            setShowImportModal(false);
          }}
          onImportComplete={() => {
            /*
             * Fires while the modal is still open on its results, so the
             * table and the rollups behind it are already current when the
             * user closes it.
             */
            setRefreshToggle(Date.now().toString());
          }}
        />
      )}
    </Fragment>
  );
};

export default NetworkSites;
