import EnterpriseSettingLicenseNotice from "../EnterpriseSettings/EnterpriseSettingLicenseNotice";
import {
  EnterpriseLicenseMode,
  isEnterpriseConfigurationReadOnly,
  LicensedFeature,
} from "../Identity/License/EnterpriseLicenseMode";
import useEnterpriseLicenseMode from "../Identity/License/UseEnterpriseLicenseMode";
import PageComponentProps from "@oneuptime/dashboard/Pages/PageComponentProps";
import PageMap from "@oneuptime/dashboard/Utils/PageMap";
import RouteMap, { RouteUtil } from "@oneuptime/dashboard/Utils/RouteMap";
import {
  getPermissionCountText,
  getRoleDeleteReachSentence,
} from "@oneuptime/dashboard/Components/CustomRole/CustomRoleCopy";
import {
  addPermissionsToCustomRole,
  CUSTOM_ROLE_PERMISSIONS_FIELD_KEY,
  getCustomRoleCreateFormFields,
  getPickedRolePermissions,
  PermissionNotAdded,
} from "./CustomRoleCreateForm";
import CustomRoleCreateNotice from "./CustomRoleCreateNotice";
import {
  CustomRoleReachDetails,
  loadCustomRoleReach,
} from "@oneuptime/dashboard/Components/CustomRole/CustomRoleReach";
import CustomRole from "Common/Models/DatabaseModels/CustomRole";
import Route from "Common/Types/API/Route";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import DeleteConfirmationMessage from "Common/UI/Components/DeleteConfirmation/DeleteConfirmationMessage";
import { getDeleteConsequence } from "Common/UI/Components/DeleteConfirmation/DeleteConsequences";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import {
  DeleteConfirmation,
  ModalType,
} from "Common/UI/Components/ModelTable/BaseModelTable";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import GrantablePermission from "Common/UI/Utils/GrantablePermission";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
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
 * TEAMS > SETTINGS > ROLES: THE PROJECT'S CUSTOM ROLES.
 *
 * Custom roles are an Enterprise feature: this is the Enterprise page, and
 * core keeps the route (Pages/Teams/Roles.tsx), which draws the built-in
 * roles under it in every edition.
 *
 * A custom role names a set of permissions once - "Incident Responder",
 * "Team Lead" - so it is given to teams and API keys in one step, and
 * changed for every team and key that has it in one place. The page lists
 * the project's roles with how many permissions each holds, creates one
 * from a name and the built-in roles it bundles (CustomRoleCreateForm), and
 * opens each on its own page, where its permissions and the teams and keys
 * given it are.
 *
 * When the Enterprise license has lapsed or leaves custom roles out, a
 * notice says the roles keep applying, and Create is gone: the server
 * refuses new roles and changes, and still lets roles be deleted.
 *
 * Deleting a role says first who loses what: the teams it is given to and
 * the people on them, and the API keys it is given to (CustomRoleReach),
 * who lose its permissions at once.
 */

interface CreateNotice {
  roleId: ObjectID;
  roleName: string;
  notAdded: Array<PermissionNotAdded>;
}

const TeamRoles: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const licenseMode: EnterpriseLicenseMode = useEnterpriseLicenseMode(
    LicensedFeature.CustomRoles,
  );
  const isReadOnly: boolean = isEnterpriseConfigurationReadOnly(licenseMode);

  /*
   * Only the built-in roles this user could put into a role are offered, so
   * a pick is never refused once the role exists (CustomRoleCreateForm).
   */
  const formFields: Array<ModelField<CustomRole>> = useMemo(() => {
    return getCustomRoleCreateFormFields({
      canGrant: (permission: Permission): boolean => {
        return GrantablePermission.canCurrentUserGrant(permission);
      },
    });
  }, []);

  /*
   * The roles picked for the role being created. Read when the form is
   * submitted, used once the role exists, and cleared as they are used.
   */
  const pendingPermissions: MutableRefObject<Array<Permission>> = useRef<
    Array<Permission>
  >([]);

  const [notice, setNotice] = useState<CreateNotice | null>(null);

  const getRoleRoute: (roleId: ObjectID) => Route = (
    roleId: ObjectID,
  ): Route => {
    return RouteUtil.populateRouteParams(
      RouteMap[PageMap.TEAM_ROLE_VIEW] as Route,
      { modelId: roleId },
    );
  };

  return (
    <Fragment>
      <EnterpriseSettingLicenseNotice
        mode={licenseMode}
        feature={LicensedFeature.CustomRoles}
      />
      {notice && (
        <CustomRoleCreateNotice
          roleName={notice.roleName}
          notAdded={notice.notAdded}
          onOpen={() => {
            Navigation.navigate(getRoleRoute(notice.roleId));
          }}
          onClose={() => {
            setNotice(null);
          }}
        />
      )}
      <ModelTable<CustomRole>
        modelType={CustomRole}
        id="custom-roles-table"
        name="Teams > Settings > Roles"
        userPreferencesKey="custom-roles-table"
        isDeleteable={true}
        isEditable={false}
        isCreateable={!isReadOnly}
        isViewable={true}
        createVerb="Create"
        singularName="Custom Role"
        pluralName="Custom Roles"
        // "View Custom Role" on every row was the longest thing on it.
        viewButtonText={translationKey("View Role")}
        /*
         * What a custom role is. With no role yet the empty state says it
         * under "No custom roles yet", and the header leaves it out.
         */
        cardProps={{
          title: "Custom Roles",
          description:
            "A set of permissions you name once, such as Incident Responder, and give to teams and API keys. Changing a role changes every team and key that has it.",
        }}
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        formFields={formFields}
        onBeforeCreate={async (
          item: CustomRole,
          _miscDataProps: JSONObject,
          formValues: JSONObject,
        ): Promise<CustomRole> => {
          pendingPermissions.current = getPickedRolePermissions(
            formValues[CUSTOM_ROLE_PERMISSIONS_FIELD_KEY],
          );

          return item;
        }}
        onCreateSuccess={async (
          createdRole: CustomRole,
          modalType?: ModalType,
        ): Promise<CustomRole> => {
          const permissions: Array<Permission> = pendingPermissions.current;
          pendingPermissions.current = [];

          const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

          if (modalType !== ModalType.Create || !createdRole.id || !projectId) {
            return createdRole;
          }

          const notAdded: Array<PermissionNotAdded> =
            await addPermissionsToCustomRole({
              customRoleId: createdRole.id,
              projectId: projectId,
              permissions: permissions,
            });

          if (notAdded.length > 0) {
            /*
             * The role exists and stays: say which roles are missing from
             * it and why, and point at its page, where Add Role is.
             */
            setNotice({
              roleId: createdRole.id,
              roleName: createdRole.name || "",
              notAdded: notAdded,
            });

            return createdRole;
          }

          setNotice(null);

          // A new role opens on its page: its permissions, and Give to a Team.
          Navigation.navigate(getRoleRoute(createdRole.id));

          return createdRole;
        }}
        getDeleteConfirmation={async (
          item: CustomRole,
        ): Promise<DeleteConfirmation> => {
          const reach: CustomRoleReachDetails = await loadCustomRoleReach({
            customRoleId: item.id!,
            projectId: ProjectUtil.getCurrentProjectId()!,
          });

          return {
            description: (
              <DeleteConfirmationMessage
                kind="question"
                name={item.name || ""}
                typeLabel="Custom Role"
                warning={[
                  getDeleteConsequence("CustomRole", translator),
                  getRoleDeleteReachSentence(translator, reach),
                ]
                  .filter((sentence: string): boolean => {
                    return Boolean(sentence);
                  })
                  .join(" ")}
              />
            ),
          };
        }}
        showRefreshButton={true}
        searchableFields={["name"]}
        searchPlaceholder="Search roles by name..."
        viewPageRoute={RouteUtil.populateRouteParams(props.pageRoute)}
        filters={[]}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Element,
            // A role's name and description are prose: they wrap, and never push the counts off the card.
            wrapContent: true,
            wrapMaxWidthClassName: "max-w-xl",
            getElement: (item: CustomRole): ReactElement => {
              return (
                <div className="min-w-0">
                  <p className="font-medium text-gray-900 break-words">
                    {item.name}
                  </p>
                  {item.description ? (
                    <p className="mt-0.5 text-sm text-gray-500 break-words">
                      {item.description}
                    </p>
                  ) : (
                    <></>
                  )}
                </div>
              );
            },
          },
          {
            field: {
              permissionCount: true,
            },
            title: "Permissions",
            type: FieldType.Element,
            getElement: (item: CustomRole): ReactElement => {
              return (
                <p className="whitespace-nowrap text-gray-700">
                  {getPermissionCountText(translator, item.permissionCount)}
                </p>
              );
            },
          },
        ]}
        selectMoreFields={{
          description: true,
        }}
      />
    </Fragment>
  );
};

export default TeamRoles;
