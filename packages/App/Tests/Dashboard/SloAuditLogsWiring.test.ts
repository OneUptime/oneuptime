import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  DEFAULT_RESOURCE_META,
  RESOURCE_META,
  ResourceMeta,
  getAuditLogsQuery,
  getResourceLink,
  getResourceLinkModelId,
  getResourceMeta,
} from "../../FeatureSet/Dashboard/src/Components/AuditLogs/AuditLogsTableUtils";
import PageMap from "../../FeatureSet/Dashboard/src/Utils/PageMap";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import ServiceLevelObjectiveBurnRateRule from "Common/Models/DatabaseModels/ServiceLevelObjectiveBurnRateRule";
import ServiceLevelObjectiveMonitorRule from "Common/Models/DatabaseModels/ServiceLevelObjectiveMonitorRule";
import ServiceLevelObjectiveOwnerTeam from "Common/Models/DatabaseModels/ServiceLevelObjectiveOwnerTeam";
import ServiceLevelObjectiveOwnerUser from "Common/Models/DatabaseModels/ServiceLevelObjectiveOwnerUser";
import ObjectID from "Common/Types/ObjectID";

/*
 * The SLO audit page and the resource metadata behind every audit table.
 *
 * The page shows everything that rolls up to the SLO, so it has to filter on
 * the root pointer alone: a resourceType or resourceId filter would keep the
 * SLO's own entries and silently drop its burn-rate rules, monitor rules and
 * owners. And every SLO-family resource type the server writes needs metadata
 * here, or its entries render as a generic cube with no link - the old state
 * of every SLO entry on the project-wide log.
 *
 * Source-level for the page (plain Node, no renderer); the pure helper module
 * is imported directly.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

type ReadCodeFunction = (...segments: Array<string>) => string;

const readCode: ReadCodeFunction = (...segments: Array<string>): string => {
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, ...segments), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
    .replace(/\s+/g, " ");
};

const SLO_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const RULE_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

describe("the SLO Audit Logs page", () => {
  const page: string = readCode("Pages", "Slo", "View", "AuditLogs.tsx");

  test("lists everything that rolls up to the SLO", () => {
    expect(page).toContain("<AuditLogsTable");
    expect(page).toContain("rootResourceId={modelId}");
    expect(page).not.toContain("resourceType=");
    expect(page).not.toContain("resourceId={");
  });

  test("says what it covers, and that automatic evaluation updates are not recorded", () => {
    const text: string = page.toLowerCase();

    expect(text).toContain("burn-rate rules");
    expect(text).toContain("monitor rules");
    expect(text).toContain("owners");
    expect(text).toContain("not recorded");
    // The old description promised monitors, which rule syncs never recorded.
    expect(text).not.toContain("compliance window, monitors");
  });
});

describe("SLO-family resource metadata", () => {
  const sloType: string = new ServiceLevelObjective().singularName!;

  test("an SLO entry opens the SLO", () => {
    expect(RESOURCE_META[sloType]).toBeDefined();
    expect(RESOURCE_META[sloType]!.viewRoute).toBe(PageMap.SLO_VIEW);
    expect(RESOURCE_META[sloType]!.viewRouteModelId).toBeUndefined();
  });

  /*
   * childViewRoute: only a monitor rule has a page of its own under the SLO.
   * A burn-rate rule is edited in place on its tab and an owner row is just a
   * row on the Owners tab, so neither may claim one.
   */
  test.each([
    {
      model: new ServiceLevelObjectiveBurnRateRule() as BaseModel,
      page: PageMap.SLO_VIEW_BURN_RATE_RULES,
      childPage: undefined,
    },
    {
      model: new ServiceLevelObjectiveMonitorRule() as BaseModel,
      page: PageMap.SLO_VIEW_MONITOR_RULES,
      childPage: PageMap.SLO_VIEW_MONITOR_RULE_VIEW,
    },
    {
      model: new ServiceLevelObjectiveOwnerUser() as BaseModel,
      page: PageMap.SLO_VIEW_OWNERS,
      childPage: undefined,
    },
    {
      model: new ServiceLevelObjectiveOwnerTeam() as BaseModel,
      page: PageMap.SLO_VIEW_OWNERS,
      childPage: undefined,
    },
  ])(
    "$model.singularName entries open the matching tab of the SLO they roll up to",
    (data: {
      model: BaseModel;
      page: PageMap;
      childPage: PageMap | undefined;
    }) => {
      // The server really does roll this model's entries up to the SLO.
      expect(data.model.enableAuditLogOn?.rootResource?.resourceType).toBe(
        sloType,
      );

      const meta: ResourceMeta | undefined =
        RESOURCE_META[data.model.singularName!];

      expect(meta).toBeDefined();
      expect(meta!.viewRoute).toBe(data.page);
      expect(meta!.viewRouteModelId).toBe("root");
      expect(meta!.childViewRoute).toBe(data.childPage);
    },
  );

  test("the helper module stays importable outside the browser", () => {
    const helpers: string = readCode(
      "Components",
      "AuditLogs",
      "AuditLogsTableUtils.ts",
    );

    expect(helpers).not.toMatch(/from "[^"]*RouteMap"/);
    expect(helpers).not.toMatch(/from "[^"]*Navigation"/);
    expect(helpers).not.toMatch(/from "Common\/UI\/Config"/);
    expect(helpers).not.toMatch(/from "react"/);
  });

  /*
   * The table body is Enterprise code since the Community / Enterprise split
   * (ee/Dashboard/AuditLogs/AuditLogsTable.tsx, which imports this helper
   * module through "@oneuptime/dashboard/..." - pinned by
   * ee/Tests/UI/AuditLogs/AuditLogsPlugins.test.tsx). Core keeps the shell
   * every page imports, and the shell must not grow a copy of the metadata.
   */
  test("the core table shell keeps no private copy of the metadata", () => {
    const table: string = readCode(
      "Components",
      "AuditLogs",
      "AuditLogsTable.tsx",
    );

    expect(table).not.toContain("const RESOURCE_META");
    expect(table).toContain("getDashboardPlugins().AuditLogsTable");
  });
});

describe("getAuditLogsQuery", () => {
  test("filters on the root pointer alone for a page with children", () => {
    expect(
      getAuditLogsQuery({ projectId: PROJECT_ID, rootResourceId: SLO_ID }),
    ).toEqual({ projectId: PROJECT_ID, rootResourceId: SLO_ID });
  });

  test("combines every filter it is given", () => {
    expect(
      getAuditLogsQuery({
        projectId: PROJECT_ID,
        resourceType: "Monitor",
        resourceId: RULE_ID,
      }),
    ).toEqual({
      projectId: PROJECT_ID,
      resourceType: "Monitor",
      resourceId: RULE_ID,
    });
  });

  test("leaves out what it is not given", () => {
    expect(getAuditLogsQuery({ projectId: null })).toEqual({});
  });
});

describe("getResourceLinkModelId", () => {
  const sloMeta: ResourceMeta = getResourceMeta("Service Level Objective");
  const ruleMeta: ResourceMeta = getResourceMeta("SLO Burn Rate Rule");

  test("a resource links to itself while it exists", () => {
    expect(
      getResourceLinkModelId({
        meta: sloMeta,
        action: "Update",
        resourceId: SLO_ID,
        rootResourceId: SLO_ID,
      }),
    ).toBe(SLO_ID);
  });

  test("a deleted resource links nowhere", () => {
    expect(
      getResourceLinkModelId({
        meta: sloMeta,
        action: "Delete",
        resourceId: SLO_ID,
        rootResourceId: SLO_ID,
      }),
    ).toBeNull();
  });

  test("a child links to its root, even after the child is deleted", () => {
    expect(
      getResourceLinkModelId({
        meta: ruleMeta,
        action: "Delete",
        resourceId: RULE_ID,
        rootResourceId: SLO_ID,
      }),
    ).toBe(SLO_ID);
  });

  test("a child without a root pointer links nowhere, rather than to its own id", () => {
    expect(
      getResourceLinkModelId({
        meta: ruleMeta,
        action: "Update",
        resourceId: RULE_ID,
        rootResourceId: undefined,
      }),
    ).toBeNull();
  });

  test("a type with no page links nowhere", () => {
    expect(
      getResourceLinkModelId({
        meta: getResourceMeta("Label"),
        action: "Update",
        resourceId: RULE_ID,
        rootResourceId: RULE_ID,
      }),
    ).toBeNull();
  });

  test("an unknown type falls back to the generic look", () => {
    expect(getResourceMeta("Something New")).toBe(DEFAULT_RESOURCE_META);
    expect(getResourceMeta(undefined)).toBe(DEFAULT_RESOURCE_META);
  });

  test("a child rooted at itself (the root backfill's fallback) links nowhere, rather than to a parent page keyed by its own id", () => {
    expect(
      getResourceLinkModelId({
        meta: ruleMeta,
        action: "Update",
        resourceId: RULE_ID,
        // A distinct instance: the ids are compared by value.
        rootResourceId: new ObjectID(RULE_ID.toString()),
      }),
    ).toBeNull();
  });
});

describe("getResourceLink", () => {
  const monitorRuleMeta: ResourceMeta = getResourceMeta(
    new ServiceLevelObjectiveMonitorRule().singularName!,
  );
  const burnRateRuleMeta: ResourceMeta = getResourceMeta(
    new ServiceLevelObjectiveBurnRateRule().singularName!,
  );
  const ownerTeamMeta: ResourceMeta = getResourceMeta(
    new ServiceLevelObjectiveOwnerTeam().singularName!,
  );
  const sloMeta: ResourceMeta = getResourceMeta(
    new ServiceLevelObjective().singularName!,
  );

  test.each(["Create", "Update"])(
    "a monitor rule's %s entry opens the rule's own page: the SLO as model id, the rule as sub-model id",
    (action: string) => {
      expect(
        getResourceLink({
          meta: monitorRuleMeta,
          action,
          resourceId: RULE_ID,
          rootResourceId: SLO_ID,
        }),
      ).toEqual({
        page: PageMap.SLO_VIEW_MONITOR_RULE_VIEW,
        modelId: SLO_ID,
        subModelId: RULE_ID,
      });
    },
  );

  test("a deleted monitor rule's entry opens its SLO's Monitor Rules tab, never the rule's page that is gone", () => {
    expect(
      getResourceLink({
        meta: monitorRuleMeta,
        action: "Delete",
        resourceId: RULE_ID,
        rootResourceId: SLO_ID,
      }),
    ).toEqual({ page: PageMap.SLO_VIEW_MONITOR_RULES, modelId: SLO_ID });
  });

  test("a monitor rule entry that cannot name its SLO links nowhere: both of its pages need the SLO id", () => {
    expect(
      getResourceLink({
        meta: monitorRuleMeta,
        action: "Update",
        resourceId: RULE_ID,
        rootResourceId: undefined,
      }),
    ).toBeNull();
  });

  test.each(["Update", "Delete"])(
    "a monitor rule %s entry rooted at itself links nowhere",
    (action: string) => {
      expect(
        getResourceLink({
          meta: monitorRuleMeta,
          action,
          resourceId: RULE_ID,
          rootResourceId: new ObjectID(RULE_ID.toString()),
        }),
      ).toBeNull();
    },
  );

  test("a monitor rule entry without its own id falls back to the SLO's Monitor Rules tab", () => {
    expect(
      getResourceLink({
        meta: monitorRuleMeta,
        action: "Update",
        resourceId: undefined,
        rootResourceId: SLO_ID,
      }),
    ).toEqual({ page: PageMap.SLO_VIEW_MONITOR_RULES, modelId: SLO_ID });
  });

  test.each(["Create", "Update", "Delete"])(
    "a burn-rate rule's %s entry opens its SLO's Burn Rate Rules tab: it has no page of its own",
    (action: string) => {
      expect(
        getResourceLink({
          meta: burnRateRuleMeta,
          action,
          resourceId: RULE_ID,
          rootResourceId: SLO_ID,
        }),
      ).toEqual({ page: PageMap.SLO_VIEW_BURN_RATE_RULES, modelId: SLO_ID });
    },
  );

  test("an owner entry opens its SLO's Owners tab", () => {
    expect(
      getResourceLink({
        meta: ownerTeamMeta,
        action: "Delete",
        resourceId: RULE_ID,
        rootResourceId: SLO_ID,
      }),
    ).toEqual({ page: PageMap.SLO_VIEW_OWNERS, modelId: SLO_ID });
  });

  test("an SLO's own entry opens the SLO while it exists, and nothing once it is deleted", () => {
    expect(
      getResourceLink({
        meta: sloMeta,
        action: "Update",
        resourceId: SLO_ID,
        rootResourceId: SLO_ID,
      }),
    ).toEqual({ page: PageMap.SLO_VIEW, modelId: SLO_ID });

    expect(
      getResourceLink({
        meta: sloMeta,
        action: "Delete",
        resourceId: SLO_ID,
        rootResourceId: SLO_ID,
      }),
    ).toBeNull();
  });

  test("a type with no page, or an unknown type, links nowhere", () => {
    expect(
      getResourceLink({
        meta: getResourceMeta("Label"),
        action: "Update",
        resourceId: RULE_ID,
        rootResourceId: RULE_ID,
      }),
    ).toBeNull();

    expect(
      getResourceLink({
        meta: getResourceMeta("Something New"),
        action: "Update",
        resourceId: RULE_ID,
        rootResourceId: SLO_ID,
      }),
    ).toBeNull();
  });

  test("only child types opened through their root declare a page of their own", () => {
    for (const type of Object.keys(RESOURCE_META)) {
      const meta: ResourceMeta = RESOURCE_META[type]!;

      if (meta.childViewRoute) {
        // Without a root id there is no parent to put the child's page under.
        expect(meta.viewRouteModelId).toBe("root");
        expect(meta.viewRoute).toBeDefined();
      }
    }
  });
});
