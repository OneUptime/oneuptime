import PageMap from "../../Utils/PageMap";
import {
  RoleAccessHolder,
  getRoleAccessFormField,
} from "../Permission/RoleAccess";
import Team from "Common/Models/DatabaseModels/Team";
import Permission from "Common/Types/Permission";
import { CardSelectOption } from "Common/UI/Components/CardSelect/CardSelect";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";

/*
 * CREATE TEAM: A NAME, WHAT THE TEAM'S MEMBERS MAY DO, AND THE REST FOLDED.
 *
 * The form asked for a name and a description, and the team it made held no
 * permissions: people invited to it could sign in and do nothing until
 * someone opened the team, found Permissions and picked from a grid of some
 * forty roles. It now asks:
 *
 *   - Name.
 *   - Access: Project Admin, Project Member, Viewer or Choose permissions
 *     later (Permission/RoleAccess.ts, the same question Create API Key
 *     asks), with Choose permissions later picked - a team with no
 *     permissions is what the server stores for a team created without any,
 *     and giving every member of a team power stays one deliberate click.
 *     Only the roles the user may hand on are offered, and the question is
 *     left out for someone who may not add permissions to a team.
 *   - Advanced, folded: the description. The team's page edits it too.
 *
 * Three rows, so no steps. React-free, so tests can read the fields without
 * rendering the page.
 */

export interface TeamCreateFormOptions {
  /*
   * The Access cards this user may pick from (getRoleAccessOptions). Empty
   * leaves the question out: the team starts with no permissions, as it
   * always did, and its Permissions page is where they are added.
   */
  accessOptions: Array<CardSelectOption>;
}

export const getTeamCreateFormFields: (
  options: TeamCreateFormOptions,
) => Array<ModelField<Team>> = (
  options: TeamCreateFormOptions,
): Array<ModelField<Team>> => {
  const advanced: FormFieldCollapsibleSection<Team> =
    getAdvancedFormSection<Team>();

  return [
    {
      field: {
        name: true,
      },
      title: "Name",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      placeholder: "Team Name",
      validation: {
        minLength: 2,
      },
    },
    /*
     * Not a column of the team: the page adds the role once the team exists
     * (RoleAccess.giveRoleAccess), so nothing of it is sent with the team.
     */
    ...(options.accessOptions.length > 0
      ? [
          getRoleAccessFormField<Team>({
            holder: RoleAccessHolder.Team,
            accessOptions: options.accessOptions,
          }),
        ]
      : []),
    {
      field: {
        description: true,
      },
      title: "Description",
      fieldType: FormFieldSchemaType.LongText,
      required: false,
      placeholder: "Team Description",
      collapsibleSection: advanced,
    },
  ];
};

/*
 * Where a new team opens: the next thing to do with it.
 *
 *   - With a role, its Members page: the team can do something now, and
 *     inviting people is what is left.
 *   - With Choose permissions later, its Permissions page: the card said the
 *     narrower role would be added on the team's page, and that is where Add
 *     Role is.
 *   - Not asked at all (the user may not add permissions to a team), its
 *     Members page as well: there is nothing they could do on Permissions.
 */
export const getNewTeamPage: (data: {
  role: Permission | null;
  wasAccessAsked: boolean;
}) => PageMap = (data: {
  role: Permission | null;
  wasAccessAsked: boolean;
}): PageMap => {
  if (!data.role && data.wasAccessAsked) {
    return PageMap.TEAM_VIEW_PERMISSIONS;
  }

  return PageMap.TEAM_VIEW_MEMBERS;
};
