import ProjectUtil from "Common/UI/Utils/Project";
import {
  ARCHIVED_FACET_SELECT,
  getArchivableValueFacetOptions,
} from "../ArchivableValue/ArchivedValueFacetOptions";
import LabelsElement from "Common/UI/Components/Label/Labels";
import AffectedResourcesCell from "../AffectedResources/AffectedResourcesCell";
import StatusPagesElement from "../StatusPage/StatusPagesElement";
import AppLink from "../AppLink/AppLink";
import Route from "Common/Types/API/Route";
import { Black } from "Common/Types/BrandColors";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import EmptyStateOptions from "Common/UI/Components/ModelTable/EmptyStateOptions";
import useBulkLabelActions from "Common/UI/Components/BulkUpdate/BulkLabelActions";
import useCustomFieldFacets from "../CustomFields/useCustomFieldFacets";
import useBulkOwnerActions from "Common/UI/Components/BulkUpdate/BulkOwnerActions";
import User from "Common/UI/Utils/User";
import useEventStateActions from "../EventView/useEventStateActions";
import { EventStateKind } from "../EventView/EventStateKinds";
import { isOwnedByViewer } from "../ResourceOwners/OwnedByViewer";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import Query from "Common/Types/BaseDatabase/Query";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceCustomField from "Common/Models/DatabaseModels/ScheduledMaintenanceCustomField";
import ScheduledMaintenanceOwnerTeam from "Common/Models/DatabaseModels/ScheduledMaintenanceOwnerTeam";
import ScheduledMaintenanceOwnerUser from "Common/Models/DatabaseModels/ScheduledMaintenanceOwnerUser";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import OwnersCell from "../ResourceOwners/OwnersCell";
import buildAffectedResourcesFacet from "../AffectedResources/buildAffectedResourcesFacet";
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
import ScheduledMaintenanceTemplate from "Common/Models/DatabaseModels/ScheduledMaintenanceTemplate";
import { JSONObject } from "Common/Types/JSON";
import Dictionary from "Common/Types/Dictionary";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import {
  CreateFromRecordAddress,
  CreatedRecordKind,
  getCreateFromRecordQuery,
} from "../CreateFromRecord/CreateFromRecord";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import Search from "Common/Types/BaseDatabase/Search";
import API from "Common/UI/Utils/API/API";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import IconProp from "Common/Types/Icon/IconProp";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import {
  ModalTableBulkDefaultActions,
  SaveFilterProps,
} from "Common/UI/Components/ModelTable/BaseModelTable";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import Navigation from "Common/UI/Utils/Navigation";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import { CardButtonSchema } from "Common/UI/Components/Card/Card";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import LiveDuration from "../EventView/LiveDuration";
import NoTemplatesYetModal from "../Template/NoTemplatesYetModal";
import ScheduledMaintenanceCalendar from "./ScheduledMaintenanceCalendar";
import MaintenanceCalendarSubscribeModal from "./MaintenanceCalendarSubscribeModal";
import { ScheduledMaintenanceView } from "./ScheduledMaintenanceView";
import { getAddExternalCalendarQuery } from "./ExternalCalendarAddLink";
import ScheduledMaintenanceExternalCalendar from "Common/Models/DatabaseModels/ScheduledMaintenanceExternalCalendar";
import CardMoreMenu from "Common/UI/Components/Card/CardMoreMenu";
import MoreMenuItem from "Common/UI/Components/MoreMenu/MoreMenuItem";

export interface ComponentProps {
  query?: Query<ScheduledMaintenance> | undefined;
  /*
   * The record whose Scheduled Maintenance tab this is - a host, a cluster,
   * a network site: Create Scheduled Maintenance Event and Create from
   * Template open the create page with it already picked
   * (Components/CreateFromRecord).
   */
  createFrom?: CreateFromRecordAddress | undefined;
  viewPageRoute?: Route;
  noItemsMessage?: string | undefined;
  /*
   * The page's own words for the table's empty state - an all-clear list
   * ("No active incidents") says so here. See EmptyStateOptions.
   */
  emptyState?: EmptyStateOptions | undefined;
  title?: string | undefined;
  description?: string | undefined;
  disableCreate?: boolean | undefined;
  saveFilterProps?: SaveFilterProps | undefined;
  /*
   * The events as a list - the default: All Events, Ongoing Events, and a
   * monitor's or a host's Scheduled Maintenance tab - or as a calendar: the
   * Maintenance Calendar page, with Subscribe to calendar (the team's
   * calendar link for every event of the project) and the calendars from
   * outside the project drawn beside the events. See ScheduledMaintenanceView.
   */
  view?: ScheduledMaintenanceView | undefined;
}

const ScheduledMaintenancesTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [scheduledMaintenanceTemplates, setScheduledMaintenanceTemplates] =
    useState<Array<ScheduledMaintenanceTemplate>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [
    showScheduledMaintenanceTemplateModal,
    setShowScheduledMaintenanceTemplateModal,
  ] = useState<boolean>(false);
  const [scheduledMaintenanceStates, setScheduledMaintenanceStates] = useState<
    ScheduledMaintenanceState[]
  >([]);
  const [showSubscribeModal, setShowSubscribeModal] = useState<boolean>(false);

  const view: ScheduledMaintenanceView =
    props.view || ScheduledMaintenanceView.List;

  /*
   * Mark as Ongoing, Mark as Ended (the project's own names for them) and
   * Change State, in each row's ⋯ menu and in Bulk Actions, as the event's
   * own page offers them (EventView/useEventStateActions).
   */
  const {
    rowActions: stateRowActions,
    bulkActions: stateBulkActions,
    modals: stateActionModals,
  } = useEventStateActions<ScheduledMaintenance>({
    kind: EventStateKind.ScheduledMaintenance,
    states: scheduledMaintenanceStates,
  });

  const { bulkActions: labelBulkActions, modals: labelBulkActionModals } =
    useBulkLabelActions<ScheduledMaintenance>({
      modelType: ScheduledMaintenance,
    });


  const scheduledMaintenanceExtraFacets: Array<ResourceFacet> = [
    {
      key: "currentScheduledMaintenanceState",
      label: "State",
      icon: IconProp.Flag,
      isMultiSelect: true,
      searchPlaceholder: "Search states...",
      loadOptions: async (
        projectId: ObjectID,
        searchTerm: string,
      ): Promise<Array<FilterChipDropdownOption>> => {
        const query: Query<ScheduledMaintenanceState> = {
          projectId: projectId,
        } as Query<ScheduledMaintenanceState>;
        if (searchTerm.trim()) {
          (query as unknown as Record<string, unknown>)["name"] = new Search(
            searchTerm.trim(),
          );
        }
        const result: ListResult<ScheduledMaintenanceState> =
          await ModelAPI.getList<ScheduledMaintenanceState>({
            modelType: ScheduledMaintenanceState,
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
        // Archived states too - old events are in them - listed last.
        return getArchivableValueFacetOptions({
          values: result.data,
          toOption: (
            s: ScheduledMaintenanceState,
          ): FilterChipDropdownOption => {
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
        const result: ListResult<ScheduledMaintenanceState> =
          await ModelAPI.getList<ScheduledMaintenanceState>({
            modelType: ScheduledMaintenanceState,
            query: {
              projectId: projectId,
              _id: new Includes(values),
            } as Query<ScheduledMaintenanceState>,
            limit: values.length,
            skip: 0,
            select: { _id: true, name: true, color: true },
            sort: {},
          });
        return result.data.map((s: ScheduledMaintenanceState) => {
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
    buildAffectedResourcesFacet<ScheduledMaintenance>({
      parentModelType: ScheduledMaintenance,
      // Only maintenance events can be attached to a network site.
      includeNetworkSite: true,
    }),
  ];

  /*
   * One namespace for everything this table mirrors into the URL, so the
   * column filters (persisted by ModelTable) and the facet chips (persisted
   * by useResourceOwners) always travel together. Falls back to a stable
   * per-table id for the pages that embed this table without saved views.
   */
  const tableUrlStateKey: string =
    props.saveFilterProps?.tableId || "scheduled-maintenance-table";

  /*
   * One chip per custom field this project has defined, appended after the
   * built-in ones. They arrive a render or two late (the definitions are
   * fetched), which is what `areFacetsLoading` below tells the bar.
   */
  const { facets: customFieldFacets, isLoading: areCustomFieldFacetsLoading } =
    useCustomFieldFacets({
      customFieldsModelType: ScheduledMaintenanceCustomField,
    });
  const {
    getOwnersForResource,
    isLoadingOwners,
    onResourcesFetched,
    filterBar,
    emptyState: facetEmptyState,
    mergeFiltersIntoQuery,
    facetSaveState,
    restoreFacetState,
  } = useResourceOwners<ScheduledMaintenance>({
    persistKey: tableUrlStateKey,
    ownerUserModelType: ScheduledMaintenanceOwnerUser,
    ownerTeamModelType: ScheduledMaintenanceOwnerTeam,
    resourceIdField: "scheduledMaintenanceId",
    showLabelsFacet: true,
    extraFacets: [...scheduledMaintenanceExtraFacets, ...customFieldFacets],
    areFacetsLoading: areCustomFieldFacetsLoading,
  });

  /*
   * Assign to Me and Add Owner in each row's ⋯ menu, and Assign to Me in
   * Bulk Actions beside Add and Remove Owner: who runs the maintenance. A
   * row the viewer owns already is not offered Assign to Me.
   */
  const {
    bulkActions: ownerBulkActions,
    rowActions: ownerRowActions,
    modals: ownerBulkActionModals,
  } = useBulkOwnerActions<ScheduledMaintenance>({
    ownerUserModelType: ScheduledMaintenanceOwnerUser,
    ownerTeamModelType: ScheduledMaintenanceOwnerTeam,
    resourceIdField: "scheduledMaintenanceId",
    offerAssignToMeInBulk: true,
    isOwnedByMe: (event: ScheduledMaintenance): boolean | undefined => {
      return isOwnedByViewer({
        owners: getOwnersForResource(event),
        viewerId: User.getUserId(),
      });
    },
  });

  // Fetch scheduled maintenance states on mount
  useEffect(() => {
    const fetchScheduledMaintenanceStates: () => Promise<void> =
      async (): Promise<void> => {
        try {
          const result: ListResult<ScheduledMaintenanceState> =
            await ModelAPI.getList<ScheduledMaintenanceState>({
              modelType: ScheduledMaintenanceState,
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
                isOngoingState: true,
                isScheduledState: true,
                isEndedState: true,
              },
              sort: {
                order: SortOrder.Ascending,
              },
            });
          setScheduledMaintenanceStates(result.data);
        } catch (err) {
          setError(API.getFriendlyMessage(err));
        }
      };

    fetchScheduledMaintenanceStates();
  }, []);

  let cardbuttons: Array<CardButtonSchema> = [];

  const fetchScheduledMaintenanceTemplates: () => Promise<void> =
    async (): Promise<void> => {
      setError("");
      setIsLoading(true);

      try {
        const listResult: ListResult<ScheduledMaintenanceTemplate> =
          await ModelAPI.getList<ScheduledMaintenanceTemplate>({
            modelType: ScheduledMaintenanceTemplate,
            query: {},
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            select: {
              templateName: true,
              _id: true,
            },
            sort: {},
          });

        setScheduledMaintenanceTemplates(listResult.data);
      } catch (err) {
        setError(API.getFriendlyMessage(err));
      }

      setIsLoading(false);
    };

  // The record this tab belongs to, in the create page's address.
  const createQuery: Dictionary<string> = getCreateFromRecordQuery(
    CreatedRecordKind.ScheduledMaintenance,
    props.createFrom,
  );

  const canCreateEvents: boolean =
    !props.disableCreate &&
    PermissionGate.check(new ScheduledMaintenance(), ModelAction.Create)
      .isAllowed;

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
          title: "Create from Template",
          icon: IconProp.Template,
          buttonStyle: ButtonStyleType.OUTLINE,
          onClick: async (): Promise<void> => {
            setShowScheduledMaintenanceTemplateModal(true);
            await fetchScheduledMaintenanceTemplates();
          },
        },
        new ScheduledMaintenance(),
        ModelAction.Create,
      ),
      PermissionGate.gateCardButton(
        {
          title: "Create Scheduled Maintenance Event",
          onClick: () => {
            Navigation.navigate(
              RouteUtil.getPageRoute(
                PageMap.SCHEDULED_MAINTENANCE_EVENT_CREATE,
                { query: createQuery },
              ),
            );
          },
          buttonStyle: ButtonStyleType.NORMAL,
          icon: IconProp.Add,
        },
        new ScheduledMaintenance(),
        ModelAction.Create,
      ),
    ].filter((button: CardButtonSchema | null): boolean => {
      return button !== null;
    }) as Array<CardButtonSchema>;
  }

  /*
   * The calendar's header as the list's reads: the main action as a button,
   * the rest in the ⋯ (the list folds them the same way, BaseModelTable).
   */
  const calendarMainButton: CardButtonSchema | undefined = cardbuttons.find(
    (button: CardButtonSchema): boolean => {
      return (
        button.buttonStyle === ButtonStyleType.NORMAL &&
        button.icon === IconProp.Add
      );
    },
  );

  /*
   * The calendar's ⋯ also adds a calendar from outside the project - public
   * holidays, a change freeze, another project's maintenance - to be drawn
   * beside the events: Calendar Settings, its Add dialog already open
   * (ExternalCalendarAddLink).
   */
  const externalCalendarButton: CardButtonSchema | null =
    PermissionGate.gateCardButton(
      {
        title: "Add External Calendar",
        icon: IconProp.Calendar,
        buttonStyle: ButtonStyleType.OUTLINE,
        onClick: () => {
          Navigation.navigate(
            RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_CALENDAR
              ] as Route,
            ).addQueryParams(getAddExternalCalendarQuery()),
          );
        },
      },
      new ScheduledMaintenanceExternalCalendar(),
      ModelAction.Create,
    );

  const calendarMoreButtons: Array<CardButtonSchema> = [
    ...cardbuttons.filter((button: CardButtonSchema): boolean => {
      return button !== calendarMainButton;
    }),
    ...(externalCalendarButton ? [externalCalendarButton] : []),
  ];

  const calendarMoreMenu: ReactElement | null =
    calendarMoreButtons.length > 0 ? (
      <CardMoreMenu key="scheduled-maintenance-calendar-more">
        {calendarMoreButtons.map(
          (button: CardButtonSchema, index: number): ReactElement => {
            return (
              <MoreMenuItem
                key={`calendar-more-${index}`}
                text={button.title}
                icon={button.icon}
                isDisabled={button.disabled}
                tooltip={button.tooltip}
                onClick={() => {
                  if (!button.disabled) {
                    button.onClick();
                  }
                }}
              />
            );
          },
        )}
      </CardMoreMenu>
    ) : null;

  /*
   * The main button and the ⋯ as one group, as the list's header holds them
   * (BaseModelTable): on a phone the button wraps its words beside the ⋯,
   * rather than taking the whole line and leaving the ⋯ a line of its own.
   */
  const calendarButtons: Array<CardButtonSchema | ReactElement> =
    calendarMainButton || calendarMoreMenu
      ? [
          <div
            key="scheduled-maintenance-calendar-actions"
            className="flex min-w-0 max-w-full items-center gap-3 [&_button]:md:ml-0"
            data-testid="scheduled-maintenance-calendar-actions"
          >
            {calendarMainButton ? (
              <Button
                title={calendarMainButton.title}
                buttonStyle={calendarMainButton.buttonStyle}
                buttonSize={calendarMainButton.buttonSize}
                className={calendarMainButton.className}
                icon={calendarMainButton.icon}
                disabled={calendarMainButton.disabled}
                tooltip={calendarMainButton.tooltip}
                dataTestId="card-button"
                onClick={() => {
                  if (!calendarMainButton.disabled) {
                    calendarMainButton.onClick();
                  }
                }}
              />
            ) : (
              <></>
            )}
            {calendarMoreMenu || <></>}
          </div>,
        ]
      : [];

  const cardTitle: string = props.title || "Scheduled Maintenance Events";
  const cardDescription: string =
    props.description ||
    "Announce planned work ahead of time, so your customers and status page subscribers are not caught by surprise.";

  return (
    <div>
      {view === ScheduledMaintenanceView.Calendar ? (
        <ScheduledMaintenanceCalendar
          query={mergeFiltersIntoQuery(props.query) || {}}
          states={scheduledMaintenanceStates}
          title={cardTitle}
          description={cardDescription}
          buttons={calendarButtons}
          topContent={filterBar}
          canCreate={canCreateEvents}
          getEventRoute={(maintenanceId: string): Route => {
            return RouteUtil.populateRouteParams(
              RouteMap[PageMap.SCHEDULED_MAINTENANCE_VIEW] as Route,
              {
                modelId: new ObjectID(maintenanceId),
              },
            );
          }}
          getCreateRoute={(startsAt: Date): Route => {
            return RouteUtil.getPageRoute(
              PageMap.SCHEDULED_MAINTENANCE_EVENT_CREATE,
              {
                query: {
                  ...createQuery,
                  startsAt: startsAt.toISOString(),
                },
              },
            );
          }}
          onSubscribe={() => {
            setShowSubscribeModal(true);
          }}
          externalCalendarSettingsRoute={RouteUtil.populateRouteParams(
            RouteMap[
              PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_CALENDAR
            ] as Route,
          )}
        />
      ) : (
        <ModelTable<ScheduledMaintenance>
          modelType={ScheduledMaintenance}
          id="scheduledMaintenances-table"
          name="Scheduled Maintenance Events"
          userPreferencesKey={"scheduled-maintenance-table"}
          customFieldsModelType={ScheduledMaintenanceCustomField}
          bulkActions={{
            buttons: [
              ...stateBulkActions,
              ...ownerBulkActions,
              ...labelBulkActions,
              ModalTableBulkDefaultActions.Delete,
            ],
          }}
          actionButtons={[...stateRowActions, ...ownerRowActions]}
          isDeleteable={true}
          topContent={filterBar}
          emptyState={{ ...props.emptyState, ...facetEmptyState }}
          currentFacetState={facetSaveState}
          onFacetStateRestored={restoreFacetState}
          query={mergeFiltersIntoQuery(props.query)}
          onFetchSuccess={(data: Array<ScheduledMaintenance>) => {
            onResourcesFetched(data);
          }}
          isEditable={false}
          isCreateable={false}
          isViewable={true}
          saveFilterProps={props.saveFilterProps}
          urlStateKey={tableUrlStateKey}
          showCreateForm={false}
          cardProps={{
            title: cardTitle,
            description: cardDescription,
            buttons: cardbuttons,
          }}
          noItemsMessage={props.noItemsMessage}
          showViewIdButton={true}
          viewButtonText="View Event"
          showRefreshButton={true}
          searchableFields={["title", "description"]}
          viewPageRoute={props.viewPageRoute}
          filters={[
            {
              title: "Scheduled Maintenance ID",
              type: FieldType.Text,
              field: {
                _id: true,
              },
            },
            {
              title: "Scheduled Maintenance Number",
              type: FieldType.Number,
              field: {
                scheduledMaintenanceNumber: true,
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
                monitors: {
                  name: true,
                  _id: true,
                  projectId: true,
                },
              },
              title: "Monitors Affected",
              type: FieldType.EntityArray,
              filterEntityType: Monitor,
              filterQuery: {
                projectId: ProjectUtil.getCurrentProjectId()!,
              },
              filterDropdownField: {
                label: "name",
                value: "_id",
              },
            },
            {
              field: {
                statusPages: {
                  name: true,
                  _id: true,
                  projectId: true,
                },
              },
              title: "Shown on Status Page",
              type: FieldType.EntityArray,
              filterEntityType: StatusPage,
              filterQuery: {
                projectId: ProjectUtil.getCurrentProjectId()!,
              },
              filterDropdownField: {
                label: "name",
                value: "_id",
              },
            },
            {
              field: {
                createdAt: true,
              },
              title: "Created At",
              type: FieldType.Date,
            },
            {
              field: {
                startsAt: true,
              },
              title: "Starts At",
              type: FieldType.Date,
            },
            {
              field: {
                endsAt: true,
              },
              title: "Ends At",
              type: FieldType.Date,
            },
          ]}
          selectMoreFields={{
            scheduledMaintenanceNumberWithPrefix: true,
            /*
             * The Resources Affected column lists several M2M relations under one
             * `field` block, but BaseModelTable only auto-selects the FIRST key
             * of each column.field. Include the remaining relations explicitly
             * so all attached resources actually load.
             */
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
            networkSites: {
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
          }}
          columns={[
            {
              field: {
                scheduledMaintenanceNumber: true,
              },
              title: "Scheduled Maintenance Number",
              type: FieldType.Text,
              getElement: (item: ScheduledMaintenance): ReactElement => {
                if (!item.scheduledMaintenanceNumber) {
                  return <>-</>;
                }

                const numberLabel: string =
                  item.scheduledMaintenanceNumberWithPrefix ||
                  `#${item.scheduledMaintenanceNumber}`;

                if (item._id) {
                  return (
                    <AppLink
                      className="hover:underline"
                      to={RouteUtil.populateRouteParams(
                        RouteMap[PageMap.SCHEDULED_MAINTENANCE_VIEW] as Route,
                        {
                          modelId: new ObjectID(item._id as string),
                        },
                      )}
                    >
                      <span>{numberLabel}</span>
                    </AppLink>
                  );
                }

                return <span>{numberLabel}</span>;
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
                currentScheduledMaintenanceState: {
                  _id: true,
                  name: true,
                  color: true,
                },
              },
              title: "Current State",
              type: FieldType.Entity,

              getElement: (item: ScheduledMaintenance): ReactElement => {
                if (item["currentScheduledMaintenanceState"]) {
                  return (
                    <Pill
                      color={
                        item.currentScheduledMaintenanceState.color || Black
                      }
                      text={
                        item.currentScheduledMaintenanceState.name || "Unknown"
                      }
                    />
                  );
                }

                return <></>;
              },
            },

            {
              // Unified "Resources Affected" cell mirroring the form picker.
              field: {
                monitors: {
                  name: true,
                  _id: true,
                  projectId: true,
                },
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
                networkSites: {
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
              },
              title: "Resources Affected",
              type: FieldType.EntityArray,
              hideOnMobile: true,

              getElement: (item: ScheduledMaintenance): ReactElement => {
                return (
                  <AffectedResourcesCell
                    monitors={item.monitors || []}
                    hosts={item.hosts || []}
                    kubernetesClusters={item.kubernetesClusters || []}
                    dockerHosts={item.dockerHosts || []}
                    podmanHosts={item.podmanHosts || []}
                    proxmoxClusters={item.proxmoxClusters || []}
                    vmwareVCenters={item.vmwareVCenters || []}
                    cephClusters={item.cephClusters || []}
                    storageArrays={item.storageArrays || []}
                    dockerSwarmClusters={item.dockerSwarmClusters || []}
                    iotFleets={item.iotFleets || []}
                    databaseServers={item.databaseServers || []}
                    networkSites={item.networkSites || []}
                    services={item.services || []}
                  />
                );
              },
            },
            {
              field: {
                statusPages: {
                  name: true,
                  _id: true,
                  projectId: true,
                },
              },
              title: "Shown on Status Page",
              type: FieldType.EntityArray,
              hideOnMobile: true,

              getElement: (item: ScheduledMaintenance): ReactElement => {
                return (
                  <StatusPagesElement statusPages={item["statusPages"] || []} />
                );
              },
            },
            {
              field: {
                startsAt: true,
              },
              title: "Starts At",
              type: FieldType.DateTime,
              hideOnMobile: true,
            },
            {
              field: {
                startsAt: true,
                endsAt: true,
              },
              title: "Duration",
              type: FieldType.Element,
              disableSort: true,
              disableCsvExport: true,
              getElement: (item: ScheduledMaintenance): ReactElement => {
                if (!item.startsAt || !item.endsAt) {
                  return <>-</>;
                }

                return (
                  <LiveDuration
                    startDate={item.startsAt}
                    endDate={item.endsAt}
                    isCompact={true}
                  />
                );
              },
            },
            {
              field: {
                endsAt: true,
              },
              title: "Ends At",
              type: FieldType.DateTime,
              hideOnMobile: true,
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

              getElement: (item: ScheduledMaintenance): ReactElement => {
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
              getElement: (item: ScheduledMaintenance): ReactElement => {
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
      )}

      {showSubscribeModal ? (
        <MaintenanceCalendarSubscribeModal
          onClose={() => {
            setShowSubscribeModal(false);
          }}
        />
      ) : (
        <></>
      )}

      {scheduledMaintenanceTemplates.length === 0 &&
        showScheduledMaintenanceTemplateModal &&
        !isLoading && (
          <NoTemplatesYetModal
            title="No Scheduled Maintenance Templates"
            description="This project has no scheduled maintenance templates yet. Create them in Scheduled Maintenance → Settings → Event Templates."
            templatesRoute={RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_TEMPLATES
              ] as Route,
            )}
            onClose={() => {
              setShowScheduledMaintenanceTemplateModal(false);
            }}
          />
        )}

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

      {showScheduledMaintenanceTemplateModal &&
      scheduledMaintenanceTemplates.length > 0 ? (
        <BasicFormModal<JSONObject>
          title="Create Scheduled Maintenance from Template"
          isLoading={isLoading}
          submitButtonText="Create from Template"
          onClose={() => {
            setShowScheduledMaintenanceTemplateModal(false);
            setIsLoading(false);
          }}
          onSubmit={async (data: JSONObject) => {
            const scheduledMaintenanceTemplateId: ObjectID = data[
              "scheduledMaintenanceTemplateId"
            ] as ObjectID;

            // The create page, filled in from the template.
            Navigation.navigate(
              RouteUtil.getPageRoute(
                PageMap.SCHEDULED_MAINTENANCE_EVENT_CREATE,
                {
                  query: {
                    ...createQuery,
                    scheduledMaintenanceTemplateId:
                      scheduledMaintenanceTemplateId.toString(),
                  },
                },
              ),
            );
          }}
          formProps={{
            initialValues: {},
            fields: [
              {
                field: {
                  scheduledMaintenanceTemplateId: true,
                },
                title: "Select Scheduled Maintenance Template",
                description:
                  "Select an scheduled maintenance template to create an scheduled maintenance from.",
                fieldType: FormFieldSchemaType.Dropdown,
                dropdownOptions: DropdownUtil.getDropdownOptionsFromEntityArray(
                  {
                    array: scheduledMaintenanceTemplates,
                    labelField: "templateName",
                    valueField: "_id",
                  },
                ),
                required: true,
                placeholder: "Select Template",
              },
            ],
          }}
        />
      ) : (
        <> </>
      )}

      {labelBulkActionModals}
      {ownerBulkActionModals}

      {stateActionModals}
    </div>
  );
};

export default ScheduledMaintenancesTable;
