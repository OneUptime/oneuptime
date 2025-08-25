import PageComponentProps from "../../PageComponentProps";
import NotNull from "Common/Types/BaseDatabase/NotNull";
import { Green, Red } from "Common/Types/BrandColors";
import BadDataException from "Common/Types/Exception/BadDataException";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ObjectID from "Common/Types/ObjectID";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import { CategoryCheckboxOptionsAndCategories } from "Common/UI/Components/CategoryCheckbox/Index";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
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

const StatusPageMicrosoftTeamsSubscribers: FunctionComponent<
  PageComponentProps
> = (props: PageComponentProps): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const [
    allowSubscribersToChooseResources,
    setAllowSubscribersToChooseResources,
  ] = React.useState<boolean>(false);

  const [
    allowSubscribersToChooseEventTypes,
    setAllowSubscribersToChooseEventTypes,
  ] = React.useState<boolean>(false);

  const [
    isMicrosoftTeamsSubscribersEnabled,
    setIsMicrosoftTeamsSubscribersEnabled,
  ] = React.useState<boolean>(false);
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
          enableMicrosoftTeamsSubscribers: true,
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

      if (statusPage && statusPage.enableMicrosoftTeamsSubscribers) {
        setIsMicrosoftTeamsSubscribersEnabled(
          statusPage.enableMicrosoftTeamsSubscribers,
        );
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

  useEffect(() => {
    if (isLoading) {
      return; // don't do anything if loading
    }

    const formFields: Array<ModelField<StatusPageSubscriber>> = [
      {
        field: {
          microsoftTeamsWorkspaceName: true,
        },
        stepId: "subscriber-info",
        title: "Microsoft Teams Workspace Name",
        description:
          "Name of the Microsoft Teams workspace for identification.",
        fieldType: FormFieldSchemaType.Text,
        required: true,
        placeholder: "my-company-workspace",
      },
      {
        field: {
          microsoftTeamsIncomingWebhookUrl: true,
        },
        stepId: "subscriber-info",
        title: "Microsoft Teams Incoming Webhook URL",
        description: "Status page updates will be sent to this Teams channel.",
        fieldType: FormFieldSchemaType.URL,
        required: true,
        placeholder: "https://xxxxx.office.com/webhook/...",
        disableSpellCheck: true,
      },
      {
        field: {
          sendYouHaveSubscribedMessage: true,
        },
        title: "Send Subscription Notification",
        stepId: "subscriber-info",
        description:
          "Send a notification to the Teams channel confirming the subscription.",
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
        description: "Unsubscribe this Teams channel from the status page.",
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
          {!isMicrosoftTeamsSubscribersEnabled && (
            <Alert
              type={AlertType.DANGER}
              title="Microsoft Teams subscribers are not enabled for this status page. Please enable it in Subscriber Settings"
            />
          )}

          <ModelTable<StatusPageSubscriber>
            modelType={StatusPageSubscriber}
            id="table-microsoft-teams-subscriber"
            name="Status Page > Microsoft Teams Subscribers"
            userPreferencesKey="status-page-microsoft-teams-subscribers-table"
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
              microsoftTeamsWorkspaceName: new NotNull(),
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
            cardProps={{
              title: "Microsoft Teams Subscribers",
              description:
                "Here are the list of Microsoft Teams channels that have subscribed to the status page.",
            }}
            noItemsMessage={"No Microsoft Teams subscribers found."}
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
                  microsoftTeamsWorkspaceName: true,
                },
                title: "Teams Workspace Name",
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
                  microsoftTeamsWorkspaceName: true,
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
        </>
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default StatusPageMicrosoftTeamsSubscribers;
