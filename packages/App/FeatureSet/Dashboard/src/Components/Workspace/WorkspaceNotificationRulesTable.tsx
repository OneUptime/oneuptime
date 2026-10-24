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
import SecurityCasePriority from "Common/Models/DatabaseModels/SecurityCasePriority";
import SecurityCaseStatus from "Common/Models/DatabaseModels/SecurityCaseStatus";
import Team from "Common/Models/DatabaseModels/Team";
import User from "Common/Models/DatabaseModels/User";
import API from "Common/UI/Utils/API/API";
import Exception from "Common/Types/Exception/Exception";
import { ErrorFunction, PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import NotificationRuleForm, {
  NOTIFICATION_RULE_DESTINATION_FIELD_KEY,
  NotificationRuleFormPart,
} from "./NotificationRuleForm/NotificationRuleForm";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import Field, {
  CustomElementProps,
} from "Common/UI/Components/Forms/Types/Field";
import IncidentNotificationRule from "Common/Types/Workspace/NotificationRules/NotificationRuleTypes/IncidentNotificationRule";
import { getNotificationRuleCardColumns } from "./NotificationRuleViewElement/NotificationRuleViewElement";
import { ShowAs } from "Common/UI/Components/ModelTable/BaseModelTable";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import FilterCondition from "Common/Types/Filter/FilterCondition";
import { NotificationRuleConditionUtil } from "Common/Types/Workspace/NotificationRules/NotificationRuleCondition";
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
import {
  getTestSendLock,
  TestSendLock,
  TestSendTargets,
} from "../TestSend/TestSendLock";
import {
  MicrosoftTeamsChat,
  MicrosoftTeamsTeam,
} from "Common/Models/DatabaseModels/WorkspaceProjectAuthToken";
import VideoCallConnection from "Common/Models/DatabaseModels/VideoCallConnection";
import { getVideoCallValidationError } from "Common/Types/Workspace/NotificationRules/VideoCallNotificationRule";
import NotificationRuleVideoCallForm from "./NotificationRuleForm/NotificationRuleVideoCallForm";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicySchedule from "Common/Models/DatabaseModels/OnCallDutyPolicySchedule";
import { WorkspaceChannelNumberPrefixes } from "Common/Utils/Workspace/WorkspaceChannelName";
import NotificationRuleInvites from "Common/Types/Workspace/NotificationRules/NotificationRuleInvites";
import {
  getNotificationRuleDestinationDescription,
  NOTIFICATION_RULE_CONDITIONS_TITLES,
  NOTIFICATION_RULE_DESTINATION_TITLES,
  NOTIFICATION_RULES_CARD_DESCRIPTIONS,
  NOTIFICATION_RULES_CARD_TITLE,
  RULE_PLURAL_NAMES,
  RULE_SINGULAR_NAMES,
  VIDEO_CALL_STEP_DESCRIPTIONS,
  VIDEO_CALL_STEP_TITLE,
} from "./NotificationRuleForm/NotificationRuleCopy";
import { canRuleCreateChannel } from "./NotificationRuleForm/NotificationRuleOwnChannel";
import {
  SecurityCaseValueLists,
  getSecurityCaseValues,
} from "../SecurityCase/SecurityCaseValues";

/*
 * How each step of the rule wizard opens: with its question as a heading
 * and a sentence under it ("Which incidents", "Then, in Slack"), drawn by
 * the field's sectionTitle and sectionDescription - not as a field label,
 * which drew it smaller than the Destination step's own "Who joins the
 * channel" heading. Nothing on these steps is optional, so no "(Optional)".
 */
const STEP_HEADING: {
  customElementDrawsOwnLabel: true;
  hideOptionalLabel: true;
} = {
  customElementDrawsOwnLabel: true,
  hideOptionalLabel: true,
};

/*
 * The form key the Video Call step is registered under. Like the
 * Destination step, it edits the rule's notificationRule column, so it needs
 * a key of its own; it is form-only and never sent.
 */
export const NOTIFICATION_RULE_VIDEO_CALL_FIELD_KEY: string =
  "notificationRuleVideoCall";

// Only incident and alert rules can start a video call.
export function canRuleStartVideoCall(
  eventType: NotificationRuleEventType,
): boolean {
  return (
    eventType === NotificationRuleEventType.Incident ||
    eventType === NotificationRuleEventType.Alert
  );
}

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
  // A security case rule's priorities and statuses: the project's own.
  const [securityCasePriorities, setSecurityCasePriorities] = React.useState<
    Array<SecurityCasePriority>
  >([]);
  const [securityCaseStatuses, setSecurityCaseStatuses] = React.useState<
    Array<SecurityCaseStatus>
  >([]);
  const [teams, setTeams] = React.useState<Array<Team>>([]);
  const [microsoftTeamsTeams, setMicrosoftTeams] = React.useState<
    Array<MicrosoftTeamsTeam>
  >([]);
  const [microsoftTeamsChats, setMicrosoftTeamsChats] = React.useState<
    Array<MicrosoftTeamsChat>
  >([]);
  const [users, setUsers] = React.useState<Array<User>>([]);
  const [onCallSchedules, setOnCallSchedules] = React.useState<
    Array<OnCallDutyPolicySchedule>
  >([]);
  const [videoCallConnections, setVideoCallConnections] = React.useState<
    Array<VideoCallConnection>
  >([]);
  const [numberPrefixes, setNumberPrefixes] = React.useState<
    WorkspaceChannelNumberPrefixes | undefined
  >(undefined);
  const [onCallPolicyName, setOnCallPolicyName] = React.useState<
    string | undefined
  >(undefined);

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

  // Locked, saying why, for someone who may not send a test (TestSendLock).
  const testRuleLock: TestSendLock = getTestSendLock(
    TestSendTargets.NotificationRule,
  );

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
          /*
           * This is a custom route, so BaseAPI.getHeaders() adds no
           * `tenantid` — ModelAPI.getCommonHeaders() is the only thing that
           * does. The route requires an authenticated member of the rule's
           * project, and without the header there is no project to check.
           */
          headers: ModelAPI.getCommonHeaders(),
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
          order: true,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        sort: {
          order: SortOrder.Ascending,
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
            order: true,
          },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          sort: {
            order: SortOrder.Ascending,
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
            order: true,
          },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          sort: {
            order: SortOrder.Ascending,
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
          order: true,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        sort: {
          order: SortOrder.Ascending,
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
            order: true,
          },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          sort: {
            order: SortOrder.Ascending,
          },
        });

      setScheduledMaintenanceStates(scheduledMaintenanceStates.data);

      // Read only for the security case rules, whose conditions name them.
      if (props.eventType === NotificationRuleEventType.SecurityCase) {
        const caseValues: SecurityCaseValueLists = await getSecurityCaseValues(
          ProjectUtil.getCurrentProjectId()!,
        );

        setSecurityCasePriorities(caseValues.priorities);
        setSecurityCaseStatuses(caseValues.statuses);
      }

      const monitorStatus: ListResult<MonitorStatus> = await ModelAPI.getList({
        modelType: MonitorStatus,
        query: {
          projectId: ProjectUtil.getCurrentProjectId()!,
        },
        select: {
          name: true,
          _id: true,
          color: true,
          priority: true,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        sort: {
          priority: SortOrder.Ascending,
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

      /*
       * The on-call schedules, by name, for a rule's summary to name those
       * whose on-call person joins its channel. A member who may not read
       * them still edits the rule, so a refusal leaves them unnamed.
       */
      try {
        const schedules: ListResult<OnCallDutyPolicySchedule> =
          await ModelAPI.getList({
            modelType: OnCallDutyPolicySchedule,
            query: {
              projectId: ProjectUtil.getCurrentProjectId()!,
            },
            select: {
              _id: true,
              name: true,
            },
            skip: 0,
            limit: LIMIT_PER_PROJECT,
            sort: {
              name: SortOrder.Ascending,
            },
          });

        setOnCallSchedules(schedules.data);
      } catch {
        setOnCallSchedules([]);
      }

      /*
       * What the name of the channel a rule creates is made of: the
       * project's number prefixes (incident INC-42's channel is inc-42),
       * and for an on-call policy rule, one of the project's policies. The
       * preview of the name is left out when they cannot be read; nothing
       * else on the page needs them.
       */
      try {
        const numberPrefixesResponse:
          | HTTPResponse<JSONObject>
          | HTTPErrorResponse = await API.get({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            "/workspace-notification-rule/number-prefixes",
          ),
          headers: ModelAPI.getCommonHeaders(),
        });

        if (!(numberPrefixesResponse instanceof HTTPErrorResponse)) {
          setNumberPrefixes(
            ((numberPrefixesResponse.data as JSONObject)?.[
              "numberPrefixes"
            ] as WorkspaceChannelNumberPrefixes) || {},
          );
        }
      } catch {
        setNumberPrefixes(undefined);
      }

      if (props.eventType === NotificationRuleEventType.OnCallDutyPolicy) {
        try {
          const policies: ListResult<OnCallDutyPolicy> = await ModelAPI.getList(
            {
              modelType: OnCallDutyPolicy,
              query: {
                projectId: ProjectUtil.getCurrentProjectId()!,
              },
              select: {
                _id: true,
                name: true,
              },
              skip: 0,
              limit: 1,
              sort: {
                name: SortOrder.Ascending,
              },
            },
          );

          setOnCallPolicyName(policies.data[0]?.name || undefined);
        } catch {
          setOnCallPolicyName(undefined);
        }
      }

      /*
       * The connections a rule's video call can be held with. A member who
       * may not read them still edits the rule's other steps, so a refusal
       * here leaves the list empty rather than failing the page.
       */
      if (canRuleStartVideoCall(props.eventType)) {
        try {
          const connections: ListResult<VideoCallConnection> =
            await ModelAPI.getList({
              modelType: VideoCallConnection,
              query: {
                projectId: ProjectUtil.getCurrentProjectId()!,
              },
              select: {
                _id: true,
                name: true,
                provider: true,
                config: true,
              },
              skip: 0,
              limit: LIMIT_PER_PROJECT,
              sort: {
                name: SortOrder.Ascending,
              },
            });

          setVideoCallConnections(connections.data);
        } catch {
          setVideoCallConnections([]);
        }
      }

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

        // Load chats (group / personal chats the OneUptime app was added to).
        const microsoftTeamsChatsResponse:
          | HTTPResponse<JSONObject>
          | HTTPErrorResponse = await API.get({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            `/microsoft-teams/chats`,
          ),
          headers: ModelAPI.getCommonHeaders(),
        });

        if (microsoftTeamsChatsResponse instanceof HTTPErrorResponse) {
          throw microsoftTeamsChatsResponse;
        } else {
          const chatsData: Array<MicrosoftTeamsChat> =
            (microsoftTeamsChatsResponse.data as any)?.chats || [];
          setMicrosoftTeamsChats(chatsData);
        }
      }
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

  /*
   * One half of the rule, on its own step of the rule wizard: when it fires
   * (Conditions), then where it posts (Destination). Both halves read and
   * write the same notificationRule.
   */
  type RenderRuleFormFunction = (
    part: NotificationRuleFormPart,
    values: FormValues<WorkspaceNotificationRule>,
    elementProps: CustomElementProps,
  ) => ReactElement;

  /*
   * A monitor's or on-call policy's name, one of the project's, to show the
   * name of the channel a monitor or on-call policy rule creates with.
   */
  const exampleRecordName: string | undefined =
    props.eventType === NotificationRuleEventType.Monitor
      ? monitors[0]?.name || undefined
      : props.eventType === NotificationRuleEventType.OnCallDutyPolicy
        ? onCallPolicyName
        : undefined;

  const renderRuleForm: RenderRuleFormFunction = (
    part: NotificationRuleFormPart,
    values: FormValues<WorkspaceNotificationRule>,
    elementProps: CustomElementProps,
  ): ReactElement => {
    return (
      <NotificationRuleForm
        {...elementProps}
        part={part}
        value={values.notificationRule as IncidentNotificationRule}
        eventType={props.eventType}
        monitors={monitors}
        labels={labels}
        alertStates={alertStates}
        alertSeverities={alertSeverities}
        incidentSeverities={incidentSeverities}
        incidentStates={incidentStates}
        scheduledMaintenanceStates={scheduledMaintenanceStates}
        securityCasePriorities={securityCasePriorities}
        securityCaseStatuses={securityCaseStatuses}
        monitorStatus={monitorStatus}
        workspaceType={props.workspaceType}
        teams={teams}
        microsoftTeamsTeams={microsoftTeamsTeams}
        microsoftTeamsChats={microsoftTeamsChats}
        users={users}
        onCallSchedules={onCallSchedules}
        numberPrefixes={numberPrefixes}
        exampleRecordName={exampleRecordName}
      />
    );
  };

  type RemoveFilterWithNoValues = (
    notificationRule: IncidentNotificationRule,
  ) => IncidentNotificationRule;

  const removeFiltersWithNoValues: RemoveFilterWithNoValues = (
    notificationRule: IncidentNotificationRule,
  ): IncidentNotificationRule => {
    if (notificationRule.filters && notificationRule.filters.length > 0) {
      /*
       * Only rows left empty go. This kept only conditions holding a list,
       * so a text condition - "Incident Title contains database" - was
       * dropped on save, and the rule fired for every event.
       */
      notificationRule.filters =
        NotificationRuleConditionUtil.withoutEmptyConditions(
          notificationRule.filters,
        );

      /*
       * Only a rule saved without a match condition - through the API: the
       * form always holds one - reaches this. It is saved with Any, as it
       * always was.
       */
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
            disabled: testRuleLock.isLocked,
            tooltip: testRuleLock.tooltip,
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
        singularName={RULE_SINGULAR_NAMES[props.eventType]}
        pluralName={RULE_PLURAL_NAMES[props.eventType]}
        id="servie-provider-table"
        name="Settings > Workspace Notification Rules"
        isDeleteable={true}
        isEditable={true}
        createEditModalWidth={ModalWidth.Large}
        /*
         * A new rule starts with no conditions - it fires for every event
         * until some are added - so its Conditions step can be left as it
         * opens. It matches all of its conditions, as every other rule in
         * OneUptime does by default; the step asks All or Any only once
         * there are two conditions (NotificationRuleForm), and a rule with
         * fewer is saved with this.
         *
         * A channel it creates gets everybody the record has, as they join
         * it: the people paged, the Incident Commander and other roles, the
         * owners (NotificationRuleInvites.getNewRuleSwitches). The boxes are
         * ticked from the start; they count only once the rule creates a
         * channel.
         *
         * A rule that can only post (a security case's: it creates no
         * channel) starts posting to channels the project has, the one
         * destination every such rule needs: its step opens on the channels
         * to name.
         */
        createInitialValues={{
          notificationRule: {
            filterCondition: FilterCondition.All,
            filters: [],
            ...NotificationRuleInvites.getNewRuleSwitches(props.eventType),
            ...(canRuleCreateChannel(props.eventType)
              ? {}
              : { shouldPostToExistingChannel: true }),
          },
        }}
        isCreateable={true}
        /*
         * What a rule is, said where the rules are: which records it is
         * for, then what it does with them.
         */
        cardProps={{
          title: NOTIFICATION_RULES_CARD_TITLE,
          description: NOTIFICATION_RULES_CARD_DESCRIPTIONS[props.eventType],
        }}
        /*
         * No rules yet is the list's own empty state: "No incident
         * notification rules yet.", what a rule does (the card's
         * description) and the Create button. It said "No notification
         * rules found.", as if a search had missed.
         */
        showAs={ShowAs.List}
        onBeforeCreate={(values: WorkspaceNotificationRule) => {
          values.eventType = props.eventType;
          values.projectId = ProjectUtil.getCurrentProjectId()!;
          values.workspaceType = props.workspaceType;
          values.notificationRule = removeFiltersWithNoValues(
            values.notificationRule as IncidentNotificationRule,
          );
          return Promise.resolve(values);
        }}
        onBeforeEdit={(values: WorkspaceNotificationRule) => {
          values.notificationRule = removeFiltersWithNoValues(
            values.notificationRule as IncidentNotificationRule,
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
            /*
             * Which records the rule is for. Each step opens with its
             * question as a heading, as the Destination step's sections are
             * headed (STEP_HEADING), and its two answers under it: "All
             * incidents" or "Only incidents that match conditions". When
             * conditions are checked - when a record is created and each
             * time it changes - is said over the conditions, once there are
             * some (NotificationRuleConditions): over "All incidents" it was
             * a paragraph about conditions the rule did not have, the first
             * thing the step said.
             */
            title: NOTIFICATION_RULE_CONDITIONS_TITLES[props.eventType],
            sectionTitle: NOTIFICATION_RULE_CONDITIONS_TITLES[props.eventType],
            ...STEP_HEADING,
            fieldType: FormFieldSchemaType.CustomComponent,
            /*
             * No conditions is a rule that fires for every event, so the
             * step can be left as it opens: a new rule starts with none
             * (createInitialValues below).
             */
            required: false,
            stepId: "conditions",
            customValidation: (
              values: FormValues<WorkspaceNotificationRule>,
            ): string | null => {
              return NotificationRuleConditionUtil.getConditionsValidationError(
                {
                  notificationRule:
                    values.notificationRule as IncidentNotificationRule,
                },
              );
            },
            getCustomElement: (
              values: FormValues<WorkspaceNotificationRule>,
              elementProps: CustomElementProps,
            ): ReactElement => {
              return renderRuleForm(
                NotificationRuleFormPart.Conditions,
                values,
                elementProps,
              );
            },
          },
          /*
           * The rule's other half, on a step of its own: where it posts. It
           * edits the same notificationRule column, so it is registered under
           * a key of its own (overrideFieldKey) and is form-only: what it
           * changes is written into notificationRule, and its own value - a
           * carrier, present from the start so the destination check runs
           * before anything on the step is touched - is never sent.
           */
          {
            overrideField: {
              notificationRule: true,
            },
            overrideFieldKey: NOTIFICATION_RULE_DESTINATION_FIELD_KEY,
            formOnly: true,
            title: NOTIFICATION_RULE_DESTINATION_TITLES[props.workspaceType],
            sectionTitle:
              NOTIFICATION_RULE_DESTINATION_TITLES[props.workspaceType],
            // Where it posts, and - for a rule that creates one - who joins its channel.
            sectionDescription: getNotificationRuleDestinationDescription({
              eventType: props.eventType,
              workspaceType: props.workspaceType,
            }),
            ...STEP_HEADING,
            fieldType: FormFieldSchemaType.CustomComponent,
            required: false,
            stepId: "destination",
            getDefaultValue: (): boolean => {
              return true;
            },
            customValidation: (
              values: FormValues<WorkspaceNotificationRule>,
            ): string | null => {
              return NotificationRuleConditionUtil.getDestinationValidationError(
                {
                  notificationRule:
                    values.notificationRule as IncidentNotificationRule,
                  eventType: props.eventType,
                  workspaceType: props.workspaceType,
                },
              );
            },
            onChange: (
              value: IncidentNotificationRule,
              currentValues: FormValues<WorkspaceNotificationRule>,
              setNewFormValues: (
                values: FormValues<WorkspaceNotificationRule>,
              ) => void,
            ): void => {
              setNewFormValues({
                ...currentValues,
                notificationRule: value,
              } as FormValues<WorkspaceNotificationRule>);
            },
            getCustomElement: (
              values: FormValues<WorkspaceNotificationRule>,
              elementProps: CustomElementProps,
            ): ReactElement => {
              return renderRuleForm(
                NotificationRuleFormPart.Destination,
                values,
                elementProps,
              );
            },
          },
          /*
           * The rule's video call, on a step of its own for the rules that
           * can start one: the same notificationRule column, registered
           * under a key of its own as the Destination step is.
           */
          ...(canRuleStartVideoCall(props.eventType)
            ? [
                {
                  overrideField: {
                    notificationRule: true,
                  },
                  overrideFieldKey: NOTIFICATION_RULE_VIDEO_CALL_FIELD_KEY,
                  formOnly: true,
                  title: VIDEO_CALL_STEP_TITLE,
                  sectionTitle: VIDEO_CALL_STEP_TITLE,
                  sectionDescription:
                    VIDEO_CALL_STEP_DESCRIPTIONS[props.eventType],
                  ...STEP_HEADING,
                  fieldType: FormFieldSchemaType.CustomComponent,
                  required: false,
                  stepId: "videoCall",
                  getDefaultValue: (): boolean => {
                    return true;
                  },
                  customValidation: (
                    values: FormValues<WorkspaceNotificationRule>,
                  ): string | null => {
                    return getVideoCallValidationError({
                      rule: values.notificationRule as IncidentNotificationRule,
                      workspaceType: props.workspaceType,
                    });
                  },
                  onChange: (
                    value: IncidentNotificationRule,
                    currentValues: FormValues<WorkspaceNotificationRule>,
                    setNewFormValues: (
                      values: FormValues<WorkspaceNotificationRule>,
                    ) => void,
                  ): void => {
                    setNewFormValues({
                      ...currentValues,
                      notificationRule: value,
                    } as FormValues<WorkspaceNotificationRule>);
                  },
                  getCustomElement: (
                    values: FormValues<WorkspaceNotificationRule>,
                    elementProps: CustomElementProps,
                  ): ReactElement => {
                    return (
                      <NotificationRuleVideoCallForm
                        value={
                          values.notificationRule as IncidentNotificationRule
                        }
                        onChange={(value: IncidentNotificationRule) => {
                          elementProps.onChange?.(value);
                        }}
                        workspaceType={props.workspaceType}
                        eventType={props.eventType}
                        connections={videoCallConnections}
                        error={elementProps.error}
                      />
                    );
                  },
                } as Field<WorkspaceNotificationRule>,
              ]
            : []),
        ]}
        /*
         * When the rule fires, then where it posts. The two were one Rules
         * step that could show a dozen fields at once.
         */
        formSteps={[
          {
            title: "Basic",
            id: "basic",
          },
          {
            title: "Conditions",
            id: "conditions",
          },
          {
            title: "Destination",
            id: "destination",
          },
          ...(canRuleStartVideoCall(props.eventType)
            ? [
                {
                  title: "Video Call",
                  id: "videoCall",
                },
              ]
            : []),
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
        /*
         * Each rule as a card: its name, its description when it has one,
         * When (which records), Then (what it does with them) and, when it
         * starts one, its video call.
         */
        columns={getNotificationRuleCardColumns({
          eventType: props.eventType,
          canStartVideoCall: canRuleStartVideoCall(props.eventType),
          workspaceType: props.workspaceType,
          monitors: monitors,
          labels: labels,
          alertStates: alertStates,
          alertSeverities: alertSeverities,
          incidentSeverities: incidentSeverities,
          incidentStates: incidentStates,
          scheduledMaintenanceStates: scheduledMaintenanceStates,
          securityCasePriorities: securityCasePriorities,
          securityCaseStatuses: securityCaseStatuses,
          monitorStatus: monitorStatus,
          teams: teams,
          users: users,
          onCallSchedules: onCallSchedules,
          microsoftTeamsTeams: microsoftTeamsTeams,
          microsoftTeamsChats: microsoftTeamsChats,
          videoCallConnections: videoCallConnections,
          numberPrefixes: numberPrefixes,
          exampleRecordName: exampleRecordName,
        })}
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
