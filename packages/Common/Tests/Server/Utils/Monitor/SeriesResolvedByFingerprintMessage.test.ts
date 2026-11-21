/*
 * The resolvers reach the native isolated-vm addon through the template
 * renderer. Nothing here runs a sandbox.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import MonitorAlert from "../../../../Server/Utils/Monitor/MonitorAlert";
import MonitorIncident from "../../../../Server/Utils/Monitor/MonitorIncident";
import {
  LOG_GROUP_ALERT_RESOLVED_MESSAGE,
  LOG_GROUP_INCIDENT_RESOLVED_MESSAGE,
  LOG_GROUP_RESOLVED_ROOT_CAUSE,
} from "../../../../Server/Utils/Monitor/LogGroupCriteriaFanOut";
import DataToProcess from "../../../../Server/Utils/Monitor/DataToProcess";
import AlertService from "../../../../Server/Services/AlertService";
import AlertStateService from "../../../../Server/Services/AlertStateService";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentStateService from "../../../../Server/Services/IncidentStateService";
import Alert from "../../../../Models/DatabaseModels/Alert";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorEvaluationSummary from "../../../../Types/Monitor/MonitorEvaluationSummary";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * resolveSeries{Alerts,Incidents}ByFingerprint close exactly the open
 * records whose series is named, when their criteria asks for auto-resolve.
 * They were written for Incoming Request monitors, and said so in the
 * evaluation summary; a Logs monitor resolved by a log now goes through
 * them too, and its summary must say what actually closed the alert.
 *
 * The record lookups and the state change are stood in for; what is
 * asserted is which records are resolved and what the summary says.
 */

const INCOMING_ALERT_MESSAGE: string =
  "Alert auto-resolved because the incoming payload reported this key as resolved.";
const INCOMING_INCIDENT_MESSAGE: string =
  "Incident auto-resolved because the incoming payload reported this key as resolved.";

function monitor(): Monitor {
  const value: Monitor = new Monitor();

  value.id = ObjectID.generate();
  value.projectId = ObjectID.generate();

  return value;
}

function alert(fingerprint: string | undefined, criteriaId: string): Alert {
  const value: Alert = new Alert();

  value.id = ObjectID.generate();
  value.createdCriteriaId = criteriaId;

  if (fingerprint) {
    value.seriesFingerprint = fingerprint;
  }

  return value;
}

function incident(
  fingerprint: string | undefined,
  criteriaId: string,
): Incident {
  const value: Incident = new Incident();

  value.id = ObjectID.generate();
  value.createdCriteriaId = criteriaId;
  value.createdIncidentTemplateId = "template-1";

  if (fingerprint) {
    value.seriesFingerprint = fingerprint;
  }

  return value;
}

function summary(): MonitorEvaluationSummary {
  return {
    criteriaResults: [],
    events: [],
  } as unknown as MonitorEvaluationSummary;
}

describe("resolveSeriesAlertsByFingerprint", () => {
  let resolveOpenAlert: jest.SpyInstance;
  let openAlerts: Array<Alert> = [];

  beforeEach(() => {
    openAlerts = [];

    jest
      .spyOn(AlertStateService, "getUnresolvedAlertStateIds")
      .mockResolvedValue([ObjectID.generate()] as never);
    jest.spyOn(AlertService, "findBy").mockImplementation(() => {
      return Promise.resolve(openAlerts) as never;
    });
    resolveOpenAlert = jest
      .spyOn(
        MonitorAlert as unknown as { resolveOpenAlert: () => Promise<void> },
        "resolveOpenAlert",
      )
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function resolve(input: {
    fingerprints: Array<string>;
    resolvedMessage?: string | undefined;
    evaluationSummary: MonitorEvaluationSummary;
  }): Promise<void> {
    await MonitorAlert.resolveSeriesAlertsByFingerprint({
      monitor: monitor(),
      fingerprints: input.fingerprints,
      rootCause: LOG_GROUP_RESOLVED_ROOT_CAUSE,
      ...(input.resolvedMessage
        ? { resolvedMessage: input.resolvedMessage }
        : {}),
      dataToProcess: {} as DataToProcess,
      autoResolveCriteriaInstanceIdAlertIdsDictionary: {
        down: ["alert-template"],
      },
      evaluationSummary: input.evaluationSummary,
    });
  }

  test("closes the named group's alert, with the caller's reason in the summary", async () => {
    const mine: Alert = alert("fp-sw1-gi01", "down");
    const other: Alert = alert("fp-sw1-gi02", "down");

    openAlerts = [mine, other];

    const evaluationSummary: MonitorEvaluationSummary = summary();

    await resolve({
      fingerprints: ["fp-sw1-gi01"],
      resolvedMessage: LOG_GROUP_ALERT_RESOLVED_MESSAGE,
      evaluationSummary,
    });

    expect(resolveOpenAlert).toHaveBeenCalledTimes(1);
    expect(resolveOpenAlert.mock.calls[0]![0]).toMatchObject({
      openAlert: mine,
      rootCause: "A log that resolves this group arrived.",
    });
    expect(evaluationSummary.events).toHaveLength(1);
    expect(evaluationSummary.events[0]).toMatchObject({
      type: "alert-resolved",
      message:
        "Alert auto-resolved because a log that resolves its group arrived.",
      relatedAlertId: mine.id?.toString(),
    });
  });

  test("an Incoming Request monitor's summary reads as it always has", async () => {
    openAlerts = [alert("fp-key", "down")];

    const evaluationSummary: MonitorEvaluationSummary = summary();

    await resolve({ fingerprints: ["fp-key"], evaluationSummary });

    expect(evaluationSummary.events[0]?.message).toBe(INCOMING_ALERT_MESSAGE);
  });

  test("leaves alone an alert whose criteria does not ask to be resolved, and one that is not a group's", async () => {
    openAlerts = [
      alert("fp-sw1-gi01", "a-criteria-with-auto-resolve-off"),
      alert(undefined, "down"),
    ];

    const evaluationSummary: MonitorEvaluationSummary = summary();

    await resolve({
      fingerprints: ["fp-sw1-gi01"],
      resolvedMessage: LOG_GROUP_ALERT_RESOLVED_MESSAGE,
      evaluationSummary,
    });

    expect(resolveOpenAlert).not.toHaveBeenCalled();
    expect(evaluationSummary.events).toHaveLength(0);
  });

  test("with no group named, reads nothing at all", async () => {
    await resolve({ fingerprints: [], evaluationSummary: summary() });

    expect(AlertService.findBy).not.toHaveBeenCalled();
  });

  /*
   * #10550: an Incoming Request monitor grouped by AlertActiveID got each
   * SolarWinds Orion reset - and resolved none, because the alert the
   * Dashboard adds to a criteria starts with Auto Resolve Alert off. The
   * monitor log said only that the reset opened nothing new.
   */
  describe("an Incoming Request monitor's recovery that Auto Resolve Alert holds back", () => {
    async function recover(input: {
      fingerprints: Array<string>;
      wholeMonitorCriteriaIds?: Array<string> | undefined;
      noteLeftOpen?: boolean | undefined;
      evaluationSummary: MonitorEvaluationSummary;
    }): Promise<void> {
      await MonitorAlert.resolveSeriesAlertsByFingerprint({
        monitor: monitor(),
        fingerprints: input.fingerprints,
        rootCause: "Incoming request reported this key as resolved.",
        ...(input.wholeMonitorCriteriaIds
          ? {
              wholeMonitor: {
                criteriaIds: input.wholeMonitorCriteriaIds,
                rootCause:
                  "Incoming request with no value to group by reported recovered.",
              },
            }
          : {}),
        dataToProcess: {} as DataToProcess,
        autoResolveCriteriaInstanceIdAlertIdsDictionary: {
          down: ["alert-template"],
        },
        evaluationSummary: input.evaluationSummary,
        ...(input.noteLeftOpen !== undefined
          ? { noteLeftOpen: input.noteLeftOpen }
          : {}),
      });
    }

    function orionAlert(fingerprint: string | undefined): Alert {
      const value: Alert = alert(fingerprint, "orion");

      value.title = "Hardware status is Critical";
      value.alertNumber = 7;
      value.alertNumberWithPrefix = "ALT-7";
      value.createdAt = new Date("2026-11-20T09:00:00.000Z");

      return value;
    }

    test("is named in the monitor log: which alert, and why it stays open", async () => {
      const leftOpen: Alert = orionAlert("fp-48214");

      openAlerts = [leftOpen];

      const evaluationSummary: MonitorEvaluationSummary = summary();

      await recover({
        fingerprints: ["fp-48214"],
        noteLeftOpen: true,
        evaluationSummary,
      });

      expect(resolveOpenAlert).not.toHaveBeenCalled();
      expect(evaluationSummary.events).toHaveLength(1);
      expect(evaluationSummary.events[0]).toMatchObject({
        type: "alert-skipped",
        title: "Alert left open: Hardware status is Critical",
        message:
          "A request reported this alert recovered, but Auto Resolve Alert is off in its criteria, so the alert stays open. Turn on Auto Resolve Alert, under More fields in the criteria's alert, to resolve it on recovery.",
        relatedCriteriaId: "orion",
        relatedAlertId: leftOpen.id?.toString(),
        relatedAlertNumber: 7,
        relatedAlertNumberWithPrefix: "ALT-7",
        relatedAlertCreatedAt: leftOpen.createdAt,
      });
      // Worded again in each reader's language from its sentences.
      expect(evaluationSummary.events[0]?.titleSentence).toEqual({
        template: "Alert left open: {{title}}",
        values: { title: "Hardware status is Critical" },
      });
      expect(evaluationSummary.events[0]?.messageSentence?.template).toBe(
        evaluationSummary.events[0]?.message,
      );
    });

    test("so is the alert a request with no value opened for the whole monitor", async () => {
      openAlerts = [orionAlert(undefined)];

      const evaluationSummary: MonitorEvaluationSummary = summary();

      await recover({
        fingerprints: [],
        wholeMonitorCriteriaIds: ["orion"],
        noteLeftOpen: true,
        evaluationSummary,
      });

      expect(resolveOpenAlert).not.toHaveBeenCalled();
      expect(
        evaluationSummary.events.map((event: { title: string }) => {
          return event.title;
        }),
      ).toEqual(["Alert left open: Hardware status is Critical"]);
    });

    test("names only the alerts the recovery was for: another value's, and one that resolves, are not", async () => {
      const resolves: Alert = alert("fp-48214", "down");

      openAlerts = [orionAlert("fp-48213"), orionAlert("fp-48215"), resolves];

      const evaluationSummary: MonitorEvaluationSummary = summary();

      await recover({
        fingerprints: ["fp-48214", "fp-48215"],
        noteLeftOpen: true,
        evaluationSummary,
      });

      expect(resolveOpenAlert).toHaveBeenCalledTimes(1);
      expect(resolveOpenAlert.mock.calls[0]![0]).toMatchObject({
        openAlert: resolves,
      });
      expect(
        evaluationSummary.events.map((event: { type: string }) => {
          return event.type;
        }),
      ).toEqual(["alert-skipped", "alert-resolved"]);
      expect(evaluationSummary.events[0]?.relatedAlertId).toBe(
        openAlerts[1]!.id?.toString(),
      );
    });

    test("without the note asked for - a Logs monitor's resolving log - nothing is said, as before", async () => {
      openAlerts = [orionAlert("fp-48214")];

      const evaluationSummary: MonitorEvaluationSummary = summary();

      await recover({ fingerprints: ["fp-48214"], evaluationSummary });

      expect(resolveOpenAlert).not.toHaveBeenCalled();
      expect(evaluationSummary.events).toEqual([]);
    });

    test("an alert from no criteria is not the recovery's to name", async () => {
      // Opened by hand, not by a criteria: no createdCriteriaId.
      const unowned: Alert = new Alert();

      unowned.id = ObjectID.generate();
      unowned.title = "Hardware status is Critical";
      unowned.seriesFingerprint = "fp-48214";
      openAlerts = [unowned];

      const evaluationSummary: MonitorEvaluationSummary = summary();

      await recover({
        fingerprints: ["fp-48214"],
        noteLeftOpen: true,
        evaluationSummary,
      });

      expect(evaluationSummary.events).toEqual([]);
    });
  });
});

describe("resolveSeriesIncidentsByFingerprint", () => {
  let resolveOpenIncident: jest.SpyInstance;
  let openIncidents: Array<Incident> = [];

  beforeEach(() => {
    openIncidents = [];

    jest
      .spyOn(IncidentStateService, "getUnresolvedIncidentStateIds")
      .mockResolvedValue([ObjectID.generate()] as never);
    jest.spyOn(IncidentService, "findBy").mockImplementation(() => {
      return Promise.resolve(openIncidents) as never;
    });
    resolveOpenIncident = jest
      .spyOn(
        MonitorIncident as unknown as {
          resolveOpenIncident: () => Promise<void>;
        },
        "resolveOpenIncident",
      )
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function resolve(input: {
    fingerprints: Array<string>;
    resolvedMessage?: string | undefined;
    evaluationSummary: MonitorEvaluationSummary;
  }): Promise<void> {
    await MonitorIncident.resolveSeriesIncidentsByFingerprint({
      monitor: monitor(),
      fingerprints: input.fingerprints,
      rootCause: LOG_GROUP_RESOLVED_ROOT_CAUSE,
      ...(input.resolvedMessage
        ? { resolvedMessage: input.resolvedMessage }
        : {}),
      dataToProcess: {} as DataToProcess,
      autoResolveCriteriaInstanceIdIncidentIdsDictionary: {
        down: ["template-1"],
      },
      evaluationSummary: input.evaluationSummary,
    });
  }

  test("closes the named group's incident, with the caller's reason in the summary", async () => {
    const mine: Incident = incident("fp-sw1-gi01", "down");

    openIncidents = [mine, incident("fp-sw1-gi02", "down")];

    const evaluationSummary: MonitorEvaluationSummary = summary();

    await resolve({
      fingerprints: ["fp-sw1-gi01"],
      resolvedMessage: LOG_GROUP_INCIDENT_RESOLVED_MESSAGE,
      evaluationSummary,
    });

    expect(resolveOpenIncident).toHaveBeenCalledTimes(1);
    expect(resolveOpenIncident.mock.calls[0]![0]).toMatchObject({
      openIncident: mine,
      rootCause: "A log that resolves this group arrived.",
    });
    expect(evaluationSummary.events[0]).toMatchObject({
      type: "incident-resolved",
      message:
        "Incident auto-resolved because a log that resolves its group arrived.",
    });
  });

  test("an Incoming Request monitor's summary reads as it always has", async () => {
    openIncidents = [incident("fp-key", "down")];

    const evaluationSummary: MonitorEvaluationSummary = summary();

    await resolve({ fingerprints: ["fp-key"], evaluationSummary });

    expect(evaluationSummary.events[0]?.message).toBe(
      INCOMING_INCIDENT_MESSAGE,
    );
  });

  // #10550, for the incident a grouped criteria declares.
  describe("an Incoming Request monitor's recovery that Auto Resolve Incident holds back", () => {
    async function recover(input: {
      fingerprints: Array<string>;
      wholeMonitorCriteriaIds?: Array<string> | undefined;
      noteLeftOpen?: boolean | undefined;
      evaluationSummary: MonitorEvaluationSummary;
    }): Promise<void> {
      await MonitorIncident.resolveSeriesIncidentsByFingerprint({
        monitor: monitor(),
        fingerprints: input.fingerprints,
        rootCause: "Incoming request reported this key as resolved.",
        ...(input.wholeMonitorCriteriaIds
          ? {
              wholeMonitor: {
                criteriaIds: input.wholeMonitorCriteriaIds,
                rootCause:
                  "Incoming request with no value to group by reported recovered.",
              },
            }
          : {}),
        dataToProcess: {} as DataToProcess,
        // Criteria "down" resolves its template-1 incidents, and nothing else.
        autoResolveCriteriaInstanceIdIncidentIdsDictionary: {
          down: ["template-1"],
        },
        evaluationSummary: input.evaluationSummary,
        ...(input.noteLeftOpen !== undefined
          ? { noteLeftOpen: input.noteLeftOpen }
          : {}),
      });
    }

    function orionIncident(
      fingerprint: string | undefined,
      criteriaId: string = "orion",
    ): Incident {
      const value: Incident = incident(fingerprint, criteriaId);

      value.title = "Hardware status is Critical";
      value.incidentNumber = 12;
      value.incidentNumberWithPrefix = "INC-12";
      value.createdAt = new Date("2026-11-20T09:00:00.000Z");

      return value;
    }

    test("is named in the monitor log: which incident, and why it stays open", async () => {
      const leftOpen: Incident = orionIncident("fp-48214");

      openIncidents = [leftOpen];

      const evaluationSummary: MonitorEvaluationSummary = summary();

      await recover({
        fingerprints: ["fp-48214"],
        noteLeftOpen: true,
        evaluationSummary,
      });

      expect(resolveOpenIncident).not.toHaveBeenCalled();
      expect(evaluationSummary.events).toHaveLength(1);
      expect(evaluationSummary.events[0]).toMatchObject({
        type: "incident-skipped",
        title: "Incident left open: Hardware status is Critical",
        message:
          "A request reported this incident recovered, but Auto Resolve Incident is off in its criteria, so the incident stays open. Turn on Auto Resolve Incident, under More fields in the criteria's incident, to resolve it on recovery.",
        relatedCriteriaId: "orion",
        relatedIncidentId: leftOpen.id?.toString(),
        relatedIncidentNumber: 12,
        relatedIncidentNumberWithPrefix: "INC-12",
        relatedIncidentCreatedAt: leftOpen.createdAt,
      });
      expect(evaluationSummary.events[0]?.titleSentence).toEqual({
        template: "Incident left open: {{title}}",
        values: { title: "Hardware status is Critical" },
      });
    });

    test("an incident of a template that does not resolve on its own is named, beside its criteria's one that does", async () => {
      // Same criteria: template-1 resolves on its own, template-2 does not.
      const resolves: Incident = orionIncident("fp-48214", "down");
      const heldBack: Incident = orionIncident("fp-48214", "down");

      heldBack.createdIncidentTemplateId = "template-2";
      openIncidents = [resolves, heldBack];

      const evaluationSummary: MonitorEvaluationSummary = summary();

      await recover({
        fingerprints: ["fp-48214"],
        noteLeftOpen: true,
        evaluationSummary,
      });

      expect(resolveOpenIncident).toHaveBeenCalledTimes(1);
      expect(resolveOpenIncident.mock.calls[0]![0]).toMatchObject({
        openIncident: resolves,
      });
      expect(
        evaluationSummary.events.map(
          (event: { type: string; relatedIncidentId?: string | undefined }) => {
            return `${event.type} ${event.relatedIncidentId}`;
          },
        ),
      ).toEqual([
        `incident-resolved ${resolves.id?.toString()}`,
        `incident-skipped ${heldBack.id?.toString()}`,
      ]);
    });

    test("so is the incident a request with no value opened for the whole monitor", async () => {
      openIncidents = [orionIncident(undefined)];

      const evaluationSummary: MonitorEvaluationSummary = summary();

      await recover({
        fingerprints: [],
        wholeMonitorCriteriaIds: ["orion"],
        noteLeftOpen: true,
        evaluationSummary,
      });

      expect(resolveOpenIncident).not.toHaveBeenCalled();
      expect(evaluationSummary.events[0]?.title).toBe(
        "Incident left open: Hardware status is Critical",
      );
    });

    test("without the note asked for - a Logs monitor's resolving log - nothing is said, as before", async () => {
      openIncidents = [orionIncident("fp-48214")];

      const evaluationSummary: MonitorEvaluationSummary = summary();

      await recover({ fingerprints: ["fp-48214"], evaluationSummary });

      expect(resolveOpenIncident).not.toHaveBeenCalled();
      expect(evaluationSummary.events).toEqual([]);
    });
  });
});
