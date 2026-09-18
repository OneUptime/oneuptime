import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyEscalationRuleSchedule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import OnCallDutyPolicyEscalationRuleTeam from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleTeam";
import OnCallDutyPolicyEscalationRuleUser from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleUser";
import Project from "../../../Models/DatabaseModels/Project";
import DatabaseService from "../../../Server/Services/DatabaseService";
import OnCallDutyPolicyChildService from "../../../Server/Services/OnCallDutyPolicyChildService";
import EscalationRuleService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleService";
import EscalationRuleScheduleService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleScheduleService";
import EscalationRuleTeamService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleTeamService";
import EscalationRuleUserService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleUserService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import FindOneBy from "../../../Server/Types/Database/FindOneBy";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

type Child =
  | OnCallDutyPolicyEscalationRule
  | OnCallDutyPolicyEscalationRuleUser
  | OnCallDutyPolicyEscalationRuleTeam
  | OnCallDutyPolicyEscalationRuleSchedule;

interface ChildFixture {
  name: string;
  model: { new (): Child };
  service: DatabaseService<Child>;
  hasRule: boolean;
  createPermission: Permission;
}

const CHILDREN: Array<ChildFixture> = [
  {
    name: "escalation rule",
    model: OnCallDutyPolicyEscalationRule,
    service: EscalationRuleService,
    hasRule: false,
    createPermission: Permission.CreateProjectOnCallDutyPolicyEscalationRule,
  },
  {
    name: "user assignment",
    model: OnCallDutyPolicyEscalationRuleUser,
    service: EscalationRuleUserService,
    hasRule: true,
    createPermission:
      Permission.CreateProjectOnCallDutyPolicyEscalationRuleUser,
  },
  {
    name: "team assignment",
    model: OnCallDutyPolicyEscalationRuleTeam,
    service: EscalationRuleTeamService,
    hasRule: true,
    createPermission:
      Permission.CreateProjectOnCallDutyPolicyEscalationRuleTeam,
  },
  {
    name: "schedule assignment",
    model: OnCallDutyPolicyEscalationRuleSchedule,
    service: EscalationRuleScheduleService,
    hasRule: true,
    createPermission:
      Permission.CreateProjectOnCallDutyPolicyEscalationRuleSchedule,
  },
];

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000002",
);
const POLICY_ID: ObjectID = new ObjectID(
  "20000000-0000-4000-8000-000000000001",
);
const OTHER_POLICY_ID: ObjectID = new ObjectID(
  "20000000-0000-4000-8000-000000000002",
);
const RULE_ID: ObjectID = new ObjectID("30000000-0000-4000-8000-000000000001");
const OTHER_RULE_ID: ObjectID = new ObjectID(
  "30000000-0000-4000-8000-000000000002",
);
const USER_ID: ObjectID = new ObjectID("40000000-0000-4000-8000-000000000001");
const LABEL_ID: ObjectID = new ObjectID("50000000-0000-4000-8000-000000000001");

function grant(
  permission: Permission = Permission.OnCallMember,
  overrides: Partial<UserPermission> = {},
): UserPermission {
  return {
    _type: "UserPermission",
    permission,
    labelIds: [],
    scope: PermissionScope.All,
    isBlockPermission: false,
    ...overrides,
  };
}

function callerProps(
  permissions: Array<UserPermission> = [grant()],
): DatabaseCommonInteractionProps {
  return {
    userId: USER_ID,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions,
      },
    },
  };
}

function input(
  fixture: ChildFixture,
  fields: Record<string, unknown> = {},
  props: DatabaseCommonInteractionProps = callerProps(),
): CreateBy<Child> {
  const data: Child = new fixture.model();
  Object.assign(data, {
    projectId: PROJECT_ID,
    onCallDutyPolicyId: POLICY_ID,
    ...(fixture.hasRule ? { onCallDutyPolicyEscalationRuleId: RULE_ID } : {}),
    ...fields,
  });
  return { data, props };
}

interface ReadCall {
  model: { new (): BaseModel };
  request: FindOneBy<BaseModel>;
}

let createSpy: jest.SpyInstance;
let findSpy: jest.SpyInstance;
let reads: Array<ReadCall>;
let policyReadable: boolean;
let policyCreateScopeReadable: boolean;
let policy: OnCallDutyPolicy;
let rule: OnCallDutyPolicyEscalationRule | null;

function projectedPermissions(): Array<UserPermission> | undefined {
  return reads[1]?.request.props.userTenantAccessPermission?.[
    PROJECT_ID.toString()
  ]?.permissions;
}

beforeEach(() => {
  reads = [];
  policyReadable = true;
  policyCreateScopeReadable = true;
  policy = new OnCallDutyPolicy();
  policy.id = POLICY_ID;
  policy.projectId = PROJECT_ID;
  rule = new OnCallDutyPolicyEscalationRule();
  rule.id = RULE_ID;
  rule.projectId = PROJECT_ID;
  rule.onCallDutyPolicyId = POLICY_ID;

  /*
   * The real entry points and permission checks run. Only database reads and
   * the downstream create pipeline (including hooks and writes) are stubbed.
   */
  createSpy = jest
    .spyOn(DatabaseService.prototype, "create")
    .mockImplementation(
      async (createBy: CreateBy<BaseModel>): Promise<BaseModel> => {
        return createBy.data;
      },
    );
  findSpy = jest
    .spyOn(DatabaseService.prototype, "findOneBy")
    .mockImplementation(async function (
      this: DatabaseService<BaseModel>,
      request: FindOneBy<BaseModel>,
    ): Promise<BaseModel | null> {
      reads.push({ model: this.modelType, request });
      if (
        this.modelType === OnCallDutyPolicy &&
        reads.filter((read: ReadCall): boolean => {
          return read.model === OnCallDutyPolicy;
        }).length === 2 &&
        !policyCreateScopeReadable
      ) {
        return null;
      }
      const candidate: BaseModel | null =
        this.modelType === OnCallDutyPolicy
          ? policyReadable
            ? policy
            : null
          : rule;
      if (!candidate) {
        return null;
      }

      /*
       * Honor the query's relationship predicates, as a database would. A
       * missing project/policy predicate therefore cannot pass these tests.
       */
      const query: Record<string, unknown> = request.query;
      const row: Record<string, unknown> = candidate as unknown as Record<
        string,
        unknown
      >;
      for (const column of ["_id", "projectId", "onCallDutyPolicyId"]) {
        if (
          query[column] !== undefined &&
          String(query[column]) !== String(row[column])
        ) {
          return null;
        }
      }
      return candidate;
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(CHILDREN)(
  "$name parent authorization",
  (fixture: ChildFixture) => {
    test("uses the guarded service and forwards readable creates unchanged", async () => {
      const request: CreateBy<Child> = input(fixture);
      expect(fixture.service).toBeInstanceOf(OnCallDutyPolicyChildService);

      await expect(fixture.service.create(request)).resolves.toBe(request.data);

      expect(createSpy).toHaveBeenCalledTimes(1);
      expect(createSpy).toHaveBeenCalledWith(request);
      expect(reads[0]?.model).toBe(OnCallDutyPolicy);
      expect(reads[0]?.request.props).toBe(request.props);
      expect(reads[0]?.request.query).toEqual(
        expect.objectContaining({
          _id: POLICY_ID.toString(),
          projectId: PROJECT_ID,
        }),
      );
      expect(reads).toHaveLength(fixture.hasRule ? 3 : 2);
    });

    test.each([false, true])(
      "denies unreadable parents before any hooks, ignoreHooks=%s",
      async (ignoreHooks: boolean) => {
        policyReadable = false;
        const props: DatabaseCommonInteractionProps = {
          ...callerProps(),
          ignoreHooks,
        };

        await expect(
          fixture.service.create(input(fixture, {}, props)),
        ).rejects.toThrow();

        expect(createSpy).not.toHaveBeenCalled();
        expect(reads).toHaveLength(1);
      },
    );

    test("does not let a different project's readable policy become the parent", async () => {
      policy.projectId = OTHER_PROJECT_ID;

      await expect(fixture.service.create(input(fixture))).rejects.toThrow();

      expect(reads[0]?.request.query).toEqual(
        expect.objectContaining({ projectId: PROJECT_ID }),
      );
      expect(createSpy).not.toHaveBeenCalled();
    });

    test("requires a tenant even when the body supplies a project", async () => {
      const props: DatabaseCommonInteractionProps = callerProps();
      delete props.tenantId;

      await expect(
        fixture.service.create(input(fixture, {}, props)),
      ).rejects.toThrow();

      expect(createSpy).not.toHaveBeenCalled();
      expect(findSpy).not.toHaveBeenCalled();
    });

    test("rejects a project supplied outside the caller's tenant", async () => {
      await expect(
        fixture.service.create(input(fixture, { projectId: OTHER_PROJECT_ID })),
      ).rejects.toThrow();

      expect(createSpy).not.toHaveBeenCalled();
      expect(findSpy).not.toHaveBeenCalled();
    });

    test("rejects creates carrying an existing child ID before repository.save can update it", async () => {
      await expect(
        fixture.service.create(
          input(fixture, { _id: OTHER_RULE_ID.toString() }),
        ),
      ).rejects.toThrow();

      expect(createSpy).not.toHaveBeenCalled();
      expect(findSpy).not.toHaveBeenCalled();
    });

    test("checks the child create grant even when the parent is readable", async () => {
      const props: DatabaseCommonInteractionProps = callerProps([
        grant(Permission.Viewer),
      ]);

      await expect(
        fixture.service.create(input(fixture, {}, props)),
      ).rejects.toThrow(NotAuthorizedException);

      expect(findSpy).not.toHaveBeenCalled();
      expect(createSpy).not.toHaveBeenCalled();
    });

    test.each([true, false])(
      "keeps label-scoped create grants restricted despite a broad viewer grant, matching label=%s",
      async (matchingLabel: boolean) => {
        const props: DatabaseCommonInteractionProps = callerProps([
          grant(Permission.Viewer),
          grant(Permission.OnCallMember, {
            scope: PermissionScope.Labels,
            labelIds: [LABEL_ID],
          }),
        ]);
        policyCreateScopeReadable = matchingLabel;
        const operation: Promise<Child> = fixture.service.create(
          input(fixture, {}, props),
        );
        if (matchingLabel) {
          await expect(operation).resolves.toBeInstanceOf(fixture.model);
          expect(createSpy).toHaveBeenCalledTimes(1);
        } else {
          await expect(operation).rejects.toThrow(NotAuthorizedException);
          expect(createSpy).not.toHaveBeenCalled();
          expect(reads).toHaveLength(2);
        }
        expect(projectedPermissions()).toEqual([
          grant(Permission.OnCallMember, {
            scope: PermissionScope.Labels,
            labelIds: [LABEL_ID],
          }),
        ]);
        expect(reads[0]?.request.props).toBe(props);
      },
    );

    test("preserves an unrestricted create grant alongside an unrelated label-scoped read grant", async () => {
      const props: DatabaseCommonInteractionProps = callerProps([
        grant(),
        grant(Permission.Viewer, {
          scope: PermissionScope.Labels,
          labelIds: [LABEL_ID],
        }),
      ]);
      await fixture.service.create(input(fixture, {}, props));

      expect(reads[0]?.request.query).not.toHaveProperty("labels");
      expect(reads[0]?.request.props).toBe(props);
      expect(projectedPermissions()).toEqual([grant()]);
      expect(createSpy).toHaveBeenCalledTimes(1);
    });

    test("does not replace the caller's permissions when projecting create scope", async () => {
      const permissions: Array<UserPermission> = [
        grant(Permission.Viewer),
        grant(fixture.createPermission, {
          scope: PermissionScope.Labels,
          labelIds: [LABEL_ID],
        }),
      ];
      const props: DatabaseCommonInteractionProps = callerProps(permissions);

      await fixture.service.create(input(fixture, {}, props));

      expect(
        props.userTenantAccessPermission?.[PROJECT_ID.toString()]?.permissions,
      ).toBe(permissions);
      expect(projectedPermissions()).toEqual([
        grant(Permission.OnCallMember, {
          scope: PermissionScope.Labels,
          labelIds: [LABEL_ID],
        }),
      ]);
      expect(reads[1]?.request.props).not.toBe(props);
      expect(createSpy.mock.calls[0]?.[0].props).toBe(props);
    });

    test.each([true, false])(
      "preserves owned create scope and caller teams despite broad read, owned=%s",
      async (owned: boolean) => {
        const props: DatabaseCommonInteractionProps = callerProps([
          grant(Permission.Viewer),
          grant(fixture.createPermission, { scope: PermissionScope.Owned }),
        ]);
        props.userTeamIds = [USER_ID];
        policyCreateScopeReadable = owned;

        const operation: Promise<Child> = fixture.service.create(
          input(fixture, {}, props),
        );
        if (owned) {
          await expect(operation).resolves.toBeInstanceOf(fixture.model);
          expect(createSpy).toHaveBeenCalledTimes(1);
        } else {
          await expect(operation).rejects.toThrow(NotAuthorizedException);
          expect(createSpy).not.toHaveBeenCalled();
        }

        expect(projectedPermissions()).toEqual([
          grant(Permission.OnCallMember, { scope: PermissionScope.Owned }),
        ]);
        expect(reads[1]?.request.props.userTeamIds).toEqual([USER_ID]);
        expect(reads[1]?.request.props.userId).toEqual(USER_ID);
        expect(reads[1]?.request.props.tenantId).toEqual(PROJECT_ID);
        expect(reads[1]?.request.props.isRoot).toBeFalsy();
      },
    );

    test("preserves label-specific blocks on the granular child create grant", async () => {
      const props: DatabaseCommonInteractionProps = callerProps([
        grant(),
        grant(fixture.createPermission, {
          scope: PermissionScope.Labels,
          labelIds: [LABEL_ID],
          isBlockPermission: true,
        }),
      ]);
      policyCreateScopeReadable = false;

      await expect(
        fixture.service.create(input(fixture, {}, props)),
      ).rejects.toThrow(NotAuthorizedException);

      expect(projectedPermissions()).toEqual([
        grant(),
        grant(Permission.OnCallMember, {
          scope: PermissionScope.Labels,
          labelIds: [LABEL_ID],
          isBlockPermission: true,
        }),
      ]);
      expect(createSpy).not.toHaveBeenCalled();
      expect(reads).toHaveLength(2);
    });

    test("does not narrow a scope-exempt project administrator grant", async () => {
      const props: DatabaseCommonInteractionProps = callerProps([
        grant(Permission.ProjectAdmin, {
          scope: PermissionScope.Owned,
          labelIds: [LABEL_ID],
        }),
      ]);

      await fixture.service.create(input(fixture, {}, props));

      expect(projectedPermissions()).toEqual([
        grant(Permission.OnCallMember, { labelIds: [LABEL_ID] }),
      ]);
      expect(createSpy).toHaveBeenCalledTimes(1);
    });

    test("requires a parent policy identifier", async () => {
      await expect(
        fixture.service.create(
          input(fixture, { onCallDutyPolicyId: undefined }),
        ),
      ).rejects.toThrow();

      expect(createSpy).not.toHaveBeenCalled();
      expect(findSpy).not.toHaveBeenCalled();
    });

    test("rejects multi-tenant creates before a parent read", async () => {
      const props: DatabaseCommonInteractionProps = {
        ...callerProps(),
        isMultiTenantRequest: true,
      };

      await expect(
        fixture.service.create(input(fixture, {}, props)),
      ).rejects.toThrow();

      expect(findSpy).not.toHaveBeenCalled();
      expect(createSpy).not.toHaveBeenCalled();
    });

    test("uses the caller's tenant when the body omits its project", async () => {
      const request: CreateBy<Child> = input(fixture, { projectId: undefined });

      await fixture.service.create(request);

      expect(request.data.projectId).toEqual(PROJECT_ID);
      expect(createSpy).toHaveBeenCalledTimes(1);
    });

    test("honors a blocked create grant before looking up the parent", async () => {
      const props: DatabaseCommonInteractionProps = callerProps([
        grant(),
        grant(Permission.OnCallMember, { isBlockPermission: true }),
      ]);

      await expect(
        fixture.service.create(input(fixture, {}, props)),
      ).rejects.toThrow(NotAuthorizedException);

      expect(findSpy).not.toHaveBeenCalled();
      expect(createSpy).not.toHaveBeenCalled();
    });

    test.each([{ isRoot: true }, { isMasterAdmin: true }])(
      "preserves trusted internal creates: %j",
      async (props: DatabaseCommonInteractionProps) => {
        const request: CreateBy<Child> = input(
          fixture,
          { onCallDutyPolicyId: undefined },
          props,
        );
        await expect(fixture.service.create(request)).resolves.toBe(
          request.data,
        );

        expect(createSpy).toHaveBeenCalledWith(request);
        expect(findSpy).not.toHaveBeenCalled();
      },
    );
  },
);

interface RelationFixture {
  scalar: string;
  relation: string;
  id: ObjectID;
  otherId: ObjectID;
  model: { new (): BaseModel };
}

const RELATIONS: Array<RelationFixture> = [
  {
    scalar: "projectId",
    relation: "project",
    id: PROJECT_ID,
    otherId: OTHER_PROJECT_ID,
    model: Project,
  },
  {
    scalar: "onCallDutyPolicyId",
    relation: "onCallDutyPolicy",
    id: POLICY_ID,
    otherId: OTHER_POLICY_ID,
    model: OnCallDutyPolicy,
  },
  {
    scalar: "onCallDutyPolicyEscalationRuleId",
    relation: "onCallDutyPolicyEscalationRule",
    id: RULE_ID,
    otherId: OTHER_RULE_ID,
    model: OnCallDutyPolicyEscalationRule,
  },
];

describe.each(RELATIONS)(
  "$relation canonicalization",
  (relation: RelationFixture) => {
    const fixture: ChildFixture = CHILDREN[1]!;

    test.each(["string", "ObjectID", "_id", "id", "model", "matching aliases"])(
      "accepts a relation-only %s and leaves one canonical foreign key",
      async (format: string) => {
        const model: BaseModel = new relation.model();
        model.id = relation.id;
        const values: Record<string, unknown> = {
          string: relation.id.toString(),
          ObjectID: relation.id,
          _id: { _id: relation.id.toString() },
          id: { id: relation.id },
          model,
          "matching aliases": { _id: relation.id.toString(), id: relation.id },
        };
        const request: CreateBy<Child> = input(fixture, {
          [relation.scalar]: undefined,
          [relation.relation]: values[format],
        });

        await fixture.service.create(request);

        expect(request.data.getColumnValue(relation.scalar)).toEqual(
          relation.id,
        );
        expect(request.data.getColumnValue(relation.scalar)).toBeInstanceOf(
          ObjectID,
        );
        expect(request.data.getColumnValue(relation.relation)).toBeNull();
        expect(createSpy).toHaveBeenCalledTimes(1);
      },
    );

    test("normalizes matching scalar and relation IDs", async () => {
      const request: CreateBy<Child> = input(fixture, {
        [relation.scalar]: relation.id.toString(),
        [relation.relation]: { _id: relation.id.toString() },
      });

      await fixture.service.create(request);

      expect(request.data.getColumnValue(relation.scalar)).toBeInstanceOf(
        ObjectID,
      );
      expect(request.data.getColumnValue(relation.relation)).toBeNull();
    });

    test("rejects disagreeing scalar and relation IDs", async () => {
      await expect(
        fixture.service.create(
          input(fixture, {
            [relation.relation]: { _id: relation.otherId.toString() },
          }),
        ),
      ).rejects.toThrow();

      expect(createSpy).not.toHaveBeenCalled();
    });

    test("rejects disagreeing _id and id aliases within a relation", async () => {
      await expect(
        fixture.service.create(
          input(fixture, {
            [relation.scalar]: undefined,
            [relation.relation]: {
              _id: relation.id.toString(),
              id: relation.otherId,
            },
          }),
        ),
      ).rejects.toThrow();

      expect(createSpy).not.toHaveBeenCalled();
    });

    test.each([
      "invalid",
      "",
      42,
      true,
      false,
      0,
      {},
      [],
      { name: "missing identifier" },
      { _id: "invalid" },
      { id: "invalid" },
    ])(
      "rejects malformed relation %j even if a valid scalar is supplied",
      async (value: unknown) => {
        await expect(
          fixture.service.create(
            input(fixture, {
              [relation.relation]: value,
            }),
          ),
        ).rejects.toThrow();

        expect(createSpy).not.toHaveBeenCalled();
      },
    );

    test.each(["invalid", "", 42, true, false, 0, {}, []])(
      "rejects malformed scalar %j even if a valid relation is supplied",
      async (value: unknown) => {
        await expect(
          fixture.service.create(
            input(fixture, {
              [relation.scalar]: value,
              [relation.relation]: { _id: relation.id.toString() },
            }),
          ),
        ).rejects.toThrow();

        expect(createSpy).not.toHaveBeenCalled();
      },
    );
  },
);

describe.each(
  CHILDREN.filter((fixture: ChildFixture): boolean => {
    return fixture.hasRule;
  }),
)("$name escalation-rule consistency", (fixture: ChildFixture) => {
  test.each(["missing", "different policy", "different project"])(
    "rejects a %s escalation rule",
    async (scenario: string) => {
      if (scenario === "missing") {
        rule = null;
      } else if (scenario === "different policy") {
        rule!.onCallDutyPolicyId = OTHER_POLICY_ID;
      } else {
        rule!.projectId = OTHER_PROJECT_ID;
      }

      await expect(fixture.service.create(input(fixture))).rejects.toThrow();

      expect(reads[2]?.model).toBe(OnCallDutyPolicyEscalationRule);
      expect(reads[2]?.request.query).toEqual(
        expect.objectContaining({
          _id: RULE_ID.toString(),
          projectId: PROJECT_ID,
          onCallDutyPolicyId: POLICY_ID,
        }),
      );
      expect(createSpy).not.toHaveBeenCalled();
    },
  );

  test.each(["onCallDutyPolicyId", "onCallDutyPolicyEscalationRuleId"])(
    "rejects missing %s",
    async (column: string) => {
      await expect(
        fixture.service.create(input(fixture, { [column]: undefined })),
      ).rejects.toThrow();

      expect(createSpy).not.toHaveBeenCalled();
    },
  );
});
