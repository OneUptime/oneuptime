import PageComponentProps from "../../PageComponentProps";
import NotNull from "Common/Types/BaseDatabase/NotNull";
import URL from "Common/Types/API/URL";
import { Green, Red } from "Common/Types/BrandColors";
import BadDataException from "Common/Types/Exception/BadDataException";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { CardButtonSchema } from "Common/UI/Components/Card/Card";
import { CategoryCheckboxOptionsAndCategories } from "Common/UI/Components/CategoryCheckbox/Index";
import CSVFileUpload, {
  CSVColumn,
  CSVRow,
} from "Common/UI/Components/CSVFileUpload/CSVFileUpload";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import Icon from "Common/UI/Components/Icon/Icon";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Toggle from "Common/UI/Components/Toggle/Toggle";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import ProgressBar, {
  ProgressBarSize,
} from "Common/UI/Components/ProgressBar/ProgressBar";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import SubscriberUtil from "Common/UI/Utils/StatusPage";
import SubscriberNotificationWarnings from "../../../Components/StatusPage/SubscriberNotificationWarnings";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageSubscriber from "Common/Models/DatabaseModels/StatusPageSubscriber";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ProjectUtil from "Common/UI/Utils/Project";

const StatusPageSlackSubscribers: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const [
    allowSubscribersToChooseResources,
    setAllowSubscribersToChooseResources,
  ] = React.useState<boolean>(false);

  const [
    allowSubscribersToChooseEventTypes,
    setAllowSubscribersToChooseEventTypes,
  ] = React.useState<boolean>(false);

  const [isSlackSubscribersEnabled, setIsSlackSubscribersEnabled] =
    React.useState<boolean>(false);
  const [isLoading, setIsLoading] = React.useState<boolean>(false);
  const [error, setError] = React.useState<string>("");
  const [
    categoryCheckboxOptionsAndCategories,
    setCategoryCheckboxOptionsAndCategories,
  ] = useState<CategoryCheckboxOptionsAndCategories>({
    categories: [],
    options: [],
  });

  const fetchCheckboxOptionsAndCategories: PromiseVoidFunction =
    async (): Promise<void> => {
      const result: CategoryCheckboxOptionsAndCategories =
        await SubscriberUtil.getCategoryCheckboxPropsBasedOnResources(modelId);

      setCategoryCheckboxOptionsAndCategories(result);
    };

  const fetchStatusPage: PromiseVoidFunction = async (): Promise<void> => {
    try {
      setIsLoading(true);

      const statusPage: StatusPage | null = await ModelAPI.getItem({
        modelType: StatusPage,
        id: modelId,
        select: {
          allowSubscribersToChooseResources: true,
          allowSubscribersToChooseEventTypes: true,
          enableSlackSubscribers: true,
        },
      });

      if (statusPage && statusPage.allowSubscribersToChooseResources) {
        setAllowSubscribersToChooseResources(
          statusPage.allowSubscribersToChooseResources,
        );
        await fetchCheckboxOptionsAndCategories();
      }

      if (statusPage && statusPage.allowSubscribersToChooseEventTypes) {
        setAllowSubscribersToChooseEventTypes(
          statusPage.allowSubscribersToChooseEventTypes,
        );
      }

      if (statusPage && statusPage.enableSlackSubscribers) {
        setIsSlackSubscribersEnabled(statusPage.enableSlackSubscribers);
      }

      setIsLoading(false);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  useEffect(() => {
    fetchStatusPage().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  const [formFields, setFormFields] = React.useState<
    Array<ModelField<StatusPageSubscriber>>
  >([]);

  const [showBulkAddModal, setShowBulkAddModal] = useState<boolean>(false);
  const [showProgressModal, setShowProgressModal] = useState<boolean>(false);
  const [bulkActionInProgress, setBulkActionInProgress] =
    useState<boolean>(false);
  const [bulkProgress, setBulkProgress] = useState<{
    completed: number;
    total: number;
    succeeded: number;
    failed: Array<{ webhookUrl: string; error: string }>;
  }>({
    completed: 0,
    total: 0,
    succeeded: 0,
    failed: [],
  });
  const [refreshToggle, setRefreshToggle] = useState<string>(
    Date.now().toString(),
  );
  const [csvRows, setCsvRows] = useState<Array<CSVRow>>([]);
  const [sendNotification, setSendNotification] = useState<boolean>(false);

  const slackCsvColumns: Array<CSVColumn> = [
    {
      key: "workspaceName",
      title: "Workspace Name",
      required: true,
      description: "Name of the Slack workspace for identification",
    },
    {
      key: "webhookUrl",
      title: "Incoming Webhook URL",
      required: true,
      description: "Slack incoming webhook URL",
    },
  ];

  const handleBulkAddSubmit: () => Promise<void> = async (): Promise<void> => {
    if (!props.currentProject || !props.currentProject._id) {
      throw new BadDataException("Project ID cannot be null");
    }

    if (csvRows.length === 0) {
      return;
    }

    setShowBulkAddModal(false);
    setShowProgressModal(true);
    setBulkActionInProgress(true);
    setBulkProgress({
      completed: 0,
      total: csvRows.length,
      succeeded: 0,
      failed: [],
    });

    const projectId: ObjectID = new ObjectID(props.currentProject._id);
    let succeeded: number = 0;
    const failed: Array<{ webhookUrl: string; error: string }> = [];

    for (let i: number = 0; i < csvRows.length; i++) {
      const row: CSVRow = csvRows[i]!;
      const urlStr: string = row["webhookUrl"] || "";
      const workspaceName: string = row["workspaceName"] || "";

      try {
        const subscriber: StatusPageSubscriber = new StatusPageSubscriber();
        subscriber.slackIncomingWebhookUrl = URL.fromString(urlStr);
        subscriber.slackWorkspaceName = workspaceName;
        subscriber.statusPageId = modelId;
        subscriber.projectId = projectId;
        subscriber.sendYouHaveSubscribedMessage = sendNotification;

        await ModelAPI.create<StatusPageSubscriber>({
          model: subscriber,
          modelType: StatusPageSubscriber,
        });
        succeeded++;
      } catch (err) {
        failed.push({
          webhookUrl: urlStr,
          error: API.getFriendlyMessage(err),
        });
      }

      setBulkProgress({
        completed: i + 1,
        total: csvRows.length,
        succeeded,
        failed: [...failed],
      });
    }

    setBulkActionInProgress(false);
    setRefreshToggle(Date.now().toString());
  };

  useEffect(() => {
    if (isLoading) {
      return; // don't do anything if loading
    }

    const formFields: Array<ModelField<StatusPageSubscriber>> = [
      {
        field: {
          slackWorkspaceName: true,
        },
        stepId: "subscriber-info",
        title: "Slack Workspace Name",
        description: "Name of the Slack workspace for identification.",
        fieldType: FormFieldSchemaType.Text,
        required: true,
        placeholder: "my-company-workspace",
      },
      {
        field: {
          slackIncomingWebhookUrl: true,
        },
        stepId: "subscriber-info",
        title: "Slack Incoming Webhook URL",
        description: "Status page updates will be sent to this Slack channel.",
        fieldType: FormFieldSchemaType.URL,
        required: true,
        placeholder: "https://hooks.slack.com/services/...",
        disableSpellCheck: true,
      },
      {
        field: {
          sendYouHaveSubscribedMessage: true,
        },
        title: "Send Subscription Notification",
        stepId: "subscriber-info",
        description:
          "Send a notification to the Slack channel confirming the subscription.",
        fieldType: FormFieldSchemaType.Toggle,
        required: false,
        doNotShowWhenEditing: true,
      },

      {
        field: {
          isUnsubscribed: true,
        },
        title: "Unsubscribe",
        stepId: "subscriber-info",
        description: "Unsubscribe this Slack channel from the status page.",
        fieldType: FormFieldSchemaType.Toggle,
        required: false,
        doNotShowWhenCreating: true,
      },
    ];

    if (allowSubscribersToChooseResources) {
      formFields.push({
        field: {
          isSubscribedToAllResources: true,
        },
        title: "Subscribe to All Resources",
        stepId: "subscriber-info",
        description: "Send notifications for all resources.",
        fieldType: FormFieldSchemaType.Checkbox,
        required: false,
        defaultValue: true,
      });

      formFields.push({
        field: {
          statusPageResources: true,
        },
        title: "Select Resources to Subscribe",
        description: "Please select the resources you want to subscribe to.",
        stepId: "subscriber-info",
        fieldType: FormFieldSchemaType.CategoryCheckbox,
        required: false,
        categoryCheckboxProps: categoryCheckboxOptionsAndCategories,
        showIf: (model: FormValues<StatusPageSubscriber>) => {
          return !model || !model.isSubscribedToAllResources;
        },
      });
    }

    if (allowSubscribersToChooseEventTypes) {
      formFields.push({
        field: {
          isSubscribedToAllEventTypes: true,
        },
        title: "Subscribe to All Event Types",
        stepId: "subscriber-info",
        description:
          "Select this option if you want to subscribe to all event types.",
        fieldType: FormFieldSchemaType.Checkbox,
        required: false,
        defaultValue: true,
      });

      formFields.push({
        field: {
          statusPageEventTypes: true,
        },
        title: "Select Event Types to Subscribe",
        stepId: "subscriber-info",
        description: "Please select the event types you want to subscribe to.",
        fieldType: FormFieldSchemaType.MultiSelectDropdown,
        required: false,
        dropdownOptions: SubscriberUtil.getDropdownPropsBasedOnEventTypes(),
        showIf: (model: FormValues<StatusPageSubscriber>) => {
          return !model || !model.isSubscribedToAllEventTypes;
        },
      });
    }

    // add internal note field
    formFields.push({
      field: {
        internalNote: true,
      },
      title: "Internal Note",
      stepId: "internal-info",
      description:
        "Internal note for the subscriber. This is for internal use only and is visible only to the team members.",
      fieldType: FormFieldSchemaType.Markdown,
      required: false,
    });

    setFormFields(formFields);
  }, [isLoading]);

  return (
    <Fragment>
      {isLoading ? <PageLoader isVisible={true} /> : <></>}

      {error ? <ErrorMessage message={error} /> : <></>}

      {!error && !isLoading ? (
        <>
          {!isSlackSubscribersEnabled && (
            <Alert
              type={AlertType.DANGER}
              title="Slack subscribers are not enabled for this status page. Please enable it in Subscriber Settings"
            />
          )}
          <SubscriberNotificationWarnings statusPageId={modelId} />
          <ModelTable<StatusPageSubscriber>
            modelType={StatusPageSubscriber}
            id="table-slack-subscriber"
            name="Status Page > Slack Subscribers"
            userPreferencesKey="status-page-slack-subscribers-table"
            isDeleteable={true}
            showViewIdButton={true}
            isCreateable={true}
            isEditable={true}
            isViewable={false}
            selectMoreFields={{
              isSubscriptionConfirmed: true,
            }}
            query={{
              statusPageId: modelId,
              projectId: ProjectUtil.getCurrentProjectId()!,
              slackWorkspaceName: new NotNull(),
            }}
            onBeforeCreate={(
              item: StatusPageSubscriber,
            ): Promise<StatusPageSubscriber> => {
              if (!props.currentProject || !props.currentProject._id) {
                throw new BadDataException("Project ID cannot be null");
              }

              item.statusPageId = modelId;
              item.projectId = new ObjectID(props.currentProject._id);
              return Promise.resolve(item);
            }}
            refreshToggle={refreshToggle}
            cardProps={{
              title: "Slack Subscribers",
              description:
                "Here are the list of Slack channels that have subscribed to the status page.",
              buttons: [
                {
                  title: "Add in Bulk",
                  buttonStyle: ButtonStyleType.OUTLINE,
                  onClick: () => {
                    setShowBulkAddModal(true);
                  },
                } as CardButtonSchema,
              ],
            }}
            noItemsMessage={"No Slack subscribers found."}
            formSteps={[
              {
                title: "Subscriber Info",
                id: "subscriber-info",
              },
              {
                title: "Internal Info",
                id: "internal-info",
              },
            ]}
            formFields={formFields}
            showRefreshButton={true}
            viewPageRoute={Navigation.getCurrentRoute()}
            filters={[
              {
                field: {
                  slackWorkspaceName: true,
                },
                title: "Slack Workspace Name",
                type: FieldType.Text,
              },
              {
                field: {
                  isUnsubscribed: true,
                },
                title: "Is Unsubscribed",
                type: FieldType.Boolean,
              },
              {
                field: {
                  isSubscriptionConfirmed: true,
                },
                title: "Subscription Confirmed?",
                type: FieldType.Boolean,
              },
              {
                field: {
                  createdAt: true,
                },
                title: "Subscribed At",
                type: FieldType.DateTime,
              },
            ]}
            columns={[
              {
                field: {
                  slackWorkspaceName: true,
                },
                title: "Workspace Name",
                type: FieldType.Text,
              },
              {
                field: {
                  isUnsubscribed: true,
                },
                title: "Status",
                type: FieldType.Text,
                getElement: (item: StatusPageSubscriber): ReactElement => {
                  if (item["isUnsubscribed"]) {
                    return <Pill color={Red} text={"Unsubscribed"} />;
                  }

                  if (!item["isSubscriptionConfirmed"]) {
                    return (
                      <Pill
                        color={Red}
                        text={"Awaiting Confirmation"}
                        tooltip="Subscription not yet confirmed"
                      />
                    );
                  }

                  return <Pill color={Green} text={"Subscribed"} />;
                },
              },
              {
                field: {
                  createdAt: true,
                },
                title: "Subscribed At",
                type: FieldType.DateTime,
                hideOnMobile: true,
              },
            ]}
          />

          {showBulkAddModal && (
            <Modal
              title="Add Slack Subscribers in Bulk"
              description="Upload a CSV file with Slack workspace names and webhook URLs. Download the template to get started."
              submitButtonText="Add Subscribers"
              modalWidth={ModalWidth.Large}
              onClose={() => {
                setShowBulkAddModal(false);
                setCsvRows([]);
                setSendNotification(false);
              }}
              disableSubmitButton={csvRows.length === 0}
              onSubmit={() => {
                handleBulkAddSubmit();
              }}
            >
              <div className="space-y-4">
                <CSVFileUpload
                  columns={slackCsvColumns}
                  onDataChanged={(data: Array<CSVRow>) => {
                    setCsvRows(data);
                  }}
                  templateFileName="slack-subscribers-template.csv"
                />
                <div className="flex items-center space-x-3 pt-2">
                  <Toggle
                    value={sendNotification}
                    onChange={(value: boolean) => {
                      setSendNotification(value);
                    }}
                  />
                  <div>
                    <div className="text-sm font-medium text-gray-700">
                      Send Subscription Notification
                    </div>
                    <div className="text-xs text-gray-500">
                      Send a notification to the Slack channels confirming the
                      subscription.
                    </div>
                  </div>
                </div>
              </div>
            </Modal>
          )}

          {showProgressModal && (
            <ConfirmModal
              title={
                bulkActionInProgress
                  ? "Adding Subscribers..."
                  : "Bulk Add Complete"
              }
              description={
                <div>
                  {bulkActionInProgress ? (
                    <div className="space-y-4">
                      <p className="text-sm text-gray-500">
                        Please wait while subscribers are being added. This may
                        take a moment.
                      </p>
                      <ProgressBar
                        count={bulkProgress.completed}
                        totalCount={bulkProgress.total}
                        suffix="subscribers"
                        size={ProgressBarSize.Small}
                      />
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="flex flex-col space-y-3">
                        {bulkProgress.succeeded > 0 && (
                          <div className="flex items-center rounded-lg bg-green-50 p-3">
                            <Icon
                              className="h-5 w-5 flex-shrink-0"
                              icon={IconProp.CheckCircle}
                              color={Green}
                            />
                            <div className="ml-2 text-sm font-medium text-green-800">
                              {bulkProgress.succeeded}{" "}
                              {bulkProgress.succeeded === 1
                                ? "subscriber"
                                : "subscribers"}{" "}
                              added successfully
                            </div>
                          </div>
                        )}
                        {bulkProgress.failed.length > 0 && (
                          <div className="flex items-center rounded-lg bg-red-50 p-3">
                            <Icon
                              className="h-5 w-5 flex-shrink-0"
                              icon={IconProp.Close}
                              color={Red}
                            />
                            <div className="ml-2 text-sm font-medium text-red-800">
                              {bulkProgress.failed.length}{" "}
                              {bulkProgress.failed.length === 1
                                ? "subscriber"
                                : "subscribers"}{" "}
                              failed
                            </div>
                          </div>
                        )}
                      </div>

                      {bulkProgress.failed.length > 0 && (
                        <div className="rounded-lg border border-gray-200 overflow-hidden">
                          <div className="max-h-64 overflow-y-auto divide-y divide-gray-200">
                            {bulkProgress.failed.map(
                              (
                                failedItem: {
                                  webhookUrl: string;
                                  error: string;
                                },
                                i: number,
                              ) => {
                                return (
                                  <div className="px-4 py-3 text-sm" key={i}>
                                    <div className="font-medium text-gray-900">
                                      {failedItem.webhookUrl}
                                    </div>
                                    <div className="text-gray-500 mt-0.5">
                                      {failedItem.error}
                                    </div>
                                  </div>
                                );
                              },
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              }
              submitButtonType={ButtonStyleType.NORMAL}
              disableSubmitButton={bulkActionInProgress}
              submitButtonText="Close"
              onSubmit={() => {
                setShowProgressModal(false);
              }}
            />
          )}
        </>
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default StatusPageSlackSubscribers;
