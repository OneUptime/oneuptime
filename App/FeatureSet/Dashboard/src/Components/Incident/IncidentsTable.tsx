import LabelsElement from "Common/UI/Components/Label/Labels";
import AffectedResourcesCell from "../AffectedResources/AffectedResourcesCell";
import ProjectUtil from "Common/UI/Utils/Project";
import IncidentElement from "./Incident";
import AppLink from "../AppLink/AppLink";
import { Black } from "Common/Types/BrandColors";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import {
  ModalTableBulkDefaultActions,
  SaveFilterProps,
} from "Common/UI/Components/ModelTable/BaseModelTable";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import useBulkLabelActions from "Common/UI/Components/BulkUpdate/BulkLabelActions";
import useBulkOwnerActions from "Common/UI/Components/BulkUpdate/BulkOwnerActions";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import Query from "Common/Types/BaseDatabase/Query";
import Search from "Common/Types/BaseDatabase/Search";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentOwnerTeam from "Common/Models/DatabaseModels/IncidentOwnerTeam";
import IncidentOwnerUser from "Common/Models/DatabaseModels/IncidentOwnerUser";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import IncidentTemplate from "Common/Models/DatabaseModels/IncidentTemplate";
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
import Monitor from "Common/Models/DatabaseModels/Monitor";
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
import Navigation from "Common/UI/Utils/Navigation";
import {
  BulkActionButtonSchema,
  BulkActionFailed,
  BulkActionOnClickProps,
} from "Common/UI/Components/BulkUpdate/BulkUpdateForm";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import IncidentStateTimeline from "Common/Models/DatabaseModels/IncidentStateTimeline";
import GlobalEvents from "Common/UI/Utils/GlobalEvents";
import { REFRESH_SIDEBAR_COUNT_EVENT } from "Common/UI/Components/SideMenu/CountModelSideMenuItem";

export interface ComponentProps {
  query?: Query<Incident> | undefined;
  noItemsMessage?: string | undefined;
  title?: string | undefined;
  description?: string | undefined;
  disableCreate?: boolean | undefined;
  saveFilterProps?: SaveFilterProps | undefined;
}

const IncidentsTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [incidentTemplates, setIncidentTemplates] = useState<
    Array<IncidentTemplate>
  >([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [showIncidentTemplateModal, setShowIncidentTemplateModal] =
    useState<boolean>(false);
  const [incidentStates, setIncidentStates] = useState<IncidentState[]>([]);
  const [showBulkStateChangeModal, setShowBulkStateChangeModal] =
    useState<boolean>(false);
  const [bulkActionProps, setBulkActionProps] =
    useState<BulkActionOnClickProps<Incident> | null>(null);

  const { bulkActions: labelBulkActions, modals: labelBulkActionModals } =
    useBulkLabelActions<Incident>({ modelType: Incident });

  const { bulkActions: ownerBulkActions, modals: ownerBulkActionModals } =
    useBulkOwnerActions<Incident>({
      ownerUserModelType: IncidentOwnerUser,
      ownerTeamModelType: IncidentOwnerTeam,
      resourceIdField: "incidentId",
    });

  const incidentExtraFacets: Array<ResourceFacet> = [
    {
      key: "currentIncidentState",
      label: "State",
      icon: IconProp.Flag,
      isMultiSelect: true,
      searchPlaceholder: "Search states...",
      loadOptions: async (
        projectId: ObjectID,
        searchTerm: string,
      ): Promise<Array<FilterChipDropdownOption>> => {
        const query: Query<IncidentState> = {
          projectId: projectId,
        } as Query<IncidentState>;
        if (searchTerm.trim()) {
          (query as unknown as Record<string, unknown>)["name"] = new Search(
            searchTerm.trim(),
          );
        }
        const result: ListResult<IncidentState> =
          await ModelAPI.getList<IncidentState>({
            modelType: IncidentState,
            query: query,
            limit: 50,
            skip: 0,
            select: { _id: true, name: true, order: true, color: true },
            sort: { order: SortOrder.Ascending },
          });
        return result.data.map((s: IncidentState) => {
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
        const result: ListResult<IncidentState> =
          await ModelAPI.getList<IncidentState>({
            modelType: IncidentState,
            query: {
              projectId: projectId,
              _id: new Includes(values),
            } as Query<IncidentState>,
            limit: values.length,
            skip: 0,
            select: { _id: true, name: true, color: true },
            sort: {},
          });
        return result.data.map((s: IncidentState) => {
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
      key: "incidentSeverity",
      label: "Severity",
      icon: IconProp.Fire,
      isMultiSelect: true,
      searchPlaceholder: "Search severities...",
      loadOptions: async (
        projectId: ObjectID,
        searchTerm: string,
      ): Promise<Array<FilterChipDropdownOption>> => {
        const query: Query<IncidentSeverity> = {
          projectId: projectId,
        } as Query<IncidentSeverity>;
        if (searchTerm.trim()) {
          (query as unknown as Record<string, unknown>)["name"] = new Search(
            searchTerm.trim(),
          );
        }
        const result: ListResult<IncidentSeverity> =
          await ModelAPI.getList<IncidentSeverity>({
            modelType: IncidentSeverity,
            query: query,
            limit: 50,
            skip: 0,
            select: { _id: true, name: true, order: true, color: true },
            sort: { order: SortOrder.Ascending },
          });
        return result.data.map((s: IncidentSeverity) => {
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
        const result: ListResult<IncidentSeverity> =
          await ModelAPI.getList<IncidentSeverity>({
            modelType: IncidentSeverity,
            query: {
              projectId: projectId,
              _id: new Includes(values),
            } as Query<IncidentSeverity>,
            limit: values.length,
            skip: 0,
            select: { _id: true, name: true, color: true },
            sort: {},
          });
        return result.data.map((s: IncidentSeverity) => {
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
      key: "monitors",
      label: "Monitor",
      icon: IconProp.Signal,
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
        return result.data.map((m: Monitor) => {
          return {
            value: m.id?.toString() || "",
            label: m.name?.toString() || "",
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
        return result.data.map((m: Monitor) => {
          return {
            value: m.id?.toString() || "",
            label: m.name?.toString() || "",
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

  const {
    getOwnersForResource,
    isLoadingOwners,
    onResourcesFetched,
    filterBar,
    mergeFiltersIntoQuery,
    facetSaveState,
    restoreFacetState,
  } = useResourceOwners<Incident>({
    ownerUserModelType: IncidentOwnerUser,
    ownerTeamModelType: IncidentOwnerTeam,
    resourceIdField: "incidentId",
    showLabelsFacet: true,
    extraFacets: incidentExtraFacets,
  });

  // Fetch incident states on mount
  useEffect(() => {
    const fetchIncidentStates: () => Promise<void> =
      async (): Promise<void> => {
        try {
          const result: ListResult<IncidentState> =
            await ModelAPI.getList<IncidentState>({
              modelType: IncidentState,
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
                isAcknowledgedState: true,
                isCreatedState: true,
              },
              sort: {
                order: SortOrder.Ascending,
              },
            });
          setIncidentStates(result.data);
        } catch (err) {
          setError(API.getFriendlyMessage(err));
        }
      };

    fetchIncidentStates();
  }, []);

  const handleBulkStateChange: (
    targetStateId: ObjectID,
  ) => Promise<void> = async (targetStateId: ObjectID): Promise<void> => {
    if (!bulkActionProps) {
      return;
    }

    const { items, onProgressInfo, onBulkActionStart, onBulkActionEnd } =
      bulkActionProps;

    const targetState: IncidentState | undefined = incidentStates.find(
      (s: IncidentState) => {
        return s.id?.toString() === targetStateId.toString();
      },
    );

    if (!targetState) {
      return;
    }

    const targetOrder: number = targetState.order || 0;

    onBulkActionStart();

    const inProgressItems: Array<Incident> = [...items];
    const totalItems: Array<Incident> = [...items];
    const successItems: Array<Incident> = [];
    const failedItems: Array<BulkActionFailed<Incident>> = [];

    for (const incident of totalItems) {
      inProgressItems.splice(inProgressItems.indexOf(incident), 1);

      try {
        if (!incident.id) {
          throw new Error("Incident ID not found");
        }

        // Fetch the incident's current state order since it's not loaded in the table
        const fetchedIncident: Incident | null =
          await ModelAPI.getItem<Incident>({
            modelType: Incident,
            id: incident.id,
            select: {
              currentIncidentState: {
                order: true,
                name: true,
              },
            },
          });

        const currentOrder: number =
          fetchedIncident?.currentIncidentState?.order || 0;

        // Skip if already at or past the target state
        if (currentOrder >= targetOrder) {
          const currentStateName: string =
            fetchedIncident?.currentIncidentState?.name || "Unknown";
          failedItems.push({
            item: incident,
            failedMessage: `Skipped: Already at "${currentStateName}" (at or past "${targetState.name}")`,
          });
        } else {
          // Create state timeline to change state
          const stateTimeline: IncidentStateTimeline =
            new IncidentStateTimeline();
          stateTimeline.incidentId = incident.id;
          stateTimeline.incidentStateId = targetStateId;
          stateTimeline.projectId = ProjectUtil.getCurrentProjectId()!;

          await ModelAPI.create<IncidentStateTimeline>({
            model: stateTimeline,
            modelType: IncidentStateTimeline,
          });

          successItems.push(incident);
        }
      } catch (err) {
        failedItems.push({
          item: incident,
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

  const getBulkChangeStateAction: () => BulkActionButtonSchema<Incident> =
    (): BulkActionButtonSchema<Incident> => {
      return {
        title: "Change State",
        buttonStyleType: ButtonStyleType.NORMAL,
        icon: IconProp.TransparentCube,
        onClick: async (
          actionProps: BulkActionOnClickProps<Incident>,
        ): Promise<void> => {
          setBulkActionProps(actionProps);
          setShowBulkStateChangeModal(true);
        },
      };
    };

  const fetchIncidentTemplates: () => Promise<void> =
    async (): Promise<void> => {
      setError("");
      setIsLoading(true);

      try {
        const listResult: ListResult<IncidentTemplate> =
          await ModelAPI.getList<IncidentTemplate>({
            modelType: IncidentTemplate,
            query: {},
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            select: {
              templateName: true,
              _id: true,
            },
            sort: {},
          });

        setIncidentTemplates(listResult.data);
      } catch (err) {
        setError(API.getFriendlyMessage(err));
      }

      setIsLoading(false);
    };

  let cardbuttons: Array<CardButtonSchema> = [];

  if (!props.disableCreate) {
    // then add a card button that takes to monitor create page
    cardbuttons = [
      {
        title: "Create from Template",
        icon: IconProp.Template,
        buttonStyle: ButtonStyleType.OUTLINE,
        onClick: async (): Promise<void> => {
          setShowIncidentTemplateModal(true);
          await fetchIncidentTemplates();
        },
      },
      {
        title: "Declare Incident",
        onClick: () => {
          Navigation.navigate(
            RouteUtil.populateRouteParams(
              RouteMap[PageMap.INCIDENT_CREATE] as Route,
            ),
          );
        },
        buttonStyle: ButtonStyleType.NORMAL,
        icon: IconProp.Add,
      },
    ];
  }

  return (
    <>
      <ModelTable<Incident>
        name="Incidents"
        userPreferencesKey="incidents-table"
        bulkActions={{
          buttons: [
            getBulkChangeStateAction(),
            ...labelBulkActions,
            ...ownerBulkActions,
            ModalTableBulkDefaultActions.Delete,
          ],
        }}
        modelType={Incident}
        saveFilterProps={props.saveFilterProps}
        id="incidents-table"
        isDeleteable={false}
        showCreateForm={false}
        topContent={filterBar}
        currentFacetState={facetSaveState}
        onFacetStateRestored={restoreFacetState}
        query={mergeFiltersIntoQuery(props.query)}
        onFetchSuccess={(data: Array<Incident>) => {
          onResourcesFetched(data);
        }}
        isEditable={false}
        isCreateable={false}
        isViewable={true}
        cardProps={{
          title: props.title || "Incidents",
          buttons: cardbuttons,
          description:
            props.description ||
            "Here is a list of incidents for this project.",
        }}
        createVerb="Declare"
        noItemsMessage={props.noItemsMessage || "No incidents found."}
        showRefreshButton={true}
        searchableFields={["title", "description"]}
        showViewIdButton={true}
        viewPageRoute={RouteUtil.populateRouteParams(
          RouteMap[PageMap.INCIDENTS]!,
        )}
        filters={[
          {
            title: "Incident ID",
            type: FieldType.Text,
            field: {
              _id: true,
            },
          },
          {
            title: "Incident Number",
            type: FieldType.Number,
            field: {
              incidentNumber: true,
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
              declaredAt: true,
            },
            title: "Declared",
            type: FieldType.Date,
          },
        ]}
        selectMoreFields={{
          incidentNumberWithPrefix: true,
          isPrivate: true,
        }}
        columns={[
          {
            field: {
              incidentNumber: true,
            },
            title: "Incident Number",
            type: FieldType.Text,
            getElement: (item: Incident): ReactElement => {
              if (!item.incidentNumber) {
                return <>-</>;
              }

              const numberLabel: string =
                item.incidentNumberWithPrefix || `#${item.incidentNumber}`;

              const numberContent: ReactElement = item._id ? (
                <AppLink
                  className="hover:underline"
                  to={RouteUtil.populateRouteParams(
                    RouteMap[PageMap.INCIDENT_VIEW] as Route,
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
                      title="Private incident — visible only to its owners, project admins, and project owners"
                      className="inline-flex items-center gap-1 ml-2 px-1.5 py-0.5 rounded text-xs font-medium bg-red-50 text-red-700 border border-red-200 align-middle"
                    >
                      <Icon icon={IconProp.Lock} className="w-3 h-3" />
                      Private
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

            getElement: (item: Incident): ReactElement => {
              return <IncidentElement incident={item} />;
            },
          },
          {
            field: {
              currentIncidentState: {
                name: true,
                color: true,
              },
            },
            title: "State",
            type: FieldType.Entity,

            getElement: (item: Incident): ReactElement => {
              if (item["currentIncidentState"]) {
                return (
                  <Pill
                    isMinimal={true}
                    color={item.currentIncidentState.color || Black}
                    text={item.currentIncidentState.name || "Unknown"}
                  />
                );
              }

              return <></>;
            },
          },
          {
            field: {
              incidentSeverity: {
                name: true,
                color: true,
              },
            },

            title: "Severity",
            type: FieldType.Entity,
            hideOnMobile: true,
            getElement: (item: Incident): ReactElement => {
              if (item["incidentSeverity"]) {
                return (
                  <Pill
                    isMinimal={true}
                    color={item.incidentSeverity.color || Black}
                    text={item.incidentSeverity.name || "Unknown"}
                  />
                );
              }

              return <></>;
            },
          },
          {
            /*
             * Unified "Resources Affected" cell — mirrors the form's single
             * picker. Pulls monitors + hosts + k8s + docker in one selection
             * so the row shows whatever the user actually attached.
             */
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

            getElement: (item: Incident): ReactElement => {
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
              declaredAt: true,
            },
            title: "Declared",
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

            getElement: (item: Incident): ReactElement => {
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
            getElement: (item: Incident): ReactElement => {
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

      {incidentTemplates.length === 0 &&
        showIncidentTemplateModal &&
        !isLoading && (
          <ConfirmModal
            title={`No Incident Templates`}
            description={`No incident templates have been created yet. You can create these in Project Settings > Incident Templates.`}
            submitButtonText={"Close"}
            onSubmit={() => {
              return setShowIncidentTemplateModal(false);
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

      {showIncidentTemplateModal && incidentTemplates.length > 0 ? (
        <BasicFormModal<JSONObject>
          title="Create Incident from Template"
          isLoading={isLoading}
          submitButtonText="Create from Template"
          onClose={() => {
            setShowIncidentTemplateModal(false);
            setIsLoading(false);
          }}
          onSubmit={async (data: JSONObject) => {
            const incidentTemplateId: ObjectID = data[
              "incidentTemplateId"
            ] as ObjectID;

            // Navigate to declare incident page with the template id
            Navigation.navigate(
              RouteUtil.populateRouteParams(
                new Route(
                  (RouteMap[PageMap.INCIDENT_CREATE] as Route).toString(),
                ).addQueryParams({
                  incidentTemplateId: incidentTemplateId.toString(),
                }),
              ),
            );
          }}
          formProps={{
            initialValues: {},
            fields: [
              {
                field: {
                  incidentTemplateId: true,
                },
                title: "Select Incident Template",
                description:
                  "Select an incident template to create an incident from.",
                fieldType: FormFieldSchemaType.Dropdown,
                dropdownOptions: DropdownUtil.getDropdownOptionsFromEntityArray(
                  {
                    array: incidentTemplates,
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
          title="Change Incident State"
          description="Select the state to change incidents to. Incidents already at or past the selected state will be skipped."
          onClose={() => {
            setShowBulkStateChangeModal(false);
            setBulkActionProps(null);
          }}
          submitButtonText="Change State"
          onSubmit={async (formData: { incidentStateId: ObjectID }) => {
            await handleBulkStateChange(formData.incidentStateId);
          }}
          formProps={{
            fields: [
              {
                field: {
                  incidentStateId: true,
                },
                title: "Select State",
                fieldType: FormFieldSchemaType.Dropdown,
                required: true,
                dropdownOptions: incidentStates.map((state: IncidentState) => {
                  return {
                    label: state.name || "",
                    value: state.id?.toString() || "",
                  };
                }),
              },
            ],
          }}
        />
      )}
    </>
  );
};

export default IncidentsTable;
