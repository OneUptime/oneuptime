import DashboardNavigation from "../../Utils/Navigation";
import ProjectUser from "../../Utils/ProjectUser";
import LabelsElement from "../Label/Labels";
import MonitorsElement from "../Monitor/Monitors";
import StatusPagesElement from "../StatusPage/StatusPagesLabel";
import Route from "Common/Types/API/Route";
import { Black } from "Common/Types/BrandColors";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import Query from "Common/Types/BaseDatabase/Query";
import Label from "Common/Models/DatabaseModels/Label";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import Team from "Common/Models/DatabaseModels/Team";
import React, { FunctionComponent, ReactElement, useState } from "react";
import ScheduledMaintenanceTemplate from "Common/Models/DatabaseModels/ScheduledMaintenanceTemplate";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ScheduledMaintenanceTemplateOwnerTeam from "Common/Models/DatabaseModels/ScheduledMaintenanceTemplateOwnerTeam";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ScheduledMaintenanceTemplateOwnerUser from "Common/Models/DatabaseModels/ScheduledMaintenanceTemplateOwnerUser";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import API from "Common/UI/Utils/API/API";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import RecurringArrayFieldElement from "Common/UI/Components/Events/RecurringArrayFieldElement";
import Recurring from "Common/Types/Events/Recurring";
import { SaveFilterProps } from "Common/UI/Components/ModelTable/BaseModelTable";

export interface ComponentProps {
  query?: Query<ScheduledMaintenance> | undefined;
  viewPageRoute?: Route;
  noItemsMessage?: string | undefined;
  title?: string | undefined;
  description?: string | undefined;
  disableCreate?: boolean | undefined;
  createInitialValues?: FormValues<ScheduledMaintenance> | undefined;
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
  const [
    initialValuesForScheduledMaintenance,
    setInitialValuesForScheduledMaintenance,
  ] = useState<JSONObject>({});

  const fetchScheduledMaintenanceTemplate: (
    id: ObjectID,
  ) => Promise<void> = async (id: ObjectID): Promise<void> => {
    setError("");
    setIsLoading(true);

    try {
      //fetch scheduledMaintenance template

      const scheduledMaintenanceTemplate: ScheduledMaintenanceTemplate | null =
        await ModelAPI.getItem<ScheduledMaintenanceTemplate>({
          modelType: ScheduledMaintenanceTemplate,
          id: id,
          select: {
            title: true,
            description: true,
            monitors: true,
            statusPages: true,
            labels: true,
            changeMonitorStatusToId: true,
            shouldStatusPageSubscribersBeNotifiedOnEventCreated: true,
            shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded: true,
            shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing:
              true,
            sendSubscriberNotificationsOnBeforeTheEvent: true,
          },
        });

      const teamsListResult: ListResult<ScheduledMaintenanceTemplateOwnerTeam> =
        await ModelAPI.getList<ScheduledMaintenanceTemplateOwnerTeam>({
          modelType: ScheduledMaintenanceTemplateOwnerTeam,
          query: {
            scheduledMaintenanceTemplate: id,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            _id: true,
            teamId: true,
          },
          sort: {},
        });

      const usersListResult: ListResult<ScheduledMaintenanceTemplateOwnerUser> =
        await ModelAPI.getList<ScheduledMaintenanceTemplateOwnerUser>({
          modelType: ScheduledMaintenanceTemplateOwnerUser,
          query: {
            scheduledMaintenanceTemplate: id,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            _id: true,
            userId: true,
          },
          sort: {},
        });

      if (scheduledMaintenanceTemplate) {
        const initialValue: JSONObject = {
          ...BaseModel.toJSONObject(
            scheduledMaintenanceTemplate,
            ScheduledMaintenanceTemplate,
          ),
          monitors: scheduledMaintenanceTemplate.monitors?.map(
            (monitor: Monitor) => {
              return monitor.id!.toString();
            },
          ),
          statusPages: scheduledMaintenanceTemplate.statusPages?.map(
            (statusPage: StatusPage) => {
              return statusPage.id!.toString();
            },
          ),
          labels: scheduledMaintenanceTemplate.labels?.map((label: Label) => {
            return label.id!.toString();
          }),
          changeMonitorStatusTo:
            scheduledMaintenanceTemplate.changeMonitorStatusToId?.toString(),
          ownerUsers: usersListResult.data.map(
            (user: ScheduledMaintenanceTemplateOwnerUser): string => {
              return user.userId!.toString() || "";
            },
          ),
          ownerTeams: teamsListResult.data.map(
            (team: ScheduledMaintenanceTemplateOwnerTeam): string => {
              return team.teamId!.toString() || "";
            },
          ),
        };

        setInitialValuesForScheduledMaintenance(initialValue);
      }
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
    setShowScheduledMaintenanceTemplateModal(false);
  };

  const fetchScheduledMaintenanceTemplates: () => Promise<void> =
    async (): Promise<void> => {
      setError("");
      setIsLoading(true);
      setInitialValuesForScheduledMaintenance({});

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

  return (
    <div>
      <ModelTable<ScheduledMaintenance>
        modelType={ScheduledMaintenance}
        id="scheduledMaintenances-table"
        name="Scheduled Maintenance Events"
        isDeleteable={false}
        query={props.query || {}}
        isEditable={false}
        isCreateable={true}
        isViewable={true}
        saveFilterProps={props.saveFilterProps}
        showCreateForm={
          Object.keys(initialValuesForScheduledMaintenance).length > 0
        }
        cardProps={{
          title: props.title || "Scheduled Maintenance Events",
          description:
            props.description ||
            "Here is a list of scheduled maintenance events for this project.",
          buttons: props.disableCreate
            ? []
            : [
                {
                  title: "Create from Template",
                  icon: IconProp.Template,
                  buttonStyle: ButtonStyleType.OUTLINE,
                  onClick: async (): Promise<void> => {
                    setShowScheduledMaintenanceTemplateModal(true);
                    await fetchScheduledMaintenanceTemplates();
                  },
                },
              ],
        }}
        noItemsMessage={
          props.noItemsMessage || "No scheduled Maintenance Event found."
        }
        createInitialValues={
          Object.keys(initialValuesForScheduledMaintenance).length > 0
            ? initialValuesForScheduledMaintenance
            : props.createInitialValues
        }
        formSteps={[
          {
            title: "Event Info",
            id: "event-info",
          },
          {
            title: "Event Time",
            id: "event-time",
          },
          {
            title: "Resources Affected",
            id: "resources-affected",
          },
          {
            title: "Status Pages",
            id: "status-pages",
          },
          {
            title: "Owners",
            id: "owners",
          },
          {
            title: "Subscribers",
            id: "subscribers",
          },
          {
            title: "Labels",
            id: "labels",
          },
        ]}
        formFields={[
          {
            field: {
              title: true,
            },
            title: "Title",
            stepId: "event-info",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Event Title",
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            stepId: "event-info",
            fieldType: FormFieldSchemaType.Markdown,
            required: false,
          },
          {
            field: {
              startsAt: true,
            },
            title: "Event Starts At",
            stepId: "event-time",
            fieldType: FormFieldSchemaType.DateTime,
            required: true,
            placeholder: "Pick Date and Time",
          },
          {
            field: {
              endsAt: true,
            },
            title: "Ends At",
            stepId: "event-time",
            fieldType: FormFieldSchemaType.DateTime,
            required: true,
            placeholder: "Pick Date and Time",
          },
          {
            field: {
              monitors: true,
            },
            title: "Monitors affected ",
            stepId: "resources-affected",
            description:
              "Select monitors affected by this scheduled maintenance.",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: Monitor,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Monitors affected",
          },
          {
            field: {
              changeMonitorStatusTo: true,
            },
            title: "Change Monitor Status to ",
            stepId: "resources-affected",
            description:
              "This will change the status of all the monitors attached when the event starts.",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownModal: {
              type: MonitorStatus,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Monitor Status",
          },
          {
            field: {
              statusPages: true,
            },
            title: "Show event on these status pages ",
            stepId: "status-pages",
            description: "Select status pages to show this event on",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: StatusPage,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Select Status Pages",
          },
          {
            overrideField: {
              ownerTeams: true,
            },
            showEvenIfPermissionDoesNotExist: true,
            title: "Owner - Teams",
            stepId: "owners",
            description:
              "Select which teams own this event. They will be notified when event status changes.",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: Team,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Select Teams",
            overrideFieldKey: "ownerTeams",
          },
          {
            overrideField: {
              ownerUsers: true,
            },
            showEvenIfPermissionDoesNotExist: true,
            title: "Owner - Users",
            stepId: "owners",
            description:
              "Select which users own this event. They will be notified when event status changes.",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            fetchDropdownOptions: async () => {
              return await ProjectUser.fetchProjectUsersAsDropdownOptions(
                DashboardNavigation.getProjectId()!,
              );
            },
            required: false,
            placeholder: "Select Users",
            overrideFieldKey: "ownerUsers",
          },

          {
            field: {
              shouldStatusPageSubscribersBeNotifiedOnEventCreated: true,
            },

            title: "Event Created: Notify Status Page Subscribers",
            stepId: "subscribers",
            description:
              "Should status page subscribers be notified when this event is created?",
            fieldType: FormFieldSchemaType.Checkbox,
            defaultValue: true,
            required: false,
          },
          {
            field: {
              shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing:
                true,
            },

            title: "Event Ongoing: Notify Status Page Subscribers",
            stepId: "subscribers",
            description:
              "Should status page subscribers be notified when this event state changes to ongoing?",
            fieldType: FormFieldSchemaType.Checkbox,
            defaultValue: true,
            required: false,
          },
          {
            field: {
              shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded:
                true,
            },

            title: "Event Ended: Notify Status Page Subscribers",
            stepId: "subscribers",
            description:
              "Should status page subscribers be notified when this event state changes to ended?",
            fieldType: FormFieldSchemaType.Checkbox,
            defaultValue: true,
            required: false,
          },
          {
            field: {
              sendSubscriberNotificationsOnBeforeTheEvent: true,
            },
            stepId: "subscribers",
            title: "Send reminders to subscribers before the event",
            description:
              "Please add a list of notification options to notify subscribers before the event",
            fieldType: FormFieldSchemaType.CustomComponent,
            getCustomElement: (
              value: FormValues<ScheduledMaintenance>,
              props: CustomElementProps,
            ) => {
              return (
                <RecurringArrayFieldElement
                  {...props}
                  initialValue={
                    value.sendSubscriberNotificationsOnBeforeTheEvent as Array<Recurring>
                  }
                />
              );
            },
            required: false,
          },
          {
            field: {
              labels: true,
            },
            title: "Labels ",
            stepId: "labels",
            description:
              "Team members with access to these labels will only be able to access this resource. This is optional and an advanced feature.",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: Label,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Labels",
          },
        ]}
        showViewIdButton={true}
        viewButtonText="View Event"
        showRefreshButton={true}
        viewPageRoute={props.viewPageRoute}
        filters={[
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
              },
            },
            title: "Current State",
            type: FieldType.Entity,
            filterEntityType: ScheduledMaintenanceState,
            filterQuery: {
              projectId: DashboardNavigation.getProjectId()!,
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
              projectId: DashboardNavigation.getProjectId()!,
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
              projectId: DashboardNavigation.getProjectId()!,
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
          {
            field: {
              labels: {
                name: true,
                color: true,
              },
            },
            title: "Labels",
            type: FieldType.EntityArray,
            filterEntityType: Label,
            filterQuery: {
              projectId: DashboardNavigation.getProjectId()!,
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
            field: {
              monitors: {
                name: true,
                _id: true,
                projectId: true,
              },
            },
            title: "Monitors Affected",
            type: FieldType.EntityArray,

            getElement: (item: ScheduledMaintenance): ReactElement => {
              return <MonitorsElement monitors={item["monitors"] || []} />;
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
          },
          {
            field: {
              endsAt: true,
            },
            title: "Ends At",
            type: FieldType.DateTime,
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

            getElement: (item: ScheduledMaintenance): ReactElement => {
              return <LabelsElement labels={item["labels"] || []} />;
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
            await fetchScheduledMaintenanceTemplate(
              data["scheduledMaintenanceTemplateId"] as ObjectID,
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
    </div>
  );
};

export default ScheduledMaintenancesTable;
