import NotificationMethodView from "../../Components/NotificationMethods/NotificationMethod";
import NotifyAfterDropdownOptions from "../../Components/NotificationRule/NotifyAfterMinutesDropdownOptions";
import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import SelectEntityField from "Common/UI/Types/SelectEntityField";
import { JSONObject } from "Common/Types/JSON";
import NotificationRuleType from "Common/Types/NotificationRule/NotificationRuleType";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import NotificationMethodUtil from "Common/UI/Utils/NotificationMethodUtil";
import User from "Common/UI/Utils/User";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import UserCall from "Common/Models/DatabaseModels/UserCall";
import UserEmail from "Common/Models/DatabaseModels/UserEmail";
import UserNotificationRule from "Common/Models/DatabaseModels/UserNotificationRule";
import UserPush from "Common/Models/DatabaseModels/UserPush";
import UserSMS from "Common/Models/DatabaseModels/UserSMS";
import UserTelegram from "Common/Models/DatabaseModels/UserTelegram";
import UserWhatsApp from "Common/Models/DatabaseModels/UserWhatsApp";
import UserWebhook from "Common/Models/DatabaseModels/UserWebhook";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

const Settings: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const [error, setError] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [alertSeverities, setAlertSeverities] = useState<Array<AlertSeverity>>(
    [],
  );
  const [userEmails, setUserEmails] = useState<Array<UserEmail>>([]);
  const [userSMSs, setUserSMSs] = useState<Array<UserSMS>>([]);
  const [userWhatsApps, setUserWhatsApps] = useState<Array<UserWhatsApp>>([]);
  const [userTelegrams, setUserTelegrams] = useState<Array<UserTelegram>>([]);
  const [userWebhooks, setUserWebhooks] = useState<Array<UserWebhook>>([]);
  const [userCalls, setUserCalls] = useState<Array<UserCall>>([]);
  const [userPush, setUserPush] = useState<Array<UserPush>>([]);
  const [
    notificationMethodsDropdownOptions,
    setNotificationMethodsDropdownOptions,
  ] = useState<Array<DropdownOption>>([]);

  type GetTableFunctionProps = {
    alertSeverity?: AlertSeverity;
    ruleType: NotificationRuleType;
    title: string;
    description: string;
  };

  type GetTableFunction = (props: GetTableFunctionProps) => ReactElement;

  const getModelTable: GetTableFunction = (
    options: GetTableFunctionProps,
  ): ReactElement => {
    return (
      <ModelTable<UserNotificationRule>
        modelType={UserNotificationRule}
        /*
         * One of these tables is rendered per severity, so the severity has to
         * be part of the key: it namespaces both the stored page-size
         * preference and this table's slice of the URL state. Without it every
         * table on the page would share one namespace and paging one would
         * repaginate the rest.
         */
        userPreferencesKey={`user-notification-rules-table-${options.ruleType}${
          options.alertSeverity?.id
            ? `-${options.alertSeverity.id.toString()}`
            : ""
        }`}
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
          userId: User.getUserId()!,
          ruleType: options.ruleType,
          alertSeverityId: options.alertSeverity?.id || undefined,
        }}
        onBeforeCreate={(
          model: UserNotificationRule,
          miscDataProps: JSONObject,
        ): Promise<UserNotificationRule> => {
          model.projectId = ProjectUtil.getCurrentProjectId()!;
          model.userId = User.getUserId();
          model.ruleType = options.ruleType;
          if (options.alertSeverity?.id) {
            model.alertSeverityId = options.alertSeverity?.id;
          }

          NotificationMethodUtil.setSelectedMethodOnRule(
            model,
            miscDataProps["notificationMethod"],
            {
              userCalls: userCalls,
              userEmails: userEmails,
              userSMSs: userSMSs,
              userPush: userPush,
              userWhatsApps: userWhatsApps,
              userTelegrams: userTelegrams,
              userWebhooks: userWebhooks,
            },
          );

          return Promise.resolve(model);
        }}
        sortOrder={SortOrder.Ascending}
        sortBy="notifyAfterMinutes"
        createVerb={"Add"}
        id="notification-rules"
        name={`User Settings > Notification Rules > ${
          options.alertSeverity?.name || options.ruleType
        }`}
        isDeleteable={true}
        isEditable={false}
        isCreateable={true}
        cardProps={{
          title: options.title,
          description: options.description,
        }}
        noItemsMessage={
          "No notification rules found for this user. Please add one to receive notifications."
        }
        formFields={[
          {
            overrideField: {
              notificationMethod: true,
            },
            showEvenIfPermissionDoesNotExist: true,
            overrideFieldKey: "notificationMethod",
            title: "Notification Method",
            description: "How do you want to be notified?",
            fieldType: FormFieldSchemaType.Dropdown,
            required: true,
            placeholder: "Notification Method",
            dropdownOptions: notificationMethodsDropdownOptions,
          },
          {
            field: {
              notifyAfterMinutes: true,
            },
            title: "Notify me after",
            fieldType: FormFieldSchemaType.Dropdown,
            required: true,
            placeholder: "Immediately",
            dropdownOptions: NotifyAfterDropdownOptions,
          },
        ]}
        showRefreshButton={true}
        selectMoreFields={NotificationMethodUtil.getSelectForNotificationMethods<UserNotificationRule>()}
        filters={[]}
        columns={[
          {
            field:
              NotificationMethodUtil.getSelectForNotificationMethods<UserNotificationRule>() as SelectEntityField<UserNotificationRule>,
            title: "Notification Method",
            type: FieldType.Text,
            getElement: (item: UserNotificationRule): ReactElement => {
              return (
                <NotificationMethodView
                  item={item}
                  modelType={UserNotificationRule}
                />
              );
            },
          },
          {
            field: {
              notifyAfterMinutes: true,
            },
            title: "Notify After",
            type: FieldType.Text,
            getElement: (item: UserNotificationRule): ReactElement => {
              return (
                <div>
                  {item["notifyAfterMinutes"] === 0 && <p>Immediately</p>}
                  {(item["notifyAfterMinutes"] as number) > 0 && (
                    <p>{item["notifyAfterMinutes"] as number} minutes</p>
                  )}
                </div>
              );
            },
          },
        ]}
      />
    );
  };

  const init: PromiseVoidFunction = async (): Promise<void> => {
    // Ping an API here.
    setError("");
    setIsLoading(true);

    try {
      const alertSeverities: ListResult<AlertSeverity> = await ModelAPI.getList(
        {
          modelType: AlertSeverity,
          query: {
            projectId: ProjectUtil.getCurrentProjectId()!,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            name: true,
          },
          sort: {},
        },
      );

      const userEmails: ListResult<UserEmail> = await ModelAPI.getList({
        modelType: UserEmail,
        query: {
          projectId: ProjectUtil.getCurrentProjectId()!,
          userId: User.getUserId(),
          isVerified: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: {
          email: true,
        },
        sort: {},
      });

      setUserEmails(userEmails.data);

      const userSMSes: ListResult<UserSMS> = await ModelAPI.getList({
        modelType: UserSMS,
        query: {
          projectId: ProjectUtil.getCurrentProjectId()!,
          userId: User.getUserId(),
          isVerified: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: {
          phone: true,
        },
        sort: {},
      });

      setUserSMSs(userSMSes.data);

      const userCalls: ListResult<UserCall> = await ModelAPI.getList({
        modelType: UserCall,
        query: {
          projectId: ProjectUtil.getCurrentProjectId()!,
          userId: User.getUserId(),
          isVerified: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: {
          phone: true,
        },
        sort: {},
      });

      setUserCalls(userCalls.data);

      const userPushDevices: ListResult<UserPush> = await ModelAPI.getList({
        modelType: UserPush,
        query: {
          projectId: ProjectUtil.getCurrentProjectId()!,
          userId: User.getUserId(),
          isVerified: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: {
          deviceName: true,
          deviceType: true,
        },
        sort: {},
      });

      setUserPush(userPushDevices.data);

      const userWhatsAppList: ListResult<UserWhatsApp> = await ModelAPI.getList(
        {
          modelType: UserWhatsApp,
          query: {
            projectId: ProjectUtil.getCurrentProjectId()!,
            userId: User.getUserId(),
            isVerified: true,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            phone: true,
          },
          sort: {},
        },
      );

      setUserWhatsApps(userWhatsAppList.data);

      const userTelegramList: ListResult<UserTelegram> = await ModelAPI.getList(
        {
          modelType: UserTelegram,
          query: {
            projectId: ProjectUtil.getCurrentProjectId()!,
            userId: User.getUserId(),
            isVerified: true,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            telegramUserHandle: true,
            telegramChatId: true,
          },
          sort: {},
        },
      );

      setUserTelegrams(userTelegramList.data);

      const userWebhookList: ListResult<UserWebhook> = await ModelAPI.getList({
        modelType: UserWebhook,
        query: {
          projectId: ProjectUtil.getCurrentProjectId()!,
          userId: User.getUserId(),
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: {
          name: true,
        },
        sort: {},
      });

      setUserWebhooks(userWebhookList.data);

      setAlertSeverities(alertSeverities.data);

      setNotificationMethodsDropdownOptions(
        NotificationMethodUtil.getDropdownOptions({
          userCalls: userCalls.data,
          userEmails: userEmails.data,
          userSMSs: userSMSes.data,
          userPush: userPushDevices.data,
          userWhatsApps: userWhatsAppList.data,
          userTelegrams: userTelegramList.data,
          userWebhooks: userWebhookList.data,
        }),
      );
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  useEffect(() => {
    init().catch((err: Error) => {
      setError(err.toString());
    });
  }, []);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  return (
    <Fragment>
      <div>
        {alertSeverities.map((alertSeverity: AlertSeverity, i: number) => {
          return (
            <div key={i}>
              {getModelTable({
                alertSeverity: alertSeverity,
                ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
                title:
                  alertSeverity.name +
                  " Severity Alert: " +
                  " When I am on call and " +
                  alertSeverity.name +
                  " severity alert" +
                  " is assigned to me...",
                description:
                  "Here are the rules when you are on call and " +
                  alertSeverity.name +
                  " Severity alert" +
                  " is assigned to you.",
              })}
            </div>
          );
        })}
      </div>

      {/* <div>
                {getModelTable({
                    alertSeverity: undefined,
                    ruleType: NotificationRuleType.WHEN_USER_GOES_ON_CALL,
                    title: 'When I go on call...',
                    description:
                        'Here are the rules to notify you when you go on call.',
                })}
            </div>

            <div>
                {getModelTable({
                    alertSeverity: undefined,
                    ruleType: NotificationRuleType.WHEN_USER_GOES_OFF_CALL,
                    title: 'When I go off call...',
                    description:
                        'Here are the rules to notify you when you go off call.',
                })}
            </div> */}
    </Fragment>
  );
};

export default Settings;
