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
import SubscriberUnsubscribeCopy from "../../../Components/StatusPage/SubscriberUnsubscribeCopy";
import TeamAddedSubscribersUnsubscribedNotice from "../../../Components/StatusPage/TeamAddedSubscribersUnsubscribedNotice";
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

const StatusPageWebhookSubscribers: FunctionComponent<PageComponentProps> = (
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

  const [isWebhookSubscribersEnabled, setIsWebhookSubscribersEnabled] =
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
          enableWebhookSubscribers: true,
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

      if (statusPage && statusPage.enableWebhookSubscribers) {
        setIsWebhookSubscribersEnabled(statusPage.enableWebhookSubscribers);
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

  const webhookCsvColumns: Array<CSVColumn> = [
    {
      key: "webhookUrl",
      title: "Webhook URL",
      required: true,
      description:
        "URL to which a JSON POST request will be sent on each status page event.",
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

      try {
        const subscriber: StatusPageSubscriber = new StatusPageSubscriber();
        subscriber.subscriberWebhook = URL.fromString(urlStr);
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
      return;
    }

    const formFields: Array<ModelField<StatusPageSubscriber>> = [
      {
        field: {
          subscriberWebhook: true,
        },
        stepId: "subscriber-info",
        title: "Webhook URL",
        description:
          "A JSON POST request will be sent to this webhook on each status page event.",
        fieldType: FormFieldSchemaType.URL,
        required: true,
        placeholder: "https://example.com/webhook",
        disableSpellCheck: true,
      },
      {
        field: {
          sendYouHaveSubscribedMessage: true,
        },
        title: "Send Subscription Notification",
        stepId: "subscriber-info",
        description: "Send a webhook notification confirming the subscription.",
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
        description: "Unsubscribe this webhook from the status page.",
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
        stepId: "notifications",
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
        stepId: "notifications",
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
        stepId: "notifications",
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
        stepId: "notifications",
        description: "Please select the event types you want to subscribe to.",
        fieldType: FormFieldSchemaType.MultiSelectDropdown,
        required: false,
        dropdownOptions: SubscriberUtil.getDropdownPropsBasedOnEventTypes(),
        showIf: (model: FormValues<StatusPageSubscriber>) => {
          return !model || !model.isSubscribedToAllEventTypes;
        },
      });
    }

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
          {!isWebhookSubscribersEnabled && (
            <Alert
              type={AlertType.DANGER}
              title="Webhook subscribers are not enabled for this status page. Please enable it in Subscriber Settings"
            />
          )}
          <SubscriberNotificationWarnings statusPageId={modelId} />
          <TeamAddedSubscribersUnsubscribedNotice
            statusPageId={modelId}
            projectId={ProjectUtil.getCurrentProjectId()!}
            channelQuery={{ subscriberWebhook: new NotNull() }}
            contactSelect={{ subscriberWebhook: true }}
          />
          <ModelTable<StatusPageSubscriber>
            modelType={StatusPageSubscriber}
            id="table-webhook-subscriber"
            name="Status Page > Webhook Subscribers"
            userPreferencesKey="status-page-webhook-subscribers-table"
            saveFilterProps={{
              tableId: "status-page-webhook-subscribers-table",
            }}
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
              subscriberWebhook: new NotNull(),
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
              title: "Webhook Subscribers",
              description:
                "Here are the list of webhook URLs that have subscribed to the status page.",
              buttons: [
                {
                  title: "Add in Bulk",
                  buttonStyle: ButtonStyleType.OUTLINE,
                  icon: IconProp.UserGroup,
                  onClick: () => {
                    setShowBulkAddModal(true);
                  },
                },
              ],
            }}
            noItemsMessage={"No webhook subscribers found."}
            /*
             * Who gets the updates, then - when this page lets subscribers
             * choose - what they hear about, as the bulk add form asks it.
             */
            formSteps={
              allowSubscribersToChooseResources ||
              allowSubscribersToChooseEventTypes
                ? [
                    { title: "Subscriber Info", id: "subscriber-info" },
                    { title: "Notifications", id: "notifications" },
                    { title: "Internal Info", id: "internal-info" },
                  ]
                : [
                    { title: "Subscriber Info", id: "subscriber-info" },
                    { title: "Internal Info", id: "internal-info" },
                  ]
            }
            formFields={formFields}
            showRefreshButton={true}
            viewPageRoute={Navigation.getCurrentRoute()}
            filters={[
              {
                field: {
                  subscriberWebhook: true,
                },
                title: "Webhook URL",
                type: FieldType.URL,
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
                  createdAt: true,
                },
                title: "Subscribed At",
                type: FieldType.DateTime,
              },
              {
                field: {
                  unsubscribedAt: true,
                },
                title: SubscriberUnsubscribeCopy.unsubscribedAtTitle,
                type: FieldType.DateTime,
              },
            ]}
            columns={[
              {
                field: {
                  subscriberWebhook: true,
                },
                title: "Webhook URL",
                type: FieldType.URL,
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
              {
                field: {
                  unsubscribedAt: true,
                },
                title: SubscriberUnsubscribeCopy.unsubscribedAtTitle,
                type: FieldType.DateTime,
                hideOnMobile: true,
              },
            ]}
          />

          {showBulkAddModal && (
            <Modal
              title="Add Webhook Subscribers in Bulk"
              description="Upload a CSV file with webhook URLs. Download the template to get started."
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
                  columns={webhookCsvColumns}
                  onDataChanged={(data: Array<CSVRow>) => {
                    setCsvRows(data);
                  }}
                  templateFileName="webhook-subscribers-template.csv"
                />
                <div className="pt-2">
                  <Toggle
                    title="Send Subscription Notification"
                    description="Send a webhook notification to confirm the subscription."
                    value={sendNotification}
                    onChange={(value: boolean) => {
                      setSendNotification(value);
                    }}
                  />
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

export default StatusPageWebhookSubscribers;
