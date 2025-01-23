import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ModelForm, { FormType } from "Common/UI/Components/Forms/ModelForm";
import Navigation from "Common/UI/Utils/Navigation";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Card from "Common/UI/Components/Card/Card";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Team from "Common/Models/DatabaseModels/Team";
import ProjectUser from "../../Utils/ProjectUser";
import DashboardNavigation from "../../Utils/Navigation";
import Label from "Common/Models/DatabaseModels/Label";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ScheduledMaintenanceTemplate from "Common/Models/DatabaseModels/ScheduledMaintenanceTemplate";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ScheduledMaintenanceTemplateOwnerTeam from "Common/Models/DatabaseModels/ScheduledMaintenanceTemplateOwnerTeam";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ScheduledMaintenanceTemplateOwnerUser from "Common/Models/DatabaseModels/ScheduledMaintenanceTemplateOwnerUser";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import RecurringArrayFieldElement from "Common/UI/Components/Events/RecurringArrayFieldElement";
import Recurring from "Common/Types/Events/Recurring";

const ScheduledMaintenanceCreate: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const [initialValuesForScheduledMaintenance, setInitialValuesForScheduledMaintenance] =
    useState<JSONObject>({});

  useEffect(() => {
    if (Navigation.getQueryStringByName("scheduledMaintenanceTemplateId")) {
      fetchScheduledMaintenanceTemplate(
        new ObjectID(
          Navigation.getQueryStringByName("scheduledMaintenanceTemplateId") || "",
        ),
      );
    } else {
      setIsLoading(false);
    }
  }, []);

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

  };

  return (
    <Fragment>
      <Card
        title="Create New Scheduled Maintenance"
        description={
          "Scheduled maintenance events are planned maintenance events that you can use to notify your team and subscribers about upcoming maintenance events."
        }
        className="mb-10"
      >
        <div>
          {isLoading && <PageLoader isVisible={true} />}
          {error && <ErrorMessage message={error} />}
          {!isLoading && !error && (
            <ModelForm<ScheduledMaintenance>
              modelType={ScheduledMaintenance}
              initialValues={initialValuesForScheduledMaintenance}
              name="Create New Scheduled Maintenance Event"
              id="create-scheduledMaintenance-form"
              steps={[
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
              fields={[
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
              onSuccess={(createdItem: ScheduledMaintenance) => {
                Navigation.navigate(
                  RouteUtil.populateRouteParams(
                    RouteUtil.populateRouteParams(
                      RouteMap[PageMap.SCHEDULED_MAINTENANCE_VIEW] as Route,
                      {
                        modelId: createdItem._id,
                      },
                    ),
                  ),
                );
              }}
              submitButtonText={"Create Scheduled Maintenance Event"}
              formType={FormType.Create}
            />
          )}
        </div>
      </Card>
    </Fragment>
  );
};

export default ScheduledMaintenanceCreate;
