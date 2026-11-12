import PageComponentProps from "../../PageComponentProps";
import Route from "Common/Types/API/Route";
import useStatusPageBulkAdd, {
  StatusPageBulkAdd,
} from "../../../Components/StatusPage/useStatusPageBulkAdd";
import {
  BULK_ADD_NO_VALID_EMAIL,
  getBulkAddNothingToAddError,
  getBulkEmailEntries,
  hasBulkAddEntryToAdd,
  StatusPageBulkAddEntry,
} from "../../../Components/StatusPage/StatusPageBulkAddEntries";
import useSubscriberBulkActions, {
  useSubscriberRowActions,
  getSubscriberName,
} from "../../../Components/StatusPage/useSubscriberBulkActions";
import NotNull from "Common/Types/BaseDatabase/NotNull";
import BadDataException from "Common/Types/Exception/BadDataException";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ObjectID from "Common/Types/ObjectID";
import Email from "Common/Types/Email";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { CategoryCheckboxOptionsAndCategories } from "Common/UI/Components/CategoryCheckbox/Index";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import IconProp from "Common/Types/Icon/IconProp";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import SubscriberUtil from "Common/UI/Utils/StatusPage";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import StatusPageSubscriber from "Common/Models/DatabaseModels/StatusPageSubscriber";
import StatusPageEventType from "Common/Types/StatusPage/StatusPageEventType";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ProjectUtil from "Common/UI/Utils/Project";
import SubscriberNotificationWarnings from "../../../Components/StatusPage/SubscriberNotificationWarnings";
import SubscriberChannelOffPanel from "../../../Components/StatusPage/SubscriberChannelOffPanel";
import StatusPageSubscriberNotificationMethod from "Common/Types/StatusPage/StatusPageSubscriberNotificationMethod";
import SubscriberUnsubscribeCopy from "../../../Components/StatusPage/SubscriberUnsubscribeCopy";
import TeamAddedSubscribersUnsubscribedNotice from "../../../Components/StatusPage/TeamAddedSubscribersUnsubscribedNotice";
import SubscriberStatusPill from "../../../Components/StatusPage/SubscriberStatusPill";
import {
  SUBSCRIBER_ADD_CHOICE,
  SubscriberAddChoice,
  SubscriberFormCopy,
  getSubscriberAddChoiceColumns,
} from "../../../Components/StatusPage/SubscriberFormChoices";
import { getColumnChoiceRadioButtons } from "../../../Utils/Form/ColumnChoice";
import {
  getEmailSubscriberAddChoiceFields,
  getSubscriberInternalNoteField,
  getSubscriberLanguageField,
  getSubscriberStatusFields,
} from "../../../Components/StatusPage/SubscriberFormFields";
import {
  getSubscriberLanguageColumn,
  getSubscriberPageDefaultLanguageText,
} from "../../../Components/StatusPage/SubscriberLanguageColumn";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

const StatusPageDelete: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  // Unsubscribe in Bulk Actions (Components/StatusPage/useSubscriberBulkActions).
  const subscriberBulkActions: ReturnType<typeof useSubscriberBulkActions> =
    useSubscriberBulkActions();
  // Unsubscribe in each row's ⋯ menu too.
  const subscriberRowActions: ReturnType<typeof useSubscriberRowActions> =
    useSubscriberRowActions();
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
  /*
   * Loading from the first render: the list, and the channel's switch
   * above it, are drawn once the status page has said whether the channel
   * is on - not first as off, for a frame, on a page where it is on.
   */
  const [isLoading, setIsLoading] = React.useState<boolean>(true);
  /*
   * The status page's default language: what a subscriber without one of
   * their own is written to in, and what the Language field and column
   * name for them (SubscriberLanguageColumn).
   */
  const [pageLanguage, setPageLanguage] = React.useState<string | undefined>(
    undefined,
  );
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
          defaultLanguage: true,
        },
      });

      setPageLanguage(statusPage?.defaultLanguage || undefined);

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
  const [refreshToggle, setRefreshToggle] = useState<string>(
    Date.now().toString(),
  );
  /*
   * Add in Bulk: the shared bulk runner and its progress dialog - several
   * at once, the time left and Stop, and what happened to every entry
   * (useStatusPageBulkAdd). The list is read again once it ends.
   */
  const bulkAdd: StatusPageBulkAdd = useStatusPageBulkAdd({
    singularLabel: "Subscriber",
    pluralLabel: "Subscribers",
    onFinished: (): void => {
      setRefreshToggle(Date.now().toString());
    },
  });

  interface BulkAddFormData {
    emails: string;
    // "When you add them": written into the two columns for each address.
    subscriberAddChoice: SubscriberAddChoice;
    isSubscribedToAllResources?: boolean;
    statusPageResources?: Array<string>;
    isSubscribedToAllEventTypes?: boolean;
    statusPageEventTypes?: Array<StatusPageEventType>;
  }

  const handleBulkAddSubmit: (data: BulkAddFormData) => Promise<void> = async (
    data: BulkAddFormData,
  ): Promise<void> => {
    if (!props.currentProject || !props.currentProject._id) {
      throw new BadDataException("Project ID cannot be null");
    }

    const entries: Array<StatusPageBulkAddEntry> = getBulkEmailEntries(
      data.emails,
    );

    /*
     * The field says so when nothing in it can be added, and the form waits
     * (getBulkAddNothingToAddError): there is always an entry to add here.
     */
    if (!hasBulkAddEntryToAdd(entries)) {
      return;
    }

    // The form goes; the progress dialog takes over.
    setShowBulkAddModal(false);

    const projectId: ObjectID = new ObjectID(props.currentProject._id);
    const addChoiceColumns: {
      isSubscriptionConfirmed: boolean;
      sendYouHaveSubscribedMessage: boolean;
    } = getSubscriberAddChoiceColumns(data.subscriberAddChoice);

    await bulkAdd.run(
      entries,
      async (entry: StatusPageBulkAddEntry): Promise<void> => {
        const subscriber: StatusPageSubscriber = new StatusPageSubscriber();
        subscriber.subscriberEmail = new Email(entry.value);
        subscriber.statusPageId = modelId;
        subscriber.projectId = projectId;
        subscriber.isSubscriptionConfirmed =
          addChoiceColumns.isSubscriptionConfirmed;
        subscriber.sendYouHaveSubscribedMessage =
          addChoiceColumns.sendYouHaveSubscribedMessage;

        if (allowSubscribersToChooseResources) {
          subscriber.isSubscribedToAllResources =
            data.isSubscribedToAllResources !== false;

          if (
            !subscriber.isSubscribedToAllResources &&
            data.statusPageResources
          ) {
            subscriber.statusPageResources = data.statusPageResources.map(
              (resourceId: string): StatusPageResource => {
                const resource: StatusPageResource = new StatusPageResource();
                resource._id = resourceId;
                return resource;
              },
            );
          }
        }

        if (allowSubscribersToChooseEventTypes) {
          subscriber.isSubscribedToAllEventTypes =
            data.isSubscribedToAllEventTypes !== false;

          if (
            !subscriber.isSubscribedToAllEventTypes &&
            data.statusPageEventTypes
          ) {
            subscriber.statusPageEventTypes = data.statusPageEventTypes;
          }
        }

        await ModelAPI.create<StatusPageSubscriber>({
          model: subscriber,
          modelType: StatusPageSubscriber,
        });
      },
    );
  };

  useEffect(() => {
    if (isLoading) {
      return; // don't do anything if loading
    }

    /*
     * The address, then one question each way: on Add, "When you add them"
     * (subscribe them now, and tell them or not, or ask them to confirm
     * first); on Edit, their Status (SubscriberFormChoices.ts). The language
     * and the internal note are folded under More fields.
     */
    const moreFields: FormFieldCollapsibleSection<StatusPageSubscriber> =
      getAdvancedFormSection<StatusPageSubscriber>();

    const formFields: Array<ModelField<StatusPageSubscriber>> = [
      {
        field: {
          subscriberEmail: true,
        },
        stepId: "subscriber-info",
        title: "Email",
        /*
         * Every notification can be unsubscribed from without signing in, so
         * one reader of a shared address can take it off this page for
         * everyone who reads it.
         */
        description: SubscriberUnsubscribeCopy.sharedAddressAdvice,
        fieldType: FormFieldSchemaType.Email,
        required: true,
        placeholder: "subscriber@company.com",
        disableSpellCheck: true,
      },
      ...getEmailSubscriberAddChoiceFields(),
      ...getSubscriberStatusFields({ isEmail: true }),
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
        description:
          "Select this option if you want to subscribe to all event types.",
        stepId: "notifications",
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
        stepId: "notifications",
        fieldType: FormFieldSchemaType.MultiSelectDropdown,
        required: false,
        dropdownOptions: SubscriberUtil.getDropdownPropsBasedOnEventTypes(),
        showIf: (model: FormValues<StatusPageSubscriber>) => {
          return !model || !model.isSubscribedToAllEventTypes;
        },
      });
    }

    formFields.push(
      getSubscriberLanguageField({
        moreFields: moreFields,
        placeholder: getSubscriberPageDefaultLanguageText(
          translator,
          pageLanguage,
        ),
      }),
    );
    formFields.push(getSubscriberInternalNoteField(moreFields));

    setFormFields(formFields);
  }, [isLoading]);

  return (
    <Fragment>
      {isLoading ? <PageLoader isVisible={true} /> : <></>}

      {error ? <ErrorMessage message={error} /> : <></>}

      {!error && !isLoading ? (
        <>
          {/*
           * The channel's own switch while it is off, where a red
           * "not enabled" banner used to send people to another page.
           */}
          <SubscriberChannelOffPanel
            statusPageId={modelId}
            method={StatusPageSubscriberNotificationMethod.Email}
            isEnabled={isEmailSubscribersEnabled}
          />
          <SubscriberNotificationWarnings statusPageId={modelId} />
          <TeamAddedSubscribersUnsubscribedNotice
            statusPageId={modelId}
            projectId={ProjectUtil.getCurrentProjectId()!}
            channelQuery={{ subscriberEmail: new NotNull() }}
            contactSelect={{ subscriberEmail: true }}
          />
          <ModelTable<StatusPageSubscriber>
            modelType={StatusPageSubscriber}
            id="table-subscriber"
            name="Status Page > Email Subscribers"
            userPreferencesKey="status-page-subscriber-table"
            saveFilterProps={{
              tableId: "status-page-email-subscribers-table",
            }}
            isDeleteable={true}
            // Each row by what the list shows first (useSubscriberBulkActions).
            getItemName={getSubscriberName}
            bulkActions={{
              buttons: [...subscriberBulkActions],
            }}
            actionButtons={[...subscriberRowActions]}
            showViewIdButton={true}
            isCreateable={true}
            isEditable={true}
            isViewable={false}
            selectMoreFields={{
              subscriberPhone: true,
              isSubscriptionConfirmed: true,
              // Whether each is unsubscribed, for Unsubscribe to count.
              isUnsubscribed: true,
              /*
               * The Status reads when the link to confirm was sent, so it
               * is read whether or not the viewer shows Subscribed At.
               */
              createdAt: true,
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
            singularName="Subscriber"
            pluralName="Subscribers"
            createVerb="Add"
            /* The docs page for this list (#6822): who can subscribe, by which channel, and what they are sent. */
            documentationLink={Route.fromString(
              "/docs/status-pages/subscribers",
            )}
            cardProps={{
              title: "Email Subscribers",
              description:
                "People who get this status page's updates by email. Visitors subscribe on the status page, or you can add them here.",
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
            /*
             * Who gets the updates, then - when this page lets subscribers
             * choose - what they hear about, as the bulk add form asks it.
             * Without that choice the form is one page.
             */
            formSteps={
              allowSubscribersToChooseResources ||
              allowSubscribersToChooseEventTypes
                ? [
                    /*
                     * SUBSCRIBER_INFO_STEP_ID, written out: the form
                     * scanners of the guard tests read literal ids.
                     */
                    { title: "Subscriber Info", id: "subscriber-info" },
                    { title: "Notifications", id: "notifications" },
                  ]
                : undefined
            }
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
              {
                field: {
                  unsubscribedAt: true,
                },
                title: SubscriberUnsubscribeCopy.unsubscribedAtTitle,
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
                  // Awaiting the link we emailed them, while it works.
                  return (
                    <SubscriberStatusPill
                      subscriber={item}
                      awaitingConfirmationDescription={
                        SubscriberFormCopy.awaitingConfirmationDescription
                      }
                    />
                  );
                },
              },
              getSubscriberLanguageColumn({
                translator: translator,
                pageLanguage: pageLanguage,
              }),
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
                /*
                 * Who to add, then what they hear about - only where the
                 * page lets subscribers choose; otherwise it is one page.
                 */
                steps:
                  allowSubscribersToChooseResources ||
                  allowSubscribersToChooseEventTypes
                    ? [
                        { title: "Subscriber Info", id: "subscriber-info" },
                        { title: "Notifications", id: "notifications" },
                      ]
                    : undefined,
                fields: [
                  {
                    field: { emails: true },
                    stepId: "subscriber-info",
                    title: "Emails",
                    /*
                     * How to paste them, then the shared-address advice:
                     * every notification can be unsubscribed from without
                     * signing in, so one reader of a mailing list added here
                     * can take everyone on it off this page. Two sentences,
                     * each looked up whole.
                     */
                    description: (
                      <>
                        {translator.translateText(
                          "One email per line. Invalid and duplicate ones are skipped.",
                        )}{" "}
                        {translator.translateText(
                          SubscriberUnsubscribeCopy.sharedAddressAdvice,
                        )}
                      </>
                    ),
                    fieldType: FormFieldSchemaType.LongText,
                    required: true,
                    placeholder:
                      "user1@example.com\nuser2@example.com\nuser3@example.com",
                    // Nothing in it an address: said under it, and Add waits.
                    customValidation: (
                      values: FormValues<BulkAddFormData>,
                    ): string | null => {
                      return getBulkAddNothingToAddError(
                        getBulkEmailEntries(String(values.emails || "")),
                        BULK_ADD_NO_VALID_EMAIL,
                      );
                    },
                  },
                  {
                    /*
                     * The Add form's question, asked once for every
                     * address: the answer is written into the two columns
                     * of each subscriber (handleBulkAddSubmit).
                     */
                    field: { subscriberAddChoice: true },
                    stepId: "subscriber-info",
                    title: SUBSCRIBER_ADD_CHOICE.title,
                    fieldType: FormFieldSchemaType.RadioButton,
                    radioButtonOptions: getColumnChoiceRadioButtons(
                      SUBSCRIBER_ADD_CHOICE,
                    ),
                    required: true,
                    defaultValue: SubscriberAddChoice.SubscribeNow,
                    dataTestId: "subscriber-add-choice-bulk",
                  },
                  ...(allowSubscribersToChooseResources
                    ? [
                        {
                          field: { isSubscribedToAllResources: true },
                          title: "Subscribe to All Resources",
                          stepId: "notifications",
                          description:
                            "Send notifications for all resources to these subscribers.",
                          fieldType: FormFieldSchemaType.Checkbox,
                          required: false,
                          defaultValue: true,
                        },
                        {
                          field: { statusPageResources: true },
                          title: "Select Resources to Subscribe",
                          stepId: "notifications",
                          description:
                            "Please select the resources these subscribers should receive notifications for.",
                          fieldType: FormFieldSchemaType.CategoryCheckbox,
                          required: false,
                          categoryCheckboxProps:
                            categoryCheckboxOptionsAndCategories,
                          showIf: (model: FormValues<BulkAddFormData>) => {
                            return !model || !model.isSubscribedToAllResources;
                          },
                        },
                      ]
                    : []),
                  ...(allowSubscribersToChooseEventTypes
                    ? [
                        {
                          field: { isSubscribedToAllEventTypes: true },
                          title: "Subscribe to All Event Types",
                          stepId: "notifications",
                          description:
                            "Send notifications for all event types to these subscribers.",
                          fieldType: FormFieldSchemaType.Checkbox,
                          required: false,
                          defaultValue: true,
                        },
                        {
                          field: { statusPageEventTypes: true },
                          title: "Select Event Types to Subscribe",
                          stepId: "notifications",
                          description:
                            "Please select the event types these subscribers should receive notifications for.",
                          fieldType: FormFieldSchemaType.MultiSelectDropdown,
                          required: false,
                          dropdownOptions:
                            SubscriberUtil.getDropdownPropsBasedOnEventTypes(),
                          showIf: (model: FormValues<BulkAddFormData>) => {
                            return !model || !model.isSubscribedToAllEventTypes;
                          },
                        },
                      ]
                    : []),
                ],
              }}
            />
          )}

          {bulkAdd.dialog}
        </>
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default StatusPageDelete;
