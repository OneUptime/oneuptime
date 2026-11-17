import useStatusPageBulkAdd, {
  StatusPageBulkAdd,
} from "./useStatusPageBulkAdd";
import {
  StatusPageBulkAddEntry,
  getBulkAddNothingToAddError,
  getBulkCsvEntries,
  hasBulkAddEntryToAdd,
} from "./StatusPageBulkAddEntries";
import useSubscriberBulkActions, {
  getSubscriberName,
  useSubscriberRowActions,
} from "./useSubscriberBulkActions";
import {
  SubscriberBulkAddInput,
  SubscriberCsvBulkAdd,
  SubscriberListChannel,
  SubscriberStatusKind,
  SubscriberTextBulkAdd,
  getSubscriberChannelQuery,
  getSubscriberContactSelect,
  getSubscriberListChannel,
} from "./SubscriberListChannels";
import SubscriberNotificationWarnings from "./SubscriberNotificationWarnings";
import SubscriberChannelOffPanel from "./SubscriberChannelOffPanel";
import SubscriberUnsubscribeCopy from "./SubscriberUnsubscribeCopy";
import TeamAddedSubscribersUnsubscribedNotice from "./TeamAddedSubscribersUnsubscribedNotice";
import SubscriberStatusPill from "./SubscriberStatusPill";
import {
  SUBSCRIBER_ADD_CHOICE,
  SubscriberAddChoice,
  SubscriberFormCopy,
  getSubscriberAddChoiceColumns,
} from "./SubscriberFormChoices";
import {
  getEmailSubscriberAddChoiceFields,
  getSubscriberInternalNoteField,
  getSubscriberLanguageField,
  getSubscriberStatusFields,
  getSubscriberWelcomeField,
} from "./SubscriberFormFields";
import {
  getSubscriberLanguageColumn,
  getSubscriberPageDefaultLanguageText,
} from "./SubscriberLanguageColumn";
import { getColumnChoiceRadioButtons } from "../../Utils/Form/ColumnChoice";
import Route from "Common/Types/API/Route";
import { Green, Red } from "Common/Types/BrandColors";
import BadDataException from "Common/Types/Exception/BadDataException";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import StatusPageSubscriberChannel from "Common/Types/StatusPage/StatusPageSubscriberChannel";
import StatusPageEventType from "Common/Types/StatusPage/StatusPageEventType";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { CategoryCheckboxOptionsAndCategories } from "Common/UI/Components/CategoryCheckbox/Index";
import CSVFileUpload, {
  CSVRow,
} from "Common/UI/Components/CSVFileUpload/CSVFileUpload";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import PageSkeleton from "Common/UI/Components/Page/PageSkeleton";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import Toggle from "Common/UI/Components/Toggle/Toggle";
import Columns from "Common/UI/Components/ModelTable/Columns";
import Filter from "Common/UI/Components/ModelFilter/Filter";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import SubscriberUtil from "Common/UI/Utils/StatusPage";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import Project from "Common/Models/DatabaseModels/Project";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import StatusPageSubscriber from "Common/Models/DatabaseModels/StatusPageSubscriber";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";

/*
 * One channel's subscribers, on its tab of a status page's Subscribers page
 * (Pages/StatusPages/View/Subscribers): every tab draws THIS, configured by
 * its channel's entry in SubscriberListChannels, so the five lists cannot
 * drift apart again. They were five pages of their own, near-copies of each
 * other, until #9125.
 *
 * Top to bottom: the channel's own switch while it is off, where a red "not
 * enabled" banner used to send people to another page; the warnings about
 * notifications that will not go out; the subscribers the team added who
 * unsubscribed themselves; and the list, with Add, Edit, Delete, Unsubscribe
 * (in Bulk Actions and each row's menu), Export CSV over a selection, and
 * Add in Bulk - pasted for email and SMS, a CSV file for the rest.
 */

export interface ComponentProps {
  channel: StatusPageSubscriberChannel;
  statusPageId: ObjectID;
  projectId: ObjectID;
  currentProject?: Project | null | undefined;
  /*
   * Called whenever the list is read again, so the page can recount the
   * channel's subscribers on its tab.
   */
  onSubscribersChanged?: (() => void) | undefined;
}

// What Add in Bulk's pasted form hands back.
interface TextBulkAddFormData {
  entries: string;
  // Email: "When you add them", written into the two columns for each one.
  subscriberAddChoice?: SubscriberAddChoice;
  // The other channels: whether each is told it is subscribed.
  sendYouHaveSubscribedMessage?: boolean;
  isSubscribedToAllResources?: boolean;
  statusPageResources?: Array<string>;
  isSubscribedToAllEventTypes?: boolean;
  statusPageEventTypes?: Array<StatusPageEventType>;
}

const StatusPageSubscriberList: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const channel: SubscriberListChannel = getSubscriberListChannel(
    props.channel,
  );
  const modelId: ObjectID = props.statusPageId;

  // Unsubscribe in Bulk Actions (useSubscriberBulkActions).
  const subscriberBulkActions: ReturnType<typeof useSubscriberBulkActions> =
    useSubscriberBulkActions();
  // Unsubscribe in each row's ⋯ menu too.
  const subscriberRowActions: ReturnType<typeof useSubscriberRowActions> =
    useSubscriberRowActions();

  const [
    allowSubscribersToChooseResources,
    setAllowSubscribersToChooseResources,
  ] = useState<boolean>(false);
  const [
    allowSubscribersToChooseEventTypes,
    setAllowSubscribersToChooseEventTypes,
  ] = useState<boolean>(false);
  const [isChannelEnabled, setIsChannelEnabled] = useState<boolean>(false);
  /*
   * Loading from the first render: the list, and the channel's switch above
   * it, are drawn once the status page has said whether the channel is on -
   * not first as off, for a frame, on a page where it is on.
   */
  const [isLoading, setIsLoading] = useState<boolean>(true);
  /*
   * The status page's default language: what a subscriber without one of
   * their own is written to in, and what the Language field and column name
   * for them (SubscriberLanguageColumn).
   */
  const [pageLanguage, setPageLanguage] = useState<string | undefined>(
    undefined,
  );
  const [error, setError] = useState<string>("");
  const [
    categoryCheckboxOptionsAndCategories,
    setCategoryCheckboxOptionsAndCategories,
  ] = useState<CategoryCheckboxOptionsAndCategories>({
    categories: [],
    options: [],
  });

  const fetchStatusPage: PromiseVoidFunction = async (): Promise<void> => {
    try {
      setIsLoading(true);

      const statusPage: StatusPage | null = await ModelAPI.getItem({
        modelType: StatusPage,
        id: modelId,
        select: {
          allowSubscribersToChooseResources: true,
          allowSubscribersToChooseEventTypes: true,
          [channel.enabledColumn]: true,
          defaultLanguage: true,
        },
      });

      setPageLanguage(statusPage?.defaultLanguage || undefined);

      if (statusPage && statusPage.allowSubscribersToChooseResources) {
        setAllowSubscribersToChooseResources(true);
        setCategoryCheckboxOptionsAndCategories(
          await SubscriberUtil.getCategoryCheckboxPropsBasedOnResources(
            modelId,
          ),
        );
      }

      if (statusPage && statusPage.allowSubscribersToChooseEventTypes) {
        setAllowSubscribersToChooseEventTypes(true);
      }

      setIsChannelEnabled(Boolean(statusPage?.[channel.enabledColumn]));
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

  const asksWhatTheyHearAbout: boolean =
    allowSubscribersToChooseResources || allowSubscribersToChooseEventTypes;

  const [showBulkAddModal, setShowBulkAddModal] = useState<boolean>(false);
  const [refreshToggle, setRefreshToggle] = useState<string>(
    Date.now().toString(),
  );
  const [csvRows, setCsvRows] = useState<Array<CSVRow>>([]);
  const [sendNotification, setSendNotification] = useState<boolean>(false);

  /*
   * Add in Bulk: the shared bulk runner and its progress dialog - several at
   * once, the time left and Stop, and what happened to every entry
   * (useStatusPageBulkAdd). The list is read again once it ends.
   */
  const bulkAdd: StatusPageBulkAdd = useStatusPageBulkAdd({
    singularLabel: "Subscriber",
    pluralLabel: "Subscribers",
    onFinished: (): void => {
      setRefreshToggle(Date.now().toString());
    },
  });

  const getProjectId: () => ObjectID = (): ObjectID => {
    if (!props.currentProject || !props.currentProject._id) {
      throw new BadDataException(
        "This page does not know which project it is in. Reload the page and try again.",
      );
    }

    return new ObjectID(props.currentProject._id);
  };

  // Adds each entry, through the shared runner, as the channel writes it.
  const addEntries: (data: {
    entries: Array<StatusPageBulkAddEntry>;
    writeChoices: (subscriber: StatusPageSubscriber) => void;
  }) => Promise<void> = async (data: {
    entries: Array<StatusPageBulkAddEntry>;
    writeChoices: (subscriber: StatusPageSubscriber) => void;
  }): Promise<void> => {
    const projectId: ObjectID = getProjectId();

    await bulkAdd.run(
      data.entries,
      async (entry: StatusPageBulkAddEntry): Promise<void> => {
        const subscriber: StatusPageSubscriber = new StatusPageSubscriber();
        channel.writeBulkEntry(subscriber, entry);
        subscriber.statusPageId = modelId;
        subscriber.projectId = projectId;
        data.writeChoices(subscriber);

        await ModelAPI.create<StatusPageSubscriber>({
          model: subscriber,
          modelType: StatusPageSubscriber,
        });
      },
    );
  };

  const handleTextBulkAddSubmit: (
    data: TextBulkAddFormData,
  ) => Promise<void> = async (data: TextBulkAddFormData): Promise<void> => {
    getProjectId();

    const textBulkAdd: SubscriberTextBulkAdd =
      channel.bulkAdd as SubscriberTextBulkAdd;
    const entries: Array<StatusPageBulkAddEntry> = textBulkAdd.getEntries(
      data.entries,
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

    const addChoiceColumns: {
      isSubscriptionConfirmed: boolean;
      sendYouHaveSubscribedMessage: boolean;
    } | null = channel.asksHowToAdd
      ? getSubscriberAddChoiceColumns(data.subscriberAddChoice)
      : null;

    await addEntries({
      entries,
      writeChoices: (subscriber: StatusPageSubscriber): void => {
        if (addChoiceColumns) {
          subscriber.isSubscriptionConfirmed =
            addChoiceColumns.isSubscriptionConfirmed;
          subscriber.sendYouHaveSubscribedMessage =
            addChoiceColumns.sendYouHaveSubscribedMessage;
        } else {
          subscriber.sendYouHaveSubscribedMessage = Boolean(
            data.sendYouHaveSubscribedMessage,
          );
        }

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
      },
    });
  };

  const closeCsvBulkAdd: () => void = (): void => {
    setShowBulkAddModal(false);
    setCsvRows([]);
    setSendNotification(false);
  };

  const handleCsvBulkAddSubmit: () => Promise<void> =
    async (): Promise<void> => {
      getProjectId();

      if (csvRows.length === 0) {
        return;
      }

      const csvBulkAdd: SubscriberCsvBulkAdd =
        channel.bulkAdd as SubscriberCsvBulkAdd;
      const entries: Array<StatusPageBulkAddEntry> = getBulkCsvEntries(
        csvRows,
        csvBulkAdd.valueColumn,
        csvBulkAdd.nameColumn,
      );
      const shouldTell: boolean = sendNotification;

      /*
       * The form goes, and opens empty next time, as Close leaves it; the
       * progress dialog takes over.
       */
      closeCsvBulkAdd();

      await addEntries({
        entries,
        writeChoices: (subscriber: StatusPageSubscriber): void => {
          subscriber.sendYouHaveSubscribedMessage = shouldTell;
        },
      });
    };

  /*
   * The channel's own fields, then one question each way: on Add, email's
   * "When you add them" (subscribe them now, and tell them or not, or ask
   * them to confirm first; SubscriberFormChoices.ts); on Edit, their Status.
   * What they hear about on the second step, when the page lets subscribers
   * choose; and folded under More fields the welcome (every channel but
   * email, which asked already), the language (every channel but a webhook,
   * which gets JSON) and the internal note.
   */
  const getFormFields: () => Array<
    ModelField<StatusPageSubscriber>
  > = (): Array<ModelField<StatusPageSubscriber>> => {
    const moreFields: FormFieldCollapsibleSection<StatusPageSubscriber> =
      getAdvancedFormSection<StatusPageSubscriber>();

    const formFields: Array<ModelField<StatusPageSubscriber>> = [
      ...channel.contactFields,
      ...(channel.asksHowToAdd ? getEmailSubscriberAddChoiceFields() : []),
      ...getSubscriberStatusFields(channel.statusFieldOptions),
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

    if (!channel.asksHowToAdd) {
      formFields.push(getSubscriberWelcomeField(moreFields));
    }

    if (channel.hasLanguage) {
      formFields.push(
        getSubscriberLanguageField({
          moreFields: moreFields,
          placeholder: getSubscriberPageDefaultLanguageText(
            translator,
            pageLanguage,
          ),
        }),
      );
    }

    formFields.push(getSubscriberInternalNoteField(moreFields));

    return formFields;
  };

  // The Status of a subscriber, as the channel reads it.
  const getStatusElement: (item: StatusPageSubscriber) => ReactElement = (
    item: StatusPageSubscriber,
  ): ReactElement => {
    if (channel.statusKind === SubscriberStatusKind.ConfirmationLink) {
      return (
        <SubscriberStatusPill
          subscriber={item}
          awaitingConfirmationDescription={
            channel.awaitingConfirmationDescription ||
            SubscriberFormCopy.awaitingConfirmationDescription
          }
        />
      );
    }

    if (item["isUnsubscribed"]) {
      return <Pill color={Red} text={"Unsubscribed"} />;
    }

    return <Pill color={Green} text={"Subscribed"} />;
  };

  const filters: Filter<StatusPageSubscriber>[] = [
    {
      field: {
        [channel.contactColumn]: true,
      },
      title: channel.contactFilterTitle,
      type: channel.contactFilterType,
    },
    {
      field: {
        isUnsubscribed: true,
      },
      title: "Unsubscribed?",
      type: FieldType.Boolean,
    },
    ...(channel.statusKind === SubscriberStatusKind.ConfirmationLink
      ? [
          {
            field: {
              isSubscriptionConfirmed: true,
            },
            title: "Subscription Confirmed?",
            type: FieldType.Boolean,
          },
        ]
      : []),
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
  ];

  const columns: Columns<StatusPageSubscriber> = [
    {
      field: {
        [channel.contactColumn]: true,
      },
      title: channel.contactColumnTitle,
      type: channel.contactColumnType,
    },
    {
      field: {
        isUnsubscribed: true,
      },
      title: "Status",
      type: FieldType.Text,
      getElement: getStatusElement,
    },
    ...(channel.hasLanguage
      ? [
          getSubscriberLanguageColumn({
            translator: translator,
            pageLanguage: pageLanguage,
          }),
        ]
      : []),
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
  ];

  const getTextBulkAddModal: (
    textBulkAdd: SubscriberTextBulkAdd,
  ) => ReactElement = (textBulkAdd: SubscriberTextBulkAdd): ReactElement => {
    return (
      <BasicFormModal<TextBulkAddFormData>
        title={channel.bulkAddTitle}
        description={channel.bulkAddDescription}
        submitButtonText="Add Subscribers"
        onClose={() => {
          setShowBulkAddModal(false);
        }}
        onSubmit={handleTextBulkAddSubmit}
        formProps={{
          name: textBulkAdd.formName,
          // Who to add, then what they hear about - only where the page lets subscribers choose.
          steps: asksWhatTheyHearAbout
            ? [
                /*
                 * SUBSCRIBER_INFO_STEP_ID, written out: the form scanners
                 * of the guard tests read literal ids.
                 */
                { title: "Subscriber Info", id: "subscriber-info" },
                { title: "Notifications", id: "notifications" },
              ]
            : undefined,
          fields: [
            {
              field: { entries: true },
              stepId: "subscriber-info",
              title: textBulkAdd.fieldTitle,
              /*
               * How to paste them, then - for email - the shared-address
               * advice: every notification can be unsubscribed from without
               * signing in, so one reader of a mailing list added here can
               * take everyone on it off this page. Two sentences, each
               * looked up whole.
               */
              description: channel.asksHowToAdd ? (
                <>
                  {translator.translateText(textBulkAdd.fieldDescription)}{" "}
                  {translator.translateText(
                    SubscriberUnsubscribeCopy.sharedAddressAdvice,
                  )}
                </>
              ) : (
                textBulkAdd.fieldDescription
              ),
              fieldType: FormFieldSchemaType.LongText,
              required: true,
              placeholder: textBulkAdd.placeholder,
              readsLeftToRight: textBulkAdd.readsLeftToRight || undefined,
              // Nothing in it to add: said under it, and Add waits.
              customValidation: (
                values: FormValues<TextBulkAddFormData>,
              ): string | null => {
                return getBulkAddNothingToAddError(
                  textBulkAdd.getEntries(String(values.entries || "")),
                  textBulkAdd.nothingToAddError,
                );
              },
            },
            channel.asksHowToAdd
              ? {
                  /*
                   * The Add form's question, asked once for every address:
                   * the answer is written into the two columns of each
                   * subscriber (handleTextBulkAddSubmit).
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
                }
              : {
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
                    categoryCheckboxProps: categoryCheckboxOptionsAndCategories,
                    showIf: (model: FormValues<TextBulkAddFormData>) => {
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
                    showIf: (model: FormValues<TextBulkAddFormData>) => {
                      return !model || !model.isSubscribedToAllEventTypes;
                    },
                  },
                ]
              : []),
          ],
        }}
      />
    );
  };

  const getCsvBulkAddModal: (
    csvBulkAdd: SubscriberCsvBulkAdd,
  ) => ReactElement = (csvBulkAdd: SubscriberCsvBulkAdd): ReactElement => {
    return (
      <Modal
        title={channel.bulkAddTitle}
        description={channel.bulkAddDescription}
        submitButtonText="Add Subscribers"
        modalWidth={ModalWidth.Large}
        onClose={closeCsvBulkAdd}
        disableSubmitButton={csvRows.length === 0}
        onSubmit={() => {
          handleCsvBulkAddSubmit().catch((err: Error) => {
            setError(API.getFriendlyMessage(err));
          });
        }}
      >
        <div className="space-y-4">
          <CSVFileUpload
            columns={csvBulkAdd.columns}
            onDataChanged={(data: Array<CSVRow>) => {
              setCsvRows(data);
            }}
            templateFileName={csvBulkAdd.templateFileName}
          />
          <div className="pt-2">
            <Toggle
              title={SubscriberFormCopy.welcomeTitle}
              description={SubscriberFormCopy.welcomeDescription}
              value={sendNotification}
              onChange={(value: boolean) => {
                setSendNotification(value);
              }}
            />
          </div>
        </div>
      </Modal>
    );
  };

  /*
   * Built once the status page has said what its subscribers may choose and
   * what language it writes in, not on every draw of the list.
   */
  const formFields: Array<ModelField<StatusPageSubscriber>> = useMemo(() => {
    return isLoading ? [] : getFormFields();
  }, [isLoading, categoryCheckboxOptionsAndCategories, pageLanguage]);

  if (isLoading) {
    return <PageSkeleton />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  return (
    <Fragment>
      <SubscriberChannelOffPanel
        statusPageId={modelId}
        method={channel.method}
        isEnabled={isChannelEnabled}
      />
      <SubscriberNotificationWarnings statusPageId={modelId} />
      <TeamAddedSubscribersUnsubscribedNotice
        statusPageId={modelId}
        projectId={props.projectId}
        channelQuery={getSubscriberChannelQuery(channel)}
        contactSelect={getSubscriberContactSelect(channel)}
      />
      <ModelTable<StatusPageSubscriber>
        modelType={StatusPageSubscriber}
        id={channel.tableId}
        name={channel.tableName}
        userPreferencesKey={channel.userPreferencesKey}
        saveFilterProps={{
          tableId: channel.savedFiltersTableId,
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
          isSubscriptionConfirmed: true,
          // Whether each is unsubscribed, for Unsubscribe to count.
          isUnsubscribed: true,
          /*
           * The Status reads when the link to confirm was sent, so it is
           * read whether or not the viewer shows Subscribed At.
           */
          createdAt: true,
        }}
        query={{
          ...getSubscriberChannelQuery(channel),
          statusPageId: modelId,
          projectId: props.projectId,
        }}
        onBeforeCreate={(
          item: StatusPageSubscriber,
        ): Promise<StatusPageSubscriber> => {
          item.statusPageId = modelId;
          item.projectId = getProjectId();
          return Promise.resolve(item);
        }}
        onFetchSuccess={() => {
          props.onSubscribersChanged?.();
        }}
        refreshToggle={refreshToggle}
        singularName="Subscriber"
        pluralName="Subscribers"
        createVerb="Add"
        /* The docs page for this list (#6822): who can subscribe, by which channel, and what they are sent. */
        documentationLink={Route.fromString("/docs/status-pages/subscribers")}
        cardProps={{
          title: channel.cardTitle,
          description: channel.cardDescription,
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
         * Who gets the updates, then - when the status page lets subscribers
         * choose - what they hear about, as Add in Bulk asks it. Without
         * that choice the form is one page.
         */
        formSteps={
          asksWhatTheyHearAbout
            ? [
                /*
                 * SUBSCRIBER_INFO_STEP_ID, written out: the form scanners
                 * of the guard tests read literal ids.
                 */
                { title: "Subscriber Info", id: "subscriber-info" },
                { title: "Notifications", id: "notifications" },
              ]
            : undefined
        }
        formFields={formFields}
        showRefreshButton={true}
        viewPageRoute={Navigation.getCurrentRoute()}
        filters={filters}
        columns={columns}
      />

      {showBulkAddModal && channel.bulkAdd.input === SubscriberBulkAddInput.Text
        ? getTextBulkAddModal(channel.bulkAdd)
        : null}

      {showBulkAddModal && channel.bulkAdd.input === SubscriberBulkAddInput.Csv
        ? getCsvBulkAddModal(channel.bulkAdd)
        : null}

      {bulkAdd.dialog}
    </Fragment>
  );
};

export default StatusPageSubscriberList;
