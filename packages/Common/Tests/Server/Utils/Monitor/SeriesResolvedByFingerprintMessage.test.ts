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
});
