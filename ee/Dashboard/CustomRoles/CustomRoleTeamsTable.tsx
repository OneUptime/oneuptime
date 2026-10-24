import { getRoleRemoveFromTeamSentence } from "@oneuptime/dashboard/Components/CustomRole/CustomRoleCopy";
import { loadTeamIdsGivenCustomRole } from "@oneuptime/dashboard/Components/CustomRole/CustomRoleOptions";
import TeamElement from "@oneuptime/dashboard/Components/Team/Team";
import Team from "Common/Models/DatabaseModels/Team";
import TeamCustomRole from "Common/Models/DatabaseModels/TeamCustomRole";
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
 * THE TEAMS A CUSTOM ROLE IS GIVEN TO, on the role's page under its
 * permissions: each team links to its page, Give to a Team adds one, Remove
 * takes the role from one - from several at once in the bulk bar. Give to a
 * Team offers only the teams that could take it: not one that has the role
 * already, nor one whose permissions can't be changed (Owners, Admin) - the
 * server refuses both.
 *
 * Giving the role hands the team's members everything in it, so the server
 * weighs it as giving each permission directly: a role holding a permission
 * the user can't give is refused, in words that name it.
 *
 * The dialog is the table's own ("Give Incident Responder to a Team"), not
 * the table's create form, whose title would read "Create New Team".
 */

export interface ComponentProps {
  customRoleId: ObjectID;
  roleName: string;
  // After a team is given the role or has it taken away.
  onTeamsChange?: (() => void) | undefined;
  /*
   * The Enterprise license has lapsed or leaves custom roles out: the role
   * cannot be given to another team, and can still be taken from one.
   */
  isReadOnly?: boolean | undefined;
}

export const CUSTOM_ROLE_TEAMS_TEST_ID: string = "custom-role-teams";

const CustomRoleTeamsTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isGiving, setIsGiving] = useState<boolean>(false);
  const [refreshToggle, setRefreshToggle] = useState<string>("");
  // The teams that have the role: Give to a Team offers the others.
  const [givenTeamIds, setGivenTeamIds] = useState<Array<string>>([]);
  const [givenTeamsToggle, setGivenTeamsToggle] = useState<number>(0);

  useEffect(() => {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (!projectId) {
      return;
    }

    loadTeamIdsGivenCustomRole({
      customRoleId: props.customRoleId,
      projectId: projectId,
    })
      .then((ids: Set<string>) => {
        setGivenTeamIds(Array.from(ids));
      })
      .catch(() => {
        // Then every team is offered, and the server refuses one that has it.
        setGivenTeamIds([]);
      });
  }, [refreshToggle, givenTeamsToggle, props.customRoleId.toString()]);

  const teamQuery: Query<Team> = {
    isPermissionsEditable: true,
  };

  if (givenTeamIds.length > 0) {
    teamQuery._id = new IncludesNone(givenTeamIds);
  }

  // Locked, with the missing permission as the tooltip, as ModelTable locks its own Create.
  const giveButton: CardButtonSchema | null = PermissionGate.gateCardButton(
    {
      title: "Give to a Team",
      // NORMAL with the Add icon, so the empty table repeats it as its way on.
      icon: IconProp.Add,
      buttonStyle: ButtonStyleType.NORMAL,
      onClick: () => {
        setIsGiving(true);
      },
    },
    new TeamCustomRole(),
    ModelAction.Create,
  );

  const giveTitle: string = props.roleName
    ? translator.translateTemplate("Give {{role}} to a Team", {
        role: props.roleName,
      })
    : translator.translateText("Give this role to a team") ||
      "Give this role to a team";

  return (
    <Fragment>
      <div data-testid={CUSTOM_ROLE_TEAMS_TEST_ID}>
        <ModelTable<TeamCustomRole>
          modelType={TeamCustomRole}
          id="table-custom-role-teams"
          userPreferencesKey="custom-role-teams-table"
          name="Teams > Role > Teams"
          isDeleteable={true}
          isEditable={false}
          isCreateable={false}
          isViewable={false}
          singularName="Team"
          pluralName="Teams"
          deleteButtonText="Remove"
          refreshToggle={refreshToggle}
          query={{
            customRoleId: props.customRoleId,
            projectId: ProjectUtil.getCurrentProjectId()!,
          }}
          cardProps={{
            title: "Teams with this Role",
            description:
              "Members of these teams can do everything this role allows.",
            buttons: giveButton && !props.isReadOnly ? [giveButton] : [],
          }}
          noItemsMessage="No team has this role yet. Give it to a team to hand its members these permissions."
          onItemDeleted={() => {
            setGivenTeamsToggle((count: number): number => {
              return count + 1;
            });
            props.onTeamsChange?.();
          }}
          getDeleteConfirmation={async (
            item: TeamCustomRole,
          ): Promise<DeleteConfirmation> => {
            return {
              title: translator.translateTemplate(
                "Remove {{role}} from {{team}}",
                {
                  role: props.roleName,
                  team: item.team?.name || "",
                },
              ),
              description: getRoleRemoveFromTeamSentence(translator, {
                roleName: props.roleName,
                teamName: item.team?.name || "",
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
              "Only this role is taken from them: the teams stay, with their members and their other roles and permissions.",
            ),
          }}
          showRefreshButton={true}
          viewPageRoute={Navigation.getCurrentRoute()}
          filters={[]}
          columns={[
            {
              field: {
                team: {
                  name: true,
                  _id: true,
                },
              },
              title: "Team",
              type: FieldType.Element,
              wrapContent: true,
              wrapMaxWidthClassName: "max-w-xl",
              // The team's name says what each card is on a phone.
              hideTitleOnMobile: true,
              getElement: (item: TeamCustomRole): ReactElement => {
                if (item.team) {
                  return <TeamElement team={item.team} />;
                }

                return <></>;
              },
            },
          ]}
        />
      </div>

      {isGiving ? (
        <ModelFormModal<TeamCustomRole>
          title={giveTitle}
          name="Give a custom role to a team"
          description="Its members get everything this role allows, from now on."
          modelType={TeamCustomRole}
          submitButtonText="Give to Team"
          onClose={() => {
            setIsGiving(false);
          }}
          onSuccess={() => {
            setIsGiving(false);
            setRefreshToggle(new Date().toISOString());
            props.onTeamsChange?.();
          }}
          onBeforeCreate={async (
            item: TeamCustomRole,
          ): Promise<TeamCustomRole> => {
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
            name: "Give a custom role to a team",
            modelType: TeamCustomRole,
            id: "give-custom-role-to-team-form",
            formType: FormType.Create,
            fields: [
              {
                field: {
                  team: true,
                },
                title: "Team",
                description:
                  "Not listed: the teams that have this role already, and Owners and Admin, whose permissions can't be changed.",
                fieldType: FormFieldSchemaType.Dropdown,
                dropdownModal: {
                  type: Team,
                  labelField: "name",
                  valueField: "_id",
                  query: teamQuery,
                },
                required: true,
                placeholder: "Select a team",
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

export default CustomRoleTeamsTable;
