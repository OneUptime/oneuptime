import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import ProbeSyslogIngestService from "../../FeatureSet/Telemetry/Services/ProbeSyslogIngestService";
import LogPipelineService from "../../FeatureSet/Telemetry/Services/LogPipelineService";
import LogDropFilterService from "../../FeatureSet/Telemetry/Services/LogDropFilterService";
import LogScrubRuleService from "../../FeatureSet/Telemetry/Services/LogScrubRuleService";
import LogScrubRule from "Common/Models/DatabaseModels/LogScrubRule";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import Probe from "Common/Models/DatabaseModels/Probe";
import LogService from "Common/Server/Services/LogService";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "Common/Server/Services/OpenTelemetryIngestService";
import ProbeService from "Common/Server/Services/ProbeService";
import NetworkDeviceHydrationUtil from "Common/Server/Utils/Monitor/NetworkDeviceHydrationUtil";
import NetworkFlowDeviceMatcher from "Common/Server/Utils/NetworkFlow/NetworkFlowDeviceMatcher";
import SyslogDeviceMatcher from "Common/Server/Utils/Syslog/SyslogDeviceMatcher";
import { JSONObject } from "Common/Types/JSON";
import LogScrubAction from "Common/Types/Log/LogScrubAction";
import LogScrubPatternType from "Common/Types/Log/LogScrubPatternType";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { compileScrubRuleCustomRegex } from "Common/Types/Telemetry/ScrubRule";
import { PatternWorkAllowance } from "Common/Utils/LinearRegExp/PatternWork";
import { SeededRandom, seededRandom } from "Common/Tests/Helpers/SeededRandom";

/*
 * ---------------------------------------------------------------------------
 * A PROBE'S BATCH CARRIES MANY PROJECTS' LOGS: EACH HAS ITS OWN ALLOWANCE.
 *
 * A probe forwards the syslog of every device it polls, and the devices are
 * of more than one project. Each project's drop filters, scrub rules and
 * pipelines run on its own messages - and the work their patterns may take
 * (Common/Utils/LinearRegExp/PatternWork.ts) is that project's, never
 * shared: one project's patterns spending all theirs leaves another's
 * scrubbing exactly as it would alone.
 * ---------------------------------------------------------------------------
 */

const PROJECT: ObjectID = ObjectID.generate();
const OTHER_PROJECT: ObjectID = ObjectID.generate();
const PROBE: ObjectID = ObjectID.generate();

const SWITCH_ADDRESS: string = "10.0.0.2";
const ROUTER_ADDRESS: string = "10.0.0.3";

const RECEIVED_AT: Date = new Date();

// Written to need many steps per character on a's and b's.
const EXPLODING: string = "(?:[ab]*a[ab]{14}|[ab]{0,2000})Q";

function randomAb(length: number, seed: number): string {
  const random: SeededRandom = seededRandom(seed);
  let text: string = "";

  for (let index: number = 0; index < length; index++) {
    text += random(2) === 0 ? "a" : "b";
  }

  return text;
}

function device(data: {
  projectId: ObjectID;
  name: string;
  hostname: string;
}): NetworkDevice {
  const value: NetworkDevice = new NetworkDevice(ObjectID.generate());

  value.projectId = data.projectId;
  value.name = data.name;
  value.hostname = data.hostname;

  return value;
}

const SWITCH_DEVICE: NetworkDevice = device({
  projectId: PROJECT,
  name: "Core Switch",
  hostname: SWITCH_ADDRESS,
});

const ROUTER_DEVICE: NetworkDevice = device({
  projectId: OTHER_PROJECT,
  name: "Branch Router",
  hostname: ROUTER_ADDRESS,
});

function customScrubRule(pattern: string): {
  rule: LogScrubRule;
  regex: ReturnType<typeof compileScrubRuleCustomRegex>;
} {
  const rule: LogScrubRule = new LogScrubRule();
  rule.patternType = LogScrubPatternType.Custom;
  rule.customRegex = pattern;
  rule.scrubAction = LogScrubAction.Redact;
  rule.fieldsToScrub = "body";

  return { rule: rule, regex: compileScrubRuleCustomRegex(pattern) };
}

let insertedRows: Array<JSONObject> = [];
let allowancesMade: Array<PatternWorkAllowance> = [];

beforeEach(() => {
  SyslogDeviceMatcher.clearCaches();
  NetworkFlowDeviceMatcher.clearCaches();
  insertedRows = [];
  allowancesMade = [];

  jest.spyOn(ProbeService, "findOneById").mockImplementation((async () => {
    const probe: Probe = new Probe(PROBE);
    probe.projectId = PROJECT;
    return probe;
  }) as never);

  jest
    .spyOn(NetworkDeviceHydrationUtil, "findDevicesByProbeAndSource")
    .mockImplementation((async (data: {
      sourceIpAddress: string;
    }): Promise<Array<NetworkDevice>> => {
      if (data.sourceIpAddress === SWITCH_ADDRESS) {
        return [SWITCH_DEVICE];
      }

      if (data.sourceIpAddress === ROUTER_ADDRESS) {
        return [ROUTER_DEVICE];
      }

      return [];
    }) as never);

  jest.spyOn(NetworkDeviceService, "findBy").mockImplementation((async (data: {
    query: { projectId: ObjectID };
  }): Promise<Array<NetworkDevice>> => {
    return [SWITCH_DEVICE, ROUTER_DEVICE].filter(
      (candidate: NetworkDevice): boolean => {
        return (
          candidate.projectId?.toString() === data.query.projectId.toString()
        );
      },
    );
  }) as never);

  jest
    .spyOn(OTelIngestService, "telemetryServiceFromName")
    .mockImplementation((async (data: {
      serviceName: string;
      projectId: ObjectID;
    }): Promise<TelemetryServiceMetadata> => {
      return {
        serviceName: data.serviceName,
        primaryEntityId: ObjectID.generate(),
        primaryEntityType: ServiceType.OpenTelemetry,
        dataRententionInDays: 30,
        serviceRetentionConfig: null,
        serviceRetentionInDays: 30,
        projectRetentionConfig: null,
        projectRetentionInDays: 15,
      };
    }) as never);

  jest.spyOn(LogService, "insertJsonRows").mockImplementation((async (
    rows: Array<JSONObject>,
  ): Promise<void> => {
    insertedRows.push(...rows);
  }) as never);

  jest
    .spyOn(LogPipelineService, "loadPipelines")
    .mockResolvedValue([] as never);
  jest
    .spyOn(LogDropFilterService, "loadDropFilters")
    .mockResolvedValue([] as never);
  jest.spyOn(LogScrubRuleService, "loadScrubRules").mockImplementation((async (
    projectId: ObjectID,
  ) => {
    return projectId.toString() === PROJECT.toString()
      ? [customScrubRule(`${EXPLODING}`)]
      : [customScrubRule("secret-\\d+")];
  }) as never);

  /*
   * Each project's allowance for the batch, with no pool: what a record
   * adds is all its patterns may take on it, so one project's patterns
   * spending more than their records add stays visible.
   */
  jest
    .spyOn(PatternWorkAllowance, "forTelemetryBatch")
    .mockImplementation((): PatternWorkAllowance => {
      const allowance: PatternWorkAllowance = new PatternWorkAllowance({
        pool: 0,
        workPerRecordText: 2048,
        workPerRecordCharacter: 128,
      });
      allowancesMade.push(allowance);
      return allowance;
    });
});

afterEach(() => {
  jest.restoreAllMocks();
  SyslogDeviceMatcher.clearCaches();
  NetworkFlowDeviceMatcher.clearCaches();
});

function fromProbe(sourceIpAddress: string, message: string): JSONObject {
  return {
    sourceIpAddress: sourceIpAddress,
    facility: 1,
    severity: 5,
    timestamp: RECEIVED_AT.toISOString(),
    hostname: "device",
    appName: "app",
    message: message,
    receivedAt: RECEIVED_AT.toISOString(),
    raw: `<13>Oct 13 10:11:09 device app: ${message}`,
  } as JSONObject;
}

function rowsOf(projectId: ObjectID): Array<JSONObject> {
  return insertedRows.filter((row: JSONObject): boolean => {
    return row["projectId"] === projectId.toString();
  });
}

describe("a probe's batch of syslog from devices of two projects", () => {
  test("one project's patterns spending all theirs leaves the other's scrubbing as it would alone", async () => {
    const messages: Array<JSONObject> = [];

    for (let index: number = 0; index < 6; index++) {
      messages.push(fromProbe(SWITCH_ADDRESS, randomAb(20_000, index)));
    }

    messages.push(fromProbe(ROUTER_ADDRESS, "token secret-42 ok"));

    await ProbeSyslogIngestService.processSyslogMessages(PROBE, messages);

    const projectRows: Array<JSONObject> = rowsOf(PROJECT);
    const otherRows: Array<JSONObject> = rowsOf(OTHER_PROJECT);

    expect(projectRows).toHaveLength(6);
    expect(otherRows).toHaveLength(1);

    // The first project's lines could not be read: stored scrubbed whole.
    for (const row of projectRows) {
      expect(row["body"]).toBe("[REDACTED]");
    }

    // The second project's line, scrubbed exactly as its rule says.
    expect(otherRows[0]!["body"]).toBe("token [REDACTED] ok");
  });

  test("each project has one allowance for the batch, whatever the number of its messages", async () => {
    await ProbeSyslogIngestService.processSyslogMessages(PROBE, [
      fromProbe(SWITCH_ADDRESS, "a line"),
      fromProbe(ROUTER_ADDRESS, "token secret-1 ok"),
      fromProbe(SWITCH_ADDRESS, "another line"),
      fromProbe(ROUTER_ADDRESS, "token secret-2 ok"),
    ]);

    expect(allowancesMade).toHaveLength(2);
    expect(
      rowsOf(OTHER_PROJECT).map((row: JSONObject): unknown => {
        return row["body"];
      }),
    ).toEqual(["token [REDACTED] ok", "token [REDACTED] ok"]);
  });
});
