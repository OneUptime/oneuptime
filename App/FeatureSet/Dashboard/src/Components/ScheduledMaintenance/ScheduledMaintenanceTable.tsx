import ProjectUtil from "Common/UI/Utils/Project";
import LabelsElement from "Common/UI/Components/Label/Labels";
import AffectedResourcesCell from "../AffectedResources/AffectedResourcesCell";
import StatusPagesElement from "../StatusPage/StatusPagesElement";
import AppLink from "../AppLink/AppLink";
import Route from "Common/Types/API/Route";
import { Black } from "Common/Types/BrandColors";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import useBulkLabelActions from "Common/UI/Components/BulkUpdate/BulkLabelActions";
import useBulkOwnerActions from "Common/UI/Components/BulkUpdate/BulkOwnerActions";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import Query from "Common/Types/BaseDatabase/Query";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
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
import ObjectID from "Common/Types/ObjectID";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import Search from "Common/Types/BaseDatabase/Search";
import API from "Common/UI/Utils/API/API";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import {
  ModalTableBulkDefaultActions,
  SaveFilterProps,
} from "Common/UI/Components/ModelTable/BaseModelTable";
import Navigation from "Common/UI/Utils/Navigation";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import { CardButtonSchema } from "Common/UI/Components/Card/Card";
import {
  BulkActionButtonSchema,
  BulkActionFailed,
  BulkActionOnClickProps,
} from "Common/UI/Components/BulkUpdate/BulkUpdateForm";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ScheduledMaintenanceStateTimeline from "Common/Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import GlobalEvents from "Common/UI/Utils/GlobalEvents";
import { REFRESH_SIDEBAR_COUNT_EVENT } from "Common/UI/Components/SideMenu/CountModelSideMenuItem";

export interface ComponentProps {
  query?: Query<ScheduledMaintenance> | undefined;
  viewPageRoute?: Route;
  noItemsMessage?: string | undefined;
  title?: string | undefined;
  description?: string | undefined;
  disableCreate?: boolean | undefined;
  saveFilterProps?: SaveFilterProps | undefined;
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
  const [showBulkStateChangeModal, setShowBulkStateChangeModal] =
    useState<boolean>(false);
  const [bulkActionProps, setBulkActionProps] =
    useState<BulkActionOnClickProps<ScheduledMaintenance> | null>(null);

  const { bulkActions: labelBulkActions, modals: labelBulkActionModals } =
    useBulkLabelActions<ScheduledMaintenance>({
      modelType: ScheduledMaintenance,
    });

  const { bulkActions: ownerBulkActions, modals: ownerBulkActionModals } =
    useBulkOwnerActions<ScheduledMaintenance>({
      ownerUserModelType: ScheduledMaintenanceOwnerUser,
      ownerTeamModelType: ScheduledMaintenanceOwnerTeam,
      resourceIdField: "scheduledMaintenanceId",
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
            select: { _id: true, name: true, order: true, color: true },
            sort: { order: SortOrder.Ascending },
          });
        return result.data.map((s: ScheduledMaintenanceState) => {
          return {
            value: s.id?.toString() || "",
            label: s.name?.toString() || "",
            color: s.color?.toString() || "#9ca3af",
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
    }),
  ];

  const {
    getOwnersForResource,
    isLoadingOwners,
    onResourcesFetched,
    filterBar,
    mergeFiltersIntoQuery,
    facetSaveState,
    restoreFacetState,
  } = useResourceOwners<ScheduledMaintenance>({
    persistKey: props.saveFilterProps?.tableId,
    ownerUserModelType: ScheduledMaintenanceOwnerUser,
    ownerTeamModelType: ScheduledMaintenanceOwnerTeam,
    resourceIdField: "scheduledMaintenanceId",
    showLabelsFacet: true,
    extraFacets: scheduledMaintenanceExtraFacets,
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

  const handleBulkStateChange: (
    targetStateId: ObjectID,
  ) => Promise<void> = async (targetStateId: ObjectID): Promise<void> => {
    if (!bulkActionProps) {
      return;
    }

    const { items, onProgressInfo, onBulkActionStart, onBulkActionEnd } =
      bulkActionProps;

    const targetState: ScheduledMaintenanceState | undefined =
      scheduledMaintenanceStates.find((s: ScheduledMaintenanceState) => {
        return s.id?.toString() === targetStateId.toString();
      });

    if (!targetState) {
      return;
    }

    const targetOrder: number = targetState.order || 0;

    onBulkActionStart();

    const inProgressItems: Array<ScheduledMaintenance> = [...items];
    const totalItems: Array<ScheduledMaintenance> = [...items];
    const successItems: Array<ScheduledMaintenance> = [];
    const failedItems: Array<BulkActionFailed<ScheduledMaintenance>> = [];

    for (const scheduledMaintenance of totalItems) {
      inProgressItems.splice(inProgressItems.indexOf(scheduledMaintenance), 1);

      try {
        if (!scheduledMaintenance.id) {
          throw new Error("Scheduled Maintenance ID not found");
        }

        // Fetch the scheduled maintenance's current state order since it's not loaded in the table
        const fetchedScheduledMaintenance: ScheduledMaintenance | null =
          await ModelAPI.getItem<ScheduledMaintenance>({
            modelType: ScheduledMaintenance,
            id: scheduledMaintenance.id,
            select: {
              currentScheduledMaintenanceState: {
                order: true,
                name: true,
              },
            },
          });

        const currentOrder: number =
          fetchedScheduledMaintenance?.currentScheduledMaintenanceState
            ?.order || 0;

        // Skip if already at or past the target state
        if (currentOrder >= targetOrder) {
          const currentStateName: string =
            fetchedScheduledMaintenance?.currentScheduledMaintenanceState
              ?.name || "Unknown";
          failedItems.push({
            item: scheduledMaintenance,
            failedMessage: `Skipped: Already at "${currentStateName}" (at or past "${targetState.name}")`,
          });
        } else {
          // Create state timeline to change state
          const stateTimeline: ScheduledMaintenanceStateTimeline =
            new ScheduledMaintenanceStateTimeline();
          stateTimeline.scheduledMaintenanceId = scheduledMaintenance.id;
          stateTimeline.scheduledMaintenanceStateId = targetStateId;
          stateTimeline.projectId = ProjectUtil.getCurrentProjectId()!;

          await ModelAPI.create<ScheduledMaintenanceStateTimeline>({
            model: stateTimeline,
            modelType: ScheduledMaintenanceStateTimeline,
          });

          successItems.push(scheduledMaintenance);
        }
      } catch (err) {
        failedItems.push({
          item: scheduledMaintenance,
          failedMessage: API.getFriendlyMessage(err),
        });
      }

      onProgressInfo({
        totalItems: totalItems,
        failed: failedItems,
        successItems: successItems,
        inProgressItems: inProgressItems,
      });
    }

    onBulkActionEnd();
    setShowBulkStateChangeModal(false);
    setBulkActionProps(null);

    // Trigger sidebar badge count refresh
    GlobalEvents.dispatchEvent(REFRESH_SIDEBAR_COUNT_EVENT);
  };

  const getBulkChangeStateAction: () => BulkActionButtonSchema<ScheduledMaintenance> =
    (): BulkActionButtonSchema<ScheduledMaintenance> => {
      return {
        title: "Change State",
        buttonStyleType: ButtonStyleType.NORMAL,
        icon: IconProp.TransparentCube,
        onClick: async (
          actionProps: BulkActionOnClickProps<ScheduledMaintenance>,
        ): Promise<void> => {
          setBulkActionProps(actionProps);
          setShowBulkStateChangeModal(true);
        },
      };
    };

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

  if (!props.disableCreate) {
    // then add a card button that takes to monitor create page
    cardbuttons = [
      {
        title: "Create from Template",
        icon: IconProp.Template,
        buttonStyle: ButtonStyleType.OUTLINE,
        onClick: async (): Promise<void> => {
          setShowScheduledMaintenanceTemplateModal(true);
          await fetchScheduledMaintenanceTemplates();
        },
      },
      {
        title: "Create Scheduled Maintenance Event",
        onClick: () => {
          Navigation.navigate(
            RouteUtil.populateRouteParams(
              RouteMap[PageMap.SCHEDULED_MAINTENANCE_EVENT_CREATE] as Route,
            ),
          );
        },
        buttonStyle: ButtonStyleType.NORMAL,
        icon: IconProp.Add,
      },
    ];
  }

  return (
    <div>
      <ModelTable<ScheduledMaintenance>
        modelType={ScheduledMaintenance}
        id="scheduledMaintenances-table"
        name="Scheduled Maintenance Events"
        userPreferencesKey={"scheduled-maintenance-table"}
        bulkActions={{
          buttons: [
            getBulkChangeStateAction(),
            ...labelBulkActions,
            ...ownerBulkActions,
            ModalTableBulkDefaultActions.Delete,
          ],
        }}
        isDeleteable={false}
        topContent={filterBar}
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
        showCreateForm={false}
        cardProps={{
          title: props.title || "Scheduled Maintenance Events",
          description:
            props.description ||
            "Here is a list of scheduled maintenance events for this project.",
          buttons: cardbuttons,
        }}
        noItemsMessage={
          props.noItemsMessage || "No Scheduled Maintenance Event found."
        }
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
                    color={item.currentScheduledMaintenanceState.color || Black}
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

      {scheduledMaintenanceTemplates.length === 0 &&
        showScheduledMaintenanceTemplateModal &&
        !isLoading && (
          <ConfirmModal
            title={`No Scheduled Maintenance Templates`}
            description={`No scheduled maintenance templates have been created yet. You can create these in Project Settings > Scheduled Maintenance Templates.`}
            submitButtonText={"Close"}
            onSubmit={() => {
              return setShowScheduledMaintenanceTemplateModal(false);
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

            // Navigate to create page with the template id
            Navigation.navigate(
              RouteUtil.populateRouteParams(
                new Route(
                  (
                    RouteMap[
                      PageMap.SCHEDULED_MAINTENANCE_EVENT_CREATE
                    ] as Route
                  ).toString(),
                ).addQueryParams({
                  scheduledMaintenanceTemplateId:
                    scheduledMaintenanceTemplateId.toString(),
                }),
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

      {showBulkStateChangeModal && (
        <BasicFormModal
          title="Change Scheduled Maintenance State"
          description="Select the state to change scheduled maintenance events to. Events already at or past the selected state will be skipped."
          onClose={() => {
            setShowBulkStateChangeModal(false);
            setBulkActionProps(null);
          }}
          submitButtonText="Change State"
          onSubmit={async (formData: {
            scheduledMaintenanceStateId: ObjectID;
          }) => {
            await handleBulkStateChange(formData.scheduledMaintenanceStateId);
          }}
          formProps={{
            fields: [
              {
                field: {
                  scheduledMaintenanceStateId: true,
                },
                title: "Select State",
                fieldType: FormFieldSchemaType.Dropdown,
                required: true,
                dropdownOptions: scheduledMaintenanceStates.map(
                  (state: ScheduledMaintenanceState) => {
                    return {
                      label: state.name || "",
                      value: state.id?.toString() || "",
                    };
                  },
                ),
              },
            ],
          }}
        />
      )}
    </div>
  );
};

export default ScheduledMaintenancesTable;
