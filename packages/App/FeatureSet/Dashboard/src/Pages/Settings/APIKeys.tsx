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
import ApiKeyHint from "../../Components/ApiKey/ApiKeyHint";
import {
  API_KEY_SHOWN_ONCE_TEST_ID,
  API_KEY_SHOWN_ONCE_VALUE_TEST_ID,
  ApiKeyShownOnceCopy,
} from "../../Components/ApiKey/ApiKeyShownOnceCopy";
import { getApiKeyRolePermissionCountText } from "../../Components/CustomRole/CustomRoleCopy";
import {
  CustomRoleSummary,
  getApiKeyRoleGrants,
  getCustomRoleCardSelectOption,
  loadCustomRoleGrants,
  loadCustomRoles,
} from "../../Components/CustomRole/CustomRoleOptions";
import Route from "Common/Types/API/Route";
import { getKeyShownOnCreate } from "Common/Types/ApiKey/ApiKeyShownOnce";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import { CardSelectOption } from "Common/UI/Components/CardSelect/CardSelect";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import { ModalType } from "Common/UI/Components/ModelTable/BaseModelTable";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import ShownOnceSecretModal from "Common/UI/Components/ShownOnceSecret/ShownOnceSecretModal";
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
import {
  CUSTOM_ROLES_REQUIRED_PLAN,
  isEnterpriseFeatureEligible,
} from "../../Enterprise/EnterpriseEligibility";
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

/*
 * A key just created, shown once (#8902): the create's answer is the only
 * time the server sends it. Where the page goes once Done is pressed is
 * decided with it: the key's page, or nowhere when a notice says the key has
 * no access yet.
 */
interface CreatedKey {
  apiKeyId: ObjectID;
  key: string;
  opensItsPage: boolean;
}

const APIKeys: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const translator: Translator = useTranslator();

  /*
   * The project's custom roles this user could give a key - every
   * permission of each that a key would hold being one they may hand on,
   * and at least one that a key holds (not every one limited to what
   * someone owns) - as Access cards. Read once, after the page opens: null
   * until then, and none for someone who may not read them. Giving a custom
   * role is an Enterprise feature, so none either where the project may not
   * use custom roles (the Community Edition, or OneUptime Cloud below the
   * plan): the server would refuse the key the role.
   */
  const [customRoleOptions, setCustomRoleOptions] =
    useState<Array<CardSelectOption> | null>(null);

  useEffect(() => {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (
      !projectId ||
      !isEnterpriseFeatureEligible(CUSTOM_ROLES_REQUIRED_PLAN)
    ) {
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

  // The key just created, until Done: then it is forgotten.
  const [createdKey, setCreatedKey] = useState<CreatedKey | null>(null);

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
      {/*
       * SHOWN ONCE. The key is stored as its hash, so this is the one time
       * anyone sees it: Done is the only way out, and then the key's page
       * opens - unless a notice says the key has no access yet.
       */}
      {createdKey ? (
        <ShownOnceSecretModal
          title={ApiKeyShownOnceCopy.shownOnceTitle}
          description={ApiKeyShownOnceCopy.shownOnceDescription}
          doneButtonText={ApiKeyShownOnceCopy.done}
          secret={createdKey.key}
          onDone={() => {
            const opened: CreatedKey = createdKey;

            setCreatedKey(null);

            if (opened.opensItsPage) {
              Navigation.navigate(getApiKeyRoute(opened.apiKeyId));
            }
          }}
          dataTestId={API_KEY_SHOWN_ONCE_TEST_ID}
          valueTestId={API_KEY_SHOWN_ONCE_VALUE_TEST_ID}
        />
      ) : (
        <></>
      )}
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
        noItemsMessage={"No API keys yet."}
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

          /*
           * The key itself, which the create's answer holds and nothing will
           * hold again: shown once, before the page moves on.
           */
          const key: string | null = getKeyShownOnCreate(createdApiKey.apiKey);
          const newKeyId: ObjectID = createdApiKey.id;

          const showKeyOnce: (opensItsPage: boolean) => boolean = (
            opensItsPage: boolean,
          ): boolean => {
            if (!key) {
              return false;
            }

            setCreatedKey({
              apiKeyId: newKeyId,
              key: key,
              opensItsPage: opensItsPage,
            });

            return true;
          };

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

              // The key first, then the notice under it: it stays on the list.
              showKeyOnce(false);

              return createdApiKey;
            }
          }

          setAccessNotice(null);

          /*
           * A new key is shown once, then opens on its page: its access is
           * there - the role just picked, or nothing yet and Add Role - and
           * how the key ends. An answer that held no key opens the page at
           * once, where Reset API Key makes one to copy.
           */
          if (!showKeyOnce(true)) {
            Navigation.navigate(getApiKeyRoute(createdApiKey.id));
          }

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
          {
            /*
             * How each key ends, so a person can tell the key they hold
             * among the project's keys: the key itself is shown only once.
             */
            field: {
              apiKeyHint: true,
            },
            title: "API Key",
            type: FieldType.Element,
            getElement: (item: ApiKey): ReactElement => {
              return <ApiKeyHint hint={item.apiKeyHint} isSmall={true} />;
            },
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
