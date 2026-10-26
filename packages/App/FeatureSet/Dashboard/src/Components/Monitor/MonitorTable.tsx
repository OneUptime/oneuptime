import LabelsElement from "Common/UI/Components/Label/Labels";
import {
  ARCHIVED_FACET_SELECT,
  getArchivableValueFacetOptions,
} from "../ArchivableValue/ArchivedValueFacetOptions";
import MonitorTypeUtil from "../../Utils/MonitorType";
import ProjectUtil from "Common/UI/Utils/Project";

import { Black, Gray500, Red500 } from "Common/Types/BrandColors";
import BadDataException from "Common/Types/Exception/BadDataException";
import IconProp from "Common/Types/Icon/IconProp";
import {
  BulkActionButtonSchema,
  BulkActionOnClickProps,
} from "Common/UI/Components/BulkUpdate/BulkUpdateForm";
import {
  BulkMonitorProbeChangeMode,
  runBulkMonitorProbeChange,
} from "./BulkMonitorProbeChange";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import {
  ModalTableBulkDefaultActions,
  SaveFilterProps,
} from "Common/UI/Components/ModelTable/BaseModelTable";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import EmptyStateOptions from "Common/UI/Components/ModelTable/EmptyStateOptions";
import Column from "Common/UI/Components/ModelTable/Column";
import useBulkLabelActions from "Common/UI/Components/BulkUpdate/BulkLabelActions";
import useCustomFieldFacets from "../CustomFields/useCustomFieldFacets";
import useBulkOwnerActions from "Common/UI/Components/BulkUpdate/BulkOwnerActions";
import useBulkArchiveActions from "Common/UI/Components/BulkUpdate/BulkArchiveActions";
import {
  DISABLE_SWITCH_ACTION,
  ENABLE_SWITCH_ACTION,
  SwitchActionsResult,
  useSwitchActions,
} from "Common/UI/Components/BulkUpdate/BulkSwitchActions";
import { ModelSwitchConfirmation } from "Common/UI/Components/ModelSwitch/ModelSwitchRow";
import { getTurnOffMonitoringConfirmation } from "./MonitoringCard";
import {
  ARCHIVE_INSTEAD_OF_DELETE,
  MONITOR_ARCHIVE_COPY,
} from "../Archive/ResourceArchiveCopy";
import { getArchivedColumns } from "../Archive/ArchivedColumns";
import Statusbubble from "Common/UI/Components/StatusBubble/StatusBubble";
import FieldType from "Common/UI/Components/Types/FieldType";
import Query from "Common/Types/BaseDatabase/Query";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorCustomField from "Common/Models/DatabaseModels/MonitorCustomField";
import MonitorOwnerTeam from "Common/Models/DatabaseModels/MonitorOwnerTeam";
import MonitorOwnerUser from "Common/Models/DatabaseModels/MonitorOwnerUser";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import MonitorTemplate from "Common/Models/DatabaseModels/MonitorTemplate";
import Probe from "Common/Models/DatabaseModels/Probe";
import React, {
  FunctionComponent,
  ReactElement,
  useState,
  useEffect,
} from "react";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import MonitorElement from "./Monitor";
import MonitorTemplateElement from "./MonitorTemplateElement";
import {
  MONITOR_TEMPLATE_FACET_KEY,
  MONITOR_TEMPLATE_FACET_QUERY_FIELD,
  buildMonitorTemplateFacetQuery,
  isQueryScopedToMonitorTemplate,
} from "./MonitorFacets";
import OwnersCell from "../ResourceOwners/OwnersCell";
import useResourceOwners, {
  ResourceFacet,
  buildEntityFacetQuery,
  buildEnumFacetQuery,
} from "../ResourceOwners/useResourceOwners";
import {
  FilterChipDropdownOption,
  FilterOperator,
} from "../ResourceOwners/FilterChipDropdown";
import Includes from "Common/Types/BaseDatabase/Includes";
import Search from "Common/Types/BaseDatabase/Search";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ActionButtonSchema, {
  RowActionConfirmation,
} from "Common/UI/Components/ActionButton/ActionButtonSchema";
import { CardButtonSchema } from "Common/UI/Components/Card/Card";
import Navigation from "Common/UI/Utils/Navigation";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ObjectID from "Common/Types/ObjectID";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import ProbeUtil from "../../Utils/Probe";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";

export interface ComponentProps {
  query?: Query<Monitor> | undefined;
  noItemsMessage?: string | undefined;
  /*
   * The page's own words for the table's empty state - an all-clear list
   * ("No active incidents") says so here. See EmptyStateOptions.
   */
  emptyState?: EmptyStateOptions | undefined;
  title?: string | undefined;
  description?: string | undefined;
  disableCreate?: boolean | undefined;
  actionButtons?: Array<ActionButtonSchema<Monitor>> | undefined;
  cardButtons?: Array<CardButtonSchema> | undefined;
  saveFilterProps?: SaveFilterProps | undefined;
  videoLink?: Route | URL | undefined;
  refreshToggle?: string | undefined;
  /*
   * The Archived page. Lists archived monitors only, offers Unarchive as its
   * bulk action, and ends with when and by whom each was archived. Every
   * other mount lists live monitors only: archived ones are not checked, so
   * their frozen status would otherwise sit in "Not Operational", "Disabled"
   * and every other list as if it were current.
   */
  isArchivedView?: boolean | undefined;
  /*
   * Whether a monitor can be deleted from this list - in each row's ⋯ menu
   * and in Bulk Actions. On by default: every list of monitors is one of the
   * places a monitor is deleted from. Off where the list is another
   * resource's members (a monitor group's monitors, whose row action is
   * Remove): deleting there would take the monitor out of every group,
   * status page and SLO it is on, not only out of this one.
   */
  isDeleteable?: boolean | undefined;
}

const MonitorsTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [probes, setProbes] = useState<Array<Probe>>([]);
  const [showAddProbesModal, setShowAddProbesModal] = useState<boolean>(false);
  const [showRemoveProbesModal, setShowRemoveProbesModal] =
    useState<boolean>(false);
  const [bulkActionProps, setBulkActionProps] =
    useState<BulkActionOnClickProps<Monitor> | null>(null);

  /*
   * The template page's own Linked Monitors table is this table, scoped by
   * `monitorTemplateId`. There, a Template chip would not narrow that scope —
   * `mergeFiltersIntoQuery` builds one object, so the chip would overwrite it —
   * and the column would repeat one value down every row. Read off the query
   * rather than off a prop, so a caller that scopes the table cannot forget it.
   */
  const isScopedToTemplate: boolean = isQueryScopedToMonitorTemplate(
    props.query,
  );

  const isArchivedView: boolean = Boolean(props.isArchivedView);

  /*
   * The archive state is part of every mount's scope, set here rather than by
   * each page, so a new page built on this table cannot forget it.
   */
  const scopedQuery: Query<Monitor> = {
    ...(props.query || {}),
    isArchived: isArchivedView,
  } as Query<Monitor>;

  const {
    archiveBulkActions,
    unarchiveBulkActions,
    archiveRowActions,
    unarchiveRowActions,
  } = useBulkArchiveActions<Monitor>({
    modelType: Monitor,
    singularName: MONITOR_ARCHIVE_COPY.singularName,
    pluralName: MONITOR_ARCHIVE_COPY.pluralName,
    archiveConfirmMessage: MONITOR_ARCHIVE_COPY.bulkArchiveConfirmMessage,
    unarchiveConfirmMessage: MONITOR_ARCHIVE_COPY.bulkUnarchiveConfirmMessage,
  });

  /*
   * Enable and Disable (the shared bulk switch, as on every list that turns
   * its records on and off). A monitor's switch is the other way round -
   * Disable Monitoring on - so Enable writes false and Disable true. The
   * list reads disableActiveMonitoring (selectMoreFields below), so a
   * monitor already in the state asked for is left alone and listed.
   */
  const {
    bulkActions: monitorSwitchBulkActions,
    rowActions: monitorSwitchRowActions,
  }: SwitchActionsResult<Monitor> = useSwitchActions<Monitor>({
    modelType: Monitor,
    column: "disableActiveMonitoring",
    actions: [
      { ...ENABLE_SWITCH_ACTION, value: false },
      { ...DISABLE_SWITCH_ACTION, value: true },
    ],
    /*
     * A row's Disable asks what the monitor's own Monitoring switch asks
     * before monitoring is turned off (MonitoringCard), naming the monitor;
     * Enable turns it on at once, as that switch does.
     */
    getRowConfirmation: (data: {
      value: boolean;
      item: Monitor;
      name: string;
    }): RowActionConfirmation | undefined => {
      // Disable Monitoring on is monitoring turned off.
      const confirmation: ModelSwitchConfirmation | undefined =
        getTurnOffMonitoringConfirmation(!data.value);

      if (!confirmation) {
        return undefined;
      }

      return {
        title: confirmation.title,
        description: confirmation.description,
        submitButtonText: confirmation.submitButtonText,
        submitButtonType: confirmation.submitButtonType,
        details: (
          <p
            data-testid="row-switch-name"
            className="break-words text-sm font-semibold text-gray-900"
          >
            {data.name}
          </p>
        ),
      };
    },
  });

  const monitorTemplateFacet: ResourceFacet = {
    key: MONITOR_TEMPLATE_FACET_KEY,
    queryField: MONITOR_TEMPLATE_FACET_QUERY_FIELD,
    label: "Template",
    icon: IconProp.Template,
    isMultiSelect: true,
    searchPlaceholder: "Search templates...",
    /*
     * "is empty" is the one that earns its place: it lists every monitor that
     * came from no template — the rows the Template column shows as "—", and
     * the ones a template rollout has not reached.
     */
    supportedOperators: ["is", "is_not", "is_empty", "is_not_empty"],
    loadOptions: async (
      projectId: ObjectID,
      searchTerm: string,
    ): Promise<Array<FilterChipDropdownOption>> => {
      const query: Query<MonitorTemplate> = {
        projectId: projectId,
      } as Query<MonitorTemplate>;

      if (searchTerm.trim()) {
        (query as unknown as Record<string, unknown>)["templateName"] =
          new Search(searchTerm.trim());
      }

      const result: ListResult<MonitorTemplate> =
        await ModelAPI.getList<MonitorTemplate>({
          modelType: MonitorTemplate,
          query: query,
          limit: 50,
          skip: 0,
          select: { _id: true, templateName: true },
          sort: { templateName: SortOrder.Ascending },
        });

      return result.data.map((template: MonitorTemplate) => {
        return {
          value: template.id?.toString() || "",
          label: template.templateName?.toString() || "",
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

      const result: ListResult<MonitorTemplate> =
        await ModelAPI.getList<MonitorTemplate>({
          modelType: MonitorTemplate,
          query: {
            projectId: projectId,
            _id: new Includes(values),
          } as Query<MonitorTemplate>,
          limit: values.length,
          skip: 0,
          select: { _id: true, templateName: true },
          sort: {},
        });

      return result.data.map((template: MonitorTemplate) => {
        return {
          value: template.id?.toString() || "",
          label: template.templateName?.toString() || "",
        };
      });
    },
    toQueryValue: (
      values: Array<string>,
      operator: FilterOperator,
    ): unknown => {
      return buildMonitorTemplateFacetQuery(values, operator);
    },
  };

  /*
   * Paired with the chip above: the column answers "which template is this
   * monitor on", the chip answers "which monitors are on that template", and
   * the answer to the second is what a user does after editing a template.
   *
   * Off by default, because most monitors are not created from a template at
   * all, so on a typical project this column is a stripe of dashes crowding
   * out status and labels - the columns people actually open this list for.
   * The chip covers the same ground for the projects that do use templates,
   * and the picker turns the column back on.
   *
   * A stored layout only protects the viewers who arranged THIS column:
   * `order` listing it beats isHiddenByDefault (see
   * ColumnPreference.getCustomizableColumns), but a layout saved before
   * #3491 added the column names it nowhere, so it falls through to this
   * default and the column is off. That is everyone who customized the table
   * before that release - the intended outcome, since they never had the
   * column to lose, but not the same thing as "only affects people who never
   * opened the picker".
   */
  const monitorTemplateColumn: Column<Monitor> = {
    field: {
      monitorTemplate: {
        _id: true,
        templateName: true,
      },
    },
    title: "Template",
    type: FieldType.Entity,
    /*
     * Deliberately NOT hideOnMobile. The two flags look complementary and are
     * not: `hideOnMobile` is enforced at render (Table/TableHeader and
     * Table/TableRow drop the column), while the picker knows nothing about
     * it. Carrying both would let a phone viewer tick "Template", watch the
     * shown-columns count go up, and get no column - and the picker is the
     * only way back to a column that ships hidden. isHiddenByDefault already
     * buys the screen space hideOnMobile was here for.
     */
    isHiddenByDefault: true,
    description: "The monitor template this monitor is linked to, if any.",
    getElement: (item: Monitor): ReactElement => {
      return <MonitorTemplateElement monitorTemplate={item.monitorTemplate} />;
    },
    getExportValue: (item: Monitor): string => {
      return item.monitorTemplate?.templateName || "";
    },
  };

  const monitorExtraFacets: Array<ResourceFacet> = [
    {
      key: "currentMonitorStatus",
      label: "Status",
      icon: IconProp.Heartbeat,
      isMultiSelect: true,
      searchPlaceholder: "Search statuses...",
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
            limit: 50,
            skip: 0,
            select: {
              _id: true,
              name: true,
              priority: true,
              color: true,
              ...ARCHIVED_FACET_SELECT,
            },
            sort: { priority: SortOrder.Ascending },
          });
        // Archived statuses too - monitors can still be in them - listed last.
        return getArchivableValueFacetOptions({
          values: result.data,
          toOption: (s: MonitorStatus): FilterChipDropdownOption => {
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
        return result.data.map((s: MonitorStatus) => {
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
      key: "monitorType",
      label: "Type",
      icon: IconProp.Cube,
      isMultiSelect: true,
      searchPlaceholder: "Search monitor types...",
      options: MonitorTypeUtil.monitorTypesAsDropdownOptions().map(
        (o: DropdownOption): FilterChipDropdownOption => {
          return {
            value: o.value.toString(),
            label: o.label,
          };
        },
      ),
      toQueryValue: (
        values: Array<string>,
        operator: FilterOperator,
      ): unknown => {
        return buildEnumFacetQuery(values, operator);
      },
    },
    ...(isScopedToTemplate ? [] : [monitorTemplateFacet]),
  ];

  /*
   * One namespace for everything this table mirrors into the URL, so the
   * column filters (persisted by ModelTable) and the facet chips (persisted
   * by useResourceOwners) always travel together. Falls back to a stable
   * per-table id for the pages that embed this table without saved views.
   */
  const tableUrlStateKey: string =
    props.saveFilterProps?.tableId || "monitors-table";

  /*
   * One chip per custom field this project has defined, appended after the
   * built-in ones. They arrive a render or two late (the definitions are
   * fetched), which is what `areFacetsLoading` below tells the bar.
   */
  const { facets: customFieldFacets, isLoading: areCustomFieldFacetsLoading } =
    useCustomFieldFacets({ customFieldsModelType: MonitorCustomField });
  const {
    getOwnersForResource,
    isLoadingOwners,
    onResourcesFetched,
    filterBar,
    emptyState: facetEmptyState,
    mergeFiltersIntoQuery,
    facetSaveState,
    restoreFacetState,
  } = useResourceOwners<Monitor>({
    ownerUserModelType: MonitorOwnerUser,
    ownerTeamModelType: MonitorOwnerTeam,
    resourceIdField: "monitorId",
    showLabelsFacet: true,
    extraFacets: [...monitorExtraFacets, ...customFieldFacets],
    areFacetsLoading: areCustomFieldFacetsLoading,
    persistKey: tableUrlStateKey,
  });

  const { bulkActions: labelBulkActions, modals: labelBulkActionModals } =
    useBulkLabelActions<Monitor>({ modelType: Monitor });

  const { bulkActions: ownerBulkActions, modals: ownerBulkActionModals } =
    useBulkOwnerActions<Monitor>({
      ownerUserModelType: MonitorOwnerUser,
      ownerTeamModelType: MonitorOwnerTeam,
      resourceIdField: "monitorId",
    });

  useEffect(() => {
    const fetchProbes: () => Promise<void> = async (): Promise<void> => {
      try {
        const allProbes: Array<Probe> = await ProbeUtil.getAllProbes();
        setProbes(allProbes);
      } catch {
        // probes will remain empty, bulk actions will still work
      }
    };

    fetchProbes();
  }, []);

  /*
   * Add Probe and Remove Probe in Bulk Actions (BulkMonitorProbeChange):
   * through the shared runner, several monitors at once, whether the probe
   * is on them read a window of monitors at a time. The form closes first,
   * as every bulk action's form does: the progress dialog, and its Stop, is
   * what the person sees while the monitors change - the form left open
   * over it hid both.
   */
  const runProbeChange: (
    probeId: ObjectID,
    mode: BulkMonitorProbeChangeMode,
  ) => Promise<void> = async (
    probeId: ObjectID,
    mode: BulkMonitorProbeChangeMode,
  ): Promise<void> => {
    const actionProps: BulkActionOnClickProps<Monitor> | null = bulkActionProps;

    setShowAddProbesModal(false);
    setShowRemoveProbesModal(false);
    setBulkActionProps(null);

    if (!actionProps) {
      return;
    }

    await runBulkMonitorProbeChange({
      actionProps: actionProps,
      probeId: probeId,
      projectId: ProjectUtil.getCurrentProjectId()!,
      mode: mode,
      translate: (reason: string): string => {
        return translator.translateTemplate(reason);
      },
    });
  };

  const handleBulkAddProbes: (probeId: ObjectID) => Promise<void> = async (
    probeId: ObjectID,
  ): Promise<void> => {
    await runProbeChange(probeId, "add");
  };

  const handleBulkRemoveProbes: (probeId: ObjectID) => Promise<void> = async (
    probeId: ObjectID,
  ): Promise<void> => {
    await runProbeChange(probeId, "remove");
  };

  // Add Probe and Remove Probe sit together in Bulk Actions (ActionMenuGroup).
  const PROBE_MENU_GROUP: string = "probes";

  const getBulkAddProbesAction: () => BulkActionButtonSchema<Monitor> =
    (): BulkActionButtonSchema<Monitor> => {
      return {
        title: "Add Probe",
        buttonStyleType: ButtonStyleType.NORMAL,
        // With Remove Probe, a run of its own in Bulk Actions.
        menuGroup: PROBE_MENU_GROUP,
        icon: IconProp.Signal,
        onClick: async (
          actionProps: BulkActionOnClickProps<Monitor>,
        ): Promise<void> => {
          setBulkActionProps(actionProps);
          setShowAddProbesModal(true);
        },
      };
    };

  const getBulkRemoveProbesAction: () => BulkActionButtonSchema<Monitor> =
    (): BulkActionButtonSchema<Monitor> => {
      return {
        title: "Remove Probe",
        buttonStyleType: ButtonStyleType.NORMAL,
        menuGroup: PROBE_MENU_GROUP,
        icon: IconProp.Close,
        onClick: async (
          actionProps: BulkActionOnClickProps<Monitor>,
        ): Promise<void> => {
          setBulkActionProps(actionProps);
          setShowRemoveProbesModal(true);
        },
      };
    };

  let cardbuttons: Array<CardButtonSchema> = props.cardButtons
    ? [...props.cardButtons]
    : [];

  if (!props.disableCreate && !isArchivedView) {
    /*
     * A card button that routes to the monitor create page rather than the
     * table's built in create modal - which means ModelTable's own permission
     * gate never sees it. Without this check a viewer could open the whole
     * wizard and only find out at submit, via a validation error about a field
     * they were never shown (issue #3306).
     */
    const createMonitorButton: CardButtonSchema | null =
      PermissionGate.gateCardButton(
        {
          title: "Create Monitor",
          phoneTitle: "Create",
          onClick: () => {
            Navigation.navigate(
              RouteUtil.populateRouteParams(
                RouteMap[PageMap.MONITOR_CREATE] as Route,
              ),
            );
          },
          buttonStyle: ButtonStyleType.NORMAL,
          icon: IconProp.Add,
        },
        new Monitor(),
        ModelAction.Create,
      );

    cardbuttons = [
      ...(props.cardButtons || []),
      ...(createMonitorButton ? [createMonitorButton] : []),
    ];
  }

  return (
    <div>
      <ModelTable<Monitor>
        modelType={Monitor}
        enableJsonImportExport={!props.disableCreate && !isArchivedView}
        name={
          isArchivedView ? MONITOR_ARCHIVE_COPY.archivedPageTitle : "Monitors"
        }
        /*
         * Two keys, because the two mounts declare two different column sets:
         * the template page's Linked Monitors card drops the Template column
         * (see monitorTemplateColumn below). A saved layout only records the
         * columns the picker was showing, so saving from the scoped page over
         * a shared key would write "monitorTemplate" out of both `order` and
         * `hidden` - and a column in neither list falls back to its declared
         * default, which is now hidden. Sharing the key would silently switch
         * the Template column back off for anyone who had turned it on.
         *
         * Accepted cost of the split: anyone who had arranged the Linked
         * Monitors card while it shared the monitors-list key loses that one
         * arrangement once, and the card returns to its declared columns.
         */
        userPreferencesKey={
          isArchivedView
            ? "monitors-archived-table"
            : isScopedToTemplate
              ? "monitor-template-monitors-table"
              : "monitors-table"
        }
        customFieldsModelType={MonitorCustomField}
        id={isArchivedView ? "monitors-archived-table" : "Monitors-table"}
        saveFilterProps={props.saveFilterProps}
        urlStateKey={tableUrlStateKey}
        bulkActions={{
          buttons: isArchivedView
            ? [...unarchiveBulkActions, ModalTableBulkDefaultActions.Delete]
            : [
                ...monitorSwitchBulkActions,
                getBulkAddProbesAction(),
                getBulkRemoveProbesAction(),
                ...labelBulkActions,
                ...ownerBulkActions,
                ...archiveBulkActions,
                ModalTableBulkDefaultActions.Delete,
              ],
        }}
        /*
         * Each row's ⋯ menu: Enable or Disable (the one that changes the
         * row), the page's own actions, then Archive - or, on the Archived
         * page, Unarchive alone.
         */
        actionButtons={
          isArchivedView
            ? [...(props.actionButtons || []), ...unarchiveRowActions]
            : [
                ...monitorSwitchRowActions,
                ...(props.actionButtons || []),
                ...archiveRowActions,
              ]
        }
        isDeleteable={props.isDeleteable !== false}
        // An archived monitor is off the main list already.
        deleteConfirmationWarning={
          isArchivedView ? undefined : ARCHIVE_INSTEAD_OF_DELETE
        }
        showViewIdButton={true}
        isEditable={false}
        isCreateable={false}
        isViewable={true}
        refreshToggle={props.refreshToggle}
        topContent={filterBar}
        emptyState={{ ...props.emptyState, ...facetEmptyState }}
        currentFacetState={facetSaveState}
        onFacetStateRestored={restoreFacetState}
        query={mergeFiltersIntoQuery(scopedQuery)}
        onFetchSuccess={(data: Array<Monitor>) => {
          onResourcesFetched(data);
        }}
        createEditModalWidth={ModalWidth.Large}
        cardProps={{
          title: props.title || "Monitors",
          description:
            props.description ||
            "Monitors check your websites, APIs, servers and other resources on a schedule, and can open an incident or alert when a check fails.",
          buttons: cardbuttons,
        }}
        videoLink={props.videoLink}
        selectMoreFields={{
          disableActiveMonitoring: true,
          isNoProbeEnabledOnThisMonitor: true,
          isAllProbesDisconnectedFromThisMonitor: true,
          monitorType: true,
          isArchived: true,
        }}
        noItemsMessage={props.noItemsMessage}
        showRefreshButton={true}
        searchableFields={["name", "description"]}
        viewPageRoute={RouteUtil.populateRouteParams(
          RouteMap[PageMap.MONITORS]!,
        )}
        filters={[
          {
            title: "Monitor ID",
            type: FieldType.Text,
            field: {
              _id: true,
            },
          },
          {
            title: "Name",
            type: FieldType.Text,
            field: {
              name: true,
            },
          },
          {
            title: "Created At",
            type: FieldType.Date,
            field: {
              createdAt: true,
            },
          },
        ]}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Element,
            getElement: (item: Monitor): ReactElement => {
              return <MonitorElement monitor={item} />;
            },
          },
          {
            field: {
              monitorType: true,
            },
            title: "Monitor Type",
            type: FieldType.Text,
            hideOnMobile: true,
          },
          {
            field: {
              currentMonitorStatus: {
                color: true,
                name: true,
              },
            },

            title: "Monitor Status",
            type: FieldType.Entity,

            getElement: (item: Monitor): ReactElement => {
              if (!item["currentMonitorStatus"]) {
                throw new BadDataException("Monitor Status not found");
              }

              /*
               * An archived monitor is not checked, so its last status is
               * frozen: say why instead of showing it as if it were live.
               */
              if (item && item.isArchived) {
                return (
                  <Statusbubble
                    shouldAnimate={false}
                    color={Gray500}
                    text={"Archived"}
                  />
                );
              }

              if (item && item["disableActiveMonitoring"]) {
                return (
                  <Statusbubble
                    shouldAnimate={false}
                    color={Gray500}
                    text={"Disabled"}
                  />
                );
              }

              if (item && item.isNoProbeEnabledOnThisMonitor) {
                return (
                  <Statusbubble
                    shouldAnimate={false}
                    color={Red500}
                    text={"Probes Not Enabled"}
                  />
                );
              }

              if (item && item.isAllProbesDisconnectedFromThisMonitor) {
                return (
                  <Statusbubble
                    shouldAnimate={false}
                    color={Red500}
                    text={"Probes Disconnected"}
                  />
                );
              }

              return (
                <Statusbubble
                  color={item.currentMonitorStatus.color || Black}
                  shouldAnimate={true}
                  text={item.currentMonitorStatus.name || "Unknown"}
                />
              );
            },
          },
          ...(isScopedToTemplate ? [] : [monitorTemplateColumn]),
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

            getElement: (item: Monitor): ReactElement => {
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
            getElement: (item: Monitor): ReactElement => {
              return (
                <OwnersCell
                  owners={getOwnersForResource(item)}
                  isLoading={isLoadingOwners}
                />
              );
            },
          },
          ...(isArchivedView ? getArchivedColumns<Monitor>() : []),
        ]}
      />

      {showAddProbesModal && (
        <BasicFormModal
          title="Add Probe to Monitors"
          description="Select a probe to add to the selected monitors. Monitors that already have this probe assigned will be skipped."
          onClose={() => {
            setShowAddProbesModal(false);
            setBulkActionProps(null);
          }}
          submitButtonText="Add Probe"
          onSubmit={async (formData: { probeId: ObjectID }) => {
            await handleBulkAddProbes(formData.probeId);
          }}
          formProps={{
            fields: [
              {
                field: {
                  probeId: true,
                },
                title: "Select Probe",
                fieldType: FormFieldSchemaType.Dropdown,
                required: true,
                dropdownOptions: probes.map((probe: Probe) => {
                  return {
                    label: probe.name || "",
                    value: probe.id?.toString() || "",
                  };
                }),
              },
            ],
          }}
        />
      )}

      {labelBulkActionModals}
      {ownerBulkActionModals}

      {showRemoveProbesModal && (
        <BasicFormModal
          title="Remove Probe from Monitors"
          description="Select a probe to remove from the selected monitors. Monitors that do not have this probe assigned will be skipped."
          onClose={() => {
            setShowRemoveProbesModal(false);
            setBulkActionProps(null);
          }}
          submitButtonText="Remove Probe"
          submitButtonStyleType={ButtonStyleType.DANGER}
          onSubmit={async (formData: { probeId: ObjectID }) => {
            await handleBulkRemoveProbes(formData.probeId);
          }}
          formProps={{
            fields: [
              {
                field: {
                  probeId: true,
                },
                title: "Select Probe",
                fieldType: FormFieldSchemaType.Dropdown,
                required: true,
                dropdownOptions: probes.map((probe: Probe) => {
                  return {
                    label: probe.name || "",
                    value: probe.id?.toString() || "",
                  };
                }),
              },
            ],
          }}
        />
      )}
    </div>
  );
};

export default MonitorsTable;
