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
} from "react";
import WorkspaceType, {
  getWorkspaceTypeDisplayName,
} from "Common/Types/Workspace/WorkspaceType";
import WorkspaceNotificationSummary from "Common/Models/DatabaseModels/WorkspaceNotificationSummary";
import WorkspaceNotificationSummaryType from "Common/Types/Workspace/NotificationSummary/WorkspaceNotificationSummaryType";
import WorkspaceNotificationSummaryItem from "Common/Types/Workspace/NotificationSummary/WorkspaceNotificationSummaryItem";
import NotificationRuleEventType from "Common/Types/Workspace/NotificationRules/EventType";
import NotificationRuleCondition from "Common/Types/Workspace/NotificationRules/NotificationRuleCondition";
import NotificationRuleConditions from "./NotificationRuleForm/NotificationRuleConditions";
import FilterCondition from "Common/Types/Filter/FilterCondition";
import API from "Common/Utils/API";
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
        select: { name: true, _id: true, color: true },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        sort: { name: SortOrder.Ascending },
      });
      setAlertStates(alertStatesResult.data);

      const alertSevResult: ListResult<AlertSeverity> = await ModelAPI.getList({
        modelType: AlertSeverity,
        query: { projectId: ProjectUtil.getCurrentProjectId()! },
        select: { name: true, _id: true, color: true },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        sort: { name: SortOrder.Ascending },
      });
      setAlertSeverities(alertSevResult.data);

      const incSevResult: ListResult<IncidentSeverity> = await ModelAPI.getList(
        {
          modelType: IncidentSeverity,
          query: { projectId: ProjectUtil.getCurrentProjectId()! },
          select: { name: true, _id: true, color: true },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          sort: { name: SortOrder.Ascending },
        },
      );
      setIncidentSeverities(incSevResult.data);

      const incStatesResult: ListResult<IncidentState> = await ModelAPI.getList(
        {
          modelType: IncidentState,
          query: { projectId: ProjectUtil.getCurrentProjectId()! },
          select: { name: true, _id: true, color: true },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          sort: { name: SortOrder.Ascending },
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
        onBeforeCreate={(values: WorkspaceNotificationSummary) => {
          values.summaryType = props.summaryType;
          values.projectId = ProjectUtil.getCurrentProjectId()!;
          values.workspaceType = props.workspaceType;

          // Set nextSendAt based on sendFirstReportAt or recurringInterval
          if (values.sendFirstReportAt) {
            const firstReportDate: Date = new Date(
              values.sendFirstReportAt as unknown as string,
            );
            if (
              firstReportDate.getTime() >
              OneUptimeDate.getCurrentDate().getTime()
            ) {
              values.nextSendAt = firstReportDate;
            } else {
              values.nextSendAt = values.sendFirstReportAt;
            }
          } else if (values.recurringInterval) {
            const recurring: Recurring = Recurring.fromJSON(
              values.recurringInterval,
            );
            values.nextSendAt = Recurring.getNextDateInterval(
              OneUptimeDate.getCurrentDate(),
              recurring,
            );
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

          // Clean up empty filters
          if (values.filters && Array.isArray(values.filters)) {
            values.filters = values.filters.filter(
              (f: NotificationRuleCondition) => {
                if (!f.value) {
                  return false;
                }
                if (Array.isArray(f.value)) {
                  return f.value.length > 0;
                }
                // String-based conditions (e.g., title contains "X")
                if (typeof f.value === "string") {
                  return f.value.trim().length > 0;
                }
                return true;
              },
            );
          }

          if (!values.filterCondition) {
            values.filterCondition = FilterCondition.Any;
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
                  initialValue={
                    value.recurringInterval &&
                    value.recurringInterval instanceof Recurring
                      ? Recurring.fromJSON(value.recurringInterval as Recurring)
                      : undefined
                  }
                />
              );
            },
          },
          {
            field: {
              sendFirstReportAt: true,
            },
            title: "Send First Report At",
            description:
              "When should the first summary report be sent? Subsequent reports will follow the recurring interval from this date. If left empty, the first report will be sent after the recurring interval from now.",
            fieldType: FormFieldSchemaType.DateTime,
            required: false,
            stepId: "schedule",
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
          },
          {
            field: {
              summaryItems: true,
            },
            title: "What to Include",
            description:
              "Choose which sections appear in the summary. Select \"All\" to include everything, or pick specific sections.",
            fieldType: FormFieldSchemaType.CustomComponent,
            required: false,
            stepId: "content",
            getCustomElement: (
              value: FormValues<WorkspaceNotificationSummary>,
              elementProps: CustomElementProps,
            ): ReactElement => {
              const currentItems: Array<WorkspaceNotificationSummaryItem> =
                (value.summaryItems as Array<WorkspaceNotificationSummaryItem>) ||
                [WorkspaceNotificationSummaryItem.All];

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
                            value={
                              isAllSelected || currentItems.includes(item)
                            }
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
              filterCondition: true,
            },
            title: "Filter Condition",
            description: `Choose whether ${typeLabel.toLowerCase()}s must match ALL filters or ANY filter. If no filters are added, the summary will include all ${typeLabel.toLowerCase()}s.`,
            fieldType: FormFieldSchemaType.RadioButton,
            required: false,
            stepId: "filters",
            radioButtonOptions: [
              {
                title: "Any",
                value: FilterCondition.Any,
              },
              {
                title: "All",
                value: FilterCondition.All,
              },
            ],
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
