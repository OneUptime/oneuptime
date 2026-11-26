import SecurityEventRetention from "../../../../Server/Utils/SecurityEvent/SecurityEventRetention";
import OTelIngestService from "../../../../Server/Services/OpenTelemetryIngestService";
import ProjectService from "../../../../Server/Services/ProjectService";
import DetectionRuleService from "../../../../Server/Services/DetectionRuleService";
import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import EnterpriseEdition from "../../../../Server/Enterprise/EnterpriseEdition";
import EnterpriseFeature from "../../../../Server/Enterprise/EnterpriseFeature";
import Project from "../../../../Models/DatabaseModels/Project";
import DetectionRule from "../../../../Models/DatabaseModels/DetectionRule";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../Types/ObjectID";
import {
  DetectionRulePastRetention,
  SECONDS_IN_A_DAY,
  SECURITY_EVENT_RETENTION_MAX_LISTED_RULES,
  SecurityEventRetentionStatus,
} from "../../../../Types/SecurityEvent/SecurityEventRetention";
import { DetectionRuleType } from "../../../../Types/SecurityEvent/SigmaCorrelation";
import TelemetryRetentionConfig from "../../../../Types/Telemetry/TelemetryRetentionConfig";
import { getJestSpyOn } from "../../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * How long a project keeps its security events, read for the code that
 * reads them back (#10432): the project's retention for security events as
 * ingest stamps a new event - its Default Retention (Days), and its
 * retention by type only while that Enterprise feature is active - from
 * ingest's caches for a rule's run, or from Postgres now for a page; and
 * what the Dashboard is told: the retention, and the enabled rules that
 * read further back, read as the person asking.
 */

type Spy = ReturnType<typeof getJestSpyOn>;

const FIRST_SEEN_30_DAYS: string = `title: AWS activity in a new region
correlation:
  type: new_value
  rules: [call]
  group-by: [targetHost]
  timespan: 30d
  condition:
    field: awsRegion
---
title: Call
name: call
detection:
  selection:
    productName: AWS CloudTrail
  condition: selection`;

const FIRST_SEEN_14_DAYS: string = FIRST_SEEN_30_DAYS.replace(
  "timespan: 30d",
  "timespan: 14d",
);

const SINGLE: string = `title: Audit log cleared
detection:
  selection:
    className: Account Change
  condition: selection`;

const PROPS: DatabaseCommonInteractionProps = {
  tenantId: new ObjectID("71717171-7171-4717-8717-717171717171"),
  userId: new ObjectID("72727272-7272-4727-8727-727272727272"),
};

// A project id no earlier test warmed ingest's in-process memo with.
function newProjectId(): ObjectID {
  return ObjectID.generate();
}

function project(data: {
  defaultTelemetryRetentionInDays?: number;
  telemetryRetentionConfig?: TelemetryRetentionConfig | null;
}): Project {
  return Object.assign(new Project(), {
    defaultTelemetryRetentionInDays: data.defaultTelemetryRetentionInDays,
    telemetryRetentionConfig: data.telemetryRetentionConfig ?? null,
  });
}

function rule(id: string, name: string, sigmaRuleYaml: string): DetectionRule {
  return Object.assign(new DetectionRule(), {
    _id: id,
    name,
    sigmaRuleYaml,
  });
}

let findProject: Spy;
let isFeatureActive: Spy;

beforeEach(() => {
  // No Redis here: every cold read goes to Postgres, stubbed.
  getJestSpyOn(GlobalCache, "getJSONObject").mockResolvedValue(null as never);
  getJestSpyOn(GlobalCache, "setJSON").mockResolvedValue(undefined as never);
  findProject = getJestSpyOn(ProjectService, "findOneById").mockResolvedValue(
    project({ defaultTelemetryRetentionInDays: 15 }) as never,
  );
  isFeatureActive = getJestSpyOn(
    EnterpriseEdition,
    "isFeatureActive",
  ).mockReturnValue(true as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("SecurityEventRetention.getRetentionInDays", () => {
  test("a project left as it is keeps them 15 days", async () => {
    expect(
      await SecurityEventRetention.getRetentionInDays(newProjectId()),
    ).toBe(15);
  });

  test("the project's Default Retention (Days)", async () => {
    findProject.mockResolvedValue(
      project({ defaultTelemetryRetentionInDays: 45 }) as never,
    );

    expect(
      await SecurityEventRetention.getRetentionInDays(newProjectId()),
    ).toBe(45);
  });

  test("its retention by type for security events, while the Enterprise feature is active", async () => {
    findProject.mockResolvedValue(
      project({
        defaultTelemetryRetentionInDays: 15,
        telemetryRetentionConfig: { securityEvents: { default: 90 } },
      }) as never,
    );

    expect(
      await SecurityEventRetention.getRetentionInDays(newProjectId()),
    ).toBe(90);
    expect(isFeatureActive).toHaveBeenCalledWith(
      EnterpriseFeature.TelemetryRetention,
    );
  });

  test("without the Enterprise feature, the default: as ingest stamps a new event", async () => {
    isFeatureActive.mockReturnValue(false as never);
    findProject.mockResolvedValue(
      project({
        defaultTelemetryRetentionInDays: 15,
        telemetryRetentionConfig: { securityEvents: { default: 90 } },
      }) as never,
    );

    expect(
      await SecurityEventRetention.getRetentionInDays(newProjectId()),
    ).toBe(15);
  });

  test("another type's retention does not set it", async () => {
    findProject.mockResolvedValue(
      project({
        defaultTelemetryRetentionInDays: 15,
        telemetryRetentionConfig: { logs: { default: 90 } },
      }) as never,
    );

    expect(
      await SecurityEventRetention.getRetentionInDays(newProjectId()),
    ).toBe(15);
  });

  test("a rule's runs read it from ingest's caches: one Postgres read, however often", async () => {
    const projectId: ObjectID = newProjectId();

    await SecurityEventRetention.getRetentionInDays(projectId);
    await SecurityEventRetention.getRetentionInDays(projectId);
    await SecurityEventRetention.getRetentionInDays(projectId);

    expect(findProject).toHaveBeenCalledTimes(1);
  });

  test("a page reads it from Postgres now, every time, so a change just made shows", async () => {
    const projectId: ObjectID = newProjectId();

    // Warm the caches with 15 days, then change it.
    await SecurityEventRetention.getRetentionInDays(projectId);
    findProject.mockResolvedValue(
      project({ defaultTelemetryRetentionInDays: 30 }) as never,
    );

    expect(
      await SecurityEventRetention.getRetentionInDays(projectId, {
        isFresh: true,
      }),
    ).toBe(30);
    expect(findProject).toHaveBeenCalledTimes(2);
    expect(
      (findProject.mock.calls[1]![0] as { id: ObjectID }).id.toString(),
    ).toBe(projectId.toString());
  });

  test("a project not found reads as the 15 days every project starts with", async () => {
    findProject.mockResolvedValue(null as never);

    expect(
      await SecurityEventRetention.getRetentionInDays(newProjectId(), {
        isFresh: true,
      }),
    ).toBe(15);
  });
});

describe("OTelIngestService.getProjectRetention", () => {
  test("the project's own retention, with no resource's", async () => {
    findProject.mockResolvedValue(
      project({
        defaultTelemetryRetentionInDays: 20,
        telemetryRetentionConfig: { securityEvents: { default: 40 } },
      }) as never,
    );

    expect(
      await OTelIngestService.getProjectRetention(newProjectId(), {
        isFresh: true,
      }),
    ).toEqual(
      expect.objectContaining({
        dataRententionInDays: 20,
        serviceRetentionConfig: null,
        serviceRetentionInDays: null,
        projectRetentionConfig: { securityEvents: { default: 40 } },
        projectRetentionInDays: 20,
      }),
    );
  });

  test("without the Enterprise feature, no retention by type", async () => {
    isFeatureActive.mockReturnValue(false as never);
    findProject.mockResolvedValue(
      project({
        defaultTelemetryRetentionInDays: 20,
        telemetryRetentionConfig: { securityEvents: { default: 40 } },
      }) as never,
    );

    expect(
      (
        await OTelIngestService.getProjectRetention(newProjectId(), {
          isFresh: true,
        })
      ).projectRetentionConfig,
    ).toBeNull();
  });
});

describe("SecurityEventRetention.getStatus", () => {
  let findRules: Spy;

  beforeEach(() => {
    findRules = getJestSpyOn(
      DetectionRuleService,
      "findAllBy",
    ).mockResolvedValue([
      rule(
        "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1",
        "AWS activity in a new region",
        FIRST_SEEN_30_DAYS,
      ),
      rule(
        "b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2",
        "Sign-in from a new address",
        FIRST_SEEN_14_DAYS,
      ),
      rule("c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3", "Audit log cleared", SINGLE),
    ] as never);
  });

  test("the retention, read now, and the enabled rules that read further back", async () => {
    const projectId: ObjectID = newProjectId();
    const status: SecurityEventRetentionStatus =
      await SecurityEventRetention.getStatus({ projectId, props: PROPS });

    expect(status).toEqual({
      retentionInDays: 15,
      rulesPastRetention: [
        {
          id: "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1",
          name: "AWS activity in a new region",
          type: DetectionRuleType.NewValue,
          lookbackInSeconds: 30 * SECONDS_IN_A_DAY,
        },
      ],
      hasMoreRulesPastRetention: false,
    });

    // Enabled rules of the project, read as the person asking.
    const query: { query: JSONLike; props: unknown } = findRules.mock
      .calls[0]![0] as { query: JSONLike; props: unknown };
    expect(query.query["isEnabled"]).toBe(true);
    expect(String(query.query["projectId"])).toBe(projectId.toString());
    expect(query.props).toBe(PROPS);
  });

  test("with 30 days kept, no rule reads past them", async () => {
    findProject.mockResolvedValue(
      project({ defaultTelemetryRetentionInDays: 30 }) as never,
    );

    expect(
      (
        await SecurityEventRetention.getStatus({
          projectId: newProjectId(),
          props: PROPS,
        })
      ).rulesPastRetention,
    ).toEqual([]);
  });

  test("a person who may not read detection rules is told the retention alone", async () => {
    findRules.mockRejectedValue(
      new NotAuthorizedException("You do not have permission.") as never,
    );

    expect(
      await SecurityEventRetention.getStatus({
        projectId: newProjectId(),
        props: PROPS,
      }),
    ).toEqual({
      retentionInDays: 15,
      rulesPastRetention: null,
      hasMoreRulesPastRetention: false,
    });
  });

  test("a failure other than a refusal is not hidden", async () => {
    findRules.mockRejectedValue(new Error("Postgres went away.") as never);

    await expect(
      SecurityEventRetention.getStatus({
        projectId: newProjectId(),
        props: PROPS,
      }),
    ).rejects.toThrow("Postgres went away.");
  });

  test("a rule whose YAML no longer parses, or that has none, is left out", async () => {
    findRules.mockResolvedValue([
      rule(
        "d4d4d4d4-d4d4-4d4d-8d4d-d4d4d4d4d4d4",
        "Broken",
        "title: [unclosed",
      ),
      rule("e5e5e5e5-e5e5-4e5e-8e5e-e5e5e5e5e5e5", "Empty", ""),
      rule(
        "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1",
        "AWS activity in a new region",
        FIRST_SEEN_30_DAYS,
      ),
    ] as never);

    expect(
      (
        await SecurityEventRetention.getStatus({
          projectId: newProjectId(),
          props: PROPS,
        })
      ).rulesPastRetention?.map((item: DetectionRulePastRetention): string => {
        return item.name;
      }),
    ).toEqual(["AWS activity in a new region"]);
  });

  test("lists at most the ones that read furthest back, and says there are more", async () => {
    const many: Array<DetectionRule> = [];

    for (
      let index: number = 0;
      index < SECURITY_EVENT_RETENTION_MAX_LISTED_RULES + 3;
      index++
    ) {
      many.push(
        rule(
          ObjectID.generate().toString(),
          `Rule ${String(index).padStart(3, "0")}`,
          FIRST_SEEN_30_DAYS,
        ),
      );
    }

    findRules.mockResolvedValue(many as never);

    const status: SecurityEventRetentionStatus =
      await SecurityEventRetention.getStatus({
        projectId: newProjectId(),
        props: PROPS,
      });

    expect(status.rulesPastRetention).toHaveLength(
      SECURITY_EVENT_RETENTION_MAX_LISTED_RULES,
    );
    expect(status.hasMoreRulesPastRetention).toBe(true);
    expect(status.rulesPastRetention![0]!.name).toBe("Rule 000");
  });
});

type JSONLike = Record<string, unknown>;
