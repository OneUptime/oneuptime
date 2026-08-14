import NotificationMethodView, {
  DeletionImpactModal,
} from "../../Components/NotificationMethods/NotificationMethod";
import NotifyAfterDropdownOptions from "../../Components/NotificationRule/NotifyAfterMinutesDropdownOptions";
import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import {
  ErrorFunction,
  PromiseVoidFunction,
  VoidFunction,
} from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import SelectEntityField from "Common/UI/Types/SelectEntityField";
import { JSONObject } from "Common/Types/JSON";
import NotificationRuleType from "Common/Types/NotificationRule/NotificationRuleType";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import NotificationMethodUtil from "Common/UI/Utils/NotificationMethodUtil";
import PermissionUtil from "Common/UI/Utils/Permission";
import User from "Common/UI/Utils/User";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
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
  const [incidentSeverities, setIncidentSeverities] = useState<
    Array<IncidentSeverity>
  >([]);
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

  /*
   * ==========================================================================
   * DELETE GUARD
   * ==========================================================================
   *
   * Deleting a notification rule is the delete that quietly removes coverage. A
   * row here reads "Email: jane@example.com / after 5 minutes" and says nothing
   * about whether it is the LAST rule standing for this severity - and the
   * stock ModelTable confirmation cannot say either, because its description is
   * a fixed string ("Are you sure you want to delete this...?") with nowhere to
   * put a number.
   *
   * So the table's built-in delete is turned off (`isDeleteable={false}`) and
   * the Delete action is supplied here instead, opening DeletionImpactModal -
   * the same confirmation the notification method tables use, so somebody
   * tidying their settings meets one account of what a delete costs rather than
   * two that disagree. The modal counts across ALL of this user's rules in the
   * project rather than the table the row happens to sit in, which is why each
   * of the four rule-type pages can hand it nothing but a rule id.
   *
   * IT DOES NOT BLOCK. Deleting your own notification rule is your call. The
   * only thing being changed is that you make it knowing whether anything is
   * still going to page you for that severity, and whether anyone is relying on
   * you answering.
   */
  const [ruleToDelete, setRuleToDelete] = useState<UserNotificationRule | null>(
    null,
  );
  const [isDeletingRule, setIsDeletingRule] = useState<boolean>(false);
  const [deleteError, setDeleteError] = useState<string>("");
  const [refreshToggle, setRefreshToggle] = useState<string>(
    OneUptimeDate.getCurrentDate().toString(),
  );

  /*
   * The same gate BaseModelTable puts on its own delete action. Replacing that
   * action with one of ours would otherwise hand a Delete button to a read-only
   * member, who would then meet the refusal only after confirming it.
   */
  const canDeleteRules: boolean = Boolean(
    new UserNotificationRule().hasDeletePermissions(
      PermissionUtil.getAllPermissions(),
    ) || User.isMasterAdmin(),
  );

  type DeleteRuleFunction = (rule: UserNotificationRule) => Promise<void>;

  const deleteRule: DeleteRuleFunction = async (
    rule: UserNotificationRule,
  ): Promise<void> => {
    if (!rule.id) {
      return;
    }

    setIsDeletingRule(true);

    try {
      await ModelAPI.deleteItem<UserNotificationRule>({
        modelType: UserNotificationRule,
        id: rule.id,
      });

      /*
       * Every table on the page is refetched rather than only the one the row
       * sat in. A rule belongs to exactly one of them, but one shared toggle is
       * cheaper than threading a per-severity one and cannot leave a deleted
       * row on screen.
       */
      setRefreshToggle(OneUptimeDate.getCurrentDate().toString());
    } catch (err) {
      setDeleteError(API.getFriendlyMessage(err));
    }

    setRuleToDelete(null);
    setIsDeletingRule(false);
  };

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
        /*
         * One of these tables is rendered per severity, so the severity has to
         * be part of the key: it namespaces both the stored page-size
         * preference and this table's slice of the URL state. Without it every
         * table on the page would share one namespace and paging one would
         * repaginate the rest.
         */
        userPreferencesKey={`user-notification-rules-table-${options.ruleType}${
          options.incidentSeverity?.id
            ? `-${options.incidentSeverity.id.toString()}`
            : ""
        }`}
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
          options.incidentSeverity?.name || options.ruleType
        }`}
        refreshToggle={refreshToggle}
        /*
         * Off, and replaced by the action button below. See the DELETE GUARD
         * note above: the shared confirmation takes a fixed description and so
         * cannot say what this particular delete costs.
         */
        isDeleteable={false}
        actionButtons={
          canDeleteRules
            ? [
                {
                  title: "Delete",
                  icon: IconProp.Trash,
                  buttonStyleType: ButtonStyleType.DANGER_OUTLINE,
                  onClick: (
                    item: UserNotificationRule,
                    onCompleteAction: VoidFunction,
                    onError: ErrorFunction,
                  ) => {
                    try {
                      setDeleteError("");
                      setRuleToDelete(item);
                      onCompleteAction();
                    } catch (err) {
                      onCompleteAction();
                      onError(err as Error);
                    }
                  },
                },
              ]
            : []
        }
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

      setIncidentSeverities(incidentSeverities.data);

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
        {incidentSeverities.map(
          (incidentSeverity: IncidentSeverity, i: number) => {
            return (
              <div key={i}>
                {getModelTable({
                  incidentSeverity: incidentSeverity,
                  ruleType:
                    NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
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

      {/*
       * Mounted conditionally so each open is a fresh mount: the modal reads
       * the user's rules when it mounts, and a cached list would let the second
       * delete of a session be explained by the state before the first one.
       */}
      {ruleToDelete ? (
        <DeletionImpactModal
          target={{
            type: "rule",
            ruleId: ruleToDelete.id?.toString() || "",
          }}
          userId={User.getUserId()}
          projectId={ProjectUtil.getCurrentProjectId()}
          title="Delete Notification Rule"
          submitButtonText="Delete"
          isDeleting={isDeletingRule}
          onClose={() => {
            setRuleToDelete(null);
          }}
          onConfirm={() => {
            deleteRule(ruleToDelete).catch((err: Error) => {
              setDeleteError(API.getFriendlyMessage(err));
              setRuleToDelete(null);
              setIsDeletingRule(false);
            });
          }}
        />
      ) : (
        <></>
      )}

      {/*
       * The delete's own failure, which the impact modal has no room for: it is
       * showing what the delete WOULD cost, and by the time this is set the
       * delete has already been attempted and refused.
       */}
      {deleteError ? (
        <ConfirmModal
          title="Error"
          description={deleteError}
          submitButtonText="Close"
          submitButtonType={ButtonStyleType.NORMAL}
          onSubmit={() => {
            setDeleteError("");
          }}
        />
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default Settings;
