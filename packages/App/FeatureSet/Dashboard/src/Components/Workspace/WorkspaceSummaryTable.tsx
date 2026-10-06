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
  ReactElement,
  useEffect,
  useMemo,
} from "react";
import WorkspaceType, {
  getWorkspaceTypeDisplayName,
} from "Common/Types/Workspace/WorkspaceType";
import WorkspaceNotificationSummary from "Common/Models/DatabaseModels/WorkspaceNotificationSummary";
import WorkspaceNotificationSummaryType from "Common/Types/Workspace/NotificationSummary/WorkspaceNotificationSummaryType";
import WorkspaceNotificationSummaryItem from "Common/Types/Workspace/NotificationSummary/WorkspaceNotificationSummaryItem";
import NotificationRuleEventType from "Common/Types/Workspace/NotificationRules/EventType";
import NotificationRuleCondition, {
  NotificationRuleConditionUtil,
} from "Common/Types/Workspace/NotificationRules/NotificationRuleCondition";
import IncidentNotificationRule from "Common/Types/Workspace/NotificationRules/NotificationRuleTypes/IncidentNotificationRule";
import NotificationRuleConditions from "./NotificationRuleForm/NotificationRuleConditions";
import FilterCondition from "Common/Types/Filter/FilterCondition";
import { isFilterConditionNeeded } from "Common/Types/Filter/FilterConditionUtil";
import WorkspaceSummaryScheduleUtil from "Common/Utils/Workspace/WorkspaceSummarySchedule";
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

export interface ComponentProps {
  workspaceType: WorkspaceType;
  summaryType: WorkspaceNotificationSummaryType;
}

const WorkspaceSummaryTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
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

  // Test modal state
  const [showTestModal, setShowTestModal] = React.useState<boolean>(false);
  const [isTestLoading, setIsTestLoading] = React.useState<boolean>(false);
  const [testError, setTestError] = React.useState<string | undefined>(
    undefined,
  );
  const [testSummary, setTestSummary] = React.useState<
    WorkspaceNotificationSummary | undefined
  >(undefined);
  const [showTestSuccessModal, setShowTestSuccessModal] =
    React.useState<boolean>(false);

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

      const response: HTTPResponse<EmptyResponseData> | HTTPErrorResponse =
        await API.post({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            `/workspace-notification-summary/test/${summaryId.toString()}`,
          ),
          data: {},
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

  const allSummaryItems: Array<WorkspaceNotificationSummaryItem> =
    Object.values(WorkspaceNotificationSummaryItem);

  const typeLabel: string = props.summaryType;

  return (
    <Fragment>
      <ModelTable<WorkspaceNotificationSummary>
        modelType={WorkspaceNotificationSummary}
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
        singularName={`${typeLabel} Summary`}
        pluralName={`${typeLabel} Summaries`}
        id={`workspace-summary-table-${props.summaryType}`}
        name={`${typeLabel} Workspace Summaries`}
        isDeleteable={true}
        isEditable={true}
        createEditModalWidth={ModalWidth.Large}
        isCreateable={true}
        cardProps={{
          title: `${typeLabel} Summary - ${getWorkspaceTypeDisplayName(props.workspaceType)}`,
          description: `Set up recurring ${typeLabel.toLowerCase()} summary reports posted to ${getWorkspaceTypeDisplayName(props.workspaceType)}. Each summary includes stats like total count, MTTA/MTTR, severity breakdown, and a list of ${typeLabel.toLowerCase()}s with links.`,
        }}
        showAs={ShowAs.List}
        noItemsMessage={`No ${typeLabel.toLowerCase()} summary rules configured yet. Create one to start receiving periodic reports.`}
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

          // Parse channel names from comma-separated string
          if (values.channelNames && typeof values.channelNames === "string") {
            values.channelNames = (values.channelNames as unknown as string)
              .split(",")
              .map((name: string) => {
                return name.trim();
              })
              .filter((name: string) => {
                return name.length > 0;
              });
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
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Summary Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            stepId: "basic",
            placeholder: `Weekly ${typeLabel} Summary`,
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
            placeholder: `e.g., Weekly ${typeLabel.toLowerCase()} summary for the engineering team.`,
          },
          {
            field: {
              channelNames: true,
            },
            stepId: "basic",
            title: "Channel Names",
            description: `Enter one or more ${getWorkspaceTypeDisplayName(props.workspaceType)} channel names (comma-separated) where the summary will be posted.`,
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "#incidents-summary, #engineering",
          },
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
              "Later summaries follow it at the same time of day. Leave it empty to start at 09:00 in the summary's timezone, at the start of the next week, day or month.",
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
            title: "Filter Conditions",
            description: `Only include ${typeLabel.toLowerCase()}s that match these conditions. Leave empty to include all.`,
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
            noValueMessage: "-",
            title: "First Report",
            type: FieldType.DateTime,
          },
          {
            field: {
              numberOfDaysOfData: true,
            },
            title: "Lookback",
            type: FieldType.Element,
            getElement: (value: WorkspaceNotificationSummary): ReactElement => {
              return <span>{value.numberOfDaysOfData} days</span>;
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
            noValueMessage: "-",
            title: "Next Send",
            type: FieldType.DateTime,
          },
        ]}
      />

      {showTestModal && testSummary ? (
        <ConfirmModal
          title={`Send Test Summary Now`}
          error={testError}
          description={`This will send the "${testSummary.name}" summary to ${getWorkspaceTypeDisplayName(props.workspaceType)} right now. The summary will include data from the last ${testSummary.numberOfDaysOfData || 7} days. This will not affect the regular schedule.`}
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

      {showTestSuccessModal ? (
        <ConfirmModal
          title={testError ? `Test Failed` : `Summary Sent`}
          error={testError}
          description={
            testError
              ? `The test summary could not be sent. Please check your channel names and workspace connection settings.`
              : `The test summary was sent successfully. Check your ${getWorkspaceTypeDisplayName(props.workspaceType)} channel to see how it looks.`
          }
          submitButtonType={ButtonStyleType.NORMAL}
          submitButtonText={"Close"}
          onSubmit={async () => {
            setShowTestSuccessModal(false);
            setTestSummary(undefined);
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

export default WorkspaceSummaryTable;
