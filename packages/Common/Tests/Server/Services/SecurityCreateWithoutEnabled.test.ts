import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import DetectionRule from "../../../Models/DatabaseModels/DetectionRule";
import ThreatIntelFeed from "../../../Models/DatabaseModels/ThreatIntelFeed";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DetectionRuleService from "../../../Server/Services/DetectionRuleService";
import ThreatIntelFeedService from "../../../Server/Services/ThreatIntelFeedService";
import logger from "../../../Server/Utils/Logger";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { getJestSpyOn } from "../../Spy";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";

/*
 * Issue #5158, through the whole write: a threat intel feed and a detection
 * rule, created as the Dashboard creates them - the form leaves Enabled to
 * the edit form, a new feed is polled and a new rule runs, so the create
 * sends no isEnabled - and as an API client that takes the API reference at
 * its word does.
 *
 * Both were refused with "isEnabled is required": the column is required
 * with a declared default, and DatabaseService.checkRequiredFields only
 * lets a create leave such a column out when it is flagged
 * isDefaultValueColumn, which it was not. Now the create goes through, and
 * the row is inserted without the column, so Postgres writes its DEFAULT
 * of true (RequiredColumnDefaultsPostgres reads it back on a migrated
 * Postgres).
 *
 * The real services and the real create pipeline - hooks, permission
 * checks, required fields - over an in-memory table.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "5158e0a1-9dad-41d1-80b4-00c04fd43101",
);

const SIGMA_YAML: string = [
  "title: Failed logon burst",
  "detection:",
  "  selection:",
  "    className: Authentication",
  "  condition: selection",
].join("\n");

function member(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    ...ON_HIGHEST_PLAN,
    tenantId: PROJECT_ID,
    userId: ObjectID.generate(),
    userType: UserType.User,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: permissions.map(
          (permission: Permission): UserPermission => {
            return {
              _type: "UserPermission",
              permission: permission,
              labelIds: [],
              isBlockPermission: false,
            } as UserPermission;
          },
        ),
      },
    },
  } as unknown as DatabaseCommonInteractionProps;
}

// Who creates feeds and rules: the tiers that may.
const CREATORS: Array<[string, Array<Permission>]> = [
  ["a project owner", [Permission.ProjectOwner]],
  ["a project admin", [Permission.ProjectAdmin]],
  ["a security admin", [Permission.SecurityAdmin]],
  ["a security member", [Permission.SecurityMember]],
];

// What the Dashboard's feed form sends: everything but the Enabled switch.
function feedAsTheDashboardSendsIt(): ThreatIntelFeed {
  const feed: ThreatIntelFeed = new ThreatIntelFeed();
  feed.projectId = PROJECT_ID;
  feed.name = "Corporate MISP";
  feed.apiRootUrl = "https://taxii.example.com/api1/";
  feed.collectionId = "91a7b528-80eb-42ed-a74d-c6fbd5a26116";
  feed.pollIntervalInMinutes = 60;
  feed.minimumConfidence = 0;
  feed.shouldCreateCase = true;
  feed.shouldCreateAlert = true;
  feed.shouldCreateIncident = false;
  feed.shouldWriteDetectionFinding = true;
  return feed;
}

// What a client that sends only what the API reference requires sends.
function feedWithOnlyWhatIsRequired(): ThreatIntelFeed {
  const feed: ThreatIntelFeed = new ThreatIntelFeed();
  feed.projectId = PROJECT_ID;
  feed.name = "Corporate MISP";
  feed.apiRootUrl = "https://taxii.example.com/api1/";
  feed.collectionId = "91a7b528-80eb-42ed-a74d-c6fbd5a26116";
  return feed;
}

// What the Dashboard's detection rule form sends: everything but Enabled.
function ruleAsTheDashboardSendsIt(): DetectionRule {
  const rule: DetectionRule = new DetectionRule();
  rule.projectId = PROJECT_ID;
  rule.name = "Failed logon burst";
  rule.sigmaRuleYaml = SIGMA_YAML;
  rule.evaluationIntervalInMinutes = 5;
  rule.matchCountThreshold = 1;
  rule.shouldCreateCase = true;
  rule.shouldCreateAlert = false;
  rule.shouldCreateIncident = false;
  rule.shouldWriteDetectionFinding = true;
  return rule;
}

function ruleWithOnlyWhatIsRequired(): DetectionRule {
  const rule: DetectionRule = new DetectionRule();
  rule.projectId = PROJECT_ID;
  rule.name = "Failed logon burst";
  rule.sigmaRuleYaml = SIGMA_YAML;
  return rule;
}

function lastInsert(table: InMemoryTable): StoredRow {
  const row: StoredRow | undefined = table.inserts[table.inserts.length - 1];

  if (!row) {
    throw new Error("Nothing was inserted.");
  }

  return row;
}

describe("creating a threat intel feed or a detection rule without isEnabled (issue #5158)", () => {
  let feeds: InMemoryTable;
  let rules: InMemoryTable;

  beforeEach(() => {
    for (const silenced of ["debug", "info", "warn", "error"]) {
      getJestSpyOn(logger, silenced).mockImplementation((): void => {
        return undefined;
      });
    }

    stubProjectDirectory({});
    feeds = useInMemoryTable(ThreatIntelFeedService, []);
    rules = useInMemoryTable(DetectionRuleService, []);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each(CREATORS)(
    "%s creates a feed from the Dashboard's form, and it is left to Postgres to switch on",
    async (_who: string, permissions: Array<Permission>) => {
      const created: ThreatIntelFeed = await ThreatIntelFeedService.create({
        data: feedAsTheDashboardSendsIt(),
        props: member(permissions),
      });

      expect(created.id).toBeTruthy();

      const row: StoredRow = lastInsert(feeds);

      expect(row["name"]).toBe("Corporate MISP");
      // Left out of the insert: the column's DEFAULT, true, is what is stored.
      expect(Object.prototype.hasOwnProperty.call(row, "isEnabled")).toBe(
        false,
      );
    },
  );

  test.each(CREATORS)(
    "%s creates a detection rule from the Dashboard's form, and it is left to Postgres to switch on",
    async (_who: string, permissions: Array<Permission>) => {
      await DetectionRuleService.create({
        data: ruleAsTheDashboardSendsIt(),
        props: member(permissions),
      });

      const row: StoredRow = lastInsert(rules);

      expect(row["sigmaRuleYaml"]).toBe(SIGMA_YAML);
      expect(Object.prototype.hasOwnProperty.call(row, "isEnabled")).toBe(
        false,
      );
    },
  );

  test("an API client sending only the required columns creates a feed, every default left to Postgres", async () => {
    await ThreatIntelFeedService.create({
      data: feedWithOnlyWhatIsRequired(),
      props: member([Permission.SecurityAdmin]),
    });

    const row: StoredRow = lastInsert(feeds);

    for (const column of [
      "isEnabled",
      "pollIntervalInMinutes",
      "minimumConfidence",
      "shouldCreateAlert",
      "shouldCreateIncident",
      "shouldWriteDetectionFinding",
    ]) {
      expect(Object.prototype.hasOwnProperty.call(row, column)).toBe(false);
    }
  });

  test("an API client sending only the required columns creates a detection rule, every default left to Postgres", async () => {
    await DetectionRuleService.create({
      data: ruleWithOnlyWhatIsRequired(),
      props: member([Permission.SecurityAdmin]),
    });

    const row: StoredRow = lastInsert(rules);

    for (const column of [
      "isEnabled",
      "evaluationIntervalInMinutes",
      "shouldCreateAlert",
      "shouldWriteDetectionFinding",
    ]) {
      expect(Object.prototype.hasOwnProperty.call(row, column)).toBe(false);
    }
  });

  test("a feed or a rule created switched off stays off", async () => {
    const feed: ThreatIntelFeed = feedAsTheDashboardSendsIt();
    feed.isEnabled = false;
    const rule: DetectionRule = ruleAsTheDashboardSendsIt();
    rule.isEnabled = false;

    await ThreatIntelFeedService.create({
      data: feed,
      props: member([Permission.SecurityAdmin]),
    });
    await DetectionRuleService.create({
      data: rule,
      props: member([Permission.SecurityAdmin]),
    });

    expect(lastInsert(feeds)["isEnabled"]).toBe(false);
    expect(lastInsert(rules)["isEnabled"]).toBe(false);
  });

  test("an isEnabled sent as null is left to Postgres too, not stored as NULL", async () => {
    const feed: ThreatIntelFeed = feedAsTheDashboardSendsIt();
    (feed as unknown as JSONObject)["isEnabled"] = null;

    await ThreatIntelFeedService.create({
      data: feed,
      props: member([Permission.SecurityAdmin]),
    });

    expect(
      Object.prototype.hasOwnProperty.call(lastInsert(feeds), "isEnabled"),
    ).toBe(false);
  });

  test("a create without a column that has no default is still refused", async () => {
    const feed: ThreatIntelFeed = feedAsTheDashboardSendsIt();
    delete (feed as unknown as Record<string, unknown>)["name"];

    await expect(
      ThreatIntelFeedService.create({
        data: feed as DatabaseBaseModel as ThreatIntelFeed,
        props: member([Permission.SecurityAdmin]),
      }),
    ).rejects.toThrow("name is required");
    expect(feeds.inserts).toHaveLength(0);
  });

  test("a security viewer, who may not create feeds or rules, is still refused", async () => {
    await expect(
      ThreatIntelFeedService.create({
        data: feedAsTheDashboardSendsIt(),
        props: member([Permission.SecurityViewer]),
      }),
    ).rejects.toThrow();
    await expect(
      DetectionRuleService.create({
        data: ruleAsTheDashboardSendsIt(),
        props: member([Permission.SecurityViewer]),
      }),
    ).rejects.toThrow();
    expect(feeds.inserts).toHaveLength(0);
    expect(rules.inserts).toHaveLength(0);
  });
});
