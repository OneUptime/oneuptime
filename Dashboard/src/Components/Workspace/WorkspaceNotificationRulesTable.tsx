import ProjectUtil from "Common/UI/Utils/Project";
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
import WorkspaceType, {
  getWorkspaceTypeDisplayName,
} from "Common/Types/Workspace/WorkspaceType";
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
import { ErrorFunction, PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import NotificationRuleForm from "./NotificationRuleForm/NotificationRuleForm";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import IncidentNotificationRule from "Common/Types/Workspace/NotificationRules/NotificationRuleTypes/IncidentNotificationRule";
import NotificawtionRuleViewElement from "./NotificationRuleViewElement/NotificationRuleViewElement";
import { ShowAs } from "Common/UI/Components/ModelTable/BaseModelTable";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import FilterCondition from "Common/Types/Filter/FilterCondition";
import NotificationRuleCondition, {
  NotificationRuleConditionUtil,
} from "Common/Types/Workspace/NotificationRules/NotificationRuleCondition";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import EmptyResponseData from "Common/Types/API/EmptyResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import URL from "Common/Types/API/URL";
import { APP_API_URL } from "Common/UI/Config";
import { JSONObject } from "Common/Types/JSON";
import WorkspaceProjectAuthToken, {
  MicrosoftTeamsMiscData,
  MicrosoftTeamsTeam,
  SlackMiscData,
} from "Common/Models/DatabaseModels/WorkspaceProjectAuthToken";
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
  const [microsoftTeamsTeams, setMicrosoftTeams] = React.useState<
    Array<MicrosoftTeamsTeam>
  >([]);
  const [workspaceProjectAuthTokens, setWorkspaceProjectAuthTokens] =
    React.useState<Array<WorkspaceProjectAuthToken>>([]);
  const [users, setUsers] = React.useState<Array<User>>([]);

  const [showTestModal, setShowTestModal] = React.useState<boolean>(false);
  const [isTestLoading, setIsTestLoading] = React.useState<boolean>(false);
  const [testError, setTestError] = React.useState<string | undefined>(
    undefined,
  );
  const [testNotificationRule, setTestNotificationRule] = React.useState<
    WorkspaceNotificationRule | undefined
  >(undefined);

  const [showTestSuccessModal, setShowTestSuccessModal] =
    React.useState<boolean>(false);

  type TestRuleFunction = (ruleId: ObjectID) => Promise<void>;

  const testRule: TestRuleFunction = async (
    ruleId: ObjectID,
  ): Promise<void> => {
    try {
      setIsTestLoading(true);
      setTestError(undefined);

      // test rule
      const response: HTTPResponse<EmptyResponseData> | HTTPErrorResponse =
        await API.get({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            `/workspace-notification-rule/test/${ruleId.toString()}`,
          ),
          data: {},
        });
      if (response.isSuccess()) {
        setIsTestLoading(false);
        setShowTestModal(false);
        setShowTestSuccessModal(true);
      }

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      setIsTestLoading(false);
    } catch (err) {
      setTestError(API.getFriendlyErrorMessage(err as Exception));
      setIsTestLoading(false);
    }
  };

  const loadPage: PromiseVoidFunction = async (): Promise<void> => {
    try {
      setIsLoading(true);
      setError(undefined);

      const monitors: ListResult<Monitor> = await ModelAPI.getList({
        modelType: Monitor,
        query: {
          projectId: ProjectUtil.getCurrentProjectId()!,
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
          projectId: ProjectUtil.getCurrentProjectId()!,
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
          projectId: ProjectUtil.getCurrentProjectId()!,
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
            projectId: ProjectUtil.getCurrentProjectId()!,
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
            projectId: ProjectUtil.getCurrentProjectId()!,
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
          projectId: ProjectUtil.getCurrentProjectId()!,
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
            projectId: ProjectUtil.getCurrentProjectId()!,
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
          projectId: ProjectUtil.getCurrentProjectId()!,
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
          projectId: ProjectUtil.getCurrentProjectId()!,
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
          projectId: ProjectUtil.getCurrentProjectId()!,
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

      // Load Microsoft Teams if workspace type is Microsoft Teams
      if (props.workspaceType === WorkspaceType.MicrosoftTeams) {
        const microsoftTeamsResponse:
          | HTTPResponse<JSONObject>
          | HTTPErrorResponse = await API.get({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            `/microsoft-teams/teams`,
          ),
          headers: ModelAPI.getCommonHeaders(),
        });

        if (microsoftTeamsResponse instanceof HTTPErrorResponse) {
          throw microsoftTeamsResponse;
        } else {
          const teamsData: Array<MicrosoftTeamsTeam> =
            (microsoftTeamsResponse.data as any)?.teams || [];
          setMicrosoftTeams(teamsData);
        }
      }

      const workspaceAuths: ListResult<WorkspaceProjectAuthToken> =
        await ModelAPI.getList<WorkspaceProjectAuthToken>({
          modelType: WorkspaceProjectAuthToken,
          query: {
            projectId: ProjectUtil.getCurrentProjectId()!,
            workspaceType: props.workspaceType,
          },
          select: {
            _id: true,
            miscData: true,
            workspaceProjectId: true,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          sort: {
            createdAt: SortOrder.Ascending,
          },
        });

      setWorkspaceProjectAuthTokens(workspaceAuths.data);
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

  const getWorkspaceDisplayName = (
    workspace: WorkspaceProjectAuthToken,
  ): string => {
    if (props.workspaceType === WorkspaceType.Slack) {
      const teamName: string | undefined = (
        workspace.miscData as SlackMiscData
      )?.teamName;
      return teamName || workspace.workspaceProjectId || "Slack Workspace";
    }

    if (props.workspaceType === WorkspaceType.MicrosoftTeams) {
      const teamName: string | undefined = (
        workspace.miscData as MicrosoftTeamsMiscData
      )?.teamName;
      return (
        teamName ||
        workspace.workspaceProjectId ||
        `${getWorkspaceTypeDisplayName(props.workspaceType)} Workspace`
      );
    }

    return (
      workspace.workspaceProjectId ||
      `${getWorkspaceTypeDisplayName(props.workspaceType)} Workspace`
    );
  };

  const workspaceOptions: Array<{ label: string; value: string }> =
    workspaceProjectAuthTokens.map((workspace: WorkspaceProjectAuthToken) => {
      return {
        label: getWorkspaceDisplayName(workspace),
        value: workspace.id?.toString() || "",
      };
    });

  const defaultWorkspaceAuthTokenId: string | undefined =
    workspaceProjectAuthTokens.length === 1
      ? workspaceProjectAuthTokens[0]?.id?.toString()
      : undefined;

  const getWorkspaceNameById = (id?: string): string => {
    if (!id) {
      return "-";
    }

    const match: WorkspaceProjectAuthToken | undefined =
      workspaceProjectAuthTokens.find(
        (workspace: WorkspaceProjectAuthToken) => {
          return workspace.id?.toString() === id.toString();
        },
      );

    if (!match) {
      return "-";
    }

    return getWorkspaceDisplayName(match);
  };

  type RemoveFilterWithNoValues = (
    notificationRule: IncidentNotificationRule,
  ) => IncidentNotificationRule;

  const removeFiltersWithNoValues: RemoveFilterWithNoValues = (
    notificationRule: IncidentNotificationRule,
  ): IncidentNotificationRule => {
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
          projectId: ProjectUtil.getCurrentProjectId()!,
          eventType: props.eventType,
          workspaceType: props.workspaceType,
        }}
        userPreferencesKey="workspace-notification-rules-table"
        actionButtons={[
          {
            title: "Test Rule",
            buttonStyleType: ButtonStyleType.OUTLINE,
            icon: IconProp.Play,
            onClick: async (
              item: WorkspaceNotificationRule,
              onCompleteAction: VoidFunction,
              onError: ErrorFunction,
            ) => {
              try {
                setTestNotificationRule(item);
                setShowTestModal(true);

                onCompleteAction();
              } catch (err) {
                onCompleteAction();
                onError(err as Error);
              }
            },
          },
        ]}
        singularName={`${props.eventType} Notification Rule`}
        pluralName={`${props.eventType} Notification Rules`}
        id="servie-provider-table"
        name="Settings > Workspace Notification Rules"
        isDeleteable={true}
        isEditable={true}
        createEditModalWidth={ModalWidth.Large}
        isCreateable={true}
        cardProps={{
          title: `${props.eventType} - ${getWorkspaceTypeDisplayName(props.workspaceType)} Notification Rules`,
          description: `Manage ${props.eventType} notification rules for ${getWorkspaceTypeDisplayName(props.workspaceType)}.`,
        }}
        showAs={ShowAs.List}
        noItemsMessage={"No notification rules found."}
        onBeforeCreate={(values: WorkspaceNotificationRule) => {
          values.eventType = props.eventType;
          values.projectId = ProjectUtil.getCurrentProjectId()!;
          values.workspaceType = props.workspaceType;
          if (
            !values.workspaceProjectAuthTokenId &&
            defaultWorkspaceAuthTokenId
          ) {
            values.workspaceProjectAuthTokenId = new ObjectID(
              defaultWorkspaceAuthTokenId,
            );
          }
          values.notificationRule = removeFiltersWithNoValues(
            values.notificationRule as IncidentNotificationRule,
          );
          return Promise.resolve(values);
        }}
        onBeforeEdit={(values: WorkspaceNotificationRule) => {
          if (
            !values.workspaceProjectAuthTokenId &&
            defaultWorkspaceAuthTokenId
          ) {
            values.workspaceProjectAuthTokenId = new ObjectID(
              defaultWorkspaceAuthTokenId,
            );
          }
          values.notificationRule = removeFiltersWithNoValues(
            values.notificationRule as IncidentNotificationRule,
          );
          return Promise.resolve(values);
        }}
        formFields={[
          {
            field: {
              workspaceProjectAuthTokenId: true,
            },
            title: `${getWorkspaceTypeDisplayName(props.workspaceType)} Workspace`,
            description: `Select the ${getWorkspaceTypeDisplayName(props.workspaceType)} workspace where this rule should post notifications.`,
            fieldType: FormFieldSchemaType.Dropdown,
            required: true,
            stepId: "basic",
            showIf: () => {
              return workspaceProjectAuthTokens.length > 1;
            },
            dropdownOptions: workspaceOptions,
          },
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
            title: `Notify ${getWorkspaceTypeDisplayName(props.workspaceType)} on ${props.eventType} when...`,
            description: `Set the conditions to notify ${getWorkspaceTypeDisplayName(props.workspaceType)} on ${props.eventType}. If you do not set any conditions, then this rule will trigger for every ${props.eventType}.`,
            fieldType: FormFieldSchemaType.CustomComponent,
            required: true,
            stepId: "rules",
            customValidation: (
              values: FormValues<WorkspaceNotificationRule>,
            ) => {
              const error: string | null =
                NotificationRuleConditionUtil.getValidationError({
                  notificationRule:
                    values.notificationRule as IncidentNotificationRule,
                  eventType: props.eventType,
                  workspaceType: props.workspaceType,
                });

              return error;
            },
            getCustomElement: (
              value: FormValues<WorkspaceNotificationRule>,
              elementProps: CustomElementProps,
            ): ReactElement => {
              return (
                <NotificationRuleForm
                  {...elementProps}
                  value={value.notificationRule as IncidentNotificationRule}
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
                  microsoftTeamsTeams={microsoftTeamsTeams}
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
          ...(workspaceProjectAuthTokens.length > 1
            ? [
                {
                  field: {
                    workspaceProjectAuthTokenId: true,
                  },
                  title: `${getWorkspaceTypeDisplayName(props.workspaceType)} Workspace`,
                  type: FieldType.Element,
                  getElement: (
                    value: WorkspaceNotificationRule,
                  ): ReactElement => {
                    return (
                      <Fragment>
                        {getWorkspaceNameById(
                          value.workspaceProjectAuthTokenId?.toString(),
                        )}
                      </Fragment>
                    );
                  },
                },
              ]
            : []),
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
                    value={value.notificationRule as IncidentNotificationRule}
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
                    microsoftTeamsTeams={microsoftTeamsTeams}
                    users={users}
                  />
                </Fragment>
              );
            },
          },
        ]}
      />

      {showTestModal && testNotificationRule ? (
        <ConfirmModal
          title={`Test Rule`}
          error={testError}
          description={`Test the rule ${testNotificationRule.name} by sending a test notification to ${getWorkspaceTypeDisplayName(props.workspaceType)}.`}
          submitButtonText={"Test"}
          onClose={() => {
            setShowTestModal(false);
            setTestNotificationRule(undefined);
            setTestError(undefined);
            setError("");
          }}
          isLoading={isTestLoading}
          onSubmit={async () => {
            if (!testNotificationRule.id) {
              return;
            }
            await testRule(testNotificationRule.id!);
          }}
        />
      ) : (
        <></>
      )}

      {showTestSuccessModal ? (
        <ConfirmModal
          title={testError ? `Test Failed` : `Test Executed Successfully`}
          error={testError}
          description={`Test executed successfully. You should now see a notification in ${getWorkspaceTypeDisplayName(props.workspaceType)}.`}
          submitButtonType={ButtonStyleType.NORMAL}
          submitButtonText={"Close"}
          onSubmit={async () => {
            setShowTestSuccessModal(false);
            setTestNotificationRule(undefined);
            setShowTestModal(false);
            setTestError("");
          }}
        />
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default WorkspaceNotificationRuleTable;
