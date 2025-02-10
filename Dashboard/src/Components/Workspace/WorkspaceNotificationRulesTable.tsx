import DashboardNavigation from "../../Utils/Navigation";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Label from "Common/Models/DatabaseModels/Label";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
} from "react";
import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import WorkspaceNotificationRule from "Common/Models/DatabaseModels/WorkspaceNotificationRule";
import NotificationRuleEventType from "Common/Types/Workspace/NotificationRules/EventType";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import Team from "Common/Models/DatabaseModels/Team";
import User from "Common/Models/DatabaseModels/User";
import API from "Common/Utils/API";
import Exception from "Common/Types/Exception/Exception";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ListResult from "Common/UI/Utils/BaseDatabase/ListResult";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import NotificationRuleForm from "./NotificationRuleForm/NotificationRuleForm";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import SlackNotificationRule from "Common/Types/Workspace/NotificationRules/SlackNotificationRule";
import NotificawtionRuleViewElement from "./NotificationRuleViewElement/NotificationRuleViewElement";
import { ShowAs } from "Common/UI/Components/ModelTable/BaseModelTable";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import FilterCondition from "Common/Types/Filter/FilterCondition";
import NotificationRuleCondition from "Common/Types/Workspace/NotificationRules/NotificationRuleCondition";

export interface ComponentProps {
  workspaceType: WorkspaceType;
  eventType: NotificationRuleEventType;
}

const WorkspaceNotificationRuleTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isLoading, setIsLoading] = React.useState<boolean>(false);
  const [error, setError] = React.useState<string | undefined>(undefined);

  const [monitors, setMonitors] = React.useState<Array<Monitor>>([]);
  const [labels, setLabels] = React.useState<Array<Label>>([]);
  const [alertStates, setAlertStates] = React.useState<Array<AlertState>>([]);
  const [alertSeverities, setAlertSeverities] = React.useState<
    Array<AlertSeverity>
  >([]);
  const [incidentSeverities, setIncidentSeverities] = React.useState<
    Array<IncidentSeverity>
  >([]);
  const [incidentStates, setIncidentStates] = React.useState<
    Array<IncidentState>
  >([]);
  const [scheduledMaintenanceStates, setScheduledMaintenanceStates] =
    React.useState<Array<ScheduledMaintenanceState>>([]);
  const [monitorStatus, setMonitorStatus] = React.useState<
    Array<MonitorStatus>
  >([]);
  const [teams, setTeams] = React.useState<Array<Team>>([]);
  const [users, setUsers] = React.useState<Array<User>>([]);

  const loadPage: PromiseVoidFunction = async (): Promise<void> => {
    try {
      setIsLoading(true);
      setError(undefined);

      const monitors: ListResult<Monitor> = await ModelAPI.getList({
        modelType: Monitor,
        query: {
          projectId: DashboardNavigation.getProjectId()!,
        },
        select: {
          name: true,
          _id: true,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        sort: {
          name: SortOrder.Ascending,
        },
      });

      setMonitors(monitors.data);

      const labels: ListResult<Label> = await ModelAPI.getList({
        modelType: Label,
        query: {
          projectId: DashboardNavigation.getProjectId()!,
        },
        select: {
          name: true,
          _id: true,
          color: true,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        sort: {
          name: SortOrder.Ascending,
        },
      });

      setLabels(labels.data);

      const alertStates: ListResult<AlertState> = await ModelAPI.getList({
        modelType: AlertState,
        query: {
          projectId: DashboardNavigation.getProjectId()!,
        },
        select: {
          name: true,
          _id: true,
          color: true,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        sort: {
          name: SortOrder.Ascending,
        },
      });

      setAlertStates(alertStates.data);

      const alertSeverities: ListResult<AlertSeverity> = await ModelAPI.getList(
        {
          modelType: AlertSeverity,
          query: {
            projectId: DashboardNavigation.getProjectId()!,
          },
          select: {
            name: true,
            _id: true,
            color: true,
          },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          sort: {
            name: SortOrder.Ascending,
          },
        },
      );

      setAlertSeverities(alertSeverities.data);

      const incidentSeverities: ListResult<IncidentSeverity> =
        await ModelAPI.getList({
          modelType: IncidentSeverity,
          query: {
            projectId: DashboardNavigation.getProjectId()!,
          },
          select: {
            name: true,
            _id: true,
            color: true,
          },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          sort: {
            name: SortOrder.Ascending,
          },
        });

      setIncidentSeverities(incidentSeverities.data);

      const incidentStates: ListResult<IncidentState> = await ModelAPI.getList({
        modelType: IncidentState,
        query: {
          projectId: DashboardNavigation.getProjectId()!,
        },
        select: {
          name: true,
          _id: true,
          color: true,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        sort: {
          name: SortOrder.Ascending,
        },
      });

      setIncidentStates(incidentStates.data);

      const scheduledMaintenanceStates: ListResult<ScheduledMaintenanceState> =
        await ModelAPI.getList({
          modelType: ScheduledMaintenanceState,
          query: {
            projectId: DashboardNavigation.getProjectId()!,
          },
          select: {
            name: true,
            _id: true,
            color: true,
          },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          sort: {
            name: SortOrder.Ascending,
          },
        });

      setScheduledMaintenanceStates(scheduledMaintenanceStates.data);

      const monitorStatus: ListResult<MonitorStatus> = await ModelAPI.getList({
        modelType: MonitorStatus,
        query: {
          projectId: DashboardNavigation.getProjectId()!,
        },
        select: {
          name: true,
          _id: true,
          color: true,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        sort: {
          name: SortOrder.Ascending,
        },
      });

      setMonitorStatus(monitorStatus.data);

      const teams: ListResult<Team> = await ModelAPI.getList({
        modelType: Team,
        query: {
          projectId: DashboardNavigation.getProjectId()!,
        },
        select: {
          name: true,
          _id: true,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        sort: {
          name: SortOrder.Ascending,
        },
      });

      setTeams(teams.data);

      const teamMembers: ListResult<TeamMember> = await ModelAPI.getList({
        modelType: TeamMember,
        query: {
          projectId: DashboardNavigation.getProjectId()!,
        },
        select: {
          _id: true,
          user: {
            name: true,
            email: true,
            _id: true,
          },
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        sort: {},
      });

      const users: Array<User> = teamMembers.data.map(
        (teamMember: TeamMember) => {
          return teamMember.user!;
        },
      );

      // make sure user is unique by id

      const uniqueUsers: Array<User> = [];

      users.forEach((user: User) => {
        if (
          !uniqueUsers.find((u: User) => {
            return u._id?.toString() === user._id?.toString();
          })
        ) {
          uniqueUsers.push(user);
        }
      });

      setUsers(uniqueUsers);
    } catch (err) {
      setError(API.getFriendlyErrorMessage(err as Exception));
    }
    setIsLoading(false);
  };

  useEffect(() => {
    loadPage().catch((err: Exception) => {
      setError(API.getFriendlyErrorMessage(err as Exception));
    });
  }, []);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  type RemoveFilterWithNoValues = (
    notificationRule: SlackNotificationRule,
  ) => SlackNotificationRule;

  const removeFiltersWithNoValues: RemoveFilterWithNoValues = (
    notificationRule: SlackNotificationRule,
  ): SlackNotificationRule => {
    if (notificationRule.filters && notificationRule.filters.length > 0) {
      notificationRule.filters = notificationRule.filters.filter(
        (filter: NotificationRuleCondition) => {
          if (
            filter.value &&
            filter.value &&
            Array.isArray(filter.value) &&
            filter.value.length > 0
          ) {
            return true;
          }

          return false;
        },
      );

      if (!notificationRule.filterCondition) {
        notificationRule.filterCondition = FilterCondition.Any;
      }
    }

    return notificationRule;
  };

  return (
    <Fragment>
      <ModelTable<WorkspaceNotificationRule>
        modelType={WorkspaceNotificationRule}
        query={{
          projectId: DashboardNavigation.getProjectId()!,
          eventType: props.eventType,
        }}
        singularName={`${props.eventType} Notification Rule`}
        pluralName={`${props.eventType} Notification Rules`}
        id="servie-provider-table"
        name="Settings > Workspace Notification Rules"
        isDeleteable={true}
        isEditable={true}
        createEditModalWidth={ModalWidth.Large}
        isCreateable={true}
        cardProps={{
          title: `${props.eventType} - ${props.workspaceType} Notification Rules`,
          description: `Manage ${props.eventType} notification rules for ${props.workspaceType}.`,
        }}
        showAs={ShowAs.List}
        noItemsMessage={"No notification rules found."}
        onBeforeCreate={(values: WorkspaceNotificationRule) => {
          values.eventType = props.eventType;
          values.projectId = DashboardNavigation.getProjectId()!;
          values.workspaceType = props.workspaceType;
          values.notificationRule = removeFiltersWithNoValues(
            values.notificationRule as SlackNotificationRule,
          );
          return Promise.resolve(values);
        }}
        onBeforeEdit={(values: WorkspaceNotificationRule) => {
          values.notificationRule = removeFiltersWithNoValues(
            values.notificationRule as SlackNotificationRule,
          );
          return Promise.resolve(values);
        }}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Rule Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            stepId: "basic",
            placeholder: "Notify DevOps Team",
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              description: true,
            },
            stepId: "basic",
            title: "Rule Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Notify DevOps Team when a new incident is created.",
          },
          {
            field: {
              notificationRule: true,
            },
            title: "Notification Rules",
            fieldType: FormFieldSchemaType.CustomComponent,
            required: true,
            stepId: "rules",
            getCustomElement: (
              value: FormValues<WorkspaceNotificationRule>,
              elementProps: CustomElementProps,
            ): ReactElement => {
              return (
                <NotificationRuleForm
                  {...elementProps}
                  value={value.notificationRule as SlackNotificationRule}
                  eventType={props.eventType}
                  monitors={monitors}
                  labels={labels}
                  alertStates={alertStates}
                  alertSeverities={alertSeverities}
                  incidentSeverities={incidentSeverities}
                  incidentStates={incidentStates}
                  scheduledMaintenanceStates={scheduledMaintenanceStates}
                  monitorStatus={monitorStatus}
                  workspaceType={props.workspaceType}
                  teams={teams}
                  users={users}
                />
              );
            },
          },
        ]}
        formSteps={[
          {
            title: "Basic",
            id: "basic",
          },
          {
            title: "Rules",
            id: "rules",
          },
        ]}
        showRefreshButton={true}
        filters={[
          {
            field: {
              name: true,
            },
            type: FieldType.Text,
            title: "Rule Name",
          },
          {
            field: {
              description: true,
            },
            type: FieldType.Text,
            title: "Rule Description",
          },
        ]}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Rule Name",
            type: FieldType.Text,
          },
          {
            field: {
              description: true,
            },
            noValueMessage: "-",
            title: "Rule Description",
            type: FieldType.Text,
          },
          {
            field: {
              notificationRule: true,
            },
            title: "Notification Rules",
            type: FieldType.Element,
            getElement: (value: WorkspaceNotificationRule): ReactElement => {
              return (
                <Fragment>
                  <NotificawtionRuleViewElement
                    value={value.notificationRule as SlackNotificationRule}
                    eventType={props.eventType}
                    monitors={monitors}
                    labels={labels}
                    alertStates={alertStates}
                    alertSeverities={alertSeverities}
                    incidentSeverities={incidentSeverities}
                    incidentStates={incidentStates}
                    scheduledMaintenanceStates={scheduledMaintenanceStates}
                    monitorStatus={monitorStatus}
                    workspaceType={props.workspaceType}
                    teams={teams}
                    users={users}
                  />
                </Fragment>
              );
            },
          },
        ]}
      />
    </Fragment>
  );
};

export default WorkspaceNotificationRuleTable;
