import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  buildDefaultTestPriorities,
  buildDefaultTestStatuses,
} from "../../../Helpers/SecurityCaseValues";
import { stubSecurityCaseValues } from "../../../Helpers/SecurityCaseValuesStub";
import { getSecurityPlaybookTemplateValues } from "../../../../Utils/SecurityEvent/SecurityTemplateRecords";
import DetectionRule from "../../../../Models/DatabaseModels/DetectionRule";
import SecurityCase from "../../../../Models/DatabaseModels/SecurityCase";
import SecurityLogSource from "../../../../Models/DatabaseModels/SecurityLogSource";
import SecurityPlaybook from "../../../../Models/DatabaseModels/SecurityPlaybook";
import DetectionRuleService from "../../../../Server/Services/DetectionRuleService";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "../../../../Server/Services/OpenTelemetryIngestService";
import SecurityCaseService from "../../../../Server/Services/SecurityCaseService";
import SecurityEventConnectionService from "../../../../Server/Services/SecurityEventConnectionService";
import SecurityEventDestinationService from "../../../../Server/Services/SecurityEventDestinationService";
import SecurityEventService from "../../../../Server/Services/SecurityEventService";
import SecurityLogSourceService from "../../../../Server/Services/SecurityLogSourceService";
import SecurityTelemetrySourceService from "../../../../Server/Services/SecurityTelemetrySourceService";
import SecurityTelemetrySource from "../../../../Models/DatabaseModels/SecurityTelemetrySource";
import {
  SECURITY_TELEMETRY_SOURCE_KINDS,
  SecurityTelemetrySourceKind,
} from "../../../../Types/SecurityEvent/SecurityTelemetrySource";
import SecurityPlaybookService from "../../../../Server/Services/SecurityPlaybookService";
import ThreatIntelFeedService from "../../../../Server/Services/ThreatIntelFeedService";
import DetectionRuleEvaluator, {
  DetectionRuleSetupTest,
} from "../../../../Server/Utils/SecurityEvent/DetectionRuleEvaluator";
import SecuritySetup, {
  SecuritySetupStatus,
  SecuritySetupTestResult,
  TurnOnRecommendedResult,
  buildDetectionRuleFromLibrary,
  buildSetupTestEvents,
  describeTurnOnRecommendedFailure,
  isRuleFromLibraryEntry,
} from "../../../../Server/Utils/SecurityEvent/SecuritySetup";
import logger from "../../../../Server/Utils/Logger";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate from "../../../../Types/Date";
import BadDataException from "../../../../Types/Exception/BadDataException";
import BadRequestException from "../../../../Types/Exception/BadRequestException";
import ForbiddenException from "../../../../Types/Exception/ForbiddenException";
import NotAuthenticatedException from "../../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../../Types/Exception/PaymentRequiredException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import {
  DetectionRuleLibraryEntry,
  SETUP_TEST_DETECTION_RULE_ID,
  getDetectionRuleLibraryEntry,
  getRecommendedDetectionRules,
} from "../../../../Types/SecurityEvent/DetectionRuleLibrary";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import {
  SETUP_TEST_EVENT_COUNT,
  SETUP_TEST_PRODUCT_NAME,
  SETUP_TEST_SOURCE_IP,
} from "../../../../Types/SecurityEvent/SecuritySetupTest";
import * as SecurityPlaybookTemplates from "../../../../Types/SecurityPlaybook/SecurityPlaybookTemplates";
import {
  ENRICH_NEW_CASES_TEMPLATE_KEY,
  getSecurityPlaybookTemplateDefinition,
} from "../../../../Types/SecurityPlaybook/SecurityPlaybookTemplates";
import {
  TurnOnRecommendedAction,
  TurnOnRecommendedPart,
  TurnOnRecommendedProblem,
  TurnOnRecommendedReason,
} from "../../../../Types/SecurityEvent/TurnOnRecommended";
import ServiceType from "../../../../Types/Telemetry/ServiceType";

const PROJECT_ID: ObjectID = new ObjectID(
  "6ba7b811-9dad-41d1-80b4-00c04fd43401",
);
const NOW: Date = new Date("2026-10-19T12:00:00.000Z");
const PROPS: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: new ObjectID("6ba7b811-9dad-41d1-80b4-00c04fd434aa"),
} as DatabaseCommonInteractionProps;

const BRUTE_FORCE: DetectionRuleLibraryEntry = getDetectionRuleLibraryEntry(
  SETUP_TEST_DETECTION_RULE_ID,
)!;

beforeEach(() => {
  // The project's priorities and statuses: a new project's.
  stubSecurityCaseValues();
});

function telemetrySource(
  kind: SecurityTelemetrySourceKind,
  isEnabled: boolean,
  index: number,
): SecurityTelemetrySource {
  const model: SecurityTelemetrySource = new SecurityTelemetrySource();
  model._id = `6ba7b813-9dad-41d1-80b4-00c04fd4350${index}`;
  model.projectId = PROJECT_ID;
  model.kind = kind;
  model.isEnabled = isEnabled;
  return model;
}

function rule(data: {
  name: string;
  isEnabled: boolean;
  sigmaRuleYaml?: string | undefined;
  idSuffix: string;
}): DetectionRule {
  const model: DetectionRule = new DetectionRule();
  model._id = `6ba7b812-9dad-41d1-80b4-00c04fd4${data.idSuffix}`;
  model.projectId = PROJECT_ID;
  model.name = data.name;
  model.isEnabled = data.isEnabled;
  model.sigmaRuleYaml = data.sigmaRuleYaml || "title: x";
  return model;
}

describe("isRuleFromLibraryEntry", () => {
  test("a rule carrying the library rule's Sigma id is it, whatever its name", () => {
    expect(
      isRuleFromLibraryEntry(
        { name: "Renamed", sigmaRuleYaml: BRUTE_FORCE.sigmaRuleYaml },
        BRUTE_FORCE,
      ),
    ).toBe(true);
  });

  test("a rule with the library rule's name is it, whatever its case or spacing", () => {
    expect(
      isRuleFromLibraryEntry(
        { name: "  brute FORCE from one ip address ", sigmaRuleYaml: "" },
        BRUTE_FORCE,
      ),
    ).toBe(true);
  });

  test("any other rule is not", () => {
    expect(
      isRuleFromLibraryEntry(
        { name: "Port scan", sigmaRuleYaml: "id: something-else" },
        BRUTE_FORCE,
      ),
    ).toBe(false);
  });
});

describe("buildDetectionRuleFromLibrary", () => {
  test("is on, opens cases rather than alerts or incidents, and keeps the entry's settings", () => {
    const built: DetectionRule = buildDetectionRuleFromLibrary({
      projectId: PROJECT_ID,
      entry: BRUTE_FORCE,
    });

    expect(built.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(built.name).toBe(BRUTE_FORCE.title);
    expect(built.sigmaRuleYaml).toBe(BRUTE_FORCE.sigmaRuleYaml);
    expect(built.isEnabled).toBe(true);
    expect(built.shouldCreateCase).toBe(true);
    expect(built.shouldCreateAlert).toBe(false);
    expect(built.shouldCreateIncident).toBe(false);
    expect(built.shouldWriteDetectionFinding).toBe(true);
    expect(built.groupByField).toBe("principalIp");
    expect(built.matchCountThreshold).toBe(BRUTE_FORCE.matchCountThreshold);
    expect(built.evaluationIntervalInMinutes).toBe(
      BRUTE_FORCE.evaluationIntervalInMinutes,
    );
  });
});

describe("buildSetupTestEvents", () => {
  test("a dozen failed sign-ins from the documentation address, over the last minute", () => {
    const events: Array<NormalizedSecurityEvent> = buildSetupTestEvents(NOW);

    expect(events).toHaveLength(SETUP_TEST_EVENT_COUNT);

    for (const event of events) {
      expect(event.className).toBe("Authentication");
      expect(event.statusName).toBe("Failure");
      expect(event.principalIp).toBe(SETUP_TEST_SOURCE_IP);
      expect(event.productName).toBe(SETUP_TEST_PRODUCT_NAME);
      expect(event.attributes["oneuptime.setup_test"]).toBe("true");
      expect(event.time.getTime()).toBeLessThan(NOW.getTime());
      expect(event.time.getTime()).toBeGreaterThanOrEqual(
        OneUptimeDate.addRemoveMinutes(NOW, -1).getTime(),
      );
    }

    // Each is its own event, so ClickHouse keeps them all.
    expect(
      new Set(
        events.map((event: NormalizedSecurityEvent): string => {
          return event.eventUid;
        }),
      ).size,
    ).toBe(SETUP_TEST_EVENT_COUNT);
  });

  test("are enough for the brute force rule to fire", () => {
    expect(SETUP_TEST_EVENT_COUNT).toBeGreaterThan(
      BRUTE_FORCE.matchCountThreshold,
    );
  });
});

describe("SecuritySetup.getStatus", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function count(value: number): PositiveNumber {
    return new PositiveNumber(value);
  }

  test("reads the whole pipeline with the caller's own permissions", async () => {
    jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
    const connections: ReturnType<typeof jest.spyOn> = jest
      .spyOn(SecurityEventConnectionService, "countBy")
      .mockResolvedValue(count(2));
    jest
      .spyOn(SecurityLogSourceService, "findOneBy")
      .mockResolvedValue({ isEnabled: true } as never);
    jest
      .spyOn(SecurityTelemetrySourceService, "countBy")
      .mockResolvedValue(count(3));
    const eventCount: ReturnType<typeof jest.spyOn> = jest
      .spyOn(SecurityEventService, "countBy")
      .mockResolvedValue(count(1234));
    jest
      .spyOn(SecurityEventService, "findBy")
      .mockResolvedValue([
        { time: new Date("2026-10-19T11:59:00.000Z") },
      ] as never);
    const recommended: Array<DetectionRuleLibraryEntry> =
      getRecommendedDetectionRules();
    jest.spyOn(DetectionRuleService, "findBy").mockResolvedValue([
      rule({
        name: recommended[0]!.title,
        isEnabled: true,
        idSuffix: "0001",
      }),
      rule({
        name: recommended[1]!.title,
        isEnabled: false,
        idSuffix: "0002",
      }),
      rule({ name: "My own rule", isEnabled: true, idSuffix: "0003" }),
    ] as never);
    jest.spyOn(ThreatIntelFeedService, "countBy").mockResolvedValue(count(1));
    jest.spyOn(SecurityCaseService, "countBy").mockResolvedValue(count(3));
    jest.spyOn(SecurityPlaybookService, "countBy").mockResolvedValue(count(4));
    jest
      .spyOn(SecurityEventDestinationService, "countBy")
      .mockResolvedValue(count(1));

    const status: SecuritySetupStatus = await SecuritySetup.getStatus({
      projectId: PROJECT_ID,
      props: PROPS,
    });

    expect(status).toEqual({
      connections: 2,
      logsSourceEnabled: true,
      telemetrySourcesEnabled: 3,
      eventsLast24Hours: 1234,
      lastEventAt: "2026-10-19T11:59:00.000Z",
      enabledRules: 2,
      recommendedRules: recommended.length,
      recommendedRulesOn: 1,
      threatIntelFeeds: 1,
      openCases: 3,
      enabledPlaybooks: 4,
      destinations: 1,
    });

    expect(connections.mock.calls[0]![0]).toEqual(
      expect.objectContaining({ props: PROPS }),
    );

    // Events of the last 24 hours, the caller's own reading.
    const eventQuery: JSONObject = (
      eventCount.mock.calls[0]![0] as { query: JSONObject }
    ).query;
    expect(eventQuery["projectId"]).toBe(PROJECT_ID);
  });

  test("a figure the caller may not read is 0, and the rest still show", async () => {
    jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
    jest
      .spyOn(SecurityEventConnectionService, "countBy")
      .mockRejectedValue(new Error("not allowed"));
    jest
      .spyOn(SecurityLogSourceService, "findOneBy")
      .mockRejectedValue(new Error("not allowed"));
    jest
      .spyOn(SecurityTelemetrySourceService, "countBy")
      .mockRejectedValue(new Error("not allowed"));
    jest
      .spyOn(SecurityEventService, "countBy")
      .mockRejectedValue(new Error("not allowed"));
    jest
      .spyOn(SecurityEventService, "findBy")
      .mockRejectedValue(new Error("not allowed"));
    jest
      .spyOn(DetectionRuleService, "findBy")
      .mockRejectedValue(new Error("not allowed"));
    jest
      .spyOn(ThreatIntelFeedService, "countBy")
      .mockRejectedValue(new Error("not allowed"));
    jest.spyOn(SecurityCaseService, "countBy").mockResolvedValue(count(5));
    jest
      .spyOn(SecurityPlaybookService, "countBy")
      .mockRejectedValue(new Error("not allowed"));
    jest
      .spyOn(SecurityEventDestinationService, "countBy")
      .mockRejectedValue(new Error("not allowed"));

    const status: SecuritySetupStatus = await SecuritySetup.getStatus({
      projectId: PROJECT_ID,
      props: PROPS,
    });

    expect(status.openCases).toBe(5);
    expect(status.connections).toBe(0);
    expect(status.logsSourceEnabled).toBe(false);
    expect(status.telemetrySourcesEnabled).toBe(0);
    expect(status.eventsLast24Hours).toBe(0);
    expect(status.lastEventAt).toBeNull();
    expect(status.enabledRules).toBe(0);
    expect(status.recommendedRulesOn).toBe(0);
  });
});

describe("SecuritySetup.turnOnRecommended", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  interface Writes {
    rulesCreated: Array<DetectionRule>;
    rulesUpdated: Array<{ id: string; data: JSONObject }>;
    logSourcesCreated: Array<SecurityLogSource>;
    logSourcesUpdated: Array<JSONObject>;
    telemetrySourcesCreated: Array<SecurityTelemetrySource>;
    telemetrySourcesUpdated: Array<{ id: string; data: JSONObject }>;
    playbooksCreated: Array<SecurityPlaybook>;
    playbooksUpdated: Array<{ id: string; data: JSONObject }>;
    propsSeen: Array<unknown>;
  }

  function install(existing: {
    rules?: Array<DetectionRule>;
    logSource?: SecurityLogSource | null;
    // Every kind already on, unless a test says otherwise.
    telemetrySources?: Array<SecurityTelemetrySource>;
    playbooks?: Array<SecurityPlaybook>;
  }): Writes {
    const writes: Writes = {
      rulesCreated: [],
      rulesUpdated: [],
      logSourcesCreated: [],
      logSourcesUpdated: [],
      telemetrySourcesCreated: [],
      telemetrySourcesUpdated: [],
      playbooksCreated: [],
      playbooksUpdated: [],
      propsSeen: [],
    };

    jest
      .spyOn(DetectionRuleService, "findBy")
      .mockResolvedValue((existing.rules || []) as never);
    jest
      .spyOn(DetectionRuleService, "create")
      .mockImplementation(
        async (data: { data: DetectionRule; props: unknown }) => {
          writes.rulesCreated.push(data.data);
          writes.propsSeen.push(data.props);
          return data.data as never;
        },
      );
    jest
      .spyOn(DetectionRuleService, "updateOneById")
      .mockImplementation(async (data: { id: ObjectID; data: unknown }) => {
        writes.rulesUpdated.push({
          id: data.id.toString(),
          data: data.data as JSONObject,
        });
        return 1;
      });
    jest
      .spyOn(SecurityLogSourceService, "findOneBy")
      .mockResolvedValue((existing.logSource ?? null) as never);
    jest
      .spyOn(SecurityLogSourceService, "create")
      .mockImplementation(async (data: { data: SecurityLogSource }) => {
        writes.logSourcesCreated.push(data.data);
        return data.data as never;
      });
    jest
      .spyOn(SecurityLogSourceService, "updateOneById")
      .mockImplementation(async (data: { data: unknown }) => {
        writes.logSourcesUpdated.push(data.data as JSONObject);
        return 1;
      });
    jest.spyOn(SecurityTelemetrySourceService, "findBy").mockResolvedValue(
      (existing.telemetrySources ||
        SECURITY_TELEMETRY_SOURCE_KINDS.map(
          (kind: SecurityTelemetrySourceKind, index: number) => {
            return telemetrySource(kind, true, index);
          },
        )) as never,
    );
    jest
      .spyOn(SecurityTelemetrySourceService, "create")
      .mockImplementation(
        async (data: { data: SecurityTelemetrySource; props: unknown }) => {
          writes.telemetrySourcesCreated.push(data.data);
          writes.propsSeen.push(data.props);
          return data.data as never;
        },
      );
    jest
      .spyOn(SecurityTelemetrySourceService, "updateOneById")
      .mockImplementation(async (data: { id: ObjectID; data: unknown }) => {
        writes.telemetrySourcesUpdated.push({
          id: data.id.toString(),
          data: data.data as JSONObject,
        });
        return 1;
      });
    jest
      .spyOn(SecurityPlaybookService, "findBy")
      .mockResolvedValue((existing.playbooks || []) as never);
    jest
      .spyOn(SecurityPlaybookService, "create")
      .mockImplementation(async (data: { data: SecurityPlaybook }) => {
        writes.playbooksCreated.push(data.data);
        return data.data as never;
      });
    jest
      .spyOn(SecurityPlaybookService, "updateOneById")
      .mockImplementation(async (data: { id: ObjectID; data: unknown }) => {
        writes.playbooksUpdated.push({
          id: data.id.toString(),
          data: data.data as JSONObject,
        });
        return 1;
      });

    return writes;
  }

  test("a new project: your logs on, every recommended rule added, Enrich New Cases on - all as the caller", async () => {
    const writes: Writes = install({});

    const result: TurnOnRecommendedResult =
      await SecuritySetup.turnOnRecommended({
        projectId: PROJECT_ID,
        props: PROPS,
        options: { logs: true, detections: true, playbook: true },
      });

    const recommended: Array<DetectionRuleLibraryEntry> =
      getRecommendedDetectionRules();

    expect(result).toEqual({
      rulesAdded: recommended.length,
      rulesTurnedOn: 0,
      logsTurnedOn: true,
      telemetrySourcesTurnedOn: 0,
      playbookAdded: true,
      playbookTurnedOn: false,
      problems: [],
    });
    expect(
      writes.rulesCreated.map((created: DetectionRule): string => {
        return created.name!;
      }),
    ).toEqual(
      recommended.map((entry: DetectionRuleLibraryEntry): string => {
        return entry.title;
      }),
    );

    for (const props of writes.propsSeen) {
      expect(props).toBe(PROPS);
    }

    expect(writes.logSourcesCreated[0]!.isEnabled).toBe(true);
    expect(writes.logSourcesCreated[0]!.projectId?.toString()).toBe(
      PROJECT_ID.toString(),
    );

    const template: ReturnType<typeof getSecurityPlaybookTemplateDefinition> =
      getSecurityPlaybookTemplateDefinition(ENRICH_NEW_CASES_TEMPLATE_KEY);
    const playbook: SecurityPlaybook = writes.playbooksCreated[0]!;

    expect(playbook.name).toBe(template!.title);
    expect(playbook.isEnabled).toBe(true);
    expect(playbook.trigger).toBe(template!.trigger);
    expect((playbook.steps as Array<unknown>).length).toBe(
      template!.getSteps(
        getSecurityPlaybookTemplateValues({
          priorities: buildDefaultTestPriorities(),
          statuses: buildDefaultTestStatuses(),
        }),
      ).length,
    );
  });

  test("clicking twice changes nothing more", async () => {
    const recommended: Array<DetectionRuleLibraryEntry> =
      getRecommendedDetectionRules();
    const writes: Writes = install({
      rules: recommended.map(
        (entry: DetectionRuleLibraryEntry, index: number): DetectionRule => {
          return rule({
            name: entry.title,
            isEnabled: true,
            idSuffix: String(1000 + index),
          });
        },
      ),
      logSource: {
        isEnabled: true,
        id: ObjectID.generate(),
      } as SecurityLogSource,
      playbooks: [
        { name: "Enrich New Cases", isEnabled: true } as SecurityPlaybook,
      ],
    });

    const result: TurnOnRecommendedResult =
      await SecuritySetup.turnOnRecommended({
        projectId: PROJECT_ID,
        props: PROPS,
        options: { logs: true, detections: true, playbook: true },
      });

    expect(result).toEqual({
      rulesAdded: 0,
      rulesTurnedOn: 0,
      logsTurnedOn: false,
      telemetrySourcesTurnedOn: 0,
      playbookAdded: false,
      playbookTurnedOn: false,
      problems: [],
    });
    expect(writes.rulesCreated).toHaveLength(0);
    expect(writes.logSourcesCreated).toHaveLength(0);
    expect(writes.playbooksCreated).toHaveLength(0);
    expect(writes.playbooksUpdated).toHaveLength(0);
  });

  test("Enrich New Cases, switched off, is switched back on rather than added again", async () => {
    const playbookId: ObjectID = ObjectID.generate();
    const off: SecurityPlaybook = {
      name: "  enrich new cases ",
      isEnabled: false,
      id: playbookId,
    } as SecurityPlaybook;
    const writes: Writes = install({ playbooks: [off] });

    const result: TurnOnRecommendedResult =
      await SecuritySetup.turnOnRecommended({
        projectId: PROJECT_ID,
        props: PROPS,
        options: { logs: false, detections: false, playbook: true },
      });

    expect(result.playbookAdded).toBe(false);
    expect(result.playbookTurnedOn).toBe(true);
    expect(writes.playbooksCreated).toHaveLength(0);
    expect(writes.playbooksUpdated).toEqual([
      { id: playbookId.toString(), data: { isEnabled: true } },
    ]);
  });

  test("a recommended rule that was turned off is turned back on, not added twice", async () => {
    const recommended: Array<DetectionRuleLibraryEntry> =
      getRecommendedDetectionRules();
    const off: DetectionRule = rule({
      name: "Renamed by the team",
      sigmaRuleYaml: recommended[0]!.sigmaRuleYaml,
      isEnabled: false,
      idSuffix: "2001",
    });
    const writes: Writes = install({ rules: [off] });

    const result: TurnOnRecommendedResult =
      await SecuritySetup.turnOnRecommended({
        projectId: PROJECT_ID,
        props: PROPS,
        options: { logs: false, detections: true, playbook: false },
      });

    expect(result.rulesTurnedOn).toBe(1);
    expect(result.rulesAdded).toBe(recommended.length - 1);
    expect(writes.rulesUpdated).toEqual([
      { id: off.id!.toString(), data: { isEnabled: true } },
    ]);
  });

  test("your logs, switched off, are switched back on", async () => {
    const writes: Writes = install({
      logSource: {
        isEnabled: false,
        id: ObjectID.generate(),
      } as SecurityLogSource,
    });

    const result: TurnOnRecommendedResult =
      await SecuritySetup.turnOnRecommended({
        projectId: PROJECT_ID,
        props: PROPS,
        options: { logs: true, detections: false, playbook: false },
      });

    expect(result.logsTurnedOn).toBe(true);
    expect(writes.logSourcesUpdated).toEqual([{ isEnabled: true }]);
  });

  test("only what was asked for is done", async () => {
    const writes: Writes = install({});

    await SecuritySetup.turnOnRecommended({
      projectId: PROJECT_ID,
      props: PROPS,
      options: { logs: false, detections: false, playbook: true },
    });

    expect(writes.rulesCreated).toHaveLength(0);
    expect(writes.logSourcesCreated).toHaveLength(0);
    expect(writes.playbooksCreated).toHaveLength(1);
  });

  // The library's own 53-character title, against the old 50-character name.
  const SEQUENCE_TITLE: string =
    "Failed sign-ins, then a success from the same address";

  function failCreatingRules(
    writes: Writes,
    fail: (rule: DetectionRule) => Error | null,
  ): void {
    jest
      .spyOn(DetectionRuleService, "create")
      .mockImplementation(
        async (data: { data: DetectionRule; props: unknown }) => {
          const error: Error | null = fail(data.data);

          if (error) {
            throw error;
          }

          writes.rulesCreated.push(data.data);
          writes.propsSeen.push(data.props);
          return data.data as never;
        },
      );
  }

  test("a rule that cannot be added is said, with why, and every part after it is still done", async () => {
    const writes: Writes = install({});
    failCreatingRules(writes, (rule: DetectionRule): Error | null => {
      return rule.name === SEQUENCE_TITLE
        ? new BadDataException("name length cannot be more than 50 characters")
        : null;
    });
    const recommended: Array<DetectionRuleLibraryEntry> =
      getRecommendedDetectionRules();

    const result: TurnOnRecommendedResult =
      await SecuritySetup.turnOnRecommended({
        projectId: PROJECT_ID,
        props: PROPS,
        options: { logs: true, detections: true, playbook: true },
      });

    expect(result).toEqual({
      rulesAdded: recommended.length - 1,
      rulesTurnedOn: 0,
      logsTurnedOn: true,
      telemetrySourcesTurnedOn: 0,
      playbookAdded: true,
      playbookTurnedOn: false,
      problems: [
        {
          part: TurnOnRecommendedPart.Rule,
          action: TurnOnRecommendedAction.Add,
          name: SEQUENCE_TITLE,
          reason: TurnOnRecommendedReason.Refused,
          detail: "name length cannot be more than 50 characters",
        },
      ],
    });

    // The rules after it were still added, in the library's order, and the playbook.
    expect(
      writes.rulesCreated.map((created: DetectionRule): string => {
        return created.name!;
      }),
    ).toEqual(
      recommended
        .filter((entry: DetectionRuleLibraryEntry): boolean => {
          return entry.title !== SEQUENCE_TITLE;
        })
        .map((entry: DetectionRuleLibraryEntry): string => {
          return entry.title;
        }),
    );
    expect(writes.playbooksCreated).toHaveLength(1);
    expect(writes.logSourcesCreated).toHaveLength(1);
  });

  test("clicking again after a failure does only what was left, and nothing twice", async () => {
    const writes: Writes = install({});
    let isFixed: boolean = false;
    failCreatingRules(writes, (rule: DetectionRule): Error | null => {
      return rule.name === SEQUENCE_TITLE && !isFixed
        ? new Error("connection reset")
        : null;
    });

    const first: TurnOnRecommendedResult =
      await SecuritySetup.turnOnRecommended({
        projectId: PROJECT_ID,
        props: PROPS,
        options: { logs: false, detections: true, playbook: false },
      });

    expect(first.problems).toHaveLength(1);

    // The second click reads what the first one added.
    const added: Array<DetectionRule> = writes.rulesCreated.map(
      (created: DetectionRule, index: number): DetectionRule => {
        return rule({
          name: created.name!,
          isEnabled: true,
          sigmaRuleYaml: created.sigmaRuleYaml,
          idSuffix: String(5000 + index),
        });
      },
    );
    jest
      .spyOn(DetectionRuleService, "findBy")
      .mockResolvedValue(added as never);
    writes.rulesCreated.length = 0;
    isFixed = true;

    const second: TurnOnRecommendedResult =
      await SecuritySetup.turnOnRecommended({
        projectId: PROJECT_ID,
        props: PROPS,
        options: { logs: false, detections: true, playbook: false },
      });

    expect(second).toEqual({
      rulesAdded: 1,
      rulesTurnedOn: 0,
      logsTurnedOn: false,
      telemetrySourcesTurnedOn: 0,
      playbookAdded: false,
      playbookTurnedOn: false,
      problems: [],
    });
    expect(
      writes.rulesCreated.map((created: DetectionRule): string => {
        return created.name!;
      }),
    ).toEqual([SEQUENCE_TITLE]);
  });

  test("your logs that cannot be turned on keep nothing else off, and the server's own failure is never the reader's to read", async () => {
    const writes: Writes = install({});
    jest
      .spyOn(SecurityLogSourceService, "create")
      .mockRejectedValue(new Error("connection reset by peer at 10.0.0.12"));

    const result: TurnOnRecommendedResult =
      await SecuritySetup.turnOnRecommended({
        projectId: PROJECT_ID,
        props: PROPS,
        options: { logs: true, detections: true, playbook: true },
      });

    expect(result.problems).toEqual([
      {
        part: TurnOnRecommendedPart.Logs,
        action: TurnOnRecommendedAction.Add,
        name: "",
        reason: TurnOnRecommendedReason.Failed,
        detail: "",
      },
    ]);
    expect(result.logsTurnedOn).toBe(false);
    expect(result.rulesAdded).toBe(getRecommendedDetectionRules().length);
    expect(result.playbookAdded).toBe(true);
    expect(writes.playbooksCreated).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("connection reset");
    expect(JSON.stringify(result)).not.toContain("10.0.0.12");
  });

  test("when the project's rules cannot be read, no rule is added - it would copy the ones there - and it says so", async () => {
    const writes: Writes = install({});
    jest
      .spyOn(DetectionRuleService, "findBy")
      .mockRejectedValue(
        new NotAuthorizedException("You do not have permission to read rules"),
      );

    const result: TurnOnRecommendedResult =
      await SecuritySetup.turnOnRecommended({
        projectId: PROJECT_ID,
        props: PROPS,
        options: { logs: true, detections: true, playbook: true },
      });

    expect(result.problems).toEqual([
      {
        part: TurnOnRecommendedPart.Rule,
        action: TurnOnRecommendedAction.Check,
        name: "",
        reason: TurnOnRecommendedReason.NotAllowed,
        detail: "",
      },
    ]);
    expect(writes.rulesCreated).toHaveLength(0);
    expect(result.rulesAdded).toBe(0);
    // Your logs and the playbook do not depend on it.
    expect(result.logsTurnedOn).toBe(true);
    expect(result.playbookAdded).toBe(true);
  });

  test("a rule turned off that the role may not turn back on is named as the project names it", async () => {
    const recommended: Array<DetectionRuleLibraryEntry> =
      getRecommendedDetectionRules();
    const off: DetectionRule = rule({
      name: "Renamed by the team",
      sigmaRuleYaml: recommended[0]!.sigmaRuleYaml,
      isEnabled: false,
      idSuffix: "2101",
    });
    const writes: Writes = install({ rules: [off] });
    jest
      .spyOn(DetectionRuleService, "updateOneById")
      .mockRejectedValue(new NotAuthorizedException("not allowed"));

    const result: TurnOnRecommendedResult =
      await SecuritySetup.turnOnRecommended({
        projectId: PROJECT_ID,
        props: PROPS,
        options: { logs: false, detections: true, playbook: false },
      });

    expect(result.problems).toEqual([
      {
        part: TurnOnRecommendedPart.Rule,
        action: TurnOnRecommendedAction.TurnOn,
        name: "Renamed by the team",
        reason: TurnOnRecommendedReason.NotAllowed,
        detail: "",
      },
    ]);
    expect(result.rulesTurnedOn).toBe(0);
    // Never copied: the other rules are added, that one is not.
    expect(result.rulesAdded).toBe(recommended.length - 1);
    expect(
      writes.rulesCreated.some((created: DetectionRule): boolean => {
        return created.name === recommended[0]!.title;
      }),
    ).toBe(false);
  });

  test("a plan that does not include rules is said once per rule, in the plan's own words", async () => {
    install({});
    jest
      .spyOn(DetectionRuleService, "create")
      .mockRejectedValue(
        new PaymentRequiredException(
          "Please upgrade your plan to Growth to access this feature",
        ),
      );

    const result: TurnOnRecommendedResult =
      await SecuritySetup.turnOnRecommended({
        projectId: PROJECT_ID,
        props: PROPS,
        options: { logs: false, detections: true, playbook: false },
      });

    expect(result.rulesAdded).toBe(0);
    expect(result.problems).toHaveLength(getRecommendedDetectionRules().length);

    for (const problem of result.problems) {
      expect(problem).toMatchObject({
        part: TurnOnRecommendedPart.Rule,
        action: TurnOnRecommendedAction.Add,
        reason: TurnOnRecommendedReason.Plan,
        detail: "Please upgrade your plan to Growth to access this feature",
      });
    }
  });

  test("Enrich New Cases that cannot be added is said by its name", async () => {
    install({});
    jest
      .spyOn(SecurityPlaybookService, "create")
      .mockRejectedValue(new ForbiddenException("Forbidden"));

    const result: TurnOnRecommendedResult =
      await SecuritySetup.turnOnRecommended({
        projectId: PROJECT_ID,
        props: PROPS,
        options: { logs: false, detections: false, playbook: true },
      });

    expect(result.playbookAdded).toBe(false);
    expect(result.problems).toEqual([
      {
        part: TurnOnRecommendedPart.Playbook,
        action: TurnOnRecommendedAction.Add,
        name: "Enrich New Cases",
        reason: TurnOnRecommendedReason.NotAllowed,
        detail: "",
      },
    ]);
  });

  test("Enrich New Cases turned off that cannot be turned back on is said by the name the project gave it", async () => {
    const off: SecurityPlaybook = {
      name: "Enrich new cases",
      isEnabled: false,
      id: ObjectID.generate(),
    } as SecurityPlaybook;
    const writes: Writes = install({ playbooks: [off] });
    jest
      .spyOn(SecurityPlaybookService, "updateOneById")
      .mockRejectedValue(new Error("deadlock detected"));

    const result: TurnOnRecommendedResult =
      await SecuritySetup.turnOnRecommended({
        projectId: PROJECT_ID,
        props: PROPS,
        options: { logs: false, detections: false, playbook: true },
      });

    expect(writes.playbooksCreated).toHaveLength(0);
    expect(result.problems).toEqual([
      {
        part: TurnOnRecommendedPart.Playbook,
        action: TurnOnRecommendedAction.TurnOn,
        name: "Enrich new cases",
        reason: TurnOnRecommendedReason.Failed,
        detail: "",
      },
    ]);
  });

  test("the project's playbooks that cannot be read add no copy of Enrich New Cases", async () => {
    const writes: Writes = install({});
    jest
      .spyOn(SecurityPlaybookService, "findBy")
      .mockRejectedValue(new Error("statement timeout"));

    const result: TurnOnRecommendedResult =
      await SecuritySetup.turnOnRecommended({
        projectId: PROJECT_ID,
        props: PROPS,
        options: { logs: false, detections: false, playbook: true },
      });

    expect(writes.playbooksCreated).toHaveLength(0);
    expect(result.problems).toEqual([
      {
        part: TurnOnRecommendedPart.Playbook,
        action: TurnOnRecommendedAction.Check,
        name: "Enrich New Cases",
        reason: TurnOnRecommendedReason.Failed,
        detail: "",
      },
    ]);
  });

  test("a missing Enrich New Cases template is said, never thrown", async () => {
    install({});
    jest
      .spyOn(SecurityPlaybookTemplates, "getSecurityPlaybookTemplateDefinition")
      .mockReturnValue(undefined);

    const result: TurnOnRecommendedResult =
      await SecuritySetup.turnOnRecommended({
        projectId: PROJECT_ID,
        props: PROPS,
        options: { logs: false, detections: false, playbook: true },
      });

    expect(result.problems).toEqual([
      {
        part: TurnOnRecommendedPart.Playbook,
        action: TurnOnRecommendedAction.Add,
        name: "",
        reason: TurnOnRecommendedReason.Failed,
        detail: "",
      },
    ]);
  });

  test("a failure on OneUptime's side is logged as an error; a refusal by the role, the plan or a check as a warning", async () => {
    install({});
    const errors: ReturnType<typeof jest.spyOn> = jest
      .spyOn(logger, "error")
      .mockImplementation(() => {
        return undefined;
      });
    const warnings: ReturnType<typeof jest.spyOn> = jest
      .spyOn(logger, "warn")
      .mockImplementation(() => {
        return undefined;
      });
    jest
      .spyOn(SecurityLogSourceService, "create")
      .mockRejectedValue(new Error("connection reset"));
    jest
      .spyOn(SecurityPlaybookService, "create")
      .mockRejectedValue(new NotAuthorizedException("not allowed"));

    const result: TurnOnRecommendedResult =
      await SecuritySetup.turnOnRecommended({
        projectId: PROJECT_ID,
        props: PROPS,
        options: { logs: true, detections: false, playbook: true },
      });

    expect(result.problems).toHaveLength(2);
    expect(String(errors.mock.calls[0]![0])).toContain(
      `could not add logs in project ${PROJECT_ID.toString()} (failed)`,
    );
    expect(String(warnings.mock.calls[0]![0])).toContain(
      'could not add playbook "Enrich New Cases"',
    );
  });

  test("every problem names a part, an action and a reason the Dashboard words", async () => {
    install({});
    jest
      .spyOn(DetectionRuleService, "create")
      .mockRejectedValue(new Error("x"));
    jest
      .spyOn(SecurityLogSourceService, "create")
      .mockRejectedValue(new BadRequestException("Bad request"));
    jest
      .spyOn(SecurityPlaybookService, "create")
      .mockRejectedValue(new NotAuthenticatedException("Sign in"));

    const result: TurnOnRecommendedResult =
      await SecuritySetup.turnOnRecommended({
        projectId: PROJECT_ID,
        props: PROPS,
        options: { logs: true, detections: true, playbook: true },
      });

    for (const problem of result.problems as Array<TurnOnRecommendedProblem>) {
      expect(Object.values(TurnOnRecommendedPart)).toContain(problem.part);
      expect(Object.values(TurnOnRecommendedAction)).toContain(problem.action);
      expect(Object.values(TurnOnRecommendedReason)).toContain(problem.reason);
      expect(typeof problem.name).toBe("string");
      expect(typeof problem.detail).toBe("string");
    }
  });

  /*
   * The rest of your OneUptime data rides on "your logs": the click turns
   * on each kind the project does not read yet, as the caller. Tests run as
   * OneUptime Community, where nothing writes the audit log, so it is left
   * off there.
   */
  describe("your OneUptime data", () => {
    test("each kind not read yet is added as the caller - all but the audit log, which only Enterprise writes", async () => {
      const writes: Writes = install({ telemetrySources: [] });

      const result: TurnOnRecommendedResult =
        await SecuritySetup.turnOnRecommended({
          projectId: PROJECT_ID,
          props: PROPS,
          options: { logs: true, detections: false, playbook: false },
        });

      expect(
        writes.telemetrySourcesCreated.map(
          (created: SecurityTelemetrySource): unknown => {
            return [created.kind, created.isEnabled, created.projectId];
          },
        ),
      ).toEqual([
        [SecurityTelemetrySourceKind.Traces, true, PROJECT_ID],
        [SecurityTelemetrySourceKind.NetworkFlows, true, PROJECT_ID],
        [SecurityTelemetrySourceKind.RumSessions, true, PROJECT_ID],
      ]);
      expect(result.telemetrySourcesTurnedOn).toBe(3);
      expect(result.problems).toEqual([]);

      for (const props of writes.propsSeen) {
        expect(props).toBe(PROPS);
      }
    });

    test("one turned off is turned back on, and one already on is left alone", async () => {
      const writes: Writes = install({
        telemetrySources: [
          telemetrySource(SecurityTelemetrySourceKind.Traces, false, 1),
          telemetrySource(SecurityTelemetrySourceKind.NetworkFlows, true, 2),
          telemetrySource(SecurityTelemetrySourceKind.RumSessions, true, 3),
        ],
      });

      const result: TurnOnRecommendedResult =
        await SecuritySetup.turnOnRecommended({
          projectId: PROJECT_ID,
          props: PROPS,
          options: { logs: true, detections: false, playbook: false },
        });

      expect(writes.telemetrySourcesCreated).toEqual([]);
      expect(writes.telemetrySourcesUpdated).toEqual([
        {
          id: "6ba7b813-9dad-41d1-80b4-00c04fd43501",
          data: { isEnabled: true },
        },
      ]);
      expect(result.telemetrySourcesTurnedOn).toBe(1);
    });

    test("a kind that cannot be added is named with why, and the others are still added", async () => {
      const writes: Writes = install({ telemetrySources: [] });
      jest
        .spyOn(SecurityTelemetrySourceService, "create")
        .mockImplementation(async (data: { data: SecurityTelemetrySource }) => {
          if (data.data.kind === SecurityTelemetrySourceKind.NetworkFlows) {
            throw new Error("connection reset by peer at 10.0.0.12");
          }

          writes.telemetrySourcesCreated.push(data.data);
          return data.data as never;
        });

      const result: TurnOnRecommendedResult =
        await SecuritySetup.turnOnRecommended({
          projectId: PROJECT_ID,
          props: PROPS,
          options: { logs: true, detections: false, playbook: false },
        });

      expect(result.problems).toEqual([
        {
          part: TurnOnRecommendedPart.TelemetrySources,
          action: TurnOnRecommendedAction.Add,
          name: SecurityTelemetrySourceKind.NetworkFlows,
          reason: TurnOnRecommendedReason.Failed,
          detail: "",
        },
      ]);
      expect(result.telemetrySourcesTurnedOn).toBe(2);
      expect(result.logsTurnedOn).toBe(true);
      expect(JSON.stringify(result)).not.toContain("10.0.0.12");
    });

    test("what the project has that cannot be read adds nothing, and says so once", async () => {
      install({});
      jest
        .spyOn(SecurityTelemetrySourceService, "findBy")
        .mockRejectedValue(new Error("not allowed"));

      const result: TurnOnRecommendedResult =
        await SecuritySetup.turnOnRecommended({
          projectId: PROJECT_ID,
          props: PROPS,
          options: { logs: true, detections: false, playbook: false },
        });

      expect(result.problems).toEqual([
        {
          part: TurnOnRecommendedPart.TelemetrySources,
          action: TurnOnRecommendedAction.Check,
          name: "",
          reason: TurnOnRecommendedReason.Failed,
          detail: "",
        },
      ]);
      expect(result.telemetrySourcesTurnedOn).toBe(0);
    });

    test("leaving your logs out leaves your OneUptime data alone too", async () => {
      const writes: Writes = install({ telemetrySources: [] });

      const result: TurnOnRecommendedResult =
        await SecuritySetup.turnOnRecommended({
          projectId: PROJECT_ID,
          props: PROPS,
          options: { logs: false, detections: false, playbook: false },
        });

      expect(writes.telemetrySourcesCreated).toEqual([]);
      expect(result.telemetrySourcesTurnedOn).toBe(0);
      expect(SecurityTelemetrySourceService.findBy).not.toHaveBeenCalled();
    });
  });
});

describe("describeTurnOnRecommendedFailure", () => {
  test.each([
    [
      "a role that may not",
      new NotAuthorizedException("You do not have permissions"),
      TurnOnRecommendedReason.NotAllowed,
      "",
    ],
    [
      "a refusal of the request",
      new ForbiddenException("Forbidden"),
      TurnOnRecommendedReason.NotAllowed,
      "",
    ],
    [
      "a session that ended",
      new NotAuthenticatedException("Not signed in"),
      TurnOnRecommendedReason.NotAllowed,
      "",
    ],
    [
      "a plan, in its own words",
      new PaymentRequiredException("Please upgrade your plan to Scale"),
      TurnOnRecommendedReason.Plan,
      "Please upgrade your plan to Scale",
    ],
    [
      "a record refused, in its own words",
      new BadDataException("Sigma rule YAML is required."),
      TurnOnRecommendedReason.Refused,
      "Sigma rule YAML is required.",
    ],
    [
      "a bad request, in its own words",
      new BadRequestException("Bad request"),
      TurnOnRecommendedReason.Refused,
      "Bad request",
    ],
    [
      "anything else, never in its own words",
      new Error("ECONNREFUSED 10.0.0.5:5432"),
      TurnOnRecommendedReason.Failed,
      "",
    ],
    [
      "something that is not an error at all",
      "boom",
      TurnOnRecommendedReason.Failed,
      "",
    ],
  ])(
    "%s",
    (
      _label: string,
      error: unknown,
      reason: TurnOnRecommendedReason,
      detail: string,
    ) => {
      expect(describeTurnOnRecommendedFailure(error)).toEqual({
        reason,
        detail,
      });
    },
  );
});

describe("SecuritySetup.runTest", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function install(existingRules: Array<DetectionRule>): {
    created: Array<DetectionRule>;
    inserted: Array<{ rows: Array<JSONObject>; options: unknown }>;
    evaluations: Array<{
      rule: DetectionRule;
      setupTest: DetectionRuleSetupTest;
    }>;
    caseQueries: Array<JSONObject>;
  } {
    const installed: {
      created: Array<DetectionRule>;
      inserted: Array<{ rows: Array<JSONObject>; options: unknown }>;
      evaluations: Array<{
        rule: DetectionRule;
        setupTest: DetectionRuleSetupTest;
      }>;
      caseQueries: Array<JSONObject>;
    } = { created: [], inserted: [], evaluations: [], caseQueries: [] };

    jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
    jest
      .spyOn(DetectionRuleService, "findBy")
      .mockResolvedValue(existingRules as never);
    jest
      .spyOn(DetectionRuleService, "create")
      .mockImplementation(async (data: { data: DetectionRule }) => {
        installed.created.push(data.data);
        data.data._id = "6ba7b812-9dad-41d1-80b4-00c04fd43499";
        return data.data as never;
      });
    jest
      .spyOn(OTelIngestService, "telemetryServiceFromName")
      .mockResolvedValue({
        serviceName: "OneUptime Detections",
        primaryEntityId: new ObjectID("6ba7b812-9dad-41d1-80b4-00c04fd434e1"),
        primaryEntityType: ServiceType.OpenTelemetry,
        dataRententionInDays: 15,
        serviceRetentionConfig: null,
        serviceRetentionInDays: null,
        projectRetentionConfig: null,
        projectRetentionInDays: 15,
      } as unknown as TelemetryServiceMetadata);
    jest
      .spyOn(SecurityEventService, "insertJsonRows")
      .mockImplementation(
        async (rows: Array<JSONObject>, options?: unknown) => {
          installed.inserted.push({ rows, options });
        },
      );
    jest
      .spyOn(DetectionRuleEvaluator, "evaluateRule")
      .mockImplementation(
        async (
          evaluated: DetectionRule,
          options?: { setupTest?: DetectionRuleSetupTest | undefined },
        ) => {
          installed.evaluations.push({
            rule: evaluated,
            setupTest: options!.setupTest!,
          });
          return {} as never;
        },
      );

    const opened: SecurityCase = new SecurityCase();
    opened._id = "6ba7b812-9dad-41d1-80b4-00c04fd434c1";
    opened.caseNumberWithPrefix = "CASE-7";

    jest
      .spyOn(SecurityCaseService, "findOneBy")
      .mockImplementation(async (data: { query: unknown }) => {
        installed.caseQueries.push(data.query as JSONObject);
        return opened as never;
      });

    return installed;
  }

  test("sends a dozen simulated failures through the brute force rule, and names the case it opened", async () => {
    const existing: DetectionRule = rule({
      name: BRUTE_FORCE.title,
      isEnabled: true,
      sigmaRuleYaml: BRUTE_FORCE.sigmaRuleYaml,
      idSuffix: "3001",
    });
    const installed: ReturnType<typeof install> = install([existing]);

    const result: SecuritySetupTestResult = await SecuritySetup.runTest({
      projectId: PROJECT_ID,
      props: PROPS,
    });

    expect(result).toEqual({
      eventsSent: SETUP_TEST_EVENT_COUNT,
      caseId: "6ba7b812-9dad-41d1-80b4-00c04fd434c1",
      caseNumber: "CASE-7",
      ruleAdded: false,
    });
    expect(installed.created).toHaveLength(0);

    // Stored, and readable before the rule reads them.
    expect(installed.inserted[0]!.rows).toHaveLength(SETUP_TEST_EVENT_COUNT);
    expect(installed.inserted[0]!.options).toEqual({
      clickhouseSettings: { wait_for_async_insert: 1 },
    });

    for (const row of installed.inserted[0]!.rows) {
      expect(row["projectId"]).toBe(PROJECT_ID.toString());
      expect(row["productName"]).toBe(SETUP_TEST_PRODUCT_NAME);
      expect(row["principalIp"]).toBe(SETUP_TEST_SOURCE_IP);
    }

    // The project's own rule, reading only the test's events, around now.
    const evaluation: {
      rule: DetectionRule;
      setupTest: DetectionRuleSetupTest;
    } = installed.evaluations[0]!;

    expect(evaluation.rule).toBe(existing);
    expect(Object.values(evaluation.setupTest.restrictTo.query_params)).toEqual(
      [SETUP_TEST_PRODUCT_NAME],
    );
    expect(evaluation.setupTest.startTime).toEqual(
      OneUptimeDate.addRemoveMinutes(NOW, -10),
    );
    expect(evaluation.setupTest.endTime).toEqual(
      OneUptimeDate.addRemoveMinutes(NOW, 1),
    );

    // The case is the one about the test's address.
    expect(installed.caseQueries[0]!["groupingKey"]).toBe(
      `entity:${SETUP_TEST_SOURCE_IP}`,
    );
  });

  test("a project without the brute force rule gets it, as the caller", async () => {
    const installed: ReturnType<typeof install> = install([
      rule({ name: "Port scan", isEnabled: true, idSuffix: "3002" }),
    ]);

    const result: SecuritySetupTestResult = await SecuritySetup.runTest({
      projectId: PROJECT_ID,
      props: PROPS,
    });

    expect(result.ruleAdded).toBe(true);
    expect(installed.created[0]!.name).toBe(BRUTE_FORCE.title);
    expect(installed.evaluations[0]!.rule).toBe(installed.created[0]);
  });

  test("no case found reads as none, not as an error", async () => {
    install([]);
    jest.spyOn(SecurityCaseService, "findOneBy").mockResolvedValue(null);

    const result: SecuritySetupTestResult = await SecuritySetup.runTest({
      projectId: PROJECT_ID,
      props: PROPS,
    });

    expect(result.caseId).toBeNull();
    expect(result.caseNumber).toBeNull();
  });
});
