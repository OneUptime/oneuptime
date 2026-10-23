import { getRoleRemoveFromApiKeySentence } from "./CustomRoleCopy";
import { loadApiKeyIdsGivenCustomRole } from "./CustomRoleOptions";
import AppLink from "../AppLink/AppLink";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import ApiKey from "Common/Models/DatabaseModels/ApiKey";
import ApiKeyCustomRole from "Common/Models/DatabaseModels/ApiKeyCustomRole";
import Route from "Common/Types/API/Route";
import IncludesNone from "Common/Types/BaseDatabase/IncludesNone";
import Query from "Common/Types/BaseDatabase/Query";
import BadDataException from "Common/Types/Exception/BadDataException";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { CardButtonSchema } from "Common/UI/Components/Card/Card";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import {
  DeleteConfirmation,
  ModalTableBulkDefaultActions,
} from "Common/UI/Components/ModelTable/BaseModelTable";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * THE API KEYS A CUSTOM ROLE IS GIVEN TO, on the role's page under the
 * teams given it: each key links to its page, Give to an API Key adds one,
 * Remove takes the role from one - from several at once in the bulk bar.
 * Give to an API Key offers only the keys that do not have the role.
 *
 * Giving the role hands the key everything in it but what the role limits
 * to resources someone owns (a key owns nothing), so the server weighs it as
 * giving the key each of those permissions directly: a role holding a
 * permission the user can't give is refused, in words that name it.
 *
 * Shown only to someone who may read the project's API keys: a change to
 * the role reaches the keys too, and the role's page says how many
 * (CustomRoleReach) - but who may change roles need not see the keys.
 */

export interface ComponentProps {
  customRoleId: ObjectID;
  roleName: string;
  // After a key is given the role or has it taken away.
  onApiKeysChange?: (() => void) | undefined;
}

export const CUSTOM_ROLE_API_KEYS_TEST_ID: string = "custom-role-api-keys";

const CustomRoleApiKeysTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isGiving, setIsGiving] = useState<boolean>(false);
  const [refreshToggle, setRefreshToggle] = useState<string>("");
  // The keys that have the role: Give to an API Key offers the others.
  const [givenApiKeyIds, setGivenApiKeyIds] = useState<Array<string>>([]);
  const [givenApiKeysToggle, setGivenApiKeysToggle] = useState<number>(0);

  const mayReadApiKeys: boolean = PermissionGate.check(
    new ApiKeyCustomRole(),
    ModelAction.Read,
  ).isAllowed;

  useEffect(() => {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (!projectId || !mayReadApiKeys) {
      return;
    }

    loadApiKeyIdsGivenCustomRole({
      customRoleId: props.customRoleId,
      projectId: projectId,
    })
      .then((ids: Set<string>) => {
        setGivenApiKeyIds(Array.from(ids));
      })
      .catch(() => {
        // Then every key is offered, and the server refuses one that has it.
        setGivenApiKeyIds([]);
      });
  }, [
    refreshToggle,
    givenApiKeysToggle,
    mayReadApiKeys,
    props.customRoleId.toString(),
  ]);

  if (!mayReadApiKeys) {
    return <></>;
  }

  const apiKeyQuery: Query<ApiKey> = {};

  if (givenApiKeyIds.length > 0) {
    apiKeyQuery._id = new IncludesNone(givenApiKeyIds);
  }

  // Locked, with the missing permission as the tooltip, as ModelTable locks its own Create.
  const giveButton: CardButtonSchema | null = PermissionGate.gateCardButton(
    {
      title: "Give to an API Key",
      // NORMAL with the Add icon, so the empty table repeats it as its way on.
      icon: IconProp.Add,
      buttonStyle: ButtonStyleType.NORMAL,
      onClick: () => {
        setIsGiving(true);
      },
    },
    new ApiKeyCustomRole(),
    ModelAction.Create,
  );

  const giveTitle: string = props.roleName
    ? translator.translateTemplate("Give {{role}} to an API Key", {
        role: props.roleName,
      })
    : translator.translateText("Give this role to an API key") ||
      "Give this role to an API key";

  const getApiKeyRoute: (apiKeyId: string) => Route = (
    apiKeyId: string,
  ): Route => {
    return RouteUtil.populateRouteParams(
      RouteMap[PageMap.SETTINGS_APIKEY_VIEW] as Route,
      { modelId: new ObjectID(apiKeyId) },
    );
  };

  return (
    <Fragment>
      <div data-testid={CUSTOM_ROLE_API_KEYS_TEST_ID}>
        <ModelTable<ApiKeyCustomRole>
          modelType={ApiKeyCustomRole}
          id="table-custom-role-api-keys"
          userPreferencesKey="custom-role-api-keys-table"
          name="Teams > Role > API Keys"
          isDeleteable={true}
          isEditable={false}
          isCreateable={false}
          isViewable={false}
          singularName="API Key"
          pluralName="API Keys"
          deleteButtonText="Remove"
          refreshToggle={refreshToggle}
          query={{
            customRoleId: props.customRoleId,
            projectId: ProjectUtil.getCurrentProjectId()!,
          }}
          cardProps={{
            title: "API Keys with this Role",
            description: "These API keys can do everything this role allows.",
            buttons: giveButton ? [giveButton] : [],
          }}
          noItemsMessage="No API key has this role yet. Give it to a key to let the key do what the role allows."
          onItemDeleted={() => {
            setGivenApiKeysToggle((count: number): number => {
              return count + 1;
            });
            props.onApiKeysChange?.();
          }}
          getDeleteConfirmation={async (
            item: ApiKeyCustomRole,
          ): Promise<DeleteConfirmation> => {
            return {
              title: translator.translateTemplate(
                "Remove {{role}} from {{apiKey}}",
                {
                  role: props.roleName,
                  apiKey: item.apiKey?.name || "",
                },
              ),
              description: getRoleRemoveFromApiKeySentence(translator, {
                roleName: props.roleName,
                apiKeyName: item.apiKey?.name || "",
              }),
              submitButtonText: "Remove",
            };
          }}
          bulkActions={{
            buttons: [ModalTableBulkDefaultActions.Delete],
            deleteVerb: "Remove",
            deleteIcon: IconProp.Minus,
            // Looked up where the dialog draws it (BaseModelTable).
            deleteConfirmationWarning: translationKey(
              "Only this role is taken from them: the keys stay, with their other roles and permissions.",
            ),
          }}
          showRefreshButton={true}
          viewPageRoute={Navigation.getCurrentRoute()}
          filters={[]}
          selectMoreFields={{
            apiKeyId: true,
          }}
          columns={[
            {
              field: {
                apiKey: {
                  name: true,
                },
              },
              title: "API Key",
              type: FieldType.Element,
              wrapContent: true,
              wrapMaxWidthClassName: "max-w-xl",
              getElement: (item: ApiKeyCustomRole): ReactElement => {
                const apiKeyId: string = item.apiKeyId?.toString() || "";

                if (!apiKeyId) {
                  return <></>;
                }

                return (
                  <AppLink
                    className="font-medium text-gray-900 hover:underline break-words"
                    to={getApiKeyRoute(apiKeyId)}
                  >
                    <span>{item.apiKey?.name || ""}</span>
                  </AppLink>
                );
              },
            },
          ]}
        />
      </div>

      {isGiving ? (
        <ModelFormModal<ApiKeyCustomRole>
          title={giveTitle}
          name="Give a custom role to an API key"
          description="From now on the key can do everything this role allows, except what it limits to resources someone owns."
          modelType={ApiKeyCustomRole}
          submitButtonText="Give to API Key"
          onClose={() => {
            setIsGiving(false);
          }}
          onSuccess={() => {
            setIsGiving(false);
            setRefreshToggle(new Date().toISOString());
            props.onApiKeysChange?.();
          }}
          onBeforeCreate={async (
            item: ApiKeyCustomRole,
          ): Promise<ApiKeyCustomRole> => {
            const projectId: ObjectID | null =
              ProjectUtil.getCurrentProjectId();

            if (!projectId) {
              throw new BadDataException("Project ID cannot be null");
            }

            item.customRoleId = props.customRoleId;
            item.projectId = projectId;
            return item;
          }}
          formProps={{
            name: "Give a custom role to an API key",
            modelType: ApiKeyCustomRole,
            id: "give-custom-role-to-api-key-form",
            formType: FormType.Create,
            fields: [
              {
                field: {
                  apiKey: true,
                },
                title: "API Key",
                description:
                  "API keys that have this role already are not listed.",
                fieldType: FormFieldSchemaType.Dropdown,
                dropdownModal: {
                  type: ApiKey,
                  labelField: "name",
                  valueField: "_id",
                  query: apiKeyQuery,
                },
                required: true,
                placeholder: "Select an API key",
              },
            ],
          }}
        />
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default CustomRoleApiKeysTable;
