import PageComponentProps from "../../PageComponentProps";
import useStatusPageBulkAdd, {
  StatusPageBulkAdd,
} from "../../../Components/StatusPage/useStatusPageBulkAdd";
import {
  BULK_ADD_NO_VALID_PHONE,
  getBulkAddNothingToAddError,
  getBulkPhoneEntries,
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
import Phone from "Common/Types/Phone";
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
import ProjectUtil from "Common/UI/Utils/Project";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import SubscriberUtil from "Common/UI/Utils/StatusPage";
import SubscriberNotificationWarnings from "../../../Components/StatusPage/SubscriberNotificationWarnings";
import SubscriberChannelOffPanel from "../../../Components/StatusPage/SubscriberChannelOffPanel";
import StatusPageSubscriberNotificationMethod from "Common/Types/StatusPage/StatusPageSubscriberNotificationMethod";
import SubscriberUnsubscribeCopy from "../../../Components/StatusPage/SubscriberUnsubscribeCopy";
import TeamAddedSubscribersUnsubscribedNotice from "../../../Components/StatusPage/TeamAddedSubscribersUnsubscribedNotice";
import { SubscriberFormCopy } from "../../../Components/StatusPage/SubscriberFormChoices";
import SubscriberStatusPill from "../../../Components/StatusPage/SubscriberStatusPill";
import {
  getSubscriberInternalNoteField,
  getSubscriberLanguageField,
  getSubscriberStatusFields,
  getSubscriberWelcomeField,
} from "../../../Components/StatusPage/SubscriberFormFields";
import {
  getSubscriberLanguageColumn,
  getSubscriberPageDefaultLanguageText,
} from "../../../Components/StatusPage/SubscriberLanguageColumn";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
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

  const [isSMSSubscribersEnabled, setIsSMSSubscribersEnabled] =
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
          enableSmsSubscribers: true,
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

      if (statusPage && statusPage.enableSmsSubscribers) {
        setIsSMSSubscribersEnabled(statusPage.enableSmsSubscribers);
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
    phones: string;
    sendYouHaveSubscribedMessage: boolean;
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

    const entries: Array<StatusPageBulkAddEntry> = getBulkPhoneEntries(
      data.phones,
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

    await bulkAdd.run(
      entries,
      async (entry: StatusPageBulkAddEntry): Promise<void> => {
        const subscriber: StatusPageSubscriber = new StatusPageSubscriber();
        subscriber.subscriberPhone = new Phone(entry.value);
        subscriber.statusPageId = modelId;
        subscriber.projectId = projectId;
        subscriber.sendYouHaveSubscribedMessage =
          data.sendYouHaveSubscribedMessage;

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
     * The number, its Status on Edit, and under More fields the welcome
     * text, the language and the internal note (SubscriberFormFields.tsx).
     */
    const moreFields: FormFieldCollapsibleSection<StatusPageSubscriber> =
      getAdvancedFormSection<StatusPageSubscriber>();

    const formFields: Array<ModelField<StatusPageSubscriber>> = [
      {
        field: {
          subscriberPhone: true,
        },
        title: "Phone Number",
        description: "Status page updates will be sent to this phone number.",
        fieldType: FormFieldSchemaType.Phone,
        stepId: "subscriber-info",
        required: true,
        placeholder: "+11234567890",
      },
      ...getSubscriberStatusFields({ isEmail: false, isPhone: true }),
    ];

    if (allowSubscribersToChooseResources) {
      formFields.push({
        field: {
          isSubscribedToAllResources: true,
        },
        title: "Subscribe to All Resources",
        description: "Send notifications for all resources.",
        stepId: "notifications",
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

    formFields.push(getSubscriberWelcomeField(moreFields));
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
            method={StatusPageSubscriberNotificationMethod.SMS}
            isEnabled={isSMSSubscribersEnabled}
          />
          <SubscriberNotificationWarnings statusPageId={modelId} />
          <TeamAddedSubscribersUnsubscribedNotice
            statusPageId={modelId}
            projectId={ProjectUtil.getCurrentProjectId()!}
            channelQuery={{ subscriberPhone: new NotNull() }}
            contactSelect={{ subscriberPhone: true }}
          />
          <ModelTable<StatusPageSubscriber>
            modelType={StatusPageSubscriber}
            userPreferencesKey="status-page-sms-subscribers-table"
            id="table-subscriber"
            name="Status Page > SMS Subscribers"
            saveFilterProps={{
              tableId: "status-page-sms-subscribers-table",
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
              subscriberPhone: new NotNull(),
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
            cardProps={{
              title: "SMS Subscribers",
              description:
                "Phone numbers that get this status page's updates by text message. Visitors subscribe on the status page, or you can add them here.",
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
            formFields={formFields}
            showRefreshButton={true}
            viewPageRoute={Navigation.getCurrentRoute()}
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
            filters={[
              {
                field: {
                  subscriberPhone: true,
                },
                title: "Phone Number",
                type: FieldType.Phone,
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
                  subscriberPhone: true,
                },
                title: "SMS",
                type: FieldType.Phone,
              },
              {
                field: {
                  isUnsubscribed: true,
                },
                title: "Status",
                type: FieldType.Text,
                getElement: (item: StatusPageSubscriber): ReactElement => {
                  /*
                   * Someone who signed up by SMS on the status page awaits
                   * the link texted to them, while it works.
                   */
                  return (
                    <SubscriberStatusPill
                      subscriber={item}
                      awaitingConfirmationDescription={
                        SubscriberFormCopy.awaitingTextConfirmationDescription
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
                type: FieldType.Date,
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
              title="Add SMS Subscribers in Bulk"
              description="Paste phone numbers below. These subscribers will be added to this status page."
              submitButtonText="Add Subscribers"
              onClose={() => {
                setShowBulkAddModal(false);
              }}
              onSubmit={handleBulkAddSubmit}
              formProps={{
                name: "Bulk Add SMS Subscribers",
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
                    field: { phones: true },
                    stepId: "subscriber-info",
                    title: "Phone Numbers",
                    description:
                      "One phone number per line (or separated by commas or semicolons). Invalid or duplicate entries will be skipped.",
                    fieldType: FormFieldSchemaType.LongText,
                    required: true,
                    placeholder: "+11234567890\n+11234567891\n+11234567892",
                    /*
                     * Numbers read left to right in every language, the
                     * example's with them: on a Persian or Arabic page
                     * each "+" went after its digits (#7180).
                     */
                    readsLeftToRight: true,
                    // Nothing in it a number: said under it, and Next waits.
                    customValidation: (
                      values: FormValues<BulkAddFormData>,
                    ): string | null => {
                      return getBulkAddNothingToAddError(
                        getBulkPhoneEntries(String(values.phones || "")),
                        BULK_ADD_NO_VALID_PHONE,
                      );
                    },
                  },
                  {
                    field: { sendYouHaveSubscribedMessage: true },
                    stepId: "subscriber-info",
                    title: SubscriberFormCopy.welcomeTitle,
                    description: SubscriberFormCopy.welcomeDescription,
                    fieldType: FormFieldSchemaType.Toggle,
                    required: false,
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
