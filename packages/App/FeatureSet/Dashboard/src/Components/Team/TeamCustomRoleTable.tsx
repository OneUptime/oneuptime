import {
  CustomRoleSummary,
  getCustomRoleCardSelectOption,
  loadCustomRoles,
} from "../CustomRole/CustomRoleOptions";
import {
  getPermissionCountText,
  getRoleRemoveFromTeamSentence,
} from "../CustomRole/CustomRoleCopy";
import AppLink from "../AppLink/AppLink";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import TeamCustomRole from "Common/Models/DatabaseModels/TeamCustomRole";
import Route from "Common/Types/API/Route";
import BadDataException from "Common/Types/Exception/BadDataException";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
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
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * A TEAM'S CUSTOM ROLES, on its Permissions page above what it was given
 * directly: "Incident Responder - 6 permissions", each a link to the role.
 *
 * Add Custom Role picks one of the project's roles from cards that say how
 * many permissions each holds; Remove takes it away. The team's members get
 * everything a role allows, and a change to the role changes the team with
 * it - so the role's permissions are changed on the role's page, never here.
 *
 * Only shown once the project has a custom role: a project that never makes
 * one sees the team's Permissions page exactly as before. The dialog is the
 * card's own ("Add a Custom Role"), not the table's create form, whose title
 * would read "Add New Custom Role" - as if a role were made here.
 */

export interface ComponentProps {
  teamId: ObjectID;
}

export const TEAM_CUSTOM_ROLES_TEST_ID: string = "team-custom-roles";

const TeamCustomRoleTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [roles, setRoles] = useState<Array<CustomRoleSummary> | null>(null);
  const [isAdding, setIsAdding] = useState<boolean>(false);
  const [refreshToggle, setRefreshToggle] = useState<string>("");

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
  }, []);

  if (!roles || roles.length === 0) {
    return <></>;
  }

  const roleOptions: Array<CardSelectOption> = roles.map(
    (role: CustomRoleSummary): CardSelectOption => {
      return getCustomRoleCardSelectOption(translator, role);
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
      onClick: () => {
        setIsAdding(true);
      },
    },
    new TeamCustomRole(),
    ModelAction.Create,
  );

  return (
    <Fragment>
      <div data-testid={TEAM_CUSTOM_ROLES_TEST_ID}>
        <ModelTable<TeamCustomRole>
          modelType={TeamCustomRole}
          id="table-team-custom-roles"
          userPreferencesKey="team-custom-roles-table"
          name="Teams > Team > Custom Roles"
          isDeleteable={true}
          isEditable={false}
          isCreateable={false}
          isViewable={false}
          singularName="Custom Role"
          pluralName="Custom Roles"
          deleteButtonText="Remove"
          refreshToggle={refreshToggle}
          query={{
            teamId: props.teamId,
            projectId: ProjectUtil.getCurrentProjectId()!,
          }}
          cardProps={{
            title: "Custom Roles",
            description:
              "Sets of permissions made on the Roles page. The team's members can do everything its roles allow, and a change to a role changes this team with it.",
            buttons: addButton ? [addButton] : [],
          }}
          noItemsMessage="This team has no custom role yet. Add one to give its members everything the role allows."
          getDeleteConfirmation={async (
            item: TeamCustomRole,
          ): Promise<DeleteConfirmation> => {
            return {
              title: translator.translateTemplate("Remove {{role}}", {
                role: item.customRole?.name || "",
              }),
              description: getRoleRemoveFromTeamSentence(translator, {
                roleName: item.customRole?.name || "",
                teamName:
                  translator.translateText("This team") || "This team",
              }),
              submitButtonText: "Remove",
            };
          }}
          bulkActions={{
            buttons: [ModalTableBulkDefaultActions.Delete],
            deleteVerb: "Remove",
            deleteIcon: IconProp.Minus,
            deleteConfirmationWarning:
              "Only the roles are taken from this team: the roles stay, with every other team that has them.",
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
              getElement: (item: TeamCustomRole): ReactElement => {
                const roleId: string = item.customRoleId?.toString() || "";

                return (
                  <div className="min-w-0">
                    <AppLink
                      className="font-medium text-gray-900 hover:underline break-words"
                      to={getRoleRoute(roleId)}
                    >
                      <span>{item.customRole?.name || ""}</span>
                    </AppLink>
                    <p className="text-sm text-gray-500">
                      {getPermissionCountText(
                        translator,
                        item.customRole?.permissionCount,
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
        <ModelFormModal<TeamCustomRole>
          title="Add a Custom Role"
          name="Add a custom role to a team"
          description="The team's members get everything the role allows. Make or change roles on the Roles page."
          modelType={TeamCustomRole}
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
            item: TeamCustomRole,
          ): Promise<TeamCustomRole> => {
            const projectId: ObjectID | null =
              ProjectUtil.getCurrentProjectId();

            if (!projectId || !item.customRoleId) {
              throw new BadDataException("Pick a custom role.");
            }

            item.teamId = props.teamId;
            item.projectId = projectId;
            item.customRoleId = new ObjectID(item.customRoleId.toString());
            return item;
          }}
          formProps={{
            name: "Add a custom role to a team",
            modelType: TeamCustomRole,
            id: "add-custom-role-to-team-form",
            formType: FormType.Create,
            fields: [
              {
                field: {
                  customRoleId: true,
                },
                title: "Custom Role",
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

export default TeamCustomRoleTable;
