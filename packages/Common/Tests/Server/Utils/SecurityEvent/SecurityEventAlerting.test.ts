/*
 * The alert creation path pulls the native isolated-vm addon through its
 * template renderer; stub it out before anything imports it.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import {
  AlertableMatch,
  DedupedRecordOutcome,
  openDedupedAlerts,
  openDedupedIncidents,
  pickSeverityByPrecedence,
} from "../../../../Server/Utils/SecurityEvent/SecurityEventAlerting";
import Alert from "../../../../Models/DatabaseModels/Alert";
import Incident from "../../../../Models/DatabaseModels/Incident";
import AlertService from "../../../../Server/Services/AlertService";
import IncidentService from "../../../../Server/Services/IncidentService";
import logger from "../../../../Server/Utils/Logger";
import Includes from "../../../../Types/BaseDatabase/Includes";
import ObjectID from "../../../../Types/ObjectID";
import { JSONObject } from "../../../../Types/JSON";
import { getJestSpyOn } from "../../../Spy";
import {
  ALERT_STATE_IDS,
  INCIDENT_STATE_IDS,
  idsOfAnyFilter,
  mockProjectStates,
  openStateIds,
} from "../../TestingUtils/Services/ProjectStatesHelper";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The shared alerting machinery both detection sources ride (Sigma rules
 * and threat-intel feeds): fingerprint-scoped dedupe against unresolved
 * state, per-item guarded creates, and the severity precedence ladder.
 * Behavior here is ALSO pinned end-to-end by DetectionRuleEvaluator's own
 * suite; these tests pin the extracted module directly so a regression
 * names the guilty layer.
 */

type Spy = ReturnType<typeof getJestSpyOn>;

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const SEVERITY_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);

function buildMatch(fingerprint: string): AlertableMatch {
  return {
    fingerprint,
    title: `title for ${fingerprint}`,
    description: "what happened",
    rootCause: "the source matched",
  };
}

let alertFindSpy: Spy;
let alertCreateSpy: Spy;
let incidentFindSpy: Spy;
let incidentCreateSpy: Spy;

beforeEach(() => {
  /*
   * The project's states: "unresolved" is every state above its resolved
   * state (Common/Utils/ResolvedState), so a state placed after Resolved is
   * no open record to dedupe against.
   */
  mockProjectStates();
  alertFindSpy = getJestSpyOn(AlertService, "findBy").mockResolvedValue(
    [] as never,
  );
  alertCreateSpy = getJestSpyOn(AlertService, "create").mockResolvedValue(
    new Alert() as never,
  );
  incidentFindSpy = getJestSpyOn(IncidentService, "findBy").mockResolvedValue(
    [] as never,
  );
  incidentCreateSpy = getJestSpyOn(IncidentService, "create").mockResolvedValue(
    new Incident() as never,
  );
  getJestSpyOn(logger, "error").mockImplementation((() => {
    return undefined;
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("openDedupedAlerts", () => {
  test("dedupe is scoped to the candidate fingerprints against unresolved alerts", async () => {
    await openDedupedAlerts({
      projectId: PROJECT_ID,
      alertSeverityId: SEVERITY_ID,
      logLabel: "test",
      matches: [buildMatch("fp-1"), buildMatch("fp-2")],
    });

    const query: JSONObject = (alertFindSpy.mock.calls[0]![0] as JSONObject)[
      "query"
    ] as JSONObject;
    expect(query["seriesFingerprint"]).toBeInstanceOf(Includes);
    expect((query["seriesFingerprint"] as Includes).values).toEqual([
      "fp-1",
      "fp-2",
    ]);
    expect(idsOfAnyFilter(query["currentAlertStateId"])).toEqual(
      openStateIds(ALERT_STATE_IDS),
    );
    expect(query["currentAlertState"]).toBeUndefined();
  });

  test("creates only for fingerprints without an open alert, carrying the match fields", async () => {
    const open: Alert = new Alert();
    open.seriesFingerprint = "fp-1";
    alertFindSpy.mockResolvedValue([open] as never);

    const created: number = await openDedupedAlerts({
      projectId: PROJECT_ID,
      alertSeverityId: SEVERITY_ID,
      logLabel: "test",
      matches: [buildMatch("fp-1"), buildMatch("fp-2")],
    });

    expect(created).toBe(1);
    expect(alertCreateSpy).toHaveBeenCalledTimes(1);

    const alert: Alert = (alertCreateSpy.mock.calls[0]![0] as JSONObject)[
      "data"
    ] as Alert;
    expect(alert.seriesFingerprint).toBe("fp-2");
    expect(alert.title).toBe("title for fp-2");
    expect(alert.alertSeverityId).toBe(SEVERITY_ID);
    expect(alert.isCreatedAutomatically).toBe(true);
    expect(alert.rootCause).toBe("the source matched");
  });

  test("one failing create does not sink the batch", async () => {
    alertCreateSpy
      .mockRejectedValueOnce(new Error("privacy hook exploded") as never)
      .mockResolvedValueOnce(new Alert() as never);

    const created: number = await openDedupedAlerts({
      projectId: PROJECT_ID,
      alertSeverityId: SEVERITY_ID,
      logLabel: "test",
      matches: [buildMatch("fp-1"), buildMatch("fp-2")],
    });

    expect(created).toBe(1);
    expect(alertCreateSpy).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalled();
  });

  test("a source that links its records is told each match's alert: the one already open, or the one it opened", async () => {
    const openId: ObjectID = ObjectID.generate();
    const newId: ObjectID = ObjectID.generate();
    const open: Alert = new Alert(openId);
    open.seriesFingerprint = "fp-1";
    alertFindSpy.mockResolvedValue([open] as never);
    alertCreateSpy.mockResolvedValue(new Alert(newId) as never);
    const outcomes: Array<DedupedRecordOutcome> = [];

    await openDedupedAlerts({
      projectId: PROJECT_ID,
      alertSeverityId: SEVERITY_ID,
      logLabel: "test",
      matches: [buildMatch("fp-1"), buildMatch("fp-2")],
      onOutcome: (outcome: DedupedRecordOutcome): void => {
        outcomes.push(outcome);
      },
    });

    expect(outcomes).toEqual([
      { fingerprint: "fp-1", recordId: openId, isNew: false },
      { fingerprint: "fp-2", recordId: newId, isNew: true },
    ]);
  });

  test("a create that failed tells the source nothing about its match", async () => {
    alertCreateSpy
      .mockRejectedValueOnce(new Error("privacy hook exploded") as never)
      .mockResolvedValueOnce(new Alert(ObjectID.generate()) as never);
    const outcomes: Array<DedupedRecordOutcome> = [];

    await openDedupedAlerts({
      projectId: PROJECT_ID,
      alertSeverityId: SEVERITY_ID,
      logLabel: "test",
      matches: [buildMatch("fp-1"), buildMatch("fp-2")],
      onOutcome: (outcome: DedupedRecordOutcome): void => {
        outcomes.push(outcome);
      },
    });

    expect(
      outcomes.map((outcome: DedupedRecordOutcome): string => {
        return outcome.fingerprint;
      }),
    ).toEqual(["fp-2"]);
  });
});

describe("openDedupedIncidents", () => {
  test("the incident twin dedupes against unresolved incidents and creates guarded", async () => {
    const open: Incident = new Incident();
    open.seriesFingerprint = "fp-1";
    incidentFindSpy.mockResolvedValue([open] as never);

    const created: number = await openDedupedIncidents({
      projectId: PROJECT_ID,
      incidentSeverityId: SEVERITY_ID,
      logLabel: "test",
      matches: [buildMatch("fp-1"), buildMatch("fp-2")],
    });

    expect(created).toBe(1);

    const query: JSONObject = (incidentFindSpy.mock.calls[0]![0] as JSONObject)[
      "query"
    ] as JSONObject;
    expect(idsOfAnyFilter(query["currentIncidentStateId"])).toEqual(
      openStateIds(INCIDENT_STATE_IDS),
    );
    expect(query["currentIncidentState"]).toBeUndefined();

    const incident: Incident = (
      incidentCreateSpy.mock.calls[0]![0] as JSONObject
    )["data"] as Incident;
    expect(incident.seriesFingerprint).toBe("fp-2");
    expect(incident.incidentSeverityId).toBe(SEVERITY_ID);
  });

  test("a source that links its records is told each match's incident, open or declared now", async () => {
    const openId: ObjectID = ObjectID.generate();
    const newId: ObjectID = ObjectID.generate();
    const open: Incident = new Incident(openId);
    open.seriesFingerprint = "fp-1";
    incidentFindSpy.mockResolvedValue([open] as never);
    incidentCreateSpy.mockResolvedValue(new Incident(newId) as never);
    const outcomes: Array<DedupedRecordOutcome> = [];

    await openDedupedIncidents({
      projectId: PROJECT_ID,
      incidentSeverityId: SEVERITY_ID,
      logLabel: "test",
      matches: [buildMatch("fp-1"), buildMatch("fp-2")],
      onOutcome: (outcome: DedupedRecordOutcome): void => {
        outcomes.push(outcome);
      },
    });

    expect(outcomes).toEqual([
      { fingerprint: "fp-1", recordId: openId, isNew: false },
      { fingerprint: "fp-2", recordId: newId, isNew: true },
    ]);
  });

  test("an incident that could not be declared tells the source nothing", async () => {
    incidentCreateSpy.mockRejectedValue(
      new Error("No incident state is created.") as never,
    );
    const outcomes: Array<DedupedRecordOutcome> = [];

    const created: number = await openDedupedIncidents({
      projectId: PROJECT_ID,
      incidentSeverityId: SEVERITY_ID,
      logLabel: "test",
      matches: [buildMatch("fp-1")],
      onOutcome: (outcome: DedupedRecordOutcome): void => {
        outcomes.push(outcome);
      },
    });

    expect(created).toBe(0);
    expect(outcomes).toEqual([]);
  });
});

describe("pickSeverityByPrecedence", () => {
  type TestSeverity = { id?: ObjectID; name?: string };

  function severity(idText: string, name: string): TestSeverity {
    return { id: new ObjectID(idText), name };
  }

  // Sorted by order ascending: most severe first, per the model convention.
  const SEVERITIES: Array<TestSeverity> = [
    severity("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "Critical"),
    severity("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "High"),
    severity("cccccccc-cccc-4ccc-8ccc-cccccccccccc", "Low"),
  ];

  test("an explicit id that belongs to the project wins", () => {
    expect(
      pickSeverityByPrecedence({
        severities: SEVERITIES,
        explicitSeverityId: SEVERITIES[2]!.id,
        severityLabel: "Critical",
        isSevere: true,
      })?.toString(),
    ).toBe(SEVERITIES[2]!.id!.toString());
  });

  test("a stale explicit id falls through to the name match, case-insensitively", () => {
    expect(
      pickSeverityByPrecedence({
        severities: SEVERITIES,
        explicitSeverityId: new ObjectID(
          "99999999-9999-4999-8999-999999999999",
        ),
        severityLabel: "high",
        isSevere: true,
      })?.toString(),
    ).toBe(SEVERITIES[1]!.id!.toString());
  });

  test("no name match ranks: severe labels to the most severe, others to the least", () => {
    expect(
      pickSeverityByPrecedence({
        severities: SEVERITIES,
        explicitSeverityId: undefined,
        severityLabel: "Sev0",
        isSevere: true,
      })?.toString(),
    ).toBe(SEVERITIES[0]!.id!.toString());

    expect(
      pickSeverityByPrecedence({
        severities: SEVERITIES,
        explicitSeverityId: undefined,
        severityLabel: "Informational",
        isSevere: false,
      })?.toString(),
    ).toBe(SEVERITIES[2]!.id!.toString());
  });

  test("no severities at all resolves to null — the caller skips creation", () => {
    expect(
      pickSeverityByPrecedence({
        severities: [],
        explicitSeverityId: SEVERITY_ID,
        severityLabel: "High",
        isSevere: true,
      }),
    ).toBeNull();
  });

  describe("archived severities (Common/Utils/ArchivableValues)", () => {
    type ArchivableSeverity = TestSeverity & { isArchived?: boolean };

    // Critical and Low are archived; High is the only live one.
    const WITH_ARCHIVED: Array<ArchivableSeverity> = [
      { ...SEVERITIES[0]!, isArchived: true },
      { ...SEVERITIES[1]!, isArchived: false },
      { ...SEVERITIES[2]!, isArchived: true },
    ];

    test("the rule's own severity is kept even when archived: it runs as it was set up", () => {
      expect(
        pickSeverityByPrecedence({
          severities: WITH_ARCHIVED,
          explicitSeverityId: SEVERITIES[0]!.id,
          severityLabel: "Low",
          isSevere: false,
        })?.toString(),
      ).toBe(SEVERITIES[0]!.id!.toString());
    });

    test("the name match never lands on an archived severity", () => {
      expect(
        pickSeverityByPrecedence({
          severities: WITH_ARCHIVED,
          explicitSeverityId: undefined,
          severityLabel: "critical",
          isSevere: false,
        })?.toString(),
      ).toBe(SEVERITIES[1]!.id!.toString());
    });

    test("the rank picks among the live ones, both ends", () => {
      for (const isSevere of [true, false]) {
        expect(
          pickSeverityByPrecedence({
            severities: WITH_ARCHIVED,
            explicitSeverityId: undefined,
            severityLabel: "Sev0",
            isSevere: isSevere,
          })?.toString(),
        ).toBe(SEVERITIES[1]!.id!.toString());
      }
    });

    test("only archived ones and no rule of its own: nothing is picked", () => {
      expect(
        pickSeverityByPrecedence({
          severities: [
            { ...SEVERITIES[0]!, isArchived: true },
            { ...SEVERITIES[2]!, isArchived: true },
          ],
          explicitSeverityId: undefined,
          severityLabel: "Critical",
          isSevere: true,
        }),
      ).toBeNull();
    });
  });
});
