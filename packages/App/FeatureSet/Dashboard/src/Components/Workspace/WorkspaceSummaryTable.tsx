import ProjectUtil from "Common/UI/Utils/Project";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Label from "Common/Models/DatabaseModels/Label";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import React, {
  Fragment,
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useEffect,
  useMemo,
  useRef,
} from "react";
import WorkspaceType, {
  getWorkspaceTypeDisplayName,
} from "Common/Types/Workspace/WorkspaceType";
import {
  WORKSPACE_SUMMARY_TYPE_COPY,
  WorkspaceSummaryTypeCopy,
} from "./WorkspaceSummaryCopy";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import WorkspaceNotificationSummary from "Common/Models/DatabaseModels/WorkspaceNotificationSummary";
import WorkspaceNotificationSummaryType from "Common/Types/Workspace/NotificationSummary/WorkspaceNotificationSummaryType";
import WorkspaceNotificationSummaryItem from "Common/Types/Workspace/NotificationSummary/WorkspaceNotificationSummaryItem";
import NotificationRuleEventType from "Common/Types/Workspace/NotificationRules/EventType";
import NotificationRuleCondition, {
  NotificationRuleConditionUtil,
} from "Common/Types/Workspace/NotificationRules/NotificationRuleCondition";
import IncidentNotificationRule from "Common/Types/Workspace/NotificationRules/NotificationRuleTypes/IncidentNotificationRule";
import NotificationRuleConditions from "./NotificationRuleForm/NotificationRuleConditions";
import {
  EXISTING_CHANNELS_MATTERMOST_TEAM_DESCRIPTION,
  getMattermostTeamOptions,
  getMattermostTeamsNotJoined,
  MATTERMOST_TEAM_PLACEHOLDER,
  MATTERMOST_TEAM_TITLE,
  MattermostRuleTeams,
  NOTIFICATION_RULE_CONDITIONS_TITLES,
} from "./NotificationRuleForm/NotificationRuleCopy";
import { fetchMattermostRuleTeams } from "../Mattermost/MattermostTeamsCard";
import { MattermostConnectionTeam } from "Common/Models/DatabaseModels/WorkspaceProjectAuthToken";
import FilterCondition from "Common/Types/Filter/FilterCondition";
import { isFilterConditionNeeded } from "Common/Types/Filter/FilterConditionUtil";
import WorkspaceSummaryScheduleUtil from "Common/Utils/Workspace/WorkspaceSummarySchedule";
import WorkspaceSummarySetup, {
  MAX_LOOKBACK_DAYS,
  MIN_LOOKBACK_DAYS,
} from "Common/Utils/Workspace/WorkspaceSummarySetup";
import WorkspaceSummaryFirstSendPreview from "./WorkspaceSummaryFirstSendPreview";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import Exception from "Common/Types/Exception/Exception";
import { ErrorFunction, PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import EmptyResponseData from "Common/Types/API/EmptyResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import URL from "Common/Types/API/URL";
import { APP_API_URL } from "Common/UI/Config";
import { ShowAs } from "Common/UI/Components/ModelTable/BaseModelTable";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import RecurringFieldElement from "Common/UI/Components/Events/RecurringFieldElement";
import RecurringViewElement from "Common/UI/Components/Events/RecurringViewElement";
import Recurring from "Common/Types/Events/Recurring";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import OneUptimeDate from "Common/Types/Date";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import CheckboxElement from "Common/UI/Components/Checkbox/Checkbox";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import TimezoneUtil from "Common/UI/Utils/Timezone";
import {
  getTestSendLock,
  TestSendLock,
  TestSendTargets,
} from "../TestSend/TestSendLock";
import {
  getWorkspaceSummaryTestChannels,
  WorkspaceSummaryTestChannel,
} from "Common/Types/Workspace/NotificationSummary/WorkspaceSummaryTestChannel";
import WorkspaceSummaryTestFailure, {
  getChannelsNotPostedIn,
  getWorkspaceSummaryTestLead,
  getWorkspaceSummaryTestNextStep,
} from "./WorkspaceSummaryTestFailure";

export interface ComponentProps {
  workspaceType: WorkspaceType;
  summaryType: WorkspaceNotificationSummaryType;
}

const WorkspaceSummaryTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isLoading, setIsLoading] = React.useState<boolean>(false);
  const [error, setError] = React.useState<string | undefined>(undefined);

  // Dropdown data for filters
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

  /*
   * A Mattermost project's connection: the teams its bot is a member of,
   * for a summary to pick the team of its channels from, and those it was
   * taken out of. Undefined for another workspace, or when it cannot be
   * read: no picker, as before.
   */
  const [mattermostConnection, setMattermostConnection] = React.useState<
    MattermostRuleTeams | undefined
  >(undefined);

  /*
   * The teams the bot was taken out of that the open form's summary picks:
   * still offered, said to be so, while the form is open - changed to
   * another team and back too - as a notification rule's are. Emptied when
   * the form closes, for the next one.
   */
  const summaryTeamsNotJoined: MutableRefObject<
    Array<MattermostConnectionTeam>
  > = useRef<Array<MattermostConnectionTeam>>([]);

  // Locked, saying why, for someone who may not send a test (TestSendLock).
  const testSummaryLock: TestSendLock = getTestSendLock(
    TestSendTargets.Summary,
  );

  // Test modal state
  const [showTestModal, setShowTestModal] = React.useState<boolean>(false);
  const [isTestLoading, setIsTestLoading] = React.useState<boolean>(false);
  const [testError, setTestError] = React.useState<string | undefined>(
    undefined,
  );
  const [testSummary, setTestSummary] = React.useState<
    WorkspaceNotificationSummary | undefined
  >(undefined);
  /*
   * What the test came to, once it is sent: Summary Sent, or Test Failed
   * with what the server said - each channel the summary was not posted
   * in, and why. A test that failed in one channel may have been posted in
   * the others, so it is reported, not offered again to send.
   */
  const [showTestResultModal, setShowTestResultModal] =
    React.useState<boolean>(false);
  /*
   * A failed test's channels, as the test route answers them: listed in
   * Test Failed, each under why it did not get the test. Empty for a
   * failure the route says only in words (a summary with no channels, a
   * network error): the dialog says those words.
   */
  const [testChannels, setTestChannels] = React.useState<
    Array<WorkspaceSummaryTestChannel>
  >([]);

  // The time zones the Timezone field offers: worked out once, not per render.
  const timezoneOptions: Array<DropdownOption> =
    useMemo((): Array<DropdownOption> => {
      return TimezoneUtil.getTimezoneDropdownOptions();
    }, []);

  // Map summary type to notification rule event type for filters
  type GetEventTypeFunction = () => NotificationRuleEventType;

  const getEventType: GetEventTypeFunction = (): NotificationRuleEventType => {
    switch (props.summaryType) {
      case WorkspaceNotificationSummaryType.Incident:
        return NotificationRuleEventType.Incident;
      case WorkspaceNotificationSummaryType.Alert:
        return NotificationRuleEventType.Alert;
      case WorkspaceNotificationSummaryType.IncidentEpisode:
        return NotificationRuleEventType.IncidentEpisode;
      case WorkspaceNotificationSummaryType.AlertEpisode:
        return NotificationRuleEventType.AlertEpisode;
      default:
        return NotificationRuleEventType.Incident;
    }
  };

  const eventType: NotificationRuleEventType = getEventType();

  // Load dropdown data for filter conditions
  const loadPage: PromiseVoidFunction = async (): Promise<void> => {
    try {
      setIsLoading(true);
      setError(undefined);

      const monitorsResult: ListResult<Monitor> = await ModelAPI.getList({
        modelType: Monitor,
        query: { projectId: ProjectUtil.getCurrentProjectId()! },
        select: { name: true, _id: true },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        sort: { name: SortOrder.Ascending },
      });
      setMonitors(monitorsResult.data);

      const labelsResult: ListResult<Label> = await ModelAPI.getList({
        modelType: Label,
        query: { projectId: ProjectUtil.getCurrentProjectId()! },
        select: { name: true, _id: true, color: true },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        sort: { name: SortOrder.Ascending },
      });
      setLabels(labelsResult.data);

      const alertStatesResult: ListResult<AlertState> = await ModelAPI.getList({
        modelType: AlertState,
        query: { projectId: ProjectUtil.getCurrentProjectId()! },
        select: { name: true, _id: true, color: true, order: true },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        sort: {
          order: SortOrder.Ascending,
        },
      });
      setAlertStates(alertStatesResult.data);

      const alertSevResult: ListResult<AlertSeverity> = await ModelAPI.getList({
        modelType: AlertSeverity,
        query: { projectId: ProjectUtil.getCurrentProjectId()! },
        select: { name: true, _id: true, color: true, order: true },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        sort: {
          order: SortOrder.Ascending,
        },
      });
      setAlertSeverities(alertSevResult.data);

      const incSevResult: ListResult<IncidentSeverity> = await ModelAPI.getList(
        {
          modelType: IncidentSeverity,
          query: { projectId: ProjectUtil.getCurrentProjectId()! },
          select: { name: true, _id: true, color: true, order: true },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          sort: {
            order: SortOrder.Ascending,
          },
        },
      );
      setIncidentSeverities(incSevResult.data);

      const incStatesResult: ListResult<IncidentState> = await ModelAPI.getList(
        {
          modelType: IncidentState,
          query: { projectId: ProjectUtil.getCurrentProjectId()! },
          select: { name: true, _id: true, color: true, order: true },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          sort: {
            order: SortOrder.Ascending,
          },
        },
      );
      setIncidentStates(incStatesResult.data);

      // A Mattermost summary picks the team of its channels among the bot's.
      if (props.workspaceType === WorkspaceType.Mattermost) {
        setMattermostConnection(await fetchMattermostRuleTeams());
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

  type TestSummaryFunction = (summaryId: ObjectID) => Promise<void>;

  const testSummaryFn: TestSummaryFunction = async (
    summaryId: ObjectID,
  ): Promise<void> => {
    try {
      setIsTestLoading(true);
      setTestError(undefined);
      setTestChannels([]);

      const response: HTTPResponse<EmptyResponseData> | HTTPErrorResponse =
        await API.post({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            `/workspace-notification-summary/test/${summaryId.toString()}`,
          ),
          data: {},
          headers: ModelAPI.getCommonHeaders(),
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      setIsTestLoading(false);

      if (response.isSuccess()) {
        setShowTestModal(false);
        setShowTestResultModal(true);
      }
    } catch (err) {
      setTestChannels(
        err instanceof HTTPErrorResponse
          ? getWorkspaceSummaryTestChannels(err.jsonData)
          : [],
      );
      setTestError(API.getFriendlyErrorMessage(err as Exception));
      setIsTestLoading(false);
      setShowTestModal(false);
      setShowTestResultModal(true);
    }
  };

  /*
   * Test Failed's red line: how many channels did not get the test, in the
   * reader's language, when the route said which - else its own words.
   * Summary Sent has none.
   */
  const testFailureLead: string | undefined = testError
    ? getWorkspaceSummaryTestLead(translator, testChannels) || testError
    : undefined;
  const hasTestChannelsNotPostedIn: boolean =
    getChannelsNotPostedIn(testChannels).length > 0;

  const allSummaryItems: Array<WorkspaceNotificationSummaryItem> =
    Object.values(WorkspaceNotificationSummaryItem);

  const typeLabel: string = props.summaryType;

  // This kind's sentences, each worded whole (WorkspaceSummaryCopy).
  const copy: WorkspaceSummaryTypeCopy =
    WORKSPACE_SUMMARY_TYPE_COPY[props.summaryType];

  const workspaceName: string = getWorkspaceTypeDisplayName(
    props.workspaceType,
  );

  return (
    <Fragment>
      <ModelTable<WorkspaceNotificationSummary>
        modelType={WorkspaceNotificationSummary}
        // Enable or Disable in each row's ⋯ menu: the one that changes the row.
        rowSwitch={{ column: "isEnabled" }}
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
          summaryType: props.summaryType,
          workspaceType: props.workspaceType,
        }}
        userPreferencesKey={`workspace-summary-table-${props.summaryType}-${props.workspaceType}`}
        actionButtons={[
          {
            title: "Send Test Now",
            buttonStyleType: ButtonStyleType.OUTLINE,
            icon: IconProp.Play,
            disabled: testSummaryLock.isLocked,
            tooltip: testSummaryLock.tooltip,
            onClick: async (
              item: WorkspaceNotificationSummary,
              onCompleteAction: VoidFunction,
              onError: ErrorFunction,
            ) => {
              try {
                setTestSummary(item);
                setShowTestModal(true);
                onCompleteAction();
              } catch (err) {
                onCompleteAction();
                onError(err as Error);
              }
            },
          },
        ]}
        singularName={copy.singularName}
        pluralName={copy.pluralName}
        id={`workspace-summary-table-${props.summaryType}`}
        name={`${typeLabel} Workspace Summaries`}
        isDeleteable={true}
        isEditable={true}
        createEditModalWidth={ModalWidth.Large}
        onCreateEditModalClose={() => {
          summaryTeamsNotJoined.current = [];
        }}
        isCreateable={true}
        cardProps={{
          title: translator.translateTemplate(copy.cardTitle, {
            workspace: workspaceName,
          }),
          description: translator.translateTemplate(copy.cardDescription, {
            workspace: workspaceName,
          }),
        }}
        showAs={ShowAs.List}
        noItemsMessage={translator.translateTemplate(copy.noItemsMessage)}
        /*
         * A new summary goes out every week, as its other defaults - the
         * last 7 days, a "Weekly ... Summary" - already assumed, so it can
         * be saved as it opens. It matches all of its filters; All or Any
         * is asked only once there are two of them.
         */
        createInitialValues={{
          recurringInterval:
            WorkspaceSummaryScheduleUtil.getDefaultRecurringInterval(),
          filterCondition: FilterCondition.All,
          filters: [],
        }}
        onBeforeCreate={(values: WorkspaceNotificationSummary) => {
          values.summaryType = props.summaryType;
          values.projectId = ProjectUtil.getCurrentProjectId()!;
          values.workspaceType = props.workspaceType;

          // The time zone the form showed: the creator's own, unless changed.
          if (!values.timezone) {
            values.timezone = OneUptimeDate.getCurrentTimezone();
          }

          /*
           * Left empty, the first summary goes out at 09:00 in the summary's
           * time zone at the start of the next week (or day, or month) - the
           * date the form showed under the field. The server works the next
           * send out from it on that zone's clock
           * (WorkspaceSummaryScheduleUtil): a first summary dated in the past
           * goes out at the schedule's next occurrence, not in a burst of
           * catch-up summaries, and later ones keep its time of day there
           * when the clocks change.
           */
          if (!values.sendFirstReportAt) {
            values.sendFirstReportAt =
              WorkspaceSummaryScheduleUtil.getDefaultFirstSendDate({
                timezone: values.timezone,
                intervalType: WorkspaceSummaryScheduleUtil.toRecurring(
                  values.recurringInterval,
                )?.intervalType,
              });
          }

          // The channel names typed, comma-separated, as the list they name.
          if (values.channelNames) {
            values.channelNames = WorkspaceSummarySetup.readChannelNames(
              values.channelNames,
            );
          }

          // Default to "All" if none selected
          if (
            !values.summaryItems ||
            (Array.isArray(values.summaryItems) &&
              values.summaryItems.length === 0)
          ) {
            values.summaryItems = [WorkspaceNotificationSummaryItem.All];
          }

          if (values.isEnabled === undefined || values.isEnabled === null) {
            values.isEnabled = true;
          }

          // A condition row left empty is dropped, not saved.
          if (values.filters && Array.isArray(values.filters)) {
            values.filters =
              NotificationRuleConditionUtil.withoutEmptyConditions(
                values.filters,
              );
          }

          if (!values.filterCondition) {
            values.filterCondition = FilterCondition.All;
          }

          return Promise.resolve(values);
        }}
        onBeforeEdit={(values: WorkspaceNotificationSummary) => {
          // Convert channelNames from JSON array to comma-separated string for the text input
          if (values.channelNames && Array.isArray(values.channelNames)) {
            values.channelNames = (values.channelNames as Array<string>).join(
              ", ",
            ) as unknown as Array<string>;
          }

          // As on create: a condition row left empty is dropped, not saved.
          if (values.filters && Array.isArray(values.filters)) {
            values.filters =
              NotificationRuleConditionUtil.withoutEmptyConditions(
                values.filters,
              );
          }

          return Promise.resolve(values);
        }}
        /*
         * An edit saves what a create does. Channel Names edited in its
         * text box went to the server as the text typed, "#ops, #alerts",
         * saved as it was, and the summary was then posted in a channel
         * per letter; it is the list it names. With nothing to include
         * picked, it includes everything, as a new summary does - one
         * saved with nothing could never be sent (#7116).
         */
        onBeforeUpdate={(values: WorkspaceNotificationSummary) => {
          if (values.channelNames !== undefined) {
            values.channelNames = WorkspaceSummarySetup.readChannelNames(
              values.channelNames,
            );
          }

          if (
            Array.isArray(values.summaryItems) &&
            values.summaryItems.length === 0
          ) {
            values.summaryItems = [WorkspaceNotificationSummaryItem.All];
          }

          return Promise.resolve(values);
        }}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Summary Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            stepId: "basic",
            placeholder: translator.translateTemplate(copy.namePlaceholder),
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              description: true,
            },
            stepId: "basic",
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: translator.translateTemplate(
              copy.descriptionPlaceholder,
            ),
          },
          {
            field: {
              channelNames: true,
            },
            stepId: "basic",
            title: "Channel Names",
            description: translator.translateTemplate(
              "Enter one or more {{workspace}} channel names (comma-separated) where the summary will be posted.",
              { workspace: workspaceName },
            ),
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "#incidents-summary, #engineering",
          },
          /*
           * Mattermost, whose bot is a member of two or more teams - or a
           * summary that picks a team the bot was taken out of: the team its
           * channels are in, as a notification rule picks it. Left empty,
           * they are looked for in the default team first, then in the
           * bot's other teams. Kept as the team's id in teamName, which the
           * summary hands Mattermost as the team of its channels
           * (WorkspaceNotificationSummaryService).
           */
          ...(props.workspaceType === WorkspaceType.Mattermost &&
          mattermostConnection
            ? [
                {
                  field: {
                    teamName: true,
                  },
                  stepId: "basic",
                  title: MATTERMOST_TEAM_TITLE,
                  description: EXISTING_CHANNELS_MATTERMOST_TEAM_DESCRIPTION,
                  fieldType: FormFieldSchemaType.Dropdown,
                  required: false,
                  placeholder: MATTERMOST_TEAM_PLACEHOLDER,
                  dropdownOptions: getMattermostTeamOptions({
                    connection: mattermostConnection,
                    teams: mattermostConnection.teams,
                    notJoined: [],
                    translator: translator,
                  }),
                  fetchDropdownOptions: async (
                    values: FormValues<WorkspaceNotificationSummary>,
                  ): Promise<Array<DropdownOption>> => {
                    /*
                     * Run each time the step opens, on the form's values: a
                     * pick of a team the bot left is kept till the form closes.
                     */
                    for (const team of getMattermostTeamsNotJoined({
                      connection: mattermostConnection,
                      teamIds: [
                        typeof values.teamName === "string"
                          ? values.teamName
                          : undefined,
                      ],
                    })) {
                      if (
                        !summaryTeamsNotJoined.current.some(
                          (kept: MattermostConnectionTeam): boolean => {
                            return kept.id === team.id;
                          },
                        )
                      ) {
                        summaryTeamsNotJoined.current = [
                          ...summaryTeamsNotJoined.current,
                          team,
                        ];
                      }
                    }

                    return getMattermostTeamOptions({
                      connection: mattermostConnection,
                      teams: mattermostConnection.teams,
                      notJoined: summaryTeamsNotJoined.current,
                      translator: translator,
                    });
                  },
                  showIf: (): boolean => {
                    return (
                      mattermostConnection.teams.length > 1 ||
                      summaryTeamsNotJoined.current.length > 0
                    );
                  },
                },
              ]
            : []),
          ...(props.workspaceType === WorkspaceType.MicrosoftTeams
            ? [
                {
                  field: {
                    teamName: true,
                  },
                  stepId: "basic",
                  title: "Team Name",
                  description:
                    "The name of the Microsoft Teams team where the summary will be posted.",
                  fieldType: FormFieldSchemaType.Text,
                  required: false,
                  placeholder: "Engineering Team",
                },
              ]
            : []),
          {
            field: {
              isEnabled: true,
            },
            stepId: "basic",
            title: "Enabled",
            description:
              "When enabled, the summary will be sent automatically on the configured schedule.",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            /*
             * On, as the column defaults to. The switch drew off - its model
             * column declares the default only to the database - and a
             * switch left alone is sent as off, so a summary created as the
             * form opened was saved disabled and never went out.
             */
            defaultValue: true,
          },
          {
            field: {
              recurringInterval: true,
            },
            title: "How Often",
            description:
              "Choose how frequently this summary should be posted (e.g., every 1 day, every 1 week).",
            fieldType: FormFieldSchemaType.CustomComponent,
            required: true,
            stepId: "schedule",
            getCustomElement: (
              value: FormValues<WorkspaceNotificationSummary>,
              elementProps: CustomElementProps,
            ): ReactElement => {
              return (
                <RecurringFieldElement
                  error={elementProps.error}
                  onChange={(recurring: Recurring) => {
                    if (elementProps.onChange) {
                      elementProps.onChange(recurring);
                    }
                  }}
                  // A saved interval in either shape: a Recurring or its JSON.
                  initialValue={WorkspaceSummaryScheduleUtil.toRecurring(
                    value.recurringInterval,
                  )}
                />
              );
            },
          },
          /*
           * The clock the schedule is read on: the summary goes out at the
           * same time of day there all year, the clocks changing for
           * daylight saving time included. It starts on the creator's own
           * time zone, so nobody has to touch it.
           */
          {
            field: {
              timezone: true,
            },
            title: "Timezone",
            description:
              "Summaries go out at the same time of day in this timezone all year, also after the clocks change.",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: timezoneOptions,
            defaultValue: OneUptimeDate.getCurrentTimezone(),
            required: true,
            stepId: "schedule",
            placeholder: "Select Timezone",
          },
          {
            field: {
              sendFirstReportAt: true,
            },
            title: "Send First Report At",
            description:
              "Later summaries go out at the same time of day. Leave empty for 09:00 at the start of the next period.",
            fieldType: FormFieldSchemaType.DateTime,
            required: false,
            stepId: "schedule",
            /*
             * When the first summary goes out, worked out from what the form
             * holds the way the server will work it out on save - so leaving
             * the date empty says what that means. Only while creating: a
             * saved summary's next send is in the list.
             */
            getFooterElement: (
              values: FormValues<WorkspaceNotificationSummary>,
            ): ReactElement => {
              return (
                <WorkspaceSummaryFirstSendPreview
                  recurringInterval={values.recurringInterval}
                  sendFirstReportAt={values.sendFirstReportAt}
                  timezone={values.timezone}
                  isSaved={Boolean((values as Record<string, unknown>)["_id"])}
                />
              );
            },
          },
          {
            field: {
              numberOfDaysOfData: true,
            },
            title: "Lookback Period (Days)",
            description:
              "How many days of data to include in each summary. For example, 7 means the summary will cover the last 7 days.",
            fieldType: FormFieldSchemaType.Number,
            required: true,
            stepId: "schedule",
            placeholder: "7",
            /*
             * The last 7 days, as the column defaults to and as a weekly
             * summary covers. It drew empty - its model column declares the
             * default only to the database - and the step would not go on
             * until a number was typed.
             */
            defaultValue: 7,
            /*
             * 1 to 365 days, as the server holds every write to
             * (WorkspaceSummarySetup): it took 0, which the server refused
             * by the column's name, and -5, which it saved.
             */
            validation: {
              minValue: MIN_LOOKBACK_DAYS,
              maxValue: MAX_LOOKBACK_DAYS,
            },
          },
          {
            field: {
              summaryItems: true,
            },
            title: "What to Include",
            description:
              'Choose which sections appear in the summary. Select "All" to include everything, or pick specific sections.',
            fieldType: FormFieldSchemaType.CustomComponent,
            required: false,
            stepId: "content",
            getCustomElement: (
              value: FormValues<WorkspaceNotificationSummary>,
              elementProps: CustomElementProps,
            ): ReactElement => {
              const currentItems: Array<WorkspaceNotificationSummaryItem> =
                (value.summaryItems as Array<WorkspaceNotificationSummaryItem>) || [
                  WorkspaceNotificationSummaryItem.All,
                ];

              const isAllSelected: boolean = currentItems.includes(
                WorkspaceNotificationSummaryItem.All,
              );

              const individualItems: Array<WorkspaceNotificationSummaryItem> =
                allSummaryItems.filter(
                  (item: WorkspaceNotificationSummaryItem) => {
                    return item !== WorkspaceNotificationSummaryItem.All;
                  },
                );

              return (
                <div className="space-y-2">
                  <CheckboxElement
                    title="All"
                    value={isAllSelected}
                    onChange={(checked: boolean) => {
                      if (elementProps.onChange) {
                        if (checked) {
                          elementProps.onChange([
                            WorkspaceNotificationSummaryItem.All,
                          ]);
                        } else {
                          elementProps.onChange([]);
                        }
                      }
                    }}
                  />
                  <div className="ml-6 space-y-2">
                    {individualItems.map(
                      (item: WorkspaceNotificationSummaryItem) => {
                        return (
                          <CheckboxElement
                            key={item}
                            title={item}
                            disabled={isAllSelected}
                            value={isAllSelected || currentItems.includes(item)}
                            onChange={(checked: boolean) => {
                              if (elementProps.onChange) {
                                let newItems: Array<WorkspaceNotificationSummaryItem> =
                                  currentItems.filter(
                                    (i: WorkspaceNotificationSummaryItem) => {
                                      return (
                                        i !==
                                          WorkspaceNotificationSummaryItem.All &&
                                        i !== item
                                      );
                                    },
                                  );
                                if (checked) {
                                  newItems.push(item);
                                }
                                // If all individual items are selected, switch to "All"
                                if (
                                  newItems.length === individualItems.length
                                ) {
                                  newItems = [
                                    WorkspaceNotificationSummaryItem.All,
                                  ];
                                }
                                elementProps.onChange(newItems);
                              }
                            }}
                          />
                        );
                      },
                    )}
                  </div>
                </div>
              );
            },
          },
          {
            field: {
              filters: true,
            },
            /*
             * Which records the summary includes, asked as a workspace
             * rule's conditions are: "All incidents" or "Only incidents that
             * match conditions" (NotificationRuleConditions), under the
             * rule form's own heading. It said "Leave empty to include
             * all." over an Add Condition button.
             */
            title: NOTIFICATION_RULE_CONDITIONS_TITLES[eventType],
            sectionTitle: NOTIFICATION_RULE_CONDITIONS_TITLES[eventType],
            customElementDrawsOwnLabel: true,
            hideOptionalLabel: true,
            fieldType: FormFieldSchemaType.CustomComponent,
            required: false,
            stepId: "filters",
            /*
             * Every condition complete, as a notification rule's are: a
             * condition left without its operator was skipped when the
             * summary was built, and took every or no item with it
             * depending on All or Any. One left empty is still dropped on
             * create.
             */
            customValidation: (
              values: FormValues<WorkspaceNotificationSummary>,
            ): string | null => {
              return NotificationRuleConditionUtil.getConditionsValidationError(
                {
                  notificationRule: {
                    filters:
                      NotificationRuleConditionUtil.withoutEmptyConditions(
                        (values.filters as
                          | Array<NotificationRuleCondition>
                          | undefined) || [],
                      ),
                  } as IncidentNotificationRule,
                },
              );
            },
            getCustomElement: (
              value: FormValues<WorkspaceNotificationSummary>,
              elementProps: CustomElementProps,
            ): ReactElement => {
              return (
                <NotificationRuleConditions
                  eventType={eventType}
                  monitors={monitors}
                  labels={labels}
                  alertStates={alertStates}
                  alertSeverities={alertSeverities}
                  incidentSeverities={incidentSeverities}
                  incidentStates={incidentStates}
                  scheduledMaintenanceStates={[]}
                  monitorStatus={[]}
                  onChange={(conditions: Array<NotificationRuleCondition>) => {
                    if (elementProps.onChange) {
                      elementProps.onChange(conditions);
                    }
                  }}
                  value={
                    (value.filters as
                      | Array<NotificationRuleCondition>
                      | undefined) || []
                  }
                />
              );
            },
          },
          /*
           * Only once there are two conditions to combine: with one, All and
           * Any include the same items (every condition is complete - the
           * field above checks). Hidden, it keeps what the summary holds:
           * All for a new one.
           */
          {
            field: {
              filterCondition: true,
            },
            title: "Match Condition",
            description:
              "Should all conditions match, or just any one of them?",
            fieldType: FormFieldSchemaType.RadioButton,
            required: false,
            stepId: "filters",
            /*
             * Only a summary saved without one reaches this default - the
             * create form starts on All. The summary is built as Any then
             * (WorkspaceNotificationSummaryService), so that is what it
             * shows, and what it keeps when saved.
             */
            defaultValue: FilterCondition.Any,
            radioButtonOptions: [
              {
                title: "All",
                value: FilterCondition.All,
              },
              {
                title: "Any",
                value: FilterCondition.Any,
              },
            ],
            showIf: (values: FormValues<WorkspaceNotificationSummary>) => {
              return isFilterConditionNeeded(values.filters);
            },
          },
        ]}
        formSteps={[
          {
            title: "Basic Info",
            id: "basic",
          },
          {
            title: "Schedule",
            id: "schedule",
          },
          {
            title: "Content",
            id: "content",
          },
          {
            title: "Filters",
            id: "filters",
          },
        ]}
        showRefreshButton={true}
        filters={[
          {
            field: {
              name: true,
            },
            type: FieldType.Text,
            title: "Summary Name",
          },
          {
            field: {
              isEnabled: true,
            },
            type: FieldType.Boolean,
            title: "Enabled",
          },
        ]}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: {
              isEnabled: true,
            },
            title: "Enabled",
            type: FieldType.Boolean,
          },
          {
            field: {
              recurringInterval: true,
            },
            title: "Frequency",
            type: FieldType.Element,
            getElement: (value: WorkspaceNotificationSummary): ReactElement => {
              return (
                <RecurringViewElement
                  value={value.recurringInterval as Recurring}
                />
              );
            },
          },
          /*
           * The clock the summary keeps its time of day on. One with none
           * is read in UTC, so that is what it says.
           */
          {
            field: {
              timezone: true,
            },
            noValueMessage: "UTC",
            title: "Timezone",
            type: FieldType.Text,
          },
          {
            field: {
              sendFirstReportAt: true,
            },
            title: "First Report",
            type: FieldType.DateTime,
          },
          {
            field: {
              numberOfDaysOfData: true,
            },
            title: "Lookback",
            type: FieldType.Element,
            // The days the summary covers, read as its report reads them.
            getElement: (value: WorkspaceNotificationSummary): ReactElement => {
              return (
                <span>
                  {translator.translatePlural(
                    { one: "{{count}} day", other: "{{count}} days" },
                    WorkspaceSummarySetup.getLookbackDays(
                      value.numberOfDaysOfData,
                    ),
                  )}
                </span>
              );
            },
          },
          {
            field: {
              lastSentAt: true,
            },
            noValueMessage: "Never",
            title: "Last Sent",
            type: FieldType.DateTime,
          },
          {
            field: {
              nextSendAt: true,
            },
            title: "Next Send",
            type: FieldType.DateTime,
          },
        ]}
      />

      {showTestModal && testSummary ? (
        <ConfirmModal
          title={`Send Test Summary Now`}
          description={translator.translatePlural(
            {
              one: 'Send the "{{name}}" summary to {{workspace}} now, with the last {{count}} day of data. The regular schedule is not affected.',
              other:
                'Send the "{{name}}" summary to {{workspace}} now, with the last {{count}} days of data. The regular schedule is not affected.',
            },
            WorkspaceSummarySetup.getLookbackDays(
              testSummary.numberOfDaysOfData,
            ),
            { name: testSummary.name || "", workspace: workspaceName },
          )}
          submitButtonText={"Send Now"}
          onClose={() => {
            setShowTestModal(false);
            setTestSummary(undefined);
            setTestError(undefined);
          }}
          isLoading={isTestLoading}
          onSubmit={async () => {
            if (!testSummary.id) {
              return;
            }
            await testSummaryFn(testSummary.id!);
          }}
        />
      ) : (
        <></>
      )}

      {/*
       * No onClose: a dialog that only reports an outcome needs one way
       * out, and "Close" is it (SendTestNotificationButton's, the same).
       * A failure says how many channels did not get the test, lists each
       * under why (WorkspaceSummaryTestFailure), then what to do next.
       */}
      {showTestResultModal ? (
        <ConfirmModal
          title={testError ? `Test Failed` : `Summary Sent`}
          error={testFailureLead}
          description={
            testError ? (
              hasTestChannelsNotPostedIn ? (
                <WorkspaceSummaryTestFailure channels={testChannels} />
              ) : (
                getWorkspaceSummaryTestNextStep(translator, 1)
              )
            ) : (
              translator.translateTemplate(
                "The test summary was sent successfully. Check your {{workspace}} channel to see how it looks.",
                { workspace: workspaceName },
              )
            )
          }
          submitButtonType={ButtonStyleType.NORMAL}
          submitButtonText={"Close"}
          onSubmit={async () => {
            setShowTestResultModal(false);
            setTestSummary(undefined);
            setShowTestModal(false);
            setTestError(undefined);
            setTestChannels([]);
          }}
        />
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default WorkspaceSummaryTable;
