import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentCustomField from "../../../Models/DatabaseModels/IncidentCustomField";
import BaseModel, {
  DatabaseBaseModelType,
} from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseCommonInteractionPropsUtil, {
  PermissionType,
} from "../../../Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
import { CUSTOM_FIELD_TEMPLATE_VARIABLE_PREFIX } from "../../../Types/CustomField/CustomFieldVariableKey";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import Permission, {
  PermissionHelper,
  UserPermission,
} from "../../../Types/Permission";

/*
 * WHO MAY PLACE INCIDENT RECORDS IN A SUBSCRIBER TEMPLATE.
 *
 * A custom subscriber notification template can place {{incidentLabels}} and
 * any {{customFields.<key>}} - values from the team's incident records, which
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

    const unrestricted: Array<Permission> =
      SubscriberTemplateIncidentRecordAccess.getUnrestrictedPermissions(
        data.props,
      );
    const blocked: Array<Permission> =
      DatabaseCommonInteractionPropsUtil.getUserPermissions(
        data.props,
        PermissionType.Block,
      ).map((row: UserPermission): Permission => {
        return row.permission;
      });

    for (const requirement of SubscriberTemplateIncidentRecordAccess.getRequirements(
      data.placeholders,
    )) {
      const isGranted: boolean = PermissionHelper.doesPermissionsIntersect(
        unrestricted,
        requirement.permissions,
      );
      const isBlocked: boolean = PermissionHelper.doesPermissionsIntersect(
        blocked,
        requirement.permissions,
      );

      if (isGranted && !isBlocked) {
        continue;
      }

      const placeholders: string = data.placeholders
        .map((name: string): string => {
          return `{{${name}}}`;
        })
        .join(", ");

      throw new NotAuthorizedException(
        `Placing ${placeholders} in a subscriber notification template needs permission to ${requirement.description} for every incident in the project: these values come from your team's incident records, which the status page does not show. You need one of these permissions, not limited to some labels or to incidents you own: ${PermissionHelper.getPermissionTitles(
          requirement.permissions,
        ).join(", ")}.`,
      );
    }
  }

  /*
   * What these placeholders need: reading incidents, and the column each
   * one reads - Incident.labels for {{incidentLabels}}; Incident.customFields
   * and the field definitions for {{customFields.<key>}}.
   */
  public static getRequirements(
    placeholders: Array<string>,
  ): Array<AccessRequirement> {
    const requirements: Array<AccessRequirement> = [
      {
        description: "read incidents",
        permissions: this.getTableReadPermissions(Incident),
      },
    ];

    if (
      placeholders.some((name: string): boolean => {
        return name.startsWith(CUSTOM_FIELD_TEMPLATE_VARIABLE_PREFIX);
      })
    ) {
      requirements.push(
        {
          description: "read incident custom field values",
          permissions: this.getColumnReadPermissions(Incident, "customFields"),
        },
        {
          description: "read incident custom fields",
          permissions: this.getTableReadPermissions(IncidentCustomField),
        },
      );
    }

    if (
      placeholders.some((name: string): boolean => {
        return !name.startsWith(CUSTOM_FIELD_TEMPLATE_VARIABLE_PREFIX);
      })
    ) {
      requirements.push({
        description: "read incident labels",
        permissions: this.getColumnReadPermissions(Incident, "labels"),
      });
    }

    return requirements;
  }

  /*
   * The caller's granted permissions that reach every record, read as the
   * read checks read them (PermissionHelper.getNonAccessControlPermissions,
   * OwnedScopePermission): a row scoped to All, or a Labels (or legacy
   * unscoped) row with no labels. A row limited to labels does not, nor one
   * limited to owned records - except for a project-wide role that cannot
   * be scoped (Project Owner, Project Admin), whose stray Owned scope the
   * read checks ignore too.
   */
  private static getUnrestrictedPermissions(
    props: DatabaseCommonInteractionProps,
  ): Array<Permission> {
    return DatabaseCommonInteractionPropsUtil.getUserPermissions(
      props,
      PermissionType.Allow,
    )
      .filter((row: UserPermission): boolean => {
        if (row.scope === PermissionScope.All) {
          return true;
        }

        if (row.scope === PermissionScope.Owned) {
          return !PermissionHelper.isScopeApplicable(row.permission);
        }

        return !row.labelIds || row.labelIds.length === 0;
      })
      .map((row: UserPermission): Permission => {
        return row.permission;
      });
  }

  // As the table check reads them, the operational resource wildcard included.
  private static getTableReadPermissions(
    modelType: DatabaseBaseModelType,
  ): Array<Permission> {
    const model: BaseModel = new modelType();
    const permissions: Array<Permission> = [...model.readRecordPermissions];

    if (
      model.isOperationalResource &&
      !permissions.includes(Permission.ReadAllOperationalResources)
    ) {
      permissions.push(Permission.ReadAllOperationalResources);
    }

    return permissions;
  }

  // As the select check reads them: no wildcard reaches a column.
  private static getColumnReadPermissions(
    modelType: DatabaseBaseModelType,
    columnName: string,
  ): Array<Permission> {
    return [
      ...(new modelType().getColumnAccessControlFor(columnName)?.read || []),
    ];
  }
}
