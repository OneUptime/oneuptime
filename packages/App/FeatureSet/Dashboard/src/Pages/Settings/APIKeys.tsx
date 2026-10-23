import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  ROLE_ACCESS_FIELD_KEY,
  RoleAccessHolder,
  getCustomRoleAccessValue,
  getRoleAccessCustomRoleId,
  getRoleAccessOptionsForCurrentUser,
  getRoleAccessRole,
  giveApiKeyCustomRoleAccess,
  giveRoleAccess,
} from "../../Components/Permission/RoleAccess";
import RoleAccessNotice from "../../Components/Permission/RoleAccessNotice";
import { getApiKeyCreateFormFields } from "../../Components/ApiKey/ApiKeyCreateForm";
import { getApiKeyRolePermissionCountText } from "../../Components/CustomRole/CustomRoleCopy";
import {
  CustomRoleSummary,
  getApiKeyRoleGrants,
  getCustomRoleCardSelectOption,
  loadCustomRoleGrants,
  loadCustomRoles,
} from "../../Components/CustomRole/CustomRoleOptions";
import Route from "Common/Types/API/Route";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import { CardSelectOption } from "Common/UI/Components/CardSelect/CardSelect";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import { ModalType } from "Common/UI/Components/ModelTable/BaseModelTable";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import GrantablePermission, {
  TeamPermissionGrant,
} from "Common/UI/Utils/GrantablePermission";
import Navigation from "Common/UI/Utils/Navigation";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import ApiKey from "Common/Models/DatabaseModels/ApiKey";
import PlanLeftoverPage from "../../Components/Billing/PlanLeftoverPage";
import PlanLeftoverTable from "../../Components/Billing/PlanLeftoverTable";
import { PlanLeftoverTitle } from "../../Components/Billing/PlanLeftoverCopy";
import { API_KEY_REQUIRED_PLAN } from "../../Components/Billing/PlanCutoff";
import React, {
  Fragment,
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/*
 * A key whose access could not be added after it was made: what to say, and
 * which key to open.
 */
interface AccessNotice {
  apiKeyId: ObjectID;
  apiKeyName: string;
  error: string;
}

/*
 * What a new key starts with, picked under Access: a built-in role, one of
 * the project's custom roles, or nothing (Choose permissions later).
 */
interface PendingAccess {
  role: Permission | null;
  customRoleId: string | null;
}

const NO_ACCESS: PendingAccess = { role: null, customRoleId: null };

const APIKeys: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const translator: Translator = useTranslator();

  /*
   * The project's custom roles this user could give a key - every
   * permission of each that a key would hold being one they may hand on,
   * and at least one that a key holds (not every one limited to what
   * someone owns) - as Access cards. Read once, after the page opens: null
   * until then, and none for someone who may not read them.
   */
  const [customRoleOptions, setCustomRoleOptions] =
    useState<Array<CardSelectOption> | null>(null);

  useEffect(() => {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (!projectId) {
      setCustomRoleOptions([]);
      return;
    }

    Promise.all([
      loadCustomRoles({ projectId: projectId }),
      loadCustomRoleGrants({ projectId: projectId }),
    ])
      .then(
        ([roles, grants]: [
          Array<CustomRoleSummary>,
          Map<string, Array<TeamPermissionGrant>>,
        ]) => {
          setCustomRoleOptions(
            roles
              .filter((role: CustomRoleSummary): boolean => {
                const roleGrants: Array<TeamPermissionGrant> =
                  grants.get(role.id) || [];

                /*
                 * A role that gives a key nothing yet - no permission, or
                 * only ones limited to what someone owns - gives a new key
                 * nothing, as Choose permissions later does.
                 */
                return (
                  getApiKeyRoleGrants(roleGrants).length > 0 &&
                  GrantablePermission.canCurrentUserGrantApiKeyRole(roleGrants)
                );
              })
              .map((role: CustomRoleSummary): CardSelectOption => {
                const roleGrants: Array<TeamPermissionGrant> =
                  grants.get(role.id) || [];

                return getCustomRoleCardSelectOption(translator, role, {
                  value: getCustomRoleAccessValue(role.id),
                  saysItIsCustom: true,
                  permissionsText: getApiKeyRolePermissionCountText(
                    translator,
                    {
                      permissionCount: role.permissionCount,
                      ownedCount:
                        roleGrants.length -
                        getApiKeyRoleGrants(roleGrants).length,
                    },
                  ),
                });
              }),
          );
        },
      )
      .catch(() => {
        // Roles the user may not read are roles Create API Key can't offer.
        setCustomRoleOptions([]);
      });
  }, []);

  /*
   * Name, Access and, folded under Advanced, the description and the expiry
   * date - a year from today (Components/ApiKey/ApiKeyCreateForm). The
   * Access cards are the roles this user may hand on, then the custom
   * roles they could give.
   */
  const createFormFields: Array<ModelField<ApiKey>> = useMemo((): Array<
    ModelField<ApiKey>
  > => {
    return getApiKeyCreateFormFields({
      accessOptions: getRoleAccessOptionsForCurrentUser(
        RoleAccessHolder.ApiKey,
        customRoleOptions,
      ),
    });
  }, [customRoleOptions]);

  /*
   * The role picked under Access for the key being created. Read when the
   * form is submitted and used once the key exists; cleared as it is used,
   * so a later key never inherits it.
   */
  const pendingAccess: MutableRefObject<PendingAccess> =
    useRef<PendingAccess>(NO_ACCESS);

  const [accessNotice, setAccessNotice] = useState<AccessNotice | null>(null);

  type GetApiKeyRouteFunction = (apiKeyId: ObjectID) => Route;

  const getApiKeyRoute: GetApiKeyRouteFunction = (
    apiKeyId: ObjectID,
  ): Route => {
    return RouteUtil.populateRouteParams(
      RouteMap[PageMap.SETTINGS_APIKEY_VIEW] as Route,
      { modelId: apiKeyId },
    );
  };

  return (
    <Fragment>
      {accessNotice && (
        <RoleAccessNotice
          holder={RoleAccessHolder.ApiKey}
          name={accessNotice.apiKeyName}
          error={accessNotice.error}
          onOpen={() => {
            Navigation.navigate(getApiKeyRoute(accessNotice.apiKeyId));
          }}
          onClose={() => {
            setAccessNotice(null);
          }}
        />
      )}
      <ModelTable<ApiKey>
        modelType={ApiKey}
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        id="api-keys-table"
        name="Settings > API Keys"
        userPreferencesKey="api-keys-table"
        saveFilterProps={{
          tableId: "settings-api-keys-table",
        }}
        isDeleteable={true}
        isEditable={false}
        showViewIdButton={false}
        isCreateable={true}
        isViewable={true}
        cardProps={{
          title: "API Keys",
          description:
            "Everything you can do on the dashboard can also be done via the OneUptime API- use it to automate repetitive work or integrate with other platforms.",
        }}
        noItemsMessage={"No API Keys found."}
        formFields={createFormFields}
        onBeforeCreate={async (
          item: ApiKey,
          _miscDataProps: JSONObject,
          formValues: JSONObject,
        ): Promise<ApiKey> => {
          pendingAccess.current = {
            role: getRoleAccessRole(formValues[ROLE_ACCESS_FIELD_KEY]),
            customRoleId: getRoleAccessCustomRoleId(
              formValues[ROLE_ACCESS_FIELD_KEY],
            ),
          };

          return item;
        }}
        onCreateSuccess={async (
          createdApiKey: ApiKey,
          modalType?: ModalType,
        ): Promise<ApiKey> => {
          const access: PendingAccess = pendingAccess.current;
          pendingAccess.current = NO_ACCESS;
          const role: Permission | null = access.role;

          if (modalType !== ModalType.Create || !createdApiKey.id) {
            return createdApiKey;
          }

          const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

          if ((role || access.customRoleId) && projectId) {
            try {
              if (access.customRoleId) {
                await giveApiKeyCustomRoleAccess({
                  apiKeyId: createdApiKey.id,
                  projectId: projectId,
                  customRoleId: new ObjectID(access.customRoleId),
                });
              } else if (role) {
                await giveRoleAccess({
                  holder: RoleAccessHolder.ApiKey,
                  holderId: createdApiKey.id,
                  projectId: projectId,
                  role: role,
                });
              }
            } catch (err) {
              /*
               * The key exists and stays: say so, say why it has no access,
               * and point at its page, where a role is one click.
               */
              setAccessNotice({
                apiKeyId: createdApiKey.id,
                apiKeyName: createdApiKey.name || "",
                error: API.getFriendlyMessage(err),
              });

              return createdApiKey;
            }
          }

          setAccessNotice(null);

          /*
           * A new key opens on its page: the key to copy is there, and so is
           * its access - the role just picked, or nothing yet and Add Role.
           */
          Navigation.navigate(getApiKeyRoute(createdApiKey.id));

          return createdApiKey;
        }}
        showRefreshButton={true}
        searchableFields={["name", "description"]}
        viewPageRoute={Navigation.getCurrentRoute()}
        filters={[
          {
            field: {
              name: true,
            },
            type: FieldType.Text,
            title: "Name",
          },
          {
            field: {
              description: true,
            },
            type: FieldType.Text,
            title: "Description",
          },
          {
            field: {
              expiresAt: true,
            },
            type: FieldType.Date,
            title: "Expires",
          },
        ]}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: {
              description: true,
            },
            noValueMessage: "-",
            title: "Description",
            type: FieldType.LongText,
          },
          {
            field: {
              expiresAt: true,
            },
            title: "Expires",
            type: FieldType.Date,
          },
        ]}
      />
    </Fragment>
  );
};

// The keys a project below the plan still has: stopped, and each can be deleted.
const ApiKeysLeftover: FunctionComponent = (): ReactElement => {
  return (
    <PlanLeftoverTable<ApiKey>
      modelType={ApiKey}
      id="api-keys"
      query={{
        projectId: ProjectUtil.getCurrentProjectId()!,
      }}
      requiredPlan={API_KEY_REQUIRED_PLAN}
      title={PlanLeftoverTitle.apiKeys}
      columns={[
        {
          field: {
            name: true,
          },
          title: "Name",
          type: FieldType.Text,
        },
        {
          field: {
            expiresAt: true,
          },
          title: "Expires",
          type: FieldType.Date,
        },
      ]}
    />
  );
};

/*
 * API keys are sold on the Growth plan, and a project's keys stop working
 * when it drops below it - every request made with one is refused until the
 * project is back on the plan (Common/Types/Billing/PlanCutoffCredentials).
 * Below the plan this page is the plan note with the keys the project still
 * has under it, saying they stopped, so one can always be deleted whatever
 * the plan (PlanLeftoverPage); on the plan, and with billing off, it is the
 * page.
 */
const APIKeysPage: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return (
    <PlanLeftoverPage
      requiredPlan={API_KEY_REQUIRED_PLAN}
      leftovers={<ApiKeysLeftover />}
    >
      <APIKeys {...props} />
    </PlanLeftoverPage>
  );
};

export default APIKeysPage;
