import {
  isEnterpriseConfigurationReadOnly,
  LicensedFeature,
} from "../Identity/License/EnterpriseLicenseMode";
import useEnterpriseLicenseMode from "../Identity/License/UseEnterpriseLicenseMode";
import {
  CustomRoleSummary,
  getCustomRoleCardSelectOption,
  getOwnedPermissionCounts,
  loadCustomRoleGrants,
  loadCustomRoleIdsOfApiKey,
  loadCustomRoles,
} from "@oneuptime/dashboard/Components/CustomRole/CustomRoleOptions";
import {
  EVERY_ROLE_GIVEN_TO_API_KEY_TOOLTIP,
  getAddRoleToApiKeyDescription,
  getApiKeyOwnedScopeReason,
  getApiKeyRolePermissionCountText,
  getRoleRemoveFromApiKeySentence,
  TemplatedSentence,
} from "@oneuptime/dashboard/Components/CustomRole/CustomRoleCopy";
import AppLink from "@oneuptime/dashboard/Components/AppLink/AppLink";
import RolesPageLink from "./RolesPageLink";
import PageMap from "@oneuptime/dashboard/Utils/PageMap";
import RouteMap, { RouteUtil } from "@oneuptime/dashboard/Utils/RouteMap";
import ApiKeyCustomRole from "Common/Models/DatabaseModels/ApiKeyCustomRole";
import Route from "Common/Types/API/Route";
import BadDataException from "Common/Types/Exception/BadDataException";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { TeamPermissionGrant } from "Common/UI/Utils/GrantablePermission";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { CardButtonSchema } from "Common/UI/Components/Card/Card";
import { CardSelectOption } from "Common/UI/Components/CardSelect/CardSelect";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import {
  DeleteConfirmation,
  ModalTableBulkDefaultActions,
} from "Common/UI/Components/ModelTable/BaseModelTable";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import InfoTooltip from "Common/UI/Components/Tooltip/InfoTooltip";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
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
 * AN API KEY'S CUSTOM ROLES, on its page above what it was given directly:
 * "Incident Responder - 6 permissions", each a link to the role - as a
 * team's Permissions page lists the team's (TeamCustomRoleTable).
 *
 * Add Custom Role picks one of the project's roles from cards that say how
 * many of its permissions the key would hold; Remove takes it away. The key
 * can do everything a role allows, and a change to the role changes the key
 * with it - so the role's permissions are changed on the role's page, never
 * here. A permission the role scopes to what someone owns gives a key
 * nothing - a key owns nothing - and the role's line says how many of its
 * permissions apply to the key when that is not all of them, with an (i)
 * that says why in the words the role's Scope column uses ("Only resources
 * they own"). The dialog says it too, only when a role it offers has such a
 * permission.
 *
 * On a phone each role is a card of its own, its name on top: the column's
 * title over every card ("Role") said nothing the name does not.
 *
 * Only shown once the project has a custom role the reader may see: a
 * project that never makes one sees the key's page exactly as before. The
 * dialog is the card's own ("Add a Custom Role"), not the table's create
 * form, whose title would read "Add New Custom Role" - as if a role were
 * made here.
 *
 * Custom roles are an Enterprise feature: this is the Enterprise card, and
 * core keeps the slot on the key's page (Components/ApiKey
 * /ApiKeyCustomRolesSettings). With a lapsed license, or one that leaves
 * custom roles out, no role can be given to the key; the roles it has keep
 * applying and can still be taken away.
 */

export interface ComponentProps {
  apiKeyId: ObjectID;
}

export const API_KEY_CUSTOM_ROLES_TEST_ID: string = "api-key-custom-roles";

// The (i) beside a role that gives the key only part of itself.
export const API_KEY_ROLE_OWNED_REASON_TEST_ID: string =
  "api-key-role-owned-reason";

const ApiKeyCustomRoleTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const isReadOnly: boolean = isEnterpriseConfigurationReadOnly(
    useEnterpriseLicenseMode(LicensedFeature.CustomRoles),
  );
  const [roles, setRoles] = useState<Array<CustomRoleSummary> | null>(null);
  const [isAdding, setIsAdding] = useState<boolean>(false);
  const [refreshToggle, setRefreshToggle] = useState<string>("");
  // The roles the key has: Add Custom Role offers the others.
  const [givenRoleIds, setGivenRoleIds] = useState<Set<string>>(
    new Set<string>(),
  );
  // How many of each role's permissions give a key nothing, by role id.
  const [ownedCounts, setOwnedCounts] = useState<Map<string, number>>(
    new Map<string, number>(),
  );

  useEffect(() => {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (!projectId) {
      return;
    }

    loadCustomRoleIdsOfApiKey({
      apiKeyId: props.apiKeyId,
      projectId: projectId,
    })
      .then((ids: Set<string>) => {
        setGivenRoleIds(ids);
      })
      .catch(() => {
        // Then every role is offered, and the server refuses one the key has.
        setGivenRoleIds(new Set<string>());
      });
  }, [refreshToggle, props.apiKeyId.toString()]);

  useEffect(() => {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (!projectId) {
      setRoles([]);
      return;
    }

    loadCustomRoles({ projectId: projectId })
      .then((loaded: Array<CustomRoleSummary>) => {
        setRoles(loaded);
      })
      .catch(() => {
        // Roles the reader may not read are roles this card can't offer.
        setRoles([]);
      });

    loadCustomRoleGrants({ projectId: projectId })
      .then((grants: Map<string, Array<TeamPermissionGrant>>) => {
        setOwnedCounts(getOwnedPermissionCounts(grants));
      })
      .catch(() => {
        // Then each role's line says how many permissions it holds.
        setOwnedCounts(new Map<string, number>());
      });
  }, []);

  if (!roles || roles.length === 0) {
    return <></>;
  }

  const getOwnedCount: (customRoleId: string) => number = (
    customRoleId: string,
  ): number => {
    return ownedCounts.get(customRoleId.toLowerCase()) || 0;
  };

  const offeredRoles: Array<CustomRoleSummary> = roles.filter(
    (role: CustomRoleSummary): boolean => {
      return !givenRoleIds.has(role.id.toLowerCase());
    },
  );

  // Whether a role on offer would give the key only part of itself.
  const isAnyOfferedRolePartlyOwned: boolean = offeredRoles.some(
    (role: CustomRoleSummary): boolean => {
      return getOwnedCount(role.id) > 0;
    },
  );

  // Add a Custom Role's words, with the Roles page drawn as a link.
  const addRoleDescription: TemplatedSentence = getAddRoleToApiKeyDescription({
    isAnyOfferedRolePartlyOwned: isAnyOfferedRolePartlyOwned,
  });

  const roleOptions: Array<CardSelectOption> = offeredRoles.map(
    (role: CustomRoleSummary): CardSelectOption => {
      return getCustomRoleCardSelectOption(translator, role, {
        permissionsText: getApiKeyRolePermissionCountText(translator, {
          permissionCount: role.permissionCount,
          ownedCount: getOwnedCount(role.id),
        }),
      });
    },
  );

  const getRoleRoute: (customRoleId: string) => Route = (
    customRoleId: string,
  ): Route => {
    return RouteUtil.populateRouteParams(
      RouteMap[PageMap.TEAM_ROLE_VIEW] as Route,
      { modelId: new ObjectID(customRoleId) },
    );
  };

  // Locked, with the missing permission as the tooltip, as ModelTable locks its own Create.
  const addButton: CardButtonSchema | null = PermissionGate.gateCardButton(
    {
      title: "Add Custom Role",
      // NORMAL with the Add icon, so the empty table repeats it as its way on.
      icon: IconProp.Add,
      buttonStyle: ButtonStyleType.NORMAL,
      // Every role the project has is the key's already: nothing to add.
      disabled: roleOptions.length === 0,
      // The card's description just above links to the Roles page.
      tooltip:
        roleOptions.length === 0
          ? EVERY_ROLE_GIVEN_TO_API_KEY_TOOLTIP
          : undefined,
      onClick: () => {
        setIsAdding(true);
      },
    },
    new ApiKeyCustomRole(),
    ModelAction.Create,
  );

  return (
    <Fragment>
      <div data-testid={API_KEY_CUSTOM_ROLES_TEST_ID}>
        <ModelTable<ApiKeyCustomRole>
          modelType={ApiKeyCustomRole}
          id="table-api-key-custom-roles"
          userPreferencesKey="api-key-custom-roles-table"
          name="Settings > API Key > Custom Roles"
          isDeleteable={true}
          isEditable={false}
          isCreateable={false}
          isViewable={false}
          singularName="Custom Role"
          pluralName="Custom Roles"
          deleteButtonText="Remove"
          refreshToggle={refreshToggle}
          onItemDeleted={() => {
            setRefreshToggle(new Date().toISOString());
          }}
          query={{
            apiKeyId: props.apiKeyId,
            projectId: ProjectUtil.getCurrentProjectId()!,
          }}
          cardProps={{
            title: "Custom Roles",
            /*
             * Roles is a link: the page waits in the Teams menu's folded
             * Settings section, which nothing on a key's page leads to.
             */
            description: (
              <TranslatedSentence
                template="Named sets of permissions, made on the {{roles}} page. Changing a role changes this key too."
                slots={{
                  roles: <RolesPageLink />,
                }}
              />
            ),
            buttons: addButton && !isReadOnly ? [addButton] : [],
          }}
          noItemsMessage="This key has no custom role yet. Add one to give it everything the role allows."
          getDeleteConfirmation={async (
            item: ApiKeyCustomRole,
          ): Promise<DeleteConfirmation> => {
            return {
              title: translator.translateTemplate("Remove {{role}}", {
                role: item.customRole?.name || "",
              }),
              description: getRoleRemoveFromApiKeySentence(translator, {
                roleName: item.customRole?.name || "",
                apiKeyName: translator.translateText("This key") || "This key",
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
              "Only the roles are taken from this key: the roles stay, with every team and API key that has them.",
            ),
          }}
          showRefreshButton={true}
          viewPageRoute={Navigation.getCurrentRoute()}
          filters={[]}
          selectMoreFields={{
            customRoleId: true,
          }}
          columns={[
            {
              field: {
                customRole: {
                  name: true,
                  permissionCount: true,
                },
              },
              title: "Role",
              type: FieldType.Element,
              wrapContent: true,
              wrapMaxWidthClassName: "max-w-xl",
              // The role's name says what each card is.
              hideTitleOnMobile: true,
              getElement: (item: ApiKeyCustomRole): ReactElement => {
                const roleId: string = item.customRoleId?.toString() || "";
                const countText: string = getApiKeyRolePermissionCountText(
                  translator,
                  {
                    permissionCount: item.customRole?.permissionCount,
                    ownedCount: getOwnedCount(roleId),
                  },
                );

                return (
                  <div className="min-w-0">
                    <AppLink
                      className="font-medium text-gray-900 hover:underline break-words"
                      to={getRoleRoute(roleId)}
                    >
                      <span>{item.customRole?.name || ""}</span>
                    </AppLink>
                    <p className="flex items-center gap-1 text-sm text-gray-500">
                      <span>{countText}</span>
                      {/*
                       * Why the key holds less than the role: asked for
                       * where the count is, not said under every role.
                       */}
                      {getOwnedCount(roleId) > 0 &&
                      (item.customRole?.permissionCount || 0) > 0 ? (
                        <InfoTooltip
                          label="the permissions that apply to this key"
                          text={getApiKeyOwnedScopeReason(translator)}
                          dataTestId={API_KEY_ROLE_OWNED_REASON_TEST_ID}
                        />
                      ) : (
                        <></>
                      )}
                    </p>
                  </div>
                );
              },
            },
          ]}
        />
      </div>

      {isAdding ? (
        <ModelFormModal<ApiKeyCustomRole>
          title="Add a Custom Role"
          name="Add a custom role to an API key"
          // Roles is a link here too: the dialog sends people to make one.
          description={
            <TranslatedSentence
              template={addRoleDescription.template}
              values={addRoleDescription.values}
              slots={{
                roles: <RolesPageLink />,
              }}
            />
          }
          modelType={ApiKeyCustomRole}
          modalWidth={ModalWidth.Large}
          submitButtonText="Add Role"
          onClose={() => {
            setIsAdding(false);
          }}
          onSuccess={() => {
            setIsAdding(false);
            setRefreshToggle(new Date().toISOString());
          }}
          onBeforeCreate={async (
            item: ApiKeyCustomRole,
          ): Promise<ApiKeyCustomRole> => {
            const projectId: ObjectID | null =
              ProjectUtil.getCurrentProjectId();

            if (!projectId || !item.customRoleId) {
              throw new BadDataException("Pick a custom role.");
            }

            item.apiKeyId = props.apiKeyId;
            item.projectId = projectId;
            item.customRoleId = new ObjectID(item.customRoleId.toString());
            return item;
          }}
          formProps={{
            name: "Add a custom role to an API key",
            modelType: ApiKeyCustomRole,
            id: "add-custom-role-to-api-key-form",
            formType: FormType.Create,
            fields: [
              {
                field: {
                  customRoleId: true,
                },
                title: "Custom Role",
                description: "Roles this key has already are not listed.",
                fieldType: FormFieldSchemaType.CardSelect,
                cardSelectOptions: roleOptions,
                required: true,
                placeholder: "Select a custom role",
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

export default ApiKeyCustomRoleTable;
