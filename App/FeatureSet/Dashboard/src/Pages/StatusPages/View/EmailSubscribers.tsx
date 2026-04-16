import PageComponentProps from "../../PageComponentProps";
import NotNull from "Common/Types/BaseDatabase/NotNull";
import { Green, Red, Yellow } from "Common/Types/BrandColors";
import BadDataException from "Common/Types/Exception/BadDataException";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ObjectID from "Common/Types/ObjectID";
import Email from "Common/Types/Email";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import { CardButtonSchema } from "Common/UI/Components/Card/Card";
import { CategoryCheckboxOptionsAndCategories } from "Common/UI/Components/CategoryCheckbox/Index";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import IconProp from "Common/Types/Icon/IconProp";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
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
import SubscriberNotificationWarnings from "../../../Components/StatusPage/SubscriberNotificationWarnings";

const StatusPageDelete: FunctionComponent<PageComponentProps> = (
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

  const [isEmailSubscribersEnabled, setIsEmailSubscribersEnabled] =
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
          enableEmailSubscribers: true,
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

      if (statusPage && statusPage.enableEmailSubscribers) {
        setIsEmailSubscribersEnabled(statusPage.enableEmailSubscribers);
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
    failed: Array<{ email: string; error: string }>;
    skippedInvalid: Array<string>;
  }>({
    completed: 0,
    total: 0,
    succeeded: 0,
    failed: [],
    skippedInvalid: [],
  });
  const [refreshToggle, setRefreshToggle] = useState<string>(
    Date.now().toString(),
  );

  const parseBulkEmails: (input: string) => {
    valid: Array<string>;
    invalid: Array<string>;
  } = (input: string) => {
    const tokens: Array<string> = (input || "")
      .split(/[\s,;]+/)
      .map((t: string) => {
        return t.trim();
      })
      .filter((t: string) => {
        return t.length > 0;
      });

    const seen: Set<string> = new Set<string>();
    const valid: Array<string> = [];
    const invalid: Array<string> = [];

    for (const token of tokens) {
      const normalized: string = token.toLowerCase();
      if (seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);

      if (Email.isValid(normalized)) {
        valid.push(normalized);
      } else {
        invalid.push(token);
      }
    }

    return { valid, invalid };
  };

  interface BulkAddFormData {
    emails: string;
    isSubscriptionConfirmed: boolean;
    sendYouHaveSubscribedMessage: boolean;
  }

  const handleBulkAddSubmit: (data: BulkAddFormData) => Promise<void> = async (
    data: BulkAddFormData,
  ): Promise<void> => {
    if (!props.currentProject || !props.currentProject._id) {
      throw new BadDataException("Project ID cannot be null");
    }

    const { valid, invalid } = parseBulkEmails(data.emails);

    if (valid.length === 0) {
      throw new BadDataException(
        "No valid email addresses found. Please enter one email per line.",
      );
    }

    // Close the form modal and show the progress modal
    setShowBulkAddModal(false);
    setShowProgressModal(true);
    setBulkActionInProgress(true);
    setBulkProgress({
      completed: 0,
      total: valid.length,
      succeeded: 0,
      failed: [],
      skippedInvalid: invalid,
    });

    const projectId: ObjectID = new ObjectID(props.currentProject._id);
    let succeeded: number = 0;
    const failed: Array<{ email: string; error: string }> = [];

    for (let i: number = 0; i < valid.length; i++) {
      const emailStr: string = valid[i]!;

      try {
        const subscriber: StatusPageSubscriber = new StatusPageSubscriber();
        subscriber.subscriberEmail = new Email(emailStr);
        subscriber.statusPageId = modelId;
        subscriber.projectId = projectId;
        subscriber.isSubscriptionConfirmed = data.isSubscriptionConfirmed;
        subscriber.sendYouHaveSubscribedMessage =
          data.sendYouHaveSubscribedMessage;

        await ModelAPI.create<StatusPageSubscriber>({
          model: subscriber,
          modelType: StatusPageSubscriber,
        });
        succeeded++;
      } catch (err) {
        failed.push({
          email: emailStr,
          error: API.getFriendlyMessage(err),
        });
      }

      setBulkProgress({
        completed: i + 1,
        total: valid.length,
        succeeded,
        failed: [...failed],
        skippedInvalid: invalid,
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
          subscriberEmail: true,
        },
        stepId: "subscriber-info",
        title: "Email",
        description: "Status page updates will be sent to this email.",
        fieldType: FormFieldSchemaType.Email,
        required: true,
        placeholder: "subscriber@company.com",
        disableSpellCheck: true,
      },
      {
        field: {
          isSubscriptionConfirmed: true,
        },
        title: "Do not send confirmation link",
        stepId: "subscriber-info",
        description:
          "If this option is checked, then no confirmation link will be sent to the subscriber.",
        fieldType: FormFieldSchemaType.Toggle,
        required: false,
        defaultValue: true,
      },
      {
        field: {
          sendYouHaveSubscribedMessage: true,
        },
        title: "Send Subscription Email",
        stepId: "subscriber-info",
        description:
          "Send Email with the confrimation link to the subscriber. The subscriber needs to click on the link to confirm the subscription.",
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
        description: "Unsubscribe this email from the status page.",
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
        description:
          "Select this option if you want to subscribe to all event types.",
        stepId: "subscriber-info",
        fieldType: FormFieldSchemaType.Checkbox,
        required: false,
        defaultValue: true,
      });

      formFields.push({
        field: {
          statusPageEventTypes: true,
        },
        title: "Select Event Types to Subscribe",
        description: "Please select the event types you want to subscribe to.",
        stepId: "subscriber-info",
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
          {!isEmailSubscribersEnabled && (
            <Alert
              type={AlertType.DANGER}
              title="Email subscribers are not enabled for this status page. Please enable it in Subscriber Settings"
            />
          )}
          <SubscriberNotificationWarnings statusPageId={modelId} />
          <ModelTable<StatusPageSubscriber>
            modelType={StatusPageSubscriber}
            id="table-subscriber"
            name="Status Page > Email Subscribers"
            userPreferencesKey="status-page-subscriber-table"
            isDeleteable={true}
            showViewIdButton={true}
            isCreateable={true}
            isEditable={true}
            isViewable={false}
            selectMoreFields={{
              subscriberPhone: true,
              isSubscriptionConfirmed: true,
            }}
            query={{
              statusPageId: modelId,
              projectId: ProjectUtil.getCurrentProjectId()!,
              subscriberEmail: new NotNull(),
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
              title: "Email Subscribers",
              description:
                "Here are the list of subscribers who have subscribed to the status page.",
              buttons: [
                {
                  title: "Add in Bulk",
                  icon: IconProp.Add,
                  buttonStyle: ButtonStyleType.NORMAL,
                  onClick: () => {
                    setShowBulkAddModal(true);
                  },
                } as CardButtonSchema,
              ],
            }}
            noItemsMessage={"No subscribers found."}
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
            filters={[
              {
                field: {
                  subscriberEmail: true,
                },
                title: "Email",
                type: FieldType.Text,
              },
              {
                field: {
                  isUnsubscribed: true,
                },
                title: "Unsubscribed?",
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
                type: FieldType.Date,
              },
            ]}
            viewPageRoute={Navigation.getCurrentRoute()}
            columns={[
              {
                field: {
                  subscriberEmail: true,
                },
                title: "Email",
                type: FieldType.Email,
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
                        color={Yellow}
                        text={"Awaiting Confirmation"}
                        tooltip="Confirmation email sent to this user. Please click on the link to confirm subscription"
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
            <BasicFormModal<BulkAddFormData>
              title="Add Email Subscribers in Bulk"
              description="Paste email addresses below. These subscribers will be added to this status page."
              submitButtonText="Add Subscribers"
              onClose={() => {
                setShowBulkAddModal(false);
              }}
              onSubmit={handleBulkAddSubmit}
              formProps={{
                name: "Bulk Add Subscribers",
                fields: [
                  {
                    field: { emails: true },
                    title: "Emails",
                    description:
                      "One email per line (or separated by commas, semicolons, or spaces). Invalid or duplicate entries will be skipped.",
                    fieldType: FormFieldSchemaType.LongText,
                    required: true,
                    placeholder:
                      "user1@example.com\nuser2@example.com\nuser3@example.com",
                  },
                  {
                    field: { isSubscriptionConfirmed: true },
                    title: "Do not send confirmation link",
                    description:
                      "If this option is checked, then no confirmation link will be sent to the subscribers.",
                    fieldType: FormFieldSchemaType.Toggle,
                    required: false,
                    defaultValue: true,
                  },
                  {
                    field: { sendYouHaveSubscribedMessage: true },
                    title: "Send Subscription Email",
                    description:
                      "Send Email with the confirmation link to the subscribers. The subscribers need to click on the link to confirm the subscription.",
                    fieldType: FormFieldSchemaType.Toggle,
                    required: false,
                  },
                ],
              }}
            />
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
                    <ProgressBar
                      count={bulkProgress.completed}
                      totalCount={bulkProgress.total}
                      suffix="subscribers"
                      size={ProgressBarSize.Small}
                    />
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
                        {bulkProgress.skippedInvalid.length > 0 && (
                          <div className="flex items-center rounded-lg bg-yellow-50 p-3">
                            <Icon
                              className="h-5 w-5 flex-shrink-0"
                              icon={IconProp.Alert}
                              color={Yellow}
                            />
                            <div className="ml-2 text-sm font-medium text-yellow-800">
                              {bulkProgress.skippedInvalid.length} invalid{" "}
                              {bulkProgress.skippedInvalid.length === 1
                                ? "email"
                                : "emails"}{" "}
                              skipped
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
                                  email: string;
                                  error: string;
                                },
                                i: number,
                              ) => {
                                return (
                                  <div className="px-4 py-3 text-sm" key={i}>
                                    <div className="font-medium text-gray-900">
                                      {failedItem.email}
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

export default StatusPageDelete;
