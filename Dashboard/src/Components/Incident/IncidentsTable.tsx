import LabelsElement from "Common/UI/Components/Label/Labels";
import MonitorsElement from "../../Components/Monitor/Monitors";
import ProjectUtil from "Common/UI/Utils/Project";
import IncidentElement from "./Incident";
import { Black } from "Common/Types/BrandColors";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import IconProp from "Common/Types/Icon/IconProp";
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
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import Query from "Common/Types/BaseDatabase/Query";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import IncidentTemplate from "Common/Models/DatabaseModels/IncidentTemplate";
import Label from "Common/Models/DatabaseModels/Label";
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
            ModalTableBulkDefaultActions.Delete,
          ],
        }}
        modelType={Incident}
        saveFilterProps={props.saveFilterProps}
        id="incidents-table"
        isDeleteable={false}
        showCreateForm={false}
        query={props.query || {}}
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
              incidentSeverity: {
                name: true,
              },
            },
            title: "Severity",
            type: FieldType.Entity,

            filterEntityType: IncidentSeverity,
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
              currentIncidentState: {
                name: true,
                color: true,
              },
            },
            title: "State",
            type: FieldType.Entity,

            filterEntityType: IncidentState,
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
              declaredAt: true,
            },
            title: "Declared",
            type: FieldType.Date,
          },
          {
            field: {
              labels: {
                name: true,
              },
            },
            title: "Labels",
            type: FieldType.EntityArray,

            filterEntityType: Label,
            filterQuery: {
              projectId: ProjectUtil.getCurrentProjectId()!,
            },
            filterDropdownField: {
              label: "name",
              value: "_id",
            },
          },
        ]}
        columns={[
          {
            field: {
              incidentNumber: true,
              incidentNumberWithPrefix: true,
            },
            title: "Incident Number",
            type: FieldType.Text,
            getElement: (item: Incident): ReactElement => {
              if (!item.incidentNumber) {
                return <>-</>;
              }

              return <>{item.incidentNumberWithPrefix || `#${item.incidentNumber}`}</>;
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
            field: {
              monitors: {
                name: true,
                _id: true,
                projectId: true,
              },
            },
            title: "Monitors Affected",
            type: FieldType.EntityArray,

            getElement: (item: Incident): ReactElement => {
              return <MonitorsElement monitors={item["monitors"] || []} />;
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
