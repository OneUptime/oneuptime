import {
  ApiKeyRoleCoverage,
  EVERY_API_KEY_HAS_ROLE_TOOLTIP,
  getGiveRoleToApiKeyDescription,
  getRoleApiKeysCardDescription,
  getRoleRemoveFromApiKeySentence,
  NO_API_KEY_IN_PROJECT_DESCRIPTION,
  NO_API_KEY_IN_PROJECT_TITLE,
  NO_API_KEY_IN_PROJECT_TOOLTIP,
} from "@oneuptime/dashboard/Components/CustomRole/CustomRoleCopy";
import {
  getApiKeyRoleCoverage,
  loadApiKeyIdsGivenCustomRole,
  loadCustomRoleGrants,
} from "@oneuptime/dashboard/Components/CustomRole/CustomRoleOptions";
import { CUSTOM_ROLES_CARD_PLACE } from "@oneuptime/dashboard/Components/CustomRole/CustomRolesFold";
import AppLink from "@oneuptime/dashboard/Components/AppLink/AppLink";
import PageMap from "@oneuptime/dashboard/Utils/PageMap";
import RouteMap, { RouteUtil } from "@oneuptime/dashboard/Utils/RouteMap";
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
import EmptyStateOptions from "Common/UI/Components/ModelTable/EmptyStateOptions";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import FieldType from "Common/UI/Components/Types/FieldType";
import { TeamPermissionGrant } from "Common/UI/Utils/GrantablePermission";
import { getRouteToPageAnchor } from "Common/UI/Utils/PageAnchor";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
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
 * Giving the role hands the key everything in it but what the role scopes
 * to resources someone owns (a key owns nothing), so the server weighs it as
 * giving the key each of those permissions directly: a role holding a
 * permission the user can't give is refused, in words that name it.
 *
 * The card and the Give dialog say what a key gets from this role: all of
 * it, or - for a role with a permission scoped to "Only resources they
 * own", as its Permissions card shows it - how many of its permissions, and
 * why not the rest. Read again whenever the role's permissions change
 * (permissionsChangeToggle), so the words follow an edit of a scope.
 *
 * Give to an API Key is off, saying why, when no key could take the role:
 * every key has it, or the project has no key yet - then the empty card
 * says so too, with a link to the API Keys page, where keys are made. An
 * open dialog with an empty "No options." list was a dead end.
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
  // Changes whenever the role's permissions are read again.
  permissionsChangeToggle?: number | undefined;
  /*
   * With a lapsed Enterprise license, or one that leaves custom roles out,
   * the role cannot be given to another key, and can still be taken from
   * one.
   */
  isReadOnly?: boolean | undefined;
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
  // Null until read, and when it can't be: the keys are then not judged.
  const [givenApiKeyCount, setGivenApiKeyCount] = useState<number | null>(null);
  // How many keys the project has; null until read, or when it can't be.
  const [apiKeyCount, setApiKeyCount] = useState<number | null>(null);
  // How much of the role a key holds; null while unknown.
  const [coverage, setCoverage] = useState<ApiKeyRoleCoverage | null>(null);

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
        setGivenApiKeyCount(ids.size);
      })
      .catch(() => {
        // Then every key is offered, and the server refuses one that has it.
        setGivenApiKeyIds([]);
        setGivenApiKeyCount(null);
      });
  }, [
    refreshToggle,
    givenApiKeysToggle,
    mayReadApiKeys,
    props.customRoleId.toString(),
  ]);

  useEffect(() => {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (!projectId || !mayReadApiKeys) {
      return;
    }

    ModelAPI.count<ApiKey>({
      modelType: ApiKey,
      query: {
        projectId: projectId,
      },
    })
      .then((count: number) => {
        setApiKeyCount(count);
      })
      .catch(() => {
        // Then Give to an API Key stays on, and its list says what it has.
        setApiKeyCount(null);
      });
  }, [mayReadApiKeys]);

  useEffect(() => {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (!projectId || !mayReadApiKeys) {
      return;
    }

    loadCustomRoleGrants({
      projectId: projectId,
      customRoleId: props.customRoleId,
    })
      .then((grants: Map<string, Array<TeamPermissionGrant>>) => {
        const roleGrants: Array<TeamPermissionGrant> = [];

        for (const permissions of grants.values()) {
          roleGrants.push(...permissions);
        }

        setCoverage(getApiKeyRoleCoverage(roleGrants));
      })
      .catch(() => {
        // Then the card says what it always said.
        setCoverage(null);
      });
  }, [
    mayReadApiKeys,
    props.customRoleId.toString(),
    props.permissionsChangeToggle,
  ]);

  if (!mayReadApiKeys) {
    return <></>;
  }

  const apiKeyQuery: Query<ApiKey> = {};

  if (givenApiKeyIds.length > 0) {
    apiKeyQuery._id = new IncludesNone(givenApiKeyIds);
  }

  // The project has no key at all: there is nothing to give the role to.
  const hasNoApiKey: boolean = apiKeyCount === 0;

  // Every key the reader can see has the role already.
  const hasEveryApiKeyTheRole: boolean =
    apiKeyCount !== null &&
    apiKeyCount > 0 &&
    givenApiKeyCount !== null &&
    givenApiKeyCount >= apiKeyCount;

  const getGiveTooltip: () => string | undefined = (): string | undefined => {
    if (hasNoApiKey) {
      return NO_API_KEY_IN_PROJECT_TOOLTIP;
    }

    if (hasEveryApiKeyTheRole) {
      return EVERY_API_KEY_HAS_ROLE_TOOLTIP;
    }

    return undefined;
  };

  // Locked, with the missing permission as the tooltip, as ModelTable locks its own Create.
  const giveButton: CardButtonSchema | null = PermissionGate.gateCardButton(
    {
      title: "Give to an API Key",
      // NORMAL with the Add icon, so the empty table repeats it as its way on.
      icon: IconProp.Add,
      buttonStyle: ButtonStyleType.NORMAL,
      disabled: hasNoApiKey || hasEveryApiKeyTheRole,
      tooltip: getGiveTooltip(),
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

  /*
   * A key's page, opened at its Custom Roles card: the card is in the key's
   * More settings, which a link to it opens there - so a key named here
   * lands on the role that names it, not on a folded section.
   */
  const getApiKeyRoute: (apiKeyId: string) => Route = (
    apiKeyId: string,
  ): Route => {
    return getRouteToPageAnchor(
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.SETTINGS_APIKEY_VIEW] as Route,
        { modelId: new ObjectID(apiKeyId) },
      ),
      CUSTOM_ROLES_CARD_PLACE,
    );
  };

  /*
   * A project with no key yet: the way on is to make one, on the API Keys
   * page - not a Give button whose list would be empty.
   */
  const noApiKeyEmptyState: EmptyStateOptions | undefined = hasNoApiKey
    ? {
        title: NO_API_KEY_IN_PROJECT_TITLE,
        description: (
          <TranslatedSentence
            template={NO_API_KEY_IN_PROJECT_DESCRIPTION}
            slots={{
              apiKeys: (
                <AppLink
                  className="font-medium text-indigo-600 hover:underline"
                  to={RouteUtil.populateRouteParams(
                    RouteMap[PageMap.SETTINGS_APIKEYS] as Route,
                  )}
                >
                  {translator.translateText("API Keys") || ""}
                </AppLink>
              ),
            }}
          />
        ),
        hideCreateButton: true,
      }
    : undefined;

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
            description: getRoleApiKeysCardDescription(translator, coverage),
            buttons: giveButton && !props.isReadOnly ? [giveButton] : [],
          }}
          noItemsMessage="No API key has this role yet. Give it to a key to let the key do what the role allows."
          emptyState={noApiKeyEmptyState}
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
              // The key's name says what each card is.
              hideTitleOnMobile: true,
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
          description={getGiveRoleToApiKeyDescription(translator, coverage)}
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
