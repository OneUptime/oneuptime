import NotificationMethodView from "../../Components/NotificationMethods/NotificationMethod";
import NotifyAfterDropdownOptions from "../../Components/NotificationRule/NotifyAfterMinutesDropdownOptions";
import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
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
import User from "Common/UI/Utils/User";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import UserCall from "Common/Models/DatabaseModels/UserCall";
import UserEmail from "Common/Models/DatabaseModels/UserEmail";
import UserNotificationRule from "Common/Models/DatabaseModels/UserNotificationRule";
import UserPush from "Common/Models/DatabaseModels/UserPush";
import UserSMS from "Common/Models/DatabaseModels/UserSMS";
import UserWhatsApp from "Common/Models/DatabaseModels/UserWhatsApp";
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
  const [incidentSeverities, setIncidentSeverities] = useState<
    Array<IncidentSeverity>
  >([]);
  const [userEmails, setUserEmails] = useState<Array<UserEmail>>([]);
  const [userSMSs, setUserSMSs] = useState<Array<UserSMS>>([]);
  const [userWhatsApps, setUserWhatsApps] = useState<Array<UserWhatsApp>>([]);
  const [userCalls, setUserCalls] = useState<Array<UserCall>>([]);
  const [userPush, setUserPush] = useState<Array<UserPush>>([]);
  const [
    notificationMethodsDropdownOptions,
    setNotificationMethodsDropdownOptions,
  ] = useState<Array<DropdownOption>>([]);

  type GetTableFunctionProps = {
    incidentSeverity?: IncidentSeverity;
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
        userPreferencesKey={`user-notification-rules-table-${options.ruleType}`}
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
          userId: User.getUserId()!,
          ruleType: options.ruleType,
          incidentSeverityId: options.incidentSeverity?.id || undefined,
        }}
        onBeforeCreate={(
          model: UserNotificationRule,
          miscDataProps: JSONObject,
        ): Promise<UserNotificationRule> => {
          model.projectId = ProjectUtil.getCurrentProjectId()!;
          model.userId = User.getUserId();
          model.ruleType = options.ruleType;
          if (options.incidentSeverity?.id) {
            model.incidentSeverityId = options.incidentSeverity?.id;
          }

          if (miscDataProps["notificationMethod"]) {
            const userEmail: UserEmail | undefined = userEmails.find(
              (userEmail: UserEmail) => {
                return (
                  userEmail.id!.toString() ===
                  miscDataProps["notificationMethod"]?.toString()
                );
              },
            );

            if (userEmail) {
              model.userEmailId = userEmail.id!;
            }

            const userSMS: UserSMS | undefined = userSMSs.find(
              (userSMS: UserSMS) => {
                return (
                  userSMS.id!.toString() ===
                  miscDataProps["notificationMethod"]?.toString()
                );
              },
            );

            if (userSMS) {
              model.userSmsId = userSMS.id!;
            }

            const userCall: UserCall | undefined = userCalls.find(
              (userCall: UserCall) => {
                return (
                  userCall.id!.toString() ===
                  miscDataProps["notificationMethod"]?.toString()
                );
              },
            );

            if (userCall) {
              model.userCallId = userCall.id!;
            }

            const userPushDevice: UserPush | undefined = userPush.find(
              (userPushDevice: UserPush) => {
                return (
                  userPushDevice.id!.toString() ===
                  miscDataProps["notificationMethod"]?.toString()
                );
              },
            );

            if (userPushDevice) {
              model.userPushId = userPushDevice.id!;
            }

            const userWhatsApp: UserWhatsApp | undefined = userWhatsApps.find(
              (userWhatsApp: UserWhatsApp) => {
                return (
                  userWhatsApp.id!.toString() ===
                  miscDataProps["notificationMethod"]?.toString()
                );
              },
            );

            if (userWhatsApp) {
              model.userWhatsAppId = userWhatsApp.id!;
            }
          }

          return Promise.resolve(model);
        }}
        sortOrder={SortOrder.Ascending}
        sortBy="notifyAfterMinutes"
        createVerb={"Add"}
        id="notification-rules"
        name={`User Settings > Notification Rules > ${
          options.incidentSeverity?.name || options.ruleType
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
        selectMoreFields={{
          userEmail: {
            email: true,
          },
          userSms: {
            phone: true,
          },
          userPush: {
            deviceName: true,
            deviceType: true,
          },
          userWhatsApp: {
            phone: true,
          },
        }}
        filters={[]}
        columns={[
          {
            field: {
              userCall: {
                phone: true,
              },
              userEmail: {
                email: true,
              },
              userSms: {
                phone: true,
              },
              userPush: {
                deviceName: true,
                deviceType: true,
              },
              userWhatsApp: {
                phone: true,
              },
            },
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
      const incidentSeverities: ListResult<IncidentSeverity> =
        await ModelAPI.getList({
          modelType: IncidentSeverity,
          query: {
            projectId: ProjectUtil.getCurrentProjectId()!,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            name: true,
          },
          sort: {},
        });

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

      setIncidentSeverities(incidentSeverities.data);

      const dropdownOptions: Array<DropdownOption> = [
        ...userCalls.data,
        ...userEmails.data,
        ...userSMSes.data,
        ...userPushDevices.data,
        ...userWhatsAppList.data,
      ].map((model: BaseModel) => {
        const isUserCall: boolean = model instanceof UserCall;
        const isUserSms: boolean = model instanceof UserSMS;
        const isUserPush: boolean = model instanceof UserPush;
        const isUserWhatsApp: boolean = model instanceof UserWhatsApp;

        let option: DropdownOption;

        if (isUserPush) {
          option = {
            label:
              "Push: " +
              (model.getColumnValue("deviceName")?.toString() ||
                "Unknown Device"),
            value: model.id!.toString(),
          };
        } else {
          option = {
            label: model.getColumnValue("phone")
              ? (model.getColumnValue("phone")?.toString() as string)
              : (model.getColumnValue("email")?.toString() as string),
            value: model.id!.toString(),
          };

          if (isUserCall) {
            option.label = "Call: " + option.label;
          } else if (isUserSms) {
            option.label = "SMS: " + option.label;
          } else if (isUserWhatsApp) {
            option.label = "WhatsApp: " + option.label;
          } else {
            option.label = "Email: " + option.label;
          }
        }

        return option;
      });

      setNotificationMethodsDropdownOptions(dropdownOptions);
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
        {incidentSeverities.map(
          (incidentSeverity: IncidentSeverity, i: number) => {
            return (
              <div key={i}>
                {getModelTable({
                  incidentSeverity: incidentSeverity,
                  ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
                  title:
                    incidentSeverity.name +
                    " Severity Episode: " +
                    " When I am on call and " +
                    incidentSeverity.name +
                    " severity episode" +
                    " is assigned to me...",
                  description:
                    "Here are the rules when you are on call and " +
                    incidentSeverity.name +
                    " Severity episode" +
                    " is assigned to you.",
                })}
              </div>
            );
          },
        )}
      </div>
    </Fragment>
  );
};

export default Settings;
