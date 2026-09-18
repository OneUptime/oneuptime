import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import OnCallDutyPolicy from "../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseCommonInteractionPropsUtil, {
  PermissionType,
} from "../../Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
import PermissionScope from "../../Types/Database/AccessControl/PermissionScope";
import BadDataException from "../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../Types/ObjectID";
import Permission, {
  PermissionHelper,
  UserPermission,
} from "../../Types/Permission";
import DatabaseRequestType from "../Types/BaseDatabase/DatabaseRequestType";
import CreateBy from "../Types/Database/CreateBy";
import CreatePermission from "../Types/Database/Permissions/CreatePermission";
import TablePermission from "../Types/Database/Permissions/TablePermission";
import Query from "../Types/Database/Query";
import RelationValueUtil from "../Utils/Database/RelationValueUtil";
import DatabaseService from "./DatabaseService";

/** Authorize escalation configuration before any create hook can change it. */
export default class OnCallDutyPolicyChildService<
  TBaseModel extends BaseModel,
> extends DatabaseService<TBaseModel> {
  public override async create(
    createBy: CreateBy<TBaseModel>,
  ): Promise<TBaseModel> {
    const { data, props }: CreateBy<TBaseModel> = createBy;

    if (props.isRoot || props.isMasterAdmin) {
      return super.create(createBy);
    }

    /*
     * Check the original columns before normalizing relations. In particular,
     * a read-only caller must not reach the rule-ordering create hook.
     */
    CreatePermission.checkCreatePermissions(this.modelType, data, props);

    if (!props.tenantId || props.isMultiTenantRequest) {
      throw new NotAuthorizedException(
        "A project is required to create on-call configuration.",
      );
    }

    /*
     * DatabaseService uses save(), which can update when an ID is supplied.
     * A create grant must never replace an existing (possibly hidden) child.
     */
    if (data._id !== undefined && data._id !== null) {
      throw new BadDataException(
        "An ID cannot be supplied when creating on-call configuration.",
      );
    }

    const projectId: ObjectID = props.tenantId;
    const suppliedProjectId: ObjectID | null = this.normalizeReference(
      data,
      "project",
    );
    if (
      suppliedProjectId &&
      suppliedProjectId.toString() !== projectId.toString().toLowerCase()
    ) {
      throw new NotAuthorizedException(
        "The on-call configuration must belong to the current project.",
      );
    }
    data.setColumnValue("projectId", projectId);

    const policyId: ObjectID | null = this.normalizeReference(
      data,
      "onCallDutyPolicy",
    );
    if (!policyId) {
      throw new BadDataException("An on-call policy is required.");
    }

    const policyQuery: Query<OnCallDutyPolicy> = {
      _id: policyId.toString(),
      projectId,
    };
    const policyService: DatabaseService<OnCallDutyPolicy> =
      new DatabaseService(OnCallDutyPolicy);
    const policy: OnCallDutyPolicy | null = await policyService.findOneBy({
      query: policyQuery,
      select: { _id: true },
      props,
    });
    if (!policy) {
      throw new NotAuthorizedException(
        "You do not have permission to create configuration for this on-call policy.",
      );
    }

    /*
     * Read access alone is insufficient: a broad viewer grant must not widen
     * a Labels/Owned create grant or bypass a label-scoped create block. Apply
     * the create grants to the already verified parent using the normal read
     * scope machinery, which handles labels, ownership, and deny precedence.
     */
    const creatablePolicy: OnCallDutyPolicy | null =
      await policyService.findOneBy({
        query: policyQuery,
        select: { _id: true },
        props: this.getCreateScopeProps(props),
      });
    if (!creatablePolicy) {
      throw new NotAuthorizedException(
        "You do not have permission to create configuration for this on-call policy.",
      );
    }

    if (data.hasColumn("onCallDutyPolicyEscalationRuleId")) {
      const ruleId: ObjectID | null = this.normalizeReference(
        data,
        "onCallDutyPolicyEscalationRule",
      );
      if (!ruleId) {
        throw new BadDataException("An on-call escalation rule is required.");
      }

      /*
       * Escalation selects recipients by rule ID. Checking only policyId would
       * let a caller pair an allowed policy with another policy's rule. This
       * is an integrity lookup after authorizing the policy, not a new grant.
       */
      const rule: OnCallDutyPolicyEscalationRule | null =
        await new DatabaseService(OnCallDutyPolicyEscalationRule).findOneBy({
          query: {
            _id: ruleId.toString(),
            projectId,
            onCallDutyPolicyId: policyId,
          },
          select: { _id: true },
          props: { isRoot: true },
        });
      if (!rule) {
        throw new NotAuthorizedException(
          "The escalation rule is not available in this on-call policy.",
        );
      }
    }

    return super.create(createBy);
  }

  private getCreateScopeProps(
    props: DatabaseCommonInteractionProps,
  ): DatabaseCommonInteractionProps {
    const createPermissions: Array<Permission> =
      TablePermission.getTablePermission(
        this.modelType,
        DatabaseRequestType.Create,
      );
    const permissions: Array<UserPermission> = [
      ...DatabaseCommonInteractionPropsUtil.getUserPermissions(
        props,
        PermissionType.Allow,
      ),
      ...DatabaseCommonInteractionPropsUtil.getUserPermissions(
        props,
        PermissionType.Block,
      ),
    ]
      .filter((row: UserPermission): boolean => {
        return createPermissions.includes(row.permission);
      })
      .map((row: UserPermission): UserPermission => {
        return {
          ...row,
          permission: Permission.OnCallMember,
          scope: PermissionHelper.isScopeApplicable(row.permission)
            ? row.scope
            : PermissionScope.All,
        };
      });
    const projectId: ObjectID = props.tenantId!;
    return {
      ...props,
      userGlobalAccessPermission: {
        _type: "UserGlobalAccessPermission",
        globalPermissions: [],
        projectIds: [projectId],
      },
      userTenantAccessPermission: {
        [projectId.toString()]: {
          _type: "UserTenantAccessPermission",
          projectId,
          permissions,
        },
      },
    };
  }

  private normalizeReference(
    data: TBaseModel,
    relation: string,
  ): ObjectID | null {
    const column: string = `${relation}Id`;
    const values: Record<string, unknown> = data as Record<string, unknown>;
    const scalarValue: unknown = values[column];
    const relationValue: unknown = values[relation];
    const scalarId: string | null = this.referenceId(scalarValue);
    const relationId: string | null = this.referenceId(relationValue);

    if (scalarId && relationId && scalarId !== relationId) {
      throw new BadDataException(
        `${column} and ${relation} must refer to the same record.`,
      );
    }

    const id: string | null = scalarId || relationId;
    // A null relation must not override a tenant ID supplied by the request.
    data.setColumnValue(relation, undefined);
    if (!id) {
      return null;
    }

    const objectId: ObjectID = new ObjectID(id);
    data.setColumnValue(column, objectId);
    // Leave one authoritative value for TypeORM and for downstream hooks.
    return objectId;
  }

  private referenceId(value: unknown): string | null {
    if (value === undefined || value === null) {
      return null;
    }

    const id: string | null = RelationValueUtil.getRelationId(value);
    if (!id) {
      throw new BadDataException("A valid related record ID is required.");
    }
    ObjectID.validateUUID(id);

    if (typeof value === "object" && !(value instanceof ObjectID)) {
      const reference: Record<string, unknown> = value as Record<
        string,
        unknown
      >;
      if (
        reference["_id"] !== undefined &&
        reference["_id"] !== null &&
        reference["id"] !== undefined &&
        reference["id"] !== null &&
        String(reference["_id"]).toLowerCase() !==
          String(reference["id"]).toLowerCase()
      ) {
        throw new BadDataException(
          "Conflicting related record IDs are not allowed.",
        );
      }
    }

    return id.toLowerCase();
  }
}
