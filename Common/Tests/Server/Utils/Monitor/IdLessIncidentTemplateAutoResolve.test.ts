/*
 * MonitorIncident reaches the native isolated-vm addon through its template
 * renderer (MonitorTemplateUtil -> VMAPI -> VMRunner). Nothing under test
 * here touches the sandbox and the prebuilt binary cannot always dlopen in
 * the test environment, so stub it out before anything imports it.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import Incident from "../../../../Models/DatabaseModels/Incident";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import IncidentService from "../../../../Server/Services/IncidentService";
import MonitorIncident from "../../../../Server/Utils/Monitor/MonitorIncident";
import OneUptimeDate from "../../../../Types/Date";
import Dictionary from "../../../../Types/Dictionary";
import IncomingMonitorRequest from "../../../../Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, describe, expect, it, jest } from "@jest/globals";

/*
 * Regression tests for incidents created from criteria incident templates
 * that carry no `id`.
 *
 * `CriteriaIncident.id` is declared required, but the write path accepts
 * templates without one — the API and the Terraform provider both author
 * criteria that way. The create path already handles it (it sets
 * `createdIncidentTemplateId` only when the id is present) and so does the
 * dedupe match, which normalises both sides to `undefined` so a created
 * incident still matches itself on the next cycle.
 *
 * Both resolution paths did not: they returned early whenever
 * `createdIncidentTemplateId` was NULL. So an incident created from an
 * id-less template was created correctly, deduplicated correctly, carried a
 * correct `seriesFingerprint` — and could never be auto-resolved, neither by
 * an incoming payload reporting the key recovered nor by series absence,
 * with nothing logged to say why.
 *
 * The tests below fail on the pre-fix code and pin the exactness the fix
 * must keep: a NULL template id matches only an id-less auto-resolve
 * template on the same criteria, never an unrelated one that has an id.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

const CRITERIA_ID: string = "aafe2669-1a2b-4c3d-8e4f-5a6b7c8d9e0f";
const TEMPLATE_ID: string = "template-1";
const SERIES_FINGERPRINT: string = "0eb39d7970a4f69a";

/*
 * MonitorResource builds the auto-resolve dictionary by pushing
 * `incidentTemplate.id` verbatim for every template with
 * `autoResolveIncident: true`. The declared element type is `string` because
 * `CriteriaIncident.id` is declared required — but for an id-less template
 * the array really does hold `undefined` at runtime. This reproduces that
 * exact shape rather than a tidied-up version of it.
 */
const ID_LESS_TEMPLATE: string = undefined as unknown as string;

const AUTO_RESOLVE_ID_LESS_TEMPLATE: Dictionary<Array<string>> = {
  [CRITERIA_ID]: [ID_LESS_TEMPLATE],
};

const AUTO_RESOLVE_TEMPLATE_WITH_ID: Dictionary<Array<string>> = {
  [CRITERIA_ID]: [TEMPLATE_ID],
};

type ResolveOpenIncident = (input: {
  openIncident: Incident;
  rootCause: string;
  dataToProcess: IncomingMonitorRequest;
}) => Promise<void>;

const monitorIncidentInternals: {
  resolveOpenIncident: ResolveOpenIncident;
  shouldCloseIncident: (input: Record<string, unknown>) => boolean;
} = MonitorIncident as unknown as {
  resolveOpenIncident: ResolveOpenIncident;
  shouldCloseIncident: (input: Record<string, unknown>) => boolean;
};

/** Builds an open incident the way the create path would have stored it. */
function openIncident(templateId: string | undefined): Incident {
  const model: Incident = new Incident();
  model._id = INCIDENT_ID.toString();
  model.projectId = PROJECT_ID;
  model.createdCriteriaId = CRITERIA_ID;
  model.seriesFingerprint = SERIES_FINGERPRINT;

  // Mirrors the create path: only set when the template actually has an id.
  if (templateId) {
    model.createdIncidentTemplateId = templateId;
  }

  return model;
}

function criteria(
  id: string,
  createsIncidents: boolean,
): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data!.id = id;
  instance.data!.createIncidents = createsIncidents;
  return instance;
}

function monitor(): Monitor {
  const model: Monitor = new Monitor();
  model._id = MONITOR_ID.toString();
  model.projectId = PROJECT_ID;
  return model;
}

/** The Alertmanager-style recovery payload from the issue reproduction. */
function resolvedPayload(): IncomingMonitorRequest {
  return {
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    requestBody: {
      groupKey: "alertmanager-group-1",
      status: "resolved",
    },
    incomingRequestReceivedAt: OneUptimeDate.getCurrentDate(),
    checkedAt: OneUptimeDate.getCurrentDate(),
  };
}

/*
 * Arranges a single open incident and drives the event-driven resolution
 * path over it. Asserting on the mocked `resolveOpenIncident` keeps the test
 * on the decision under test rather than on incident-state persistence.
 */
async function runPayloadResolution(input: {
  incident: Incident;
  autoResolveTemplates: Dictionary<Array<string>>;
}): Promise<void> {
  jest.spyOn(IncidentService, "findBy").mockResolvedValue([input.incident]);
  jest
    .spyOn(monitorIncidentInternals, "resolveOpenIncident")
    .mockResolvedValue(undefined);

  await MonitorIncident.resolveSeriesIncidentsByFingerprint({
    monitor: monitor(),
    fingerprints: [SERIES_FINGERPRINT],
    rootCause: "Payload reported this key as resolved.",
    dataToProcess: resolvedPayload(),
    autoResolveCriteriaInstanceIdIncidentIdsDictionary:
      input.autoResolveTemplates,
  });
}

describe("Auto-resolve for id-less criteria incident templates", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("resolveSeriesIncidentsByFingerprint (payload reports the key resolved)", () => {
    it("resolves an incident whose template id is NULL when the criteria opted in with an id-less template", async () => {
      await runPayloadResolution({
        incident: openIncident(undefined),
        autoResolveTemplates: AUTO_RESOLVE_ID_LESS_TEMPLATE,
      });

      expect(
        monitorIncidentInternals.resolveOpenIncident,
      ).toHaveBeenCalledTimes(1);
    });

    it("still resolves an incident created from a template that does have an id", async () => {
      await runPayloadResolution({
        incident: openIncident(TEMPLATE_ID),
        autoResolveTemplates: AUTO_RESOLVE_TEMPLATE_WITH_ID,
      });

      expect(
        monitorIncidentInternals.resolveOpenIncident,
      ).toHaveBeenCalledTimes(1);
    });

    it("does not resolve a NULL-template incident when every auto-resolve template on that criteria carries an id", async () => {
      await runPayloadResolution({
        incident: openIncident(undefined),
        autoResolveTemplates: AUTO_RESOLVE_TEMPLATE_WITH_ID,
      });

      expect(
        monitorIncidentInternals.resolveOpenIncident,
      ).not.toHaveBeenCalled();
    });

    it("does not resolve when the creating criteria did not opt into auto-resolve at all", async () => {
      await runPayloadResolution({
        incident: openIncident(undefined),
        autoResolveTemplates: {},
      });

      expect(
        monitorIncidentInternals.resolveOpenIncident,
      ).not.toHaveBeenCalled();
    });
  });

  describe("shouldCloseIncident, per-series absence path", () => {
    it("closes a NULL-template incident once its series stops breaching", () => {
      expect(
        monitorIncidentInternals.shouldCloseIncident({
          openIncident: openIncident(undefined),
          autoResolveCriteriaInstanceIdIncidentIdsDictionary:
            AUTO_RESOLVE_ID_LESS_TEMPLATE,
          criteriaInstance: criteria(CRITERIA_ID, true),
          breachingSeriesFingerprints: new Set<string>(["some-other-series"]),
          disableSeriesAbsenceResolution: false,
        }),
      ).toBe(true);
    });

    it("keeps a NULL-template incident open while its series is still breaching", () => {
      expect(
        monitorIncidentInternals.shouldCloseIncident({
          openIncident: openIncident(undefined),
          autoResolveCriteriaInstanceIdIncidentIdsDictionary:
            AUTO_RESOLVE_ID_LESS_TEMPLATE,
          criteriaInstance: criteria(CRITERIA_ID, true),
          breachingSeriesFingerprints: new Set<string>([SERIES_FINGERPRINT]),
          disableSeriesAbsenceResolution: false,
        }),
      ).toBe(false);
    });

    it("does not close a NULL-template incident when the opted-in template carries an id", () => {
      expect(
        monitorIncidentInternals.shouldCloseIncident({
          openIncident: openIncident(undefined),
          autoResolveCriteriaInstanceIdIncidentIdsDictionary:
            AUTO_RESOLVE_TEMPLATE_WITH_ID,
          criteriaInstance: criteria(CRITERIA_ID, true),
          breachingSeriesFingerprints: new Set<string>(["some-other-series"]),
          disableSeriesAbsenceResolution: false,
        }),
      ).toBe(false);
    });

    it("still honours the event-driven guard for NULL-template incidents", () => {
      expect(
        monitorIncidentInternals.shouldCloseIncident({
          openIncident: openIncident(undefined),
          autoResolveCriteriaInstanceIdIncidentIdsDictionary:
            AUTO_RESOLVE_ID_LESS_TEMPLATE,
          criteriaInstance: criteria(CRITERIA_ID, true),
          breachingSeriesFingerprints: new Set<string>(["some-other-series"]),
          disableSeriesAbsenceResolution: true,
        }),
      ).toBe(false);
    });
  });

  describe("shouldCloseIncident, cross-criteria path", () => {
    it("closes a NULL-template incident when another criteria is now active", () => {
      expect(
        monitorIncidentInternals.shouldCloseIncident({
          openIncident: openIncident(undefined),
          autoResolveCriteriaInstanceIdIncidentIdsDictionary:
            AUTO_RESOLVE_ID_LESS_TEMPLATE,
          criteriaInstance: criteria("another-criteria", true),
          breachingSeriesFingerprints: undefined,
          disableSeriesAbsenceResolution: false,
        }),
      ).toBe(true);
    });

    it("does not close a NULL-template incident when its own criteria is still active", () => {
      expect(
        monitorIncidentInternals.shouldCloseIncident({
          openIncident: openIncident(undefined),
          autoResolveCriteriaInstanceIdIncidentIdsDictionary:
            AUTO_RESOLVE_ID_LESS_TEMPLATE,
          criteriaInstance: criteria(CRITERIA_ID, true),
          breachingSeriesFingerprints: undefined,
          disableSeriesAbsenceResolution: false,
        }),
      ).toBe(false);
    });
  });
});
