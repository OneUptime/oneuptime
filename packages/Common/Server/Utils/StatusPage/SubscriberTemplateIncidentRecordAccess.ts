import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentCustomField from "../../../Models/DatabaseModels/IncidentCustomField";
import BaseModel, {
  DatabaseBaseModelType,
} from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { isCustomFieldTemplateVariableName } from "../../../Types/CustomField/CustomFieldVariableKey";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import HeldPermissionsUtil from "../../../Types/HeldPermissions";
import Permission, { PermissionHelper } from "../../../Types/Permission";
import CallerPermission from "../Permission/CallerPermission";

/*
 * WHO MAY PLACE INCIDENT RECORDS IN A SUBSCRIBER TEMPLATE.
 *
 * A custom subscriber notification template can place {{incidentLabels}} and
 * any {{incident.customFields.<key>}} (or the older {{customFields.<key>}},
 * which is filled the same) - values from the team's incident records, which
 * the status page does not show, marked for subscribers or not
 * (SubscriberNotificationTemplateVariables.getIncidentRecordPlaceholders).
 * Templates are written by the status page roles (StatusPageAdmin,
 * StatusPageMember), which cannot read incidents; and a Slack, Teams or
 * webhook subscriber can be added by the same roles, pointing at an address
 * they own. Without this check such a role could send itself every
 * incident's custom fields - guessing keys, which come predictably from
 * field names, many at once, since a placeholder with no value is left as
 * written.
 *
 * So a template may place them only if whoever writes it may read them
 * directly: incidents, the column the value comes from (Incident.customFields
 * or Incident.labels) and, for custom fields, the field definitions. And for
 * every incident of the project, since a template reaches every incident
 * that reaches its status pages: a grant limited to labels or to owned
 * incidents does not count, and a block on any of those permissions refuses.
 *
 * The permissions are read from the models' own access control, so they
 * follow any change to it. Root and master admin writes are not checked.
 */

interface AccessRequirement {
  // What the caller must be able to read, for the refusal.
  description: string;
  permissions: Array<Permission>;
  /*
   * The *AllOperationalResources wildcard the read accepts as well, as the
   * read checks accept it (HeldPermissionsUtil), or null.
   */
  wildcard: Permission | null;
}

export default class SubscriberTemplateIncidentRecordAccess {
  /**
   * Refuses a write that places these placeholders (from
   * getIncidentRecordPlaceholders) unless the caller may read what they
   * read, for every incident of the project. Does nothing when there are
   * none, or for root and master admin.
   */
  public static assertCanPlace(data: {
    placeholders: Array<string>;
    props: DatabaseCommonInteractionProps;
  }): void {
    if (
      data.placeholders.length === 0 ||
      data.props.isRoot ||
      data.props.isMasterAdmin
    ) {
      return;
    }

    for (const requirement of SubscriberTemplateIncidentRecordAccess.getRequirements(
      data.placeholders,
    )) {
      /*
       * Held the way every permission check reads it (CallerPermission),
       * for every incident of the project: only a grant that reaches the
       * whole project counts - not one limited to labels or to owned
       * incidents - and a block on any of these refuses, labelled or not.
       */
      if (
        CallerPermission.holdsAnyOf(data.props, requirement.permissions, {
          wildcard: requirement.wildcard,
          projectWideOnly: true,
          labelledBlocksRefuse: true,
        })
      ) {
        continue;
      }

      const placeholders: string = data.placeholders
        .map((name: string): string => {
          return `{{${name}}}`;
        })
        .join(", ");

      throw new NotAuthorizedException(
        `Placing ${placeholders} in a subscriber notification template needs permission to ${requirement.description} for every incident in the project: these values come from your team's incident records, which the status page does not show. You need one of these permissions, not limited to some labels or to incidents you own: ${PermissionHelper.getPermissionTitles(
          requirement.wildcard
            ? [...requirement.permissions, requirement.wildcard]
            : requirement.permissions,
        ).join(", ")}.`,
      );
    }
  }

  /*
   * What these placeholders need: reading incidents, and the column each
   * one reads - Incident.labels for {{incidentLabels}}; Incident.customFields
   * and the field definitions for a custom field, written either way
   * ({{incident.customFields.<key>}} or {{customFields.<key>}}).
   */
  public static getRequirements(
    placeholders: Array<string>,
  ): Array<AccessRequirement> {
    const requirements: Array<AccessRequirement> = [
      {
        description: "read incidents",
        ...this.getTableReadRequirement(Incident),
      },
    ];

    if (
      placeholders.some((name: string): boolean => {
        return isCustomFieldTemplateVariableName(name);
      })
    ) {
      requirements.push(
        {
          description: "read incident custom field values",
          ...this.getColumnReadRequirement(Incident, "customFields"),
        },
        {
          description: "read incident custom fields",
          ...this.getTableReadRequirement(IncidentCustomField),
        },
      );
    }

    if (
      placeholders.some((name: string): boolean => {
        return !isCustomFieldTemplateVariableName(name);
      })
    ) {
      requirements.push({
        description: "read incident labels",
        ...this.getColumnReadRequirement(Incident, "labels"),
      });
    }

    return requirements;
  }

  // A table's read, as the table check reads it: its list and its wildcard.
  private static getTableReadRequirement(
    modelType: DatabaseBaseModelType,
  ): Pick<AccessRequirement, "permissions" | "wildcard"> {
    const model: BaseModel = new modelType();

    return {
      permissions: [...model.readRecordPermissions],
      wildcard: HeldPermissionsUtil.getModelWildcard({
        isOperationalResource: model.isOperationalResource,
        operation: "read",
      }),
    };
  }

  /*
   * A column's read, as the select check reads it: the column's own list,
   * and the table's wildcard when the column lets in everyone the table does.
   */
  private static getColumnReadRequirement(
    modelType: DatabaseBaseModelType,
    columnName: string,
  ): Pick<AccessRequirement, "permissions" | "wildcard"> {
    const model: BaseModel = new modelType();
    const permissions: Array<Permission> = [
      ...(model.getColumnAccessControlFor(columnName)?.read || []),
    ];

    return {
      permissions: permissions,
      wildcard: HeldPermissionsUtil.getColumnWildcard({
        isOperationalResource: model.isOperationalResource,
        operation: "read",
        tablePermissions: model.readRecordPermissions,
        columnPermissions: permissions,
      }),
    };
  }
}
