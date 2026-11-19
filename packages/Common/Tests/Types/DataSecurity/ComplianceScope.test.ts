import { describe, expect, test } from "@jest/globals";
import ComplianceFramework from "../../../Types/DataSecurity/ComplianceFramework";
import {
  ComplianceFrameworkResult,
  ComplianceIssueInput,
  ComplianceRequirementResult,
  ComplianceRequirementStatus,
  ComplianceScopeExclusions,
  ComplianceStoreInput,
  getRequirementsOf,
  isRequirementOf,
  scoreComplianceFramework,
} from "../../../Types/DataSecurity/ComplianceRequirementCatalog";
import {
  ComplianceScopeSetting,
  ComplianceScopeStore,
  getComplianceScopeExclusions,
  getComplianceSettingKey,
  getEffectiveSettings,
  getResourceFrameworkScope,
  getSettingRequirement,
  readComplianceScopeSetting,
} from "../../../Types/DataSecurity/ComplianceScope";
import {
  DataStoreResourceKind,
  DataStoreResourceRef,
} from "../../../Types/DataSecurity/DataStoreResource";

/*
 * WHAT A RESOURCE TURNED OFF (#9555).
 *
 * A Kubernetes cluster, a container host, a database, a cloud resource or a
 * service can turn a framework off for its own stores, or one requirement
 * of one. The stores it owns then leave the framework's scope, or stop
 * failing that requirement, wherever the framework is scored; the other
 * resources' stores count as before, and turning it on again puts
 * everything back.
 */

const CLUSTER: DataStoreResourceRef = {
  kind: DataStoreResourceKind.KubernetesCluster,
  id: "11111111-1111-4111-8111-111111111111",
};
const SERVICE: DataStoreResourceRef = {
  kind: DataStoreResourceKind.Service,
  id: "66666666-6666-4666-8666-666666666666",
};
const BUCKET: DataStoreResourceRef = {
  kind: DataStoreResourceKind.CloudResource,
  id: "55555555-5555-4555-8555-555555555555",
};

// Two databases on the cluster, a service's logs, and a store no resource holds.
const STORES: Array<ComplianceScopeStore> = [
  { id: "orders-db", owner: CLUSTER },
  { id: "cache", owner: CLUSTER },
  { id: "checkout-logs", owner: SERVICE },
  { id: "shadow-db", owner: null },
];

function off(
  resource: DataStoreResourceRef,
  framework: ComplianceFramework,
  requirement?: string,
): ComplianceScopeSetting {
  return { resource, framework, requirement, isEnabled: false };
}

function on(
  resource: DataStoreResourceRef,
  framework: ComplianceFramework,
  requirement?: string,
): ComplianceScopeSetting {
  return { resource, framework, requirement, isEnabled: true };
}

function sorted(set: ReadonlySet<string> | undefined): Array<string> {
  return Array.from(set || []).sort();
}

describe("which stores a framework leaves out", () => {
  test("a framework turned off on a resource leaves out every store it owns, and only those", () => {
    const exclusions: ComplianceScopeExclusions = getComplianceScopeExclusions(
      ComplianceFramework.PCIDSS,
      STORES,
      [off(CLUSTER, ComplianceFramework.PCIDSS)],
    );

    expect(sorted(exclusions.storeIds)).toEqual(["cache", "orders-db"]);
    expect(exclusions.requirementStoreIds?.size).toBe(0);
  });

  test("another framework is untouched", () => {
    const exclusions: ComplianceScopeExclusions = getComplianceScopeExclusions(
      ComplianceFramework.SOC2,
      STORES,
      [off(CLUSTER, ComplianceFramework.PCIDSS)],
    );

    expect(sorted(exclusions.storeIds)).toEqual([]);
  });

  test("a requirement turned off leaves the resource's stores out of that requirement alone", () => {
    const exclusions: ComplianceScopeExclusions = getComplianceScopeExclusions(
      ComplianceFramework.SOC2,
      STORES,
      [off(SERVICE, ComplianceFramework.SOC2, "A1.2")],
    );

    expect(sorted(exclusions.storeIds)).toEqual([]);
    expect(sorted(exclusions.requirementStoreIds?.get("A1.2"))).toEqual([
      "checkout-logs",
    ]);
    expect(exclusions.requirementStoreIds?.get("CC6.1")).toBeUndefined();
  });

  test("two resources turning one requirement off add up", () => {
    const exclusions: ComplianceScopeExclusions = getComplianceScopeExclusions(
      ComplianceFramework.SOC2,
      STORES,
      [
        off(SERVICE, ComplianceFramework.SOC2, "A1.2"),
        off(CLUSTER, ComplianceFramework.SOC2, "A1.2"),
      ],
    );

    expect(sorted(exclusions.requirementStoreIds?.get("A1.2"))).toEqual([
      "cache",
      "checkout-logs",
      "orders-db",
    ]);
  });

  test("a setting that is on leaves nothing out", () => {
    const exclusions: ComplianceScopeExclusions = getComplianceScopeExclusions(
      ComplianceFramework.PCIDSS,
      STORES,
      [on(CLUSTER, ComplianceFramework.PCIDSS)],
    );

    expect(sorted(exclusions.storeIds)).toEqual([]);
  });

  test("turned off, then on again: the last word stands", () => {
    const exclusions: ComplianceScopeExclusions = getComplianceScopeExclusions(
      ComplianceFramework.PCIDSS,
      STORES,
      [
        off(CLUSTER, ComplianceFramework.PCIDSS),
        on(CLUSTER, ComplianceFramework.PCIDSS),
      ],
    );

    expect(sorted(exclusions.storeIds)).toEqual([]);
  });

  test("a resource with no stores, or a store no resource holds, changes nothing", () => {
    const exclusions: ComplianceScopeExclusions = getComplianceScopeExclusions(
      ComplianceFramework.GDPR,
      STORES,
      [off(BUCKET, ComplianceFramework.GDPR)],
    );

    expect(sorted(exclusions.storeIds)).toEqual([]);
    expect(
      sorted(
        getComplianceScopeExclusions(
          ComplianceFramework.GDPR,
          [{ id: "shadow-db", owner: null }],
          [off(CLUSTER, ComplianceFramework.GDPR)],
        ).storeIds,
      ),
    ).toEqual([]);
  });

  test("a resource is matched by its kind and id, whatever the id's case", () => {
    const exclusions: ComplianceScopeExclusions = getComplianceScopeExclusions(
      ComplianceFramework.GDPR,
      STORES,
      [
        off(
          { kind: CLUSTER.kind, id: CLUSTER.id.toUpperCase() },
          ComplianceFramework.GDPR,
        ),
        // The same id under another kind is another resource.
        off(
          { kind: DataStoreResourceKind.DockerHost, id: SERVICE.id },
          ComplianceFramework.GDPR,
        ),
      ],
    );

    expect(sorted(exclusions.storeIds)).toEqual(["cache", "orders-db"]);
  });
});

describe("one setting per resource, framework and requirement", () => {
  test("the framework itself and a requirement of it are two settings", () => {
    expect(
      getComplianceSettingKey(off(CLUSTER, ComplianceFramework.SOC2)),
    ).not.toBe(
      getComplianceSettingKey(off(CLUSTER, ComplianceFramework.SOC2, "A1.2")),
    );
  });

  test("no requirement, an empty one and spaces are all the framework itself", () => {
    expect(getSettingRequirement({ requirement: undefined })).toBe("");
    expect(getSettingRequirement({ requirement: null })).toBe("");
    expect(getSettingRequirement({ requirement: "  " })).toBe("");
    expect(getSettingRequirement({ requirement: " A1.2 " })).toBe("A1.2");
  });

  test("the last of two rows for one setting wins", () => {
    expect(
      getEffectiveSettings([
        on(CLUSTER, ComplianceFramework.SOC2, "A1.2"),
        off(CLUSTER, ComplianceFramework.SOC2, "A1.2"),
        off(SERVICE, ComplianceFramework.SOC2),
      ]),
    ).toEqual([
      off(CLUSTER, ComplianceFramework.SOC2, "A1.2"),
      off(SERVICE, ComplianceFramework.SOC2),
    ]);
  });
});

describe("what one resource turned off, for its Compliance page", () => {
  test("the framework, and each requirement it turned off", () => {
    const settings: Array<ComplianceScopeSetting> = [
      off(CLUSTER, ComplianceFramework.SOC2, "A1.2"),
      off(CLUSTER, ComplianceFramework.SOC2, "CC6.7"),
      off(CLUSTER, ComplianceFramework.HIPAA),
      off(SERVICE, ComplianceFramework.SOC2),
      on(CLUSTER, ComplianceFramework.SOC2, "CC7.2"),
    ];

    expect(
      getResourceFrameworkScope(CLUSTER, ComplianceFramework.SOC2, settings),
    ).toEqual({ isTurnedOff: false, turnedOffRequirements: ["A1.2", "CC6.7"] });
    expect(
      getResourceFrameworkScope(CLUSTER, ComplianceFramework.HIPAA, settings),
    ).toEqual({ isTurnedOff: true, turnedOffRequirements: [] });
    expect(
      getResourceFrameworkScope(SERVICE, ComplianceFramework.SOC2, settings),
    ).toEqual({ isTurnedOff: true, turnedOffRequirements: [] });
    expect(
      getResourceFrameworkScope(BUCKET, ComplianceFramework.SOC2, settings),
    ).toEqual({ isTurnedOff: false, turnedOffRequirements: [] });
  });
});

describe("reading a stored setting", () => {
  test("a row of a known resource kind and framework is read as it was written", () => {
    expect(
      readComplianceScopeSetting({
        resourceType: "KubernetesCluster",
        resourceId: ` ${CLUSTER.id} `,
        framework: "PCI DSS",
        requirement: " 3.5.1 ",
        isEnabled: false,
      }),
    ).toEqual({
      resource: CLUSTER,
      framework: ComplianceFramework.PCIDSS,
      requirement: "3.5.1",
      isEnabled: false,
    });
  });

  test("a row with no requirement is about the whole framework", () => {
    expect(
      readComplianceScopeSetting({
        resourceType: "Service",
        resourceId: SERVICE.id,
        framework: "SOC 2",
        requirement: null,
        isEnabled: false,
      })?.requirement,
    ).toBe("");
  });

  test("anything this version does not know is no setting at all", () => {
    for (const row of [
      { resourceType: "Host", resourceId: CLUSTER.id, framework: "GDPR" },
      { resourceType: "Service", resourceId: "", framework: "GDPR" },
      { resourceType: "Service", resourceId: null, framework: "GDPR" },
      { resourceType: "Service", resourceId: SERVICE.id, framework: "FedRAMP" },
    ]) {
      expect(readComplianceScopeSetting(row)).toBeNull();
    }
  });

  test("a row that does not say it is off is on: it never turns anything off by accident", () => {
    expect(
      readComplianceScopeSetting({
        resourceType: "Service",
        resourceId: SERVICE.id,
        framework: "GDPR",
      })?.isEnabled,
    ).toBe(true);
  });
});

describe("scoring with what resources turned off", () => {
  function storeOf(
    id: string,
    dataTypeIds: Array<string> = [],
    isEvaluated: boolean = true,
  ): ComplianceStoreInput {
    return { id, dataTypeIds, isEvaluated };
  }

  function statusOf(
    result: ComplianceFrameworkResult,
    requirement: string,
  ): ComplianceRequirementResult | undefined {
    return result.requirements.find((each: ComplianceRequirementResult) => {
      return each.requirement === requirement;
    });
  }

  const stores: Array<ComplianceStoreInput> = [
    storeOf("orders-db", ["credit-card-number"]),
    storeOf("cache"),
    storeOf("checkout-logs"),
  ];
  const issues: Array<ComplianceIssueInput> = [
    // A public bucket fails SOC 2's CC6.1 on both databases.
    { storeId: "orders-db", checkId: "public-read" },
    { storeId: "cache", checkId: "public-read" },
  ];

  test("with nothing turned off, scoring is what it always was", () => {
    const plain: ComplianceFrameworkResult = scoreComplianceFramework(
      ComplianceFramework.SOC2,
      stores,
      issues,
    );

    expect(
      scoreComplianceFramework(ComplianceFramework.SOC2, stores, issues, {
        storeIds: new Set(),
        requirementStoreIds: new Map(),
      }),
    ).toEqual(plain);
    expect(plain.storesTurnedOff).toBe(0);
    expect(plain.storesInScope).toBe(3);
  });

  test("a framework turned off for stores takes them out of scope and counts them as turned off", () => {
    const result: ComplianceFrameworkResult = scoreComplianceFramework(
      ComplianceFramework.PCIDSS,
      stores,
      issues,
      { storeIds: new Set(["orders-db"]) },
    );

    // Only orders-db holds card numbers, so nothing is left in PCI DSS's scope.
    expect(result.storesInScope).toBe(0);
    expect(result.storesTurnedOff).toBe(1);
    expect(result.score).toBeNull();
    for (const requirement of result.requirements) {
      expect(requirement.status).toBe(ComplianceRequirementStatus.NotEvaluated);
    }
  });

  test("a requirement turned off for every store in scope reads Turned off, and leaves the score", () => {
    const result: ComplianceFrameworkResult = scoreComplianceFramework(
      ComplianceFramework.SOC2,
      stores,
      issues,
      {
        requirementStoreIds: new Map([
          ["CC6.1", new Set(["orders-db", "cache", "checkout-logs"])],
        ]),
      },
    );
    const plain: ComplianceFrameworkResult = scoreComplianceFramework(
      ComplianceFramework.SOC2,
      stores,
      issues,
    );

    expect(statusOf(plain, "CC6.1")?.status).toBe(
      ComplianceRequirementStatus.Failing,
    );
    expect(statusOf(result, "CC6.1")).toMatchObject({
      status: ComplianceRequirementStatus.TurnedOff,
      failingIssueCount: 0,
    });
    // Every other requirement passes: what was turned off is not counted at all.
    expect(result.score).toBe(100);
    expect(result.storesInScope).toBe(3);
    expect(result.storesTurnedOff).toBe(0);
  });

  test("a requirement turned off for some stores still fails on the others", () => {
    const result: ComplianceFrameworkResult = scoreComplianceFramework(
      ComplianceFramework.SOC2,
      stores,
      issues,
      { requirementStoreIds: new Map([["CC6.1", new Set(["orders-db"])]]) },
    );

    expect(statusOf(result, "CC6.1")).toMatchObject({
      status: ComplianceRequirementStatus.Failing,
      // The cache's issue still counts; the orders database's does not.
      failingIssueCount: 1,
    });
  });

  test("an issue on a store taken out of the framework fails nothing", () => {
    const result: ComplianceFrameworkResult = scoreComplianceFramework(
      ComplianceFramework.SOC2,
      stores,
      issues,
      { storeIds: new Set(["orders-db", "cache"]) },
    );

    expect(statusOf(result, "CC6.1")?.status).toBe(
      ComplianceRequirementStatus.Passing,
    );
    expect(result.storesInScope).toBe(1);
    expect(result.storesTurnedOff).toBe(2);
    expect(result.score).toBe(100);
  });

  test("an inventory requirement counts only the stores it still covers", () => {
    const unread: Array<ComplianceStoreInput> = [
      storeOf("read-db"),
      storeOf("unread-db", [], false),
    ];

    expect(
      statusOf(
        scoreComplianceFramework(ComplianceFramework.ISO27001, unread, []),
        "A.5.12",
      )?.status,
    ).toBe(ComplianceRequirementStatus.Failing);
    expect(
      statusOf(
        scoreComplianceFramework(ComplianceFramework.ISO27001, unread, [], {
          requirementStoreIds: new Map([["A.5.12", new Set(["unread-db"])]]),
        }),
        "A.5.12",
      )?.status,
    ).toBe(ComplianceRequirementStatus.Passing);
  });

  test("a requirement that only unread stores still cover is not evaluated", () => {
    const result: ComplianceFrameworkResult = scoreComplianceFramework(
      ComplianceFramework.SOC2,
      [storeOf("read-db"), storeOf("unread-db", [], false)],
      [],
      { requirementStoreIds: new Map([["CC6.1", new Set(["read-db"])]]) },
    );

    expect(statusOf(result, "CC6.1")?.status).toBe(
      ComplianceRequirementStatus.NotEvaluated,
    );
  });

  test("with nothing in scope, a requirement turned off is simply not evaluated", () => {
    const result: ComplianceFrameworkResult = scoreComplianceFramework(
      ComplianceFramework.HIPAA,
      [storeOf("no-health-data")],
      [],
      {
        requirementStoreIds: new Map([
          ["164.312(b)", new Set(["no-health-data"])],
        ]),
      },
    );

    expect(statusOf(result, "164.312(b)")?.status).toBe(
      ComplianceRequirementStatus.NotEvaluated,
    );
  });
});

describe("the requirements a setting may name", () => {
  test("a requirement of the framework is one; another framework's is not", () => {
    for (const info of getRequirementsOf(ComplianceFramework.SOC2)) {
      expect(isRequirementOf(ComplianceFramework.SOC2, info.requirement)).toBe(
        true,
      );
    }

    expect(isRequirementOf(ComplianceFramework.SOC2, "Art. 32")).toBe(false);
    expect(isRequirementOf(ComplianceFramework.GDPR, "Art. 32")).toBe(true);
    expect(isRequirementOf(ComplianceFramework.GDPR, "")).toBe(false);
  });
});
