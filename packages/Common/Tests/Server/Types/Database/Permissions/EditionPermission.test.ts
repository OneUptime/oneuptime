import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import EditionPermissions from "../../../../../Server/Types/Database/Permissions/EditionPermission";
import CreatePermission from "../../../../../Server/Types/Database/Permissions/CreatePermission";
import DeletePermission from "../../../../../Server/Types/Database/Permissions/DeletePermission";
import TablePermission from "../../../../../Server/Types/Database/Permissions/TablePermission";
import UpdatePermission from "../../../../../Server/Types/Database/Permissions/UpdatePermission";
import DatabaseRequestType from "../../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import Query from "../../../../../Server/Types/Database/Query";
import EnterpriseEdition from "../../../../../Server/Enterprise/EnterpriseEdition";
import EnterpriseFeature, {
  ALL_ENTERPRISE_FEATURES,
} from "../../../../../Server/Enterprise/EnterpriseFeature";
import {
  EnterpriseLicenseSnapshot,
  EnterpriseLicenseStatus,
} from "../../../../../Server/Enterprise/EnterpriseLicenseSnapshot";
import BaseModel, {
  DatabaseBaseModelType,
} from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import GlobalConfig from "../../../../../Models/DatabaseModels/GlobalConfig";
import GlobalOIDC from "../../../../../Models/DatabaseModels/GlobalOidc";
import GlobalOIDCProject from "../../../../../Models/DatabaseModels/GlobalOidcProject";
import GlobalSSO from "../../../../../Models/DatabaseModels/GlobalSso";
import GlobalSSOProject from "../../../../../Models/DatabaseModels/GlobalSsoProject";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import Project from "../../../../../Models/DatabaseModels/Project";
import ProjectOIDC from "../../../../../Models/DatabaseModels/ProjectOidc";
import ProjectSCIM from "../../../../../Models/DatabaseModels/ProjectSCIM";
import ProjectSSO from "../../../../../Models/DatabaseModels/ProjectSso";
import StatusPageOIDC from "../../../../../Models/DatabaseModels/StatusPageOidc";
import StatusPageSCIM from "../../../../../Models/DatabaseModels/StatusPageSCIM";
import StatusPageSSO from "../../../../../Models/DatabaseModels/StatusPageSso";
import Team from "../../../../../Models/DatabaseModels/Team";
import TeamComplianceSetting from "../../../../../Models/DatabaseModels/TeamComplianceSetting";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthenticatedException from "../../../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../../../Types/Exception/PaymentRequiredException";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../../../Types/Permission";
import FakeEnterpriseModule, {
  createLicenseSnapshot,
  createLicenseSnapshotWithStatus,
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "../../../Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "../../../Enterprise/TestBillingFlag";

/*
 * EditionPermission is the license gate on enterprise CONFIGURATION: creating
 * or updating the eleven @TableEditionAccessControl({ requiresEnterprise })
 * models (project, global and status page SSO/OIDC, SCIM, team compliance).
 *
 * The rules under test (design v2 section 0 and 3):
 *   - billing on (the cloud): never refuses; plan gates live in
 *     BillingPermission.
 *   - internal root writes: never refused.
 *   - read and delete: always allowed, so a downgraded install can still see
 *     and remove what it configured.
 *   - create and update, INCLUDING by master admins: the Community Edition is
 *     refused with the Community message; the Enterprise Edition is allowed
 *     exactly when the license snapshot is valid or in grace AND entitles the
 *     model's feature, and refused with the license message otherwise.
 *   - an unknown snapshot (the first load has not finished, or reading it
 *     throws) refuses writes - fail closed.
 *
 * Billing and the edition are pinned in every test: CI's config.env sets
 * BILLING_ENABLED=true, so an unpinned suite would only test the cloud path
 * there.
 */
jest.mock("../../../../../Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("../../../Enterprise/TestBillingFlag") =
    jest.requireActual(
      "../../../Enterprise/TestBillingFlag",
    ) as typeof import("../../../Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("../../../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

type ModelType = DatabaseBaseModelType;

type Caller = "regular user" | "master admin" | "root";

type Outcome = "allowed" | "community" | "license";

type EditionState =
  | { kind: "community" }
  | { kind: "enterprise"; snapshot: EnterpriseLicenseSnapshot | null };

const ENTERPRISE_MODELS: ReadonlyArray<[string, ModelType, EnterpriseFeature]> =
  [
    ["GlobalSSO", GlobalSSO, EnterpriseFeature.SSO],
    ["GlobalOIDC", GlobalOIDC, EnterpriseFeature.SSO],
    ["GlobalSSOProject", GlobalSSOProject, EnterpriseFeature.SSO],
    ["GlobalOIDCProject", GlobalOIDCProject, EnterpriseFeature.SSO],
    ["ProjectSSO", ProjectSSO, EnterpriseFeature.SSO],
    ["ProjectOIDC", ProjectOIDC, EnterpriseFeature.SSO],
    ["StatusPageSSO", StatusPageSSO, EnterpriseFeature.SSO],
    ["StatusPageOIDC", StatusPageOIDC, EnterpriseFeature.SSO],
    ["ProjectSCIM", ProjectSCIM, EnterpriseFeature.SCIM],
    ["StatusPageSCIM", StatusPageSCIM, EnterpriseFeature.SCIM],
    [
      "TeamComplianceSetting",
      TeamComplianceSetting,
      EnterpriseFeature.TeamCompliance,
    ],
  ];

const ORDINARY_MODELS: ReadonlyArray<[string, ModelType]> = [
  ["Project", Project],
  ["Monitor", Monitor],
  ["Team", Team],
  ["GlobalConfig", GlobalConfig],
];

const ALL_OPERATIONS: ReadonlyArray<DatabaseRequestType> = [
  DatabaseRequestType.Create,
  DatabaseRequestType.Read,
  DatabaseRequestType.Update,
  DatabaseRequestType.Delete,
];

const ALL_CALLERS: ReadonlyArray<Caller> = [
  "regular user",
  "master admin",
  "root",
];

const ALL_STATUSES: ReadonlyArray<EnterpriseLicenseStatus> = [
  "missing",
  "valid",
  "grace",
  "expired",
  "invalid",
];

const USABLE_STATUSES: ReadonlyArray<EnterpriseLicenseStatus> = [
  "valid",
  "grace",
];

const UNUSABLE_STATUSES: ReadonlyArray<EnterpriseLicenseStatus> = [
  "missing",
  "expired",
  "invalid",
];

const projectId: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const userId: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");

const buildUserProps: (
  permissions: Array<Permission>,
) => DatabaseCommonInteractionProps = (
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps => {
  const tenantPermission: UserTenantAccessPermission = {
    projectId,
    _type: "UserTenantAccessPermission",
    permissions: permissions.map((permission: Permission) => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
      };
    }),
  } as UserTenantAccessPermission;

  return {
    userId,
    tenantId: projectId,
    userTenantAccessPermission: {
      [projectId.toString()]: tenantPermission,
    },
  };
};

const propsFor: (caller: Caller) => DatabaseCommonInteractionProps = (
  caller: Caller,
): DatabaseCommonInteractionProps => {
  if (caller === "root") {
    return { isRoot: true };
  }

  if (caller === "master admin") {
    return { userId, isMasterAdmin: true };
  }

  return buildUserProps([Permission.ProjectOwner]);
};

const describeEdition: (edition: EditionState) => string = (
  edition: EditionState,
): string => {
  if (edition.kind === "community") {
    return "community";
  }

  if (!edition.snapshot) {
    return "enterprise(no snapshot yet)";
  }

  const features: string =
    edition.snapshot.features === "all"
      ? "all"
      : `[${edition.snapshot.features.join(",")}]`;

  return `enterprise(${edition.snapshot.status}, features=${features})`;
};

const installEdition: (edition: EditionState) => void = (
  edition: EditionState,
): void => {
  if (edition.kind === "community") {
    uninstallEnterpriseModule();
    return;
  }

  installFakeEnterpriseModule({ snapshot: edition.snapshot });
};

const entitles: (
  snapshot: EnterpriseLicenseSnapshot | null,
  feature: EnterpriseFeature,
) => boolean = (
  snapshot: EnterpriseLicenseSnapshot | null,
  feature: EnterpriseFeature,
): boolean => {
  if (!snapshot) {
    return false;
  }

  if (!USABLE_STATUSES.includes(snapshot.status)) {
    return false;
  }

  return snapshot.features === "all" || snapshot.features.includes(feature);
};

// The rule, written independently of the implementation.
const expectedOutcome: (input: {
  billing: boolean;
  edition: EditionState;
  operation: DatabaseRequestType;
  caller: Caller;
  feature: EnterpriseFeature | null;
}) => Outcome = (input: {
  billing: boolean;
  edition: EditionState;
  operation: DatabaseRequestType;
  caller: Caller;
  feature: EnterpriseFeature | null;
}): Outcome => {
  if (!input.feature) {
    return "allowed";
  }

  if (input.billing || input.caller === "root") {
    return "allowed";
  }

  if (
    input.operation === DatabaseRequestType.Read ||
    input.operation === DatabaseRequestType.Delete
  ) {
    return "allowed";
  }

  if (input.edition.kind === "community") {
    return "community";
  }

  return entitles(input.edition.snapshot, input.feature)
    ? "allowed"
    : "license";
};

const runEditionCheck: (input: {
  modelType: ModelType;
  operation: DatabaseRequestType;
  caller: Caller;
}) => Outcome = (input: {
  modelType: ModelType;
  operation: DatabaseRequestType;
  caller: Caller;
}): Outcome => {
  try {
    const result: unknown = EditionPermissions.checkEditionPermissions(
      input.modelType,
      propsFor(input.caller),
      input.operation,
    );

    // A Promise here would mean a refusal could be lost to a missed await.
    expect(result).toBeUndefined();

    return "allowed";
  } catch (err) {
    if (!(err instanceof PaymentRequiredException)) {
      throw err;
    }

    if (err.message === EnterpriseEdition.COMMUNITY_EDITION_MESSAGE) {
      return "community";
    }

    if (err.message === EnterpriseEdition.LICENSE_REQUIRED_MESSAGE) {
      return "license";
    }

    throw err;
  }
};

/*
 * Runs every model x operation x caller combination for one billing/edition
 * state and returns the combinations whose outcome differs from the rule.
 * One readable list on failure instead of hundreds of generated tests.
 */
const findMismatches: (input: {
  billing: boolean;
  edition: EditionState;
  models: ReadonlyArray<[string, ModelType, EnterpriseFeature | null]>;
}) => Array<string> = (input: {
  billing: boolean;
  edition: EditionState;
  models: ReadonlyArray<[string, ModelType, EnterpriseFeature | null]>;
}): Array<string> => {
  setTestBillingEnabled(input.billing);
  installEdition(input.edition);

  const mismatches: Array<string> = [];

  for (const [modelName, modelType, feature] of input.models) {
    for (const operation of ALL_OPERATIONS) {
      for (const caller of ALL_CALLERS) {
        const expected: Outcome = expectedOutcome({
          billing: input.billing,
          edition: input.edition,
          operation,
          caller,
          feature,
        });
        const actual: Outcome = runEditionCheck({
          modelType,
          operation,
          caller,
        });

        if (expected !== actual) {
          mismatches.push(
            `billing=${input.billing} ${describeEdition(input.edition)} ${modelName} ${operation} as ${caller}: expected ${expected}, got ${actual}`,
          );
        }
      }
    }
  }

  return mismatches;
};

const allEditionStates: () => Array<EditionState> = (): Array<EditionState> => {
  const states: Array<EditionState> = [{ kind: "community" }];

  for (const status of ALL_STATUSES) {
    states.push({
      kind: "enterprise",
      snapshot: createLicenseSnapshotWithStatus(status),
    });
  }

  states.push({ kind: "enterprise", snapshot: null });

  return states;
};

describe("EditionPermission.checkEditionPermissions", () => {
  beforeEach(() => {
    setTestBillingEnabled(false);
    uninstallEnterpriseModule();
  });

  afterEach(() => {
    uninstallEnterpriseModule();
    setTestBillingEnabled(false);
    jest.restoreAllMocks();
  });

  describe("the full matrix (billing x edition x license status x operation x caller x model)", () => {
    test.each([true, false])(
      "billing=%p: every enterprise model follows the rule in every edition state",
      (billing: boolean) => {
        const mismatches: Array<string> = [];

        for (const edition of allEditionStates()) {
          mismatches.push(
            ...findMismatches({
              billing,
              edition,
              models: ENTERPRISE_MODELS,
            }),
          );
        }

        expect(mismatches).toEqual([]);
      },
    );

    test.each([true, false])(
      "billing=%p: ordinary models are never gated in any edition state",
      (billing: boolean) => {
        const mismatches: Array<string> = [];

        for (const edition of allEditionStates()) {
          mismatches.push(
            ...findMismatches({
              billing,
              edition,
              models: ORDINARY_MODELS.map(
                ([name, modelType]: [string, ModelType]): [
                  string,
                  ModelType,
                  null,
                ] => {
                  return [name, modelType, null];
                },
              ),
            }),
          );
        }

        expect(mismatches).toEqual([]);
      },
    );
  });

  describe("billing on (the cloud)", () => {
    test.each(ENTERPRISE_MODELS)(
      "%s: never refused, even on the Community Edition with no license",
      (_name: string, modelType: ModelType) => {
        setTestBillingEnabled(true);
        uninstallEnterpriseModule();

        for (const caller of ALL_CALLERS) {
          for (const operation of ALL_OPERATIONS) {
            expect(runEditionCheck({ modelType, operation, caller })).toBe(
              "allowed",
            );
          }
        }
      },
    );

    test("never refused on the Enterprise Edition whatever the license says", () => {
      setTestBillingEnabled(true);

      for (const status of ALL_STATUSES) {
        installFakeEnterpriseModule({
          snapshot: createLicenseSnapshotWithStatus(status, { features: [] }),
        });

        expect(
          runEditionCheck({
            modelType: ProjectSSO,
            operation: DatabaseRequestType.Create,
            caller: "regular user",
          }),
        ).toBe("allowed");
      }
    });
  });

  describe("billing off, Community Edition", () => {
    test.each(ENTERPRISE_MODELS)(
      "%s: create and update are refused with the Community Edition message, for users and master admins",
      (_name: string, modelType: ModelType) => {
        for (const caller of [
          "regular user",
          "master admin",
        ] as Array<Caller>) {
          for (const operation of [
            DatabaseRequestType.Create,
            DatabaseRequestType.Update,
          ]) {
            expect(() => {
              EditionPermissions.checkEditionPermissions(
                modelType,
                propsFor(caller),
                operation,
              );
            }).toThrow(
              new PaymentRequiredException(
                EnterpriseEdition.COMMUNITY_EDITION_MESSAGE,
              ),
            );
          }
        }
      },
    );

    test.each(ENTERPRISE_MODELS)(
      "%s: read and delete stay allowed so leftover configuration can be seen and removed",
      (_name: string, modelType: ModelType) => {
        for (const caller of ALL_CALLERS) {
          for (const operation of [
            DatabaseRequestType.Read,
            DatabaseRequestType.Delete,
          ]) {
            expect(runEditionCheck({ modelType, operation, caller })).toBe(
              "allowed",
            );
          }
        }
      },
    );

    test.each(ENTERPRISE_MODELS)(
      "%s: internal root writes are never checked",
      (_name: string, modelType: ModelType) => {
        for (const operation of ALL_OPERATIONS) {
          expect(
            runEditionCheck({ modelType, operation, caller: "root" }),
          ).toBe("allowed");
        }

        // Root wins even when the props also claim master admin.
        expect(() => {
          EditionPermissions.checkEditionPermissions(
            modelType,
            { isRoot: true, isMasterAdmin: true },
            DatabaseRequestType.Create,
          );
        }).not.toThrow();
      },
    );
  });

  describe("billing off, Enterprise Edition", () => {
    test.each(USABLE_STATUSES)(
      "a %s license allows creating and updating every enterprise model",
      (status: EnterpriseLicenseStatus) => {
        installFakeEnterpriseModule({
          snapshot: createLicenseSnapshotWithStatus(status),
        });

        for (const [, modelType] of ENTERPRISE_MODELS) {
          for (const caller of ALL_CALLERS) {
            expect(
              runEditionCheck({
                modelType,
                operation: DatabaseRequestType.Create,
                caller,
              }),
            ).toBe("allowed");
            expect(
              runEditionCheck({
                modelType,
                operation: DatabaseRequestType.Update,
                caller,
              }),
            ).toBe("allowed");
          }
        }
      },
    );

    test.each(UNUSABLE_STATUSES)(
      "a %s license makes enterprise configuration read-only, including for master admins",
      (status: EnterpriseLicenseStatus) => {
        installFakeEnterpriseModule({
          snapshot: createLicenseSnapshotWithStatus(status),
        });

        for (const [, modelType] of ENTERPRISE_MODELS) {
          for (const caller of [
            "regular user",
            "master admin",
          ] as Array<Caller>) {
            expect(() => {
              EditionPermissions.checkEditionPermissions(
                modelType,
                propsFor(caller),
                DatabaseRequestType.Create,
              );
            }).toThrow(
              new PaymentRequiredException(
                EnterpriseEdition.LICENSE_REQUIRED_MESSAGE,
              ),
            );
            expect(
              runEditionCheck({
                modelType,
                operation: DatabaseRequestType.Update,
                caller,
              }),
            ).toBe("license");
            expect(
              runEditionCheck({
                modelType,
                operation: DatabaseRequestType.Read,
                caller,
              }),
            ).toBe("allowed");
            expect(
              runEditionCheck({
                modelType,
                operation: DatabaseRequestType.Delete,
                caller,
              }),
            ).toBe("allowed");
          }
        }
      },
    );

    test("before the first license load finishes (no snapshot) writes are refused - fail closed", () => {
      installFakeEnterpriseModule({ snapshot: null });

      expect(
        runEditionCheck({
          modelType: GlobalSSO,
          operation: DatabaseRequestType.Create,
          caller: "master admin",
        }),
      ).toBe("license");
      expect(
        runEditionCheck({
          modelType: GlobalSSO,
          operation: DatabaseRequestType.Read,
          caller: "master admin",
        }),
      ).toBe("allowed");
    });

    test("a snapshot read that throws refuses writes - fail closed", () => {
      const fake: FakeEnterpriseModule = installFakeEnterpriseModule();
      fake.licensing.getCachedSnapshotError = new Error("cache exploded");

      expect(
        runEditionCheck({
          modelType: ProjectSSO,
          operation: DatabaseRequestType.Update,
          caller: "regular user",
        }),
      ).toBe("license");
      expect(
        runEditionCheck({
          modelType: ProjectSSO,
          operation: DatabaseRequestType.Delete,
          caller: "regular user",
        }),
      ).toBe("allowed");
    });

    test("the check follows the license as it changes, with no restart", () => {
      const fake: FakeEnterpriseModule = installFakeEnterpriseModule({
        snapshot: createLicenseSnapshotWithStatus("valid"),
      });

      expect(
        runEditionCheck({
          modelType: ProjectSCIM,
          operation: DatabaseRequestType.Create,
          caller: "regular user",
        }),
      ).toBe("allowed");

      fake.setSnapshot(createLicenseSnapshotWithStatus("expired"));

      expect(
        runEditionCheck({
          modelType: ProjectSCIM,
          operation: DatabaseRequestType.Create,
          caller: "regular user",
        }),
      ).toBe("license");

      fake.setSnapshot(createLicenseSnapshotWithStatus("grace"));

      expect(
        runEditionCheck({
          modelType: ProjectSCIM,
          operation: DatabaseRequestType.Create,
          caller: "regular user",
        }),
      ).toBe("allowed");
    });
  });

  describe("each model is gated by its own license feature", () => {
    test.each(ENTERPRISE_MODELS)(
      "%s: a license entitling only %s allows writes",
      (_name: string, modelType: ModelType, feature: EnterpriseFeature) => {
        installFakeEnterpriseModule({
          snapshot: createLicenseSnapshot({ features: [feature] }),
        });

        expect(EnterpriseEdition.getModelFeature(modelType)).toBe(feature);
        expect(
          runEditionCheck({
            modelType,
            operation: DatabaseRequestType.Create,
            caller: "master admin",
          }),
        ).toBe("allowed");
        expect(
          runEditionCheck({
            modelType,
            operation: DatabaseRequestType.Update,
            caller: "regular user",
          }),
        ).toBe("allowed");
      },
    );

    test.each(ENTERPRISE_MODELS)(
      "%s: a license entitling every feature except %s refuses writes",
      (_name: string, modelType: ModelType, feature: EnterpriseFeature) => {
        installFakeEnterpriseModule({
          snapshot: createLicenseSnapshot({
            features: ALL_ENTERPRISE_FEATURES.filter(
              (candidate: EnterpriseFeature): boolean => {
                return candidate !== feature;
              },
            ),
          }),
        });

        expect(
          runEditionCheck({
            modelType,
            operation: DatabaseRequestType.Create,
            caller: "master admin",
          }),
        ).toBe("license");
        expect(
          runEditionCheck({
            modelType,
            operation: DatabaseRequestType.Update,
            caller: "regular user",
          }),
        ).toBe("license");
        expect(
          runEditionCheck({
            modelType,
            operation: DatabaseRequestType.Read,
            caller: "regular user",
          }),
        ).toBe("allowed");
      },
    );

    test("an empty feature list entitles nothing", () => {
      installFakeEnterpriseModule({
        snapshot: createLicenseSnapshot({ features: [] }),
      });

      for (const [, modelType] of ENTERPRISE_MODELS) {
        expect(
          runEditionCheck({
            modelType,
            operation: DatabaseRequestType.Create,
            caller: "regular user",
          }),
        ).toBe("license");
      }
    });
  });

  describe("an enterprise model the facade has no feature for", () => {
    /*
     * The facade's guard test should make this impossible; if it ever
     * happens the gate must fail closed rather than let the write through.
     */
    class UnmappedEnterpriseModel extends Monitor {}

    beforeEach(() => {
      (UnmappedEnterpriseModel.prototype as BaseModel).requiresEnterprise =
        true;
      (UnmappedEnterpriseModel.prototype as BaseModel).tableName =
        "UnmappedEnterpriseModelForTest";
    });

    test("maps to no feature", () => {
      expect(
        EnterpriseEdition.getModelFeature(UnmappedEnterpriseModel),
      ).toBeNull();
      expect(new UnmappedEnterpriseModel().requiresEnterprise).toBe(true);
    });

    test("is refused on the Community Edition", () => {
      expect(
        runEditionCheck({
          modelType: UnmappedEnterpriseModel,
          operation: DatabaseRequestType.Create,
          caller: "regular user",
        }),
      ).toBe("community");
    });

    test("needs a license that entitles every enterprise feature", () => {
      installFakeEnterpriseModule({
        snapshot: createLicenseSnapshot({ features: "all" }),
      });

      expect(
        runEditionCheck({
          modelType: UnmappedEnterpriseModel,
          operation: DatabaseRequestType.Update,
          caller: "regular user",
        }),
      ).toBe("allowed");

      installFakeEnterpriseModule({
        snapshot: createLicenseSnapshot({
          features: ALL_ENTERPRISE_FEATURES.filter(
            (feature: EnterpriseFeature): boolean => {
              return feature !== EnterpriseFeature.InstanceHealth;
            },
          ),
        }),
      });

      expect(
        runEditionCheck({
          modelType: UnmappedEnterpriseModel,
          operation: DatabaseRequestType.Update,
          caller: "regular user",
        }),
      ).toBe("license");
    });

    test("is still readable and deletable", () => {
      expect(
        runEditionCheck({
          modelType: UnmappedEnterpriseModel,
          operation: DatabaseRequestType.Read,
          caller: "regular user",
        }),
      ).toBe("allowed");
      expect(
        runEditionCheck({
          modelType: UnmappedEnterpriseModel,
          operation: DatabaseRequestType.Delete,
          caller: "regular user",
        }),
      ).toBe("allowed");
    });
  });
});

describe("EditionPermission wiring through the permission entry points", () => {
  beforeEach(() => {
    setTestBillingEnabled(false);
    uninstallEnterpriseModule();
  });

  afterEach(() => {
    uninstallEnterpriseModule();
    setTestBillingEnabled(false);
    jest.restoreAllMocks();
  });

  describe("CreatePermission: master admins are checked before their early return", () => {
    test("a master admin cannot create a global SSO provider on the Community Edition", () => {
      expect(() => {
        CreatePermission.checkCreatePermissions(GlobalSSO, new GlobalSSO(), {
          userId,
          isMasterAdmin: true,
        });
      }).toThrow(
        new PaymentRequiredException(
          EnterpriseEdition.COMMUNITY_EDITION_MESSAGE,
        ),
      );
    });

    test("a master admin cannot create a global OIDC provider when the license expired", () => {
      installFakeEnterpriseModule({
        snapshot: createLicenseSnapshotWithStatus("expired"),
      });

      expect(() => {
        CreatePermission.checkCreatePermissions(GlobalOIDC, new GlobalOIDC(), {
          userId,
          isMasterAdmin: true,
        });
      }).toThrow(
        new PaymentRequiredException(
          EnterpriseEdition.LICENSE_REQUIRED_MESSAGE,
        ),
      );
    });

    test("a master admin can create one with a valid license", () => {
      installFakeEnterpriseModule();

      expect(() => {
        CreatePermission.checkCreatePermissions(GlobalSSO, new GlobalSSO(), {
          userId,
          isMasterAdmin: true,
        });
      }).not.toThrow();
    });

    test("internal root writes are not checked", () => {
      expect(() => {
        CreatePermission.checkCreatePermissions(GlobalSSO, new GlobalSSO(), {
          isRoot: true,
        });
      }).not.toThrow();
      expect(() => {
        CreatePermission.checkCreatePermissions(GlobalSSO, new GlobalSSO(), {
          isRoot: true,
          isMasterAdmin: true,
        });
      }).not.toThrow();
    });

    test("a master admin creating an ordinary model is unaffected", () => {
      expect(() => {
        CreatePermission.checkCreatePermissions(Project, new Project(), {
          userId,
          isMasterAdmin: true,
        });
      }).not.toThrow();
    });

    test("billing on leaves master admin creates to the plan gates", () => {
      setTestBillingEnabled(true);

      expect(() => {
        CreatePermission.checkCreatePermissions(GlobalSSO, new GlobalSSO(), {
          userId,
          isMasterAdmin: true,
        });
      }).not.toThrow();
    });
  });

  describe("UpdatePermission: master admins are checked before their early return", () => {
    const query: Query<GlobalSSO> = { name: "Okta" } as Query<GlobalSSO>;

    test("a master admin cannot update a global SSO provider on the Community Edition", async () => {
      await expect(
        UpdatePermission.checkUpdatePermissions(
          GlobalSSO,
          query,
          { isEnabled: false },
          { userId, isMasterAdmin: true },
        ),
      ).rejects.toThrow(
        new PaymentRequiredException(
          EnterpriseEdition.COMMUNITY_EDITION_MESSAGE,
        ),
      );
    });

    test.each(UNUSABLE_STATUSES)(
      "a master admin cannot update one with a %s license",
      async (status: EnterpriseLicenseStatus) => {
        installFakeEnterpriseModule({
          snapshot: createLicenseSnapshotWithStatus(status),
        });

        await expect(
          UpdatePermission.checkUpdatePermissions(
            GlobalSSO,
            query,
            { isEnabled: false },
            { userId, isMasterAdmin: true },
          ),
        ).rejects.toThrow(
          new PaymentRequiredException(
            EnterpriseEdition.LICENSE_REQUIRED_MESSAGE,
          ),
        );
      },
    );

    test.each(USABLE_STATUSES)(
      "a master admin can update one with a %s license, and the query is returned unchanged",
      async (status: EnterpriseLicenseStatus) => {
        installFakeEnterpriseModule({
          snapshot: createLicenseSnapshotWithStatus(status),
        });

        await expect(
          UpdatePermission.checkUpdatePermissions(
            GlobalSSO,
            query,
            { isEnabled: false },
            { userId, isMasterAdmin: true },
          ),
        ).resolves.toBe(query);
      },
    );

    test("internal root updates are not checked", async () => {
      await expect(
        UpdatePermission.checkUpdatePermissions(
          GlobalSSO,
          query,
          { isEnabled: false },
          { isRoot: true },
        ),
      ).resolves.toBe(query);
    });
  });

  describe("DeletePermission: removing leftover configuration always works", () => {
    test.each(ENTERPRISE_MODELS)(
      "a master admin can delete %s on the Community Edition",
      async (_name: string, modelType: ModelType) => {
        await expect(
          DeletePermission.checkDeletePermission(
            modelType,
            {},
            { userId, isMasterAdmin: true },
          ),
        ).resolves.toEqual({});
      },
    );

    test("a project owner passes the table-level delete check on the Community Edition", () => {
      expect(() => {
        TablePermission.checkTableLevelPermissions(
          ProjectSSO,
          buildUserProps([Permission.ProjectOwner]),
          DatabaseRequestType.Delete,
        );
      }).not.toThrow();
    });
  });

  describe("TablePermission: the operation reaches the edition check", () => {
    test("a project owner's create is refused on the Community Edition", () => {
      expect(() => {
        TablePermission.checkTableLevelPermissions(
          ProjectSSO,
          buildUserProps([Permission.ProjectOwner]),
          DatabaseRequestType.Create,
        );
      }).toThrow(PaymentRequiredException);
    });

    test("a project owner's read is allowed on the Community Edition", () => {
      expect(() => {
        TablePermission.checkTableLevelPermissions(
          ProjectSSO,
          buildUserProps([Permission.ProjectOwner]),
          DatabaseRequestType.Read,
        );
      }).not.toThrow();
    });

    test("a project owner's create passes with a valid license", () => {
      installFakeEnterpriseModule();

      expect(() => {
        TablePermission.checkTableLevelPermissions(
          ProjectSSO,
          buildUserProps([Permission.ProjectOwner]),
          DatabaseRequestType.Create,
        );
      }).not.toThrow();
    });

    test("the edition check does not replace the permission check: a licensed install still refuses a user without permission", () => {
      installFakeEnterpriseModule();

      expect(() => {
        TablePermission.checkTableLevelPermissions(
          ProjectSSO,
          buildUserProps([Permission.ProjectMember]),
          DatabaseRequestType.Create,
        );
      }).toThrow(NotAuthorizedException);
    });

    test("a signed-out caller still gets 'not logged in' before any edition answer", () => {
      expect(() => {
        TablePermission.checkTableLevelPermissions(
          ProjectSSO,
          {},
          DatabaseRequestType.Create,
        );
      }).toThrow(NotAuthenticatedException);
    });
  });
});
