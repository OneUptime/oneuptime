import Project from "Common/Models/DatabaseModels/Project";
import IconProp from "Common/Types/Icon/IconProp";
import Permission from "Common/Types/Permission";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { CardButtonSchema } from "Common/UI/Components/Card/Card";
import PermissionGate from "Common/UI/Utils/PermissionGate";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import User from "Common/UI/Utils/User";

/*
 * Who may edit a card of Project settings, read from the edited columns' own
 * update access control rather than the table's.
 *
 * CardModelDetail gates its Edit button on the Project table's update list,
 * which is wide (Project Admin, Edit Project, Manage Billing, ...). Many
 * settings columns are narrower — the AI switches take Project Owner or
 * Manage Billing, the incident AI columns Project Owner or Project Admin — so
 * the table gate hands some people a working Edit button and a save the
 * server refuses. A card that writes such columns passes isEditable from
 * here instead, and shows lockedButtons in place of the card's own button.
 */

/*
 * Permissions every listed column allows for update, in the order the first
 * column lists them. The form writes all of them on save, so editing needs
 * update permission on each one.
 */
export function getProjectColumnsUpdatePermissions(
  fields: Array<string>,
): Array<Permission> {
  const project: Project = new Project();

  const perColumn: Array<Array<Permission>> = fields.map(
    (field: string): Array<Permission> => {
      return project.getColumnAccessControlFor(field)?.update || [];
    },
  );

  const [first, ...rest] = perColumn;

  return (first || []).filter((permission: Permission): boolean => {
    return rest.every((permissions: Array<Permission>): boolean => {
      return permissions.includes(permission);
    });
  });
}

/*
 * Held the way the server reads it (PermissionGate.holdsAnyOf): one
 * permission every column allows, and on every column no team block that
 * takes its update away.
 */
export function canUpdateProjectColumns(fields: Array<string>): boolean {
  if (User.isMasterAdmin()) {
    return true;
  }

  const project: Project = new Project();

  return (
    PermissionGate.holdsAnyOf(getProjectColumnsUpdatePermissions(fields)) &&
    fields.every((field: string): boolean => {
      return PermissionGate.holdsAnyOf(
        project.getColumnAccessControlFor(field)?.update || [],
      );
    })
  );
}

// Why a settings card's Edit is locked, before what would open it.
export const CHANGE_SETTINGS_REFUSED_SENTENCE: string = translationKey(
  "You do not have permission to change these settings.",
);

/*
 * The locked Edit's tooltip, worded as every lock in the product words its
 * own (PermissionGate.getRefusalReason): why, then what would allow it -
 * the settings' own permission ("You need this permission: Manage Billing."),
 * or the roles when they take nothing else - or the team block that
 * refuses it.
 */
export function getProjectColumnsPermissionMessage(
  fields: Array<string>,
): string {
  return PermissionGate.getRefusalReason({
    sentence: CHANGE_SETTINGS_REFUSED_SENTENCE,
    permissions: getProjectColumnsUpdatePermissions(fields),
  });
}

export interface ProjectColumnsEditGate {
  isEditable: boolean;
  lockedButtons: Array<CardButtonSchema>;
}

/*
 * Without the permission the button stays, locked, with the reason in its
 * tooltip — the rule CardModelDetail applies to its own Edit button. The
 * permission snapshot arrives on an API response header, so it can be empty
 * on the first paint; until it lands there is nothing honest to say, so no
 * button at all. Callers re-render once their card has loaded, which reads
 * the permissions again.
 */
export function getProjectColumnsEditGate(data: {
  fields: Array<string>;
  buttonTitle: string;
  // The locked button's icon, as the card's own button draws it: a pencil.
  buttonIcon?: IconProp | undefined;
}): ProjectColumnsEditGate {
  const isEditable: boolean = canUpdateProjectColumns(data.fields);
  const hasPermissionSnapshot: boolean = PermissionGate.hasPermissionSnapshot();

  if (isEditable || !hasPermissionSnapshot) {
    return { isEditable, lockedButtons: [] };
  }

  return {
    isEditable,
    lockedButtons: [
      {
        title: data.buttonTitle,
        icon: data.buttonIcon || IconProp.Edit,
        buttonStyle: ButtonStyleType.NORMAL,
        disabled: true,
        tooltip: getProjectColumnsPermissionMessage(data.fields),
        onClick: () => {
          // Locked. The tooltip says which permission is missing.
        },
      },
    ],
  };
}
