import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  API_KEY_ACCESS_FIELD_KEY,
  getApiKeyAccessOptionsForCurrentUser,
  getApiKeyAccessRole,
  giveApiKeyAccess,
} from "../../Components/ApiKey/ApiKeyAccess";
import { getApiKeyCreateFormFields } from "../../Components/ApiKey/ApiKeyCreateForm";
import Route from "Common/Types/API/Route";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import { ModalType } from "Common/UI/Components/ModelTable/BaseModelTable";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import ApiKey from "Common/Models/DatabaseModels/ApiKey";
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
  const translator: Translator = useTranslator();

  /*
   * Name, Access and, folded under Advanced, the description and the expiry
   * date - a year from today (Components/ApiKey/ApiKeyCreateForm). Built
   * once: the Access cards are the roles this user may hand on.
   */
  const createFormFields: Array<ModelField<ApiKey>> = useMemo((): Array<
    ModelField<ApiKey>
  > => {
    return getApiKeyCreateFormFields({
      accessOptions: getApiKeyAccessOptionsForCurrentUser(),
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
        <Alert
          type={AlertType.DANGER}
          dataTestId="api-key-access-notice"
          className="mb-5"
          strongTitle={translator.translateTemplate(
            "{{apiKeyName}} was created without access.",
            { apiKeyName: accessNotice.apiKeyName },
          )}
          title={accessNotice.error}
          textOnRight={translator.translateText(
            "Open the key to give it a role",
          )}
          onClick={() => {
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
          pendingAccessRole.current = getApiKeyAccessRole(
            formValues[API_KEY_ACCESS_FIELD_KEY],
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
              await giveApiKeyAccess({
                apiKeyId: createdApiKey.id,
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

export default APIKeys;
