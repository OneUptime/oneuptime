import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  ROLE_ACCESS_FIELD_KEY,
  RoleAccessHolder,
  getRoleAccessOptionsForCurrentUser,
  getRoleAccessRole,
  giveRoleAccess,
} from "../../Components/Permission/RoleAccess";
import RoleAccessNotice from "../../Components/Permission/RoleAccessNotice";
import { getApiKeyCreateFormFields } from "../../Components/ApiKey/ApiKeyCreateForm";
import Route from "Common/Types/API/Route";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import { ModalType } from "Common/UI/Components/ModelTable/BaseModelTable";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
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

const APIKeys: FunctionComponent<PageComponentProps> = (): ReactElement => {
  /*
   * Name, Access and, folded under Advanced, the description and the expiry
   * date - a year from today (Components/ApiKey/ApiKeyCreateForm). Built
   * once: the Access cards are the roles this user may hand on.
   */
  const createFormFields: Array<ModelField<ApiKey>> = useMemo((): Array<
    ModelField<ApiKey>
  > => {
    return getApiKeyCreateFormFields({
      accessOptions: getRoleAccessOptionsForCurrentUser(
        RoleAccessHolder.ApiKey,
      ),
    });
  }, []);

  /*
   * The role picked under Access for the key being created. Read when the
   * form is submitted and used once the key exists; cleared as it is used,
   * so a later key never inherits it.
   */
  const pendingAccessRole: MutableRefObject<Permission | null> =
    useRef<Permission | null>(null);

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
        isDeleteable={false}
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
          pendingAccessRole.current = getRoleAccessRole(
            formValues[ROLE_ACCESS_FIELD_KEY],
          );

          return item;
        }}
        onCreateSuccess={async (
          createdApiKey: ApiKey,
          modalType?: ModalType,
        ): Promise<ApiKey> => {
          const role: Permission | null = pendingAccessRole.current;
          pendingAccessRole.current = null;

          if (modalType !== ModalType.Create || !createdApiKey.id) {
            return createdApiKey;
          }

          const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

          if (role && projectId) {
            try {
              await giveRoleAccess({
                holder: RoleAccessHolder.ApiKey,
                holderId: createdApiKey.id,
                projectId: projectId,
                role: role,
              });
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
