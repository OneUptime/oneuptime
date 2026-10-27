import LabelsElement from "Common/UI/Components/Label/Labels";
import {
  ARCHIVED_FACET_SELECT,
  getArchivableValueFacetOptions,
} from "../ArchivableValue/ArchivedValueFacetOptions";
import ResolvedStateUtil from "Common/Utils/ResolvedState";
import { StateListType } from "Common/Utils/StateOrder";
import ProjectUtil from "Common/UI/Utils/Project";
import AlertElement from "./Alert";
import AppLink from "../AppLink/AppLink";
import { Black } from "Common/Types/BrandColors";
import Dictionary from "Common/Types/Dictionary";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import {
  ModalTableBulkDefaultActions,
  SaveFilterProps,
} from "Common/UI/Components/ModelTable/BaseModelTable";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import { BULK_ACTION_CONCURRENCY } from "Common/UI/Components/BulkUpdate/BulkActionRunner";
import EmptyStateOptions from "Common/UI/Components/ModelTable/EmptyStateOptions";
import useBulkLabelActions from "Common/UI/Components/BulkUpdate/BulkLabelActions";
import useCustomFieldFacets from "../CustomFields/useCustomFieldFacets";
import useBulkOwnerActions from "Common/UI/Components/BulkUpdate/BulkOwnerActions";
import useValueChangeActions from "Common/UI/Components/BulkUpdate/ValueChangeActions";
import User from "Common/UI/Utils/User";
import useEventStateActions from "../EventView/useEventStateActions";
import { EventStateKind } from "../EventView/EventStateKinds";
import { isOwnedByViewer } from "../ResourceOwners/OwnedByViewer";
import useBulkIncidentLinkActions from "./BulkIncidentLinkActions";
import useBulkAddToEpisodeActions from "../EpisodeMembers/BulkAddToEpisodeActions";
import { ALERT_EPISODE_MEMBER_KIND } from "../EpisodeMembers/EpisodeMemberKinds";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import Query from "Common/Types/BaseDatabase/Query";
import Search from "Common/Types/BaseDatabase/Search";
import Alert from "Common/Models/DatabaseModels/Alert";
import AlertCustomField from "Common/Models/DatabaseModels/AlertCustomField";
import AlertOwnerTeam from "Common/Models/DatabaseModels/AlertOwnerTeam";
import AlertOwnerUser from "Common/Models/DatabaseModels/AlertOwnerUser";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import buildAffectedResourcesFacet from "../AffectedResources/buildAffectedResourcesFacet";
import { getAffectedResourcesExportValue } from "../AffectedResources/AffectedResourceNames";
import OwnersCell from "../ResourceOwners/OwnersCell";
import useResourceOwners, {
  ResourceFacet,
  buildEntityFacetQuery,
} from "../ResourceOwners/useResourceOwners";
import {
  FilterChipDropdownOption,
  FilterOperator,
} from "../ResourceOwners/FilterChipDropdown";
import Includes from "Common/Types/BaseDatabase/Includes";
import React, {
  FunctionComponent,
  ReactElement,
  useState,
  useEffect,
} from "react";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import { CardButtonSchema } from "Common/UI/Components/Card/Card";
import Route from "Common/Types/API/Route";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import Navigation from "Common/UI/Utils/Navigation";
import AffectedResourcesCell, {
  ComponentProps as AffectedResourcesCellProps,
} from "../AffectedResources/AffectedResourcesCell";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import API from "Common/UI/Utils/API/API";
import ObjectID from "Common/Types/ObjectID";
import AlertStateTimeline from "Common/Models/DatabaseModels/AlertStateTimeline";
import LiveDuration from "../EventView/LiveDuration";
import useEventTimelineEndDates from "../EventView/useEventTimelineEndDates";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  CreateFromRecordAddress,
  CreatedRecordKind,
  getCreateFromRecordQuery,
} from "../CreateFromRecord/CreateFromRecord";

export interface ComponentProps {
  query?: Query<Alert> | undefined;
  noItemsMessage?: string | undefined;
  /*
   * The page's own words for the table's empty state - an all-clear list
   * ("No active incidents") says so here. See EmptyStateOptions.
   */
  emptyState?: EmptyStateOptions | undefined;
  title?: string | undefined;
  description?: string | undefined;
  saveFilterProps?: SaveFilterProps | undefined;
  disableCreate?: boolean | undefined;
  /*
   * The record whose Alerts tab this is - a monitor, a host, a cluster:
   * Create Alert opens the create page with it already picked
   * (Components/CreateFromRecord). The table draws no create form of its
   * own, so this replaces the create values it used to take and never used.
   */
  createFrom?: CreateFromRecordAddress | undefined;
}

/*
 * The Affected Resources column's own id, under which a viewer's show/hide
 * and column order are kept (ModelTable/ColumnPreference).
 *
 * The list had a Monitor column beside this one, naming the same monitor on
 * every row. That column is gone: Affected Resources names the monitor,
 * first. Left to its derived id ("hosts", its first field), the column would
 * stay off for anyone who had switched it off while the Monitor column named
 * the monitor - and their list would name no monitor at all. A new id comes
 * back on once for them; the stale "monitor" and "hosts" entries are dropped
 * when a layout is read (sanitizeColumnPreference).
 */
export const ALERTS_AFFECTED_RESOURCES_COLUMN_ID: string = "affected-resources";

type GetAlertAffectedResourcesFunction = (
  alert: Alert,
) => AffectedResourcesCellProps;

/*
 * What an alert's Affected Resources names, for its cell and its CSV alike:
 * the monitor the alert is about first, as on the overview's Affected
 * Resources card, then everything else linked to it.
 */
export const getAlertAffectedResources: GetAlertAffectedResourcesFunction = (
  alert: Alert,
): AffectedResourcesCellProps => {
  return {
    monitors: alert.monitor ? [alert.monitor] : [],
    hosts: alert.hosts || [],
    kubernetesClusters: alert.kubernetesClusters || [],
    dockerHosts: alert.dockerHosts || [],
    podmanHosts: alert.podmanHosts || [],
    proxmoxClusters: alert.proxmoxClusters || [],
    vmwareVCenters: alert.vmwareVCenters || [],
    cephClusters: alert.cephClusters || [],
    storageArrays: alert.storageArrays || [],
    dockerSwarmClusters: alert.dockerSwarmClusters || [],
    iotFleets: alert.iotFleets || [],
    databaseServers: alert.databaseServers || [],
    cloudResources: alert.cloudResources || [],
    services: alert.services || [],
    serviceLevelObjectives: alert.serviceLevelObjectives || [],
  };
};

const AlertsTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [error, setError] = useState<string>("");
  const [alertStates, setAlertStates] = useState<AlertState[]>([]);
  const [visibleAlerts, setVisibleAlerts] = useState<Array<Alert>>([]);

  /*
   * The project's states that count as resolved: its resolved state and any
   * state placed after it (Common/Utils/ResolvedState).
   */
  const resolvedStateIds: Array<string> = ResolvedStateUtil.getResolvedStateIds(
    {
      list: StateListType.AlertState,
      states: alertStates,
    },
  ).map((stateId: ObjectID) => {
    return stateId.toString();
  });

  const isAlertResolved: (alert: Alert) => boolean = (
    alert: Alert,
  ): boolean => {
    const stateId: string | undefined =
      alert.currentAlertState?._id?.toString();

    return Boolean(stateId && resolvedStateIds.includes(stateId));
  };

  const resolvedAlertIds: Array<string> = visibleAlerts
    .filter((alert: Alert) => {
      return isAlertResolved(alert);
    })
    .map((alert: Alert) => {
      return alert.id?.toString() || "";
    })
    .filter((alertId: string) => {
      return Boolean(alertId);
    });

  const {
    endDateByEventId: resolvedAtByAlertId,
    isLoading: isLoadingAlertDurations,
  } = useEventTimelineEndDates<AlertStateTimeline>({
    eventIds: resolvedAlertIds,
    eventIdField: "alertId",
    stateIdField: "alertStateId",
    timelineModelType: AlertStateTimeline,
    resolvedStateIds: resolvedStateIds,
  });

  const { bulkActions: labelBulkActions, modals: labelBulkActionModals } =
    useBulkLabelActions<Alert>({ modelType: Alert });

  /*
   * Acknowledge, Resolve and Change State, in each row's ⋯ menu and in Bulk
   * Actions, as the alert's own page offers them (EventView/
   * useEventStateActions).
   */
  const {
    rowActions: stateRowActions,
    bulkActions: stateBulkActions,
    modals: stateActionModals,
  } = useEventStateActions<Alert>({
    kind: EventStateKind.Alert,
    states: alertStates,
  });

  // Change Severity: the alert's Edit form's severity, from the list.
  const {
    rowActions: severityRowActions,
    bulkActions: severityBulkActions,
    modals: severityModals,
  } = useValueChangeActions<Alert, AlertSeverity>({
    modelType: Alert,
    column: "alertSeverity",
    idColumn: "alertSeverityId",
    valueModelType: AlertSeverity,
    title: "Change Severity",
    fieldTitle: "Severity",
    placeholder: "Choose a severity",
    // The list's own Severity filter wears the same icon.
    icon: IconProp.Fire,
  });

  const {
    bulkActions: incidentLinkBulkActions,
    modals: incidentLinkBulkActionModals,
  } = useBulkIncidentLinkActions();

  // Add to Existing Episode / Add to New Episode.
  const { bulkActions: episodeBulkActions, modals: episodeBulkActionModals } =
    useBulkAddToEpisodeActions<Alert>(ALERT_EPISODE_MEMBER_KIND);

  const alertExtraFacets: Array<ResourceFacet> = [
    {
      key: "currentAlertState",
      label: "State",
      icon: IconProp.Flag,
      isMultiSelect: true,
      searchPlaceholder: "Search states...",
      loadOptions: async (
        projectId: ObjectID,
        searchTerm: string,
      ): Promise<Array<FilterChipDropdownOption>> => {
        const query: Query<AlertState> = {
          projectId: projectId,
        } as Query<AlertState>;
        if (searchTerm.trim()) {
          (query as unknown as Record<string, unknown>)["name"] = new Search(
            searchTerm.trim(),
          );
        }
        const result: ListResult<AlertState> =
          await ModelAPI.getList<AlertState>({
            modelType: AlertState,
            query: query,
            limit: 50,
            skip: 0,
            select: {
              _id: true,
              name: true,
              order: true,
              color: true,
              ...ARCHIVED_FACET_SELECT,
            },
            sort: { order: SortOrder.Ascending },
          });
        // Archived states too - old alerts are in them - listed last.
        return getArchivableValueFacetOptions({
          values: result.data,
          toOption: (s: AlertState): FilterChipDropdownOption => {
            return {
              value: s.id?.toString() || "",
              label: s.name?.toString() || "",
              color: s.color?.toString() || "#9ca3af",
            };
          },
        });
      },
      resolveOptions: async (
        projectId: ObjectID,
        values: Array<string>,
      ): Promise<Array<FilterChipDropdownOption>> => {
        if (values.length === 0) {
          return [];
        }
        const result: ListResult<AlertState> =
          await ModelAPI.getList<AlertState>({
            modelType: AlertState,
            query: {
              projectId: projectId,
              _id: new Includes(values),
            } as Query<AlertState>,
            limit: values.length,
            skip: 0,
            select: { _id: true, name: true, color: true },
            sort: {},
          });
        return result.data.map((s: AlertState) => {
          return {
            value: s.id?.toString() || "",
            label: s.name?.toString() || "",
            color: s.color?.toString() || "#9ca3af",
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
      key: "alertSeverity",
      label: "Severity",
      icon: IconProp.Fire,
      isMultiSelect: true,
      searchPlaceholder: "Search severities...",
      loadOptions: async (
        projectId: ObjectID,
        searchTerm: string,
      ): Promise<Array<FilterChipDropdownOption>> => {
        const query: Query<AlertSeverity> = {
          projectId: projectId,
        } as Query<AlertSeverity>;
        if (searchTerm.trim()) {
          (query as unknown as Record<string, unknown>)["name"] = new Search(
            searchTerm.trim(),
          );
        }
        const result: ListResult<AlertSeverity> =
          await ModelAPI.getList<AlertSeverity>({
            modelType: AlertSeverity,
            query: query,
            limit: 50,
            skip: 0,
            select: {
              _id: true,
              name: true,
              order: true,
              color: true,
              ...ARCHIVED_FACET_SELECT,
            },
            sort: { order: SortOrder.Ascending },
          });
        // Archived severities too - old alerts have them - listed last.
        return getArchivableValueFacetOptions({
          values: result.data,
          toOption: (s: AlertSeverity): FilterChipDropdownOption => {
            return {
              value: s.id?.toString() || "",
              label: s.name?.toString() || "",
              color: s.color?.toString() || "#9ca3af",
            };
          },
        });
      },
      resolveOptions: async (
        projectId: ObjectID,
        values: Array<string>,
      ): Promise<Array<FilterChipDropdownOption>> => {
        if (values.length === 0) {
          return [];
        }
        const result: ListResult<AlertSeverity> =
          await ModelAPI.getList<AlertSeverity>({
            modelType: AlertSeverity,
            query: {
              projectId: projectId,
              _id: new Includes(values),
            } as Query<AlertSeverity>,
            limit: values.length,
            skip: 0,
            select: { _id: true, name: true, color: true },
            sort: {},
          });
        return result.data.map((s: AlertSeverity) => {
          return {
            value: s.id?.toString() || "",
            label: s.name?.toString() || "",
            color: s.color?.toString() || "#9ca3af",
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
      key: "monitor",
      // Alert.monitor is M2O — filter against the FK column directly.
      queryField: "monitorId",
      label: "Monitor",
      icon: IconProp.AltGlobe,
      isMultiSelect: true,
      searchPlaceholder: "Search monitors...",
      loadOptions: async (
        projectId: ObjectID,
        searchTerm: string,
      ): Promise<Array<FilterChipDropdownOption>> => {
        const query: Query<Monitor> = {
          projectId: projectId,
        } as Query<Monitor>;
        if (searchTerm.trim()) {
          (query as unknown as Record<string, unknown>)["name"] = new Search(
            searchTerm.trim(),
          );
        }
        const result: ListResult<Monitor> = await ModelAPI.getList<Monitor>({
          modelType: Monitor,
          query: query,
          limit: 50,
          skip: 0,
          select: { _id: true, name: true },
          sort: { name: SortOrder.Ascending },
        });
        return result.data.map((m: Monitor): FilterChipDropdownOption => {
          return {
            value: m.id?.toString() || "",
            label: m.name?.toString() || "",
            icon: IconProp.AltGlobe,
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
        const result: ListResult<Monitor> = await ModelAPI.getList<Monitor>({
          modelType: Monitor,
          query: {
            projectId: projectId,
            _id: new Includes(values),
          } as Query<Monitor>,
          limit: values.length,
          skip: 0,
          select: { _id: true, name: true },
          sort: {},
        });
        return result.data.map((m: Monitor): FilterChipDropdownOption => {
          return {
            value: m.id?.toString() || "",
            label: m.name?.toString() || "",
            icon: IconProp.AltGlobe,
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
    buildAffectedResourcesFacet<Alert>({
      parentModelType: Alert,
      // Alert's monitor relation is M2O — query against the FK column.
      monitorQueryField: "monitorId",
      /*
       * The Affected Resources column lists the monitor, but filtering by it
       * stays with the Monitor facet above. That one queries monitorId
       * directly; routing it through here would list every monitor in two
       * chips and filter via an ID lookup capped at LIMIT_PER_PROJECT
       * alerts, which a noisy monitor can pass.
       */
      excludeMonitor: true,
      // Burn rate alerts are linked to the SLO that raised them.
      includeServiceLevelObjective: true,
      includeCloudResource: true,
    }),
  ];

  /*
   * One namespace for everything this table mirrors into the URL, so the
   * column filters (persisted by ModelTable) and the facet chips (persisted
   * by useResourceOwners) always travel together. Falls back to a stable
   * per-table id for the pages that embed this table without saved views.
   */
  const tableUrlStateKey: string =
    props.saveFilterProps?.tableId || "alerts-table";

  /*
   * One chip per custom field this project has defined, appended after the
   * built-in ones. They arrive a render or two late (the definitions are
   * fetched), which is what `areFacetsLoading` below tells the bar.
   */
  const { facets: customFieldFacets, isLoading: areCustomFieldFacetsLoading } =
    useCustomFieldFacets({ customFieldsModelType: AlertCustomField });
  const {
    getOwnersForResource,
    isLoadingOwners,
    onResourcesFetched,
    filterBar,
    emptyState: facetEmptyState,
    mergeFiltersIntoQuery,
    facetSaveState,
    restoreFacetState,
  } = useResourceOwners<Alert>({
    persistKey: tableUrlStateKey,
    ownerUserModelType: AlertOwnerUser,
    ownerTeamModelType: AlertOwnerTeam,
    resourceIdField: "alertId",
    showLabelsFacet: true,
    extraFacets: [...alertExtraFacets, ...customFieldFacets],
    areFacetsLoading: areCustomFieldFacetsLoading,
  });

  /*
   * Assign to Me and Add Owner in each row's ⋯ menu, and Assign to Me in
   * Bulk Actions beside Add and Remove Owner. A row the viewer owns already
   * is not offered Assign to Me.
   */
  const {
    bulkActions: ownerBulkActions,
    rowActions: ownerRowActions,
    modals: ownerBulkActionModals,
  } = useBulkOwnerActions<Alert>({
    ownerUserModelType: AlertOwnerUser,
    ownerTeamModelType: AlertOwnerTeam,
    resourceIdField: "alertId",
    offerAssignToMeInBulk: true,
    isOwnedByMe: (alert: Alert): boolean | undefined => {
      return isOwnedByViewer({
        owners: getOwnersForResource(alert),
        viewerId: User.getUserId(),
      });
    },
  });

  // Fetch alert states on mount
  useEffect(() => {
    const fetchAlertStates: () => Promise<void> = async (): Promise<void> => {
      try {
        const result: ListResult<AlertState> =
          await ModelAPI.getList<AlertState>({
            modelType: AlertState,
            query: {
              projectId: ProjectUtil.getCurrentProjectId()!,
            },
            limit: 99,
            skip: 0,
            select: {
              _id: true,
              name: true,
              color: true,
              order: true,
              isArchived: true,
              isResolvedState: true,
              isAcknowledgedState: true,
              isCreatedState: true,
            },
            sort: {
              order: SortOrder.Ascending,
            },
          });
        setAlertStates(result.data);
      } catch (err) {
        setError(API.getFriendlyMessage(err));
      }
    };

    fetchAlertStates();
  }, []);

  let cardbuttons: Array<CardButtonSchema> = [];

  // The record this tab belongs to, in the create page's address.
  const createQuery: Dictionary<string> = getCreateFromRecordQuery(
    CreatedRecordKind.Alert,
    props.createFrom,
  );

  if (!props.disableCreate) {
    /*
     * These route to a dedicated create page instead of the table's built in
     * create modal, so ModelTable's own permission gate never sees them. Gate
     * them here or a viewer walks the whole flow and is refused at the end
     * (issue #3306).
     */
    cardbuttons = [
      PermissionGate.gateCardButton(
        {
          title: "Create Alert",
          phoneTitle: "Create",
          onClick: () => {
            Navigation.navigate(
              RouteUtil.getPageRoute(PageMap.ALERT_CREATE, {
                query: createQuery,
              }),
            );
          },
          buttonStyle: ButtonStyleType.NORMAL,
          icon: IconProp.Add,
        },
        new Alert(),
        ModelAction.Create,
      ),
    ].filter((button: CardButtonSchema | null): boolean => {
      return button !== null;
    }) as Array<CardButtonSchema>;
  }

  return (
    <>
      <ModelTable<Alert>
        name="Alerts"
        userPreferencesKey="alerts-table"
        customFieldsModelType={AlertCustomField}
        bulkActions={{
          buttons: [
            ...stateBulkActions,
            ...severityBulkActions,
            ...ownerBulkActions,
            ...labelBulkActions,
            ...incidentLinkBulkActions,
            ...episodeBulkActions,
            ModalTableBulkDefaultActions.Delete,
          ],
          /*
           * An alert's delete takes its own metrics with it and checks
           * nothing across alerts: several are deleted at once.
           */
          deleteConcurrency: BULK_ACTION_CONCURRENCY,
        }}
        actionButtons={[
          ...stateRowActions,
          ...severityRowActions,
          ...ownerRowActions,
        ]}
        modelType={Alert}
        id="alerts-table"
        isDeleteable={true}
        topContent={filterBar}
        emptyState={{ ...props.emptyState, ...facetEmptyState }}
        currentFacetState={facetSaveState}
        onFacetStateRestored={restoreFacetState}
        query={mergeFiltersIntoQuery(props.query)}
        onFetchSuccess={(data: Array<Alert>) => {
          setVisibleAlerts(data);
          onResourcesFetched(data);
        }}
        isEditable={false}
        isCreateable={false}
        isViewable={true}
        cardProps={{
          title: props.title || "Alerts",
          buttons: cardbuttons,
          description:
            props.description ||
            "Alerts flag problems for your team to look into before users are affected. Unlike incidents, they never appear on status pages.",
        }}
        noItemsMessage={props.noItemsMessage}
        showRefreshButton={true}
        searchableFields={["title", "description"]}
        showViewIdButton={true}
        saveFilterProps={props.saveFilterProps}
        urlStateKey={tableUrlStateKey}
        viewPageRoute={RouteUtil.populateRouteParams(RouteMap[PageMap.ALERTS]!)}
        filters={[
          {
            title: "Alert ID",
            type: FieldType.Text,
            field: {
              _id: true,
            },
          },
          {
            title: "Alert Number",
            type: FieldType.Number,
            field: {
              alertNumber: true,
            },
          },
          {
            field: {
              title: true,
            },
            title: "Title",
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
        selectMoreFields={{
          alertNumberWithPrefix: true,
          isPrivate: true,
          /*
           * The Affected Resources column lists several M2M relations under one
           * `field` block, but BaseModelTable only auto-selects the FIRST key
           * of each column.field. Include the remaining relations explicitly
           * so all attached resources actually load.
           */
          kubernetesClusters: {
            name: true,
            _id: true,
            projectId: true,
          },
          dockerHosts: {
            name: true,
            _id: true,
            projectId: true,
          },
          podmanHosts: {
            name: true,
            _id: true,
            projectId: true,
          },
          proxmoxClusters: {
            name: true,
            _id: true,
            projectId: true,
          },
          vmwareVCenters: {
            name: true,
            _id: true,
            projectId: true,
          },
          cephClusters: {
            name: true,
            _id: true,
            projectId: true,
          },
          storageArrays: {
            name: true,
            _id: true,
            projectId: true,
          },
          dockerSwarmClusters: {
            name: true,
            _id: true,
            projectId: true,
          },
          iotFleets: {
            name: true,
            _id: true,
            projectId: true,
          },
          databaseServers: {
            name: true,
            _id: true,
            projectId: true,
          },
          cloudResources: {
            name: true,
            _id: true,
            projectId: true,
          },
          services: {
            name: true,
            _id: true,
            projectId: true,
            serviceColor: true,
          },
          /*
           * Only columns ServiceLevelObjective flags canReadOnRelationQuery.
           * Any other SLO column would fail the whole list for a role that
           * can read alerts but not SLOs.
           */
          serviceLevelObjectives: {
            name: true,
            _id: true,
            projectId: true,
          },
        }}
        columns={[
          {
            field: {
              alertNumber: true,
            },
            title: "Alert Number",
            type: FieldType.Text,
            getElement: (item: Alert): ReactElement => {
              if (!item.alertNumber) {
                return <>-</>;
              }

              const numberLabel: string =
                item.alertNumberWithPrefix || `#${item.alertNumber}`;

              const numberContent: ReactElement = item._id ? (
                <AppLink
                  className="hover:underline"
                  to={RouteUtil.populateRouteParams(
                    RouteMap[PageMap.ALERT_VIEW] as Route,
                    {
                      modelId: new ObjectID(item._id as string),
                    },
                  )}
                >
                  <span>{numberLabel}</span>
                </AppLink>
              ) : (
                <span>{numberLabel}</span>
              );

              return (
                <span className="inline-flex items-center">
                  {numberContent}
                  {item.isPrivate === true && (
                    <span
                      title={translator.translateText(
                        "Private alert — visible only to its owners, project admins, and project owners",
                      )}
                      className="inline-flex items-center gap-1 ml-2 px-1.5 py-0.5 rounded text-xs font-medium bg-red-50 text-red-700 border border-red-200 align-middle"
                    >
                      <Icon icon={IconProp.Lock} className="w-3 h-3" />
                      {translator.translateText("Private")}
                    </span>
                  )}
                </span>
              );
            },
          },
          {
            field: {
              title: true,
            },
            title: "Title",
            type: FieldType.Element,
            getElement: (item: Alert): ReactElement => {
              return <AlertElement alert={item} />;
            },
          },
          {
            field: {
              currentAlertState: {
                _id: true,
                name: true,
                color: true,
              },
            },
            title: "State",
            type: FieldType.Entity,

            getElement: (item: Alert): ReactElement => {
              if (item["currentAlertState"]) {
                return (
                  <Pill
                    isMinimal={true}
                    color={item.currentAlertState.color || Black}
                    text={item.currentAlertState.name || "Unknown"}
                  />
                );
              }

              return <></>;
            },
          },
          {
            field: {
              alertSeverity: {
                _id: true,
                name: true,
                color: true,
              },
            },

            title: "Severity",
            type: FieldType.Entity,

            getElement: (item: Alert): ReactElement => {
              if (item["alertSeverity"]) {
                return (
                  <Pill
                    isMinimal={false}
                    color={item.alertSeverity.color || Black}
                    text={item.alertSeverity.name || "Unknown"}
                  />
                );
              }

              return <></>;
            },
          },
          {
            id: ALERTS_AFFECTED_RESOURCES_COLUMN_ID,
            field: {
              hosts: {
                name: true,
                _id: true,
                projectId: true,
              },
              kubernetesClusters: {
                name: true,
                _id: true,
                projectId: true,
              },
              dockerHosts: {
                name: true,
                _id: true,
                projectId: true,
              },
              podmanHosts: {
                name: true,
                _id: true,
                projectId: true,
              },
              proxmoxClusters: {
                name: true,
                _id: true,
                projectId: true,
              },
              vmwareVCenters: {
                name: true,
                _id: true,
                projectId: true,
              },
              cephClusters: {
                name: true,
                _id: true,
                projectId: true,
              },
              storageArrays: {
                name: true,
                _id: true,
                projectId: true,
              },
              dockerSwarmClusters: {
                name: true,
                _id: true,
                projectId: true,
              },
              iotFleets: {
                name: true,
                _id: true,
                projectId: true,
              },
              databaseServers: {
                name: true,
                _id: true,
                projectId: true,
              },
              cloudResources: {
                name: true,
                _id: true,
                projectId: true,
              },
              services: {
                name: true,
                _id: true,
                projectId: true,
                serviceColor: true,
              },
              serviceLevelObjectives: {
                name: true,
                _id: true,
                projectId: true,
              },
              /*
               * The monitor the alert is about, listed first, as on the
               * overview's Affected Resources card. The list has no Monitor
               * column: this is where a row names its monitor. A secondary
               * key, so hosts stays the column's primary field; the table's
               * relation select asks for it on every read
               * (getRelationSelectFromColumns).
               */
              monitor: {
                name: true,
                _id: true,
                projectId: true,
              },
            },
            title: "Affected Resources",
            type: FieldType.EntityArray,

            getElement: (item: Alert): ReactElement => {
              return (
                <AffectedResourcesCell {...getAlertAffectedResources(item)} />
              );
            },
            /*
             * The cell's names in the cell's order. Read field by field, the
             * file would put the monitor last, after every other resource.
             */
            getExportValue: (item: Alert): string => {
              return getAffectedResourcesExportValue(
                getAlertAffectedResources(item),
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
          {
            field: {
              createdAt: true,
            },
            title: "Duration",
            type: FieldType.Element,
            disableSort: true,
            disableCsvExport: true,
            getElement: (item: Alert): ReactElement => {
              const alertId: string = item.id?.toString() || "";
              const isResolved: boolean = isAlertResolved(item);
              const resolvedAt: Date | undefined = alertId
                ? resolvedAtByAlertId[alertId]
                : undefined;

              if (
                !item.createdAt ||
                (isResolved && (isLoadingAlertDurations || !resolvedAt))
              ) {
                return <>-</>;
              }

              return (
                <LiveDuration
                  startDate={item.createdAt}
                  endDate={isResolved ? resolvedAt : undefined}
                  isCompact={true}
                />
              );
            },
          },
          {
            field: {
              labels: {
                name: true,
                color: true,
              },
            },
            title: "Labels",
            type: FieldType.EntityArray,
            hideOnMobile: true,

            getElement: (item: Alert): ReactElement => {
              return <LabelsElement labels={item["labels"] || []} />;
            },
          },
          {
            field: {
              _id: true,
            },
            title: "Owners",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: Alert): ReactElement => {
              return (
                <OwnersCell
                  owners={getOwnersForResource(item)}
                  isLoading={isLoadingOwners}
                />
              );
            },
          },
        ]}
      />

      {error && (
        <ConfirmModal
          title={`Error`}
          description={`${error}`}
          submitButtonText={"Close"}
          onSubmit={() => {
            return setError("");
          }}
        />
      )}

      {labelBulkActionModals}
      {ownerBulkActionModals}
      {incidentLinkBulkActionModals}
      {episodeBulkActionModals}

      {stateActionModals}
      {severityModals}
    </>
  );
};

export default AlertsTable;
