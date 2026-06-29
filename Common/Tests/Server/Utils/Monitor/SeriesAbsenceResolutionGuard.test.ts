import MonitorIncident from "../../../../Server/Utils/Monitor/MonitorIncident";
import MonitorAlert from "../../../../Server/Utils/Monitor/MonitorAlert";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Alert from "../../../../Models/DatabaseModels/Alert";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import Dictionary from "../../../../Types/Dictionary";

/*
 * Regression tests for the event-driven (incoming-request / webhook)
 * absence-resolution guard. A per-key incident/alert (one carrying a
 * seriesFingerprint, created by a grouped incoming-request criteria) must
 * NEVER be auto-resolved by absence — only explicitly via
 * resolveSeries{Incidents,Alerts}ByFingerprint when the payload reports the
 * key as recovered. shouldClose{Incident,Alert} is private; we exercise it
 * via the documented `as any` escape hatch since it is the single decision
 * point both the criteria-met and no-criteria-met resolve paths funnel
 * through.
 */

function incident(fingerprint: string | undefined): Incident {
  const i: Incident = new Incident();
  i.createdCriteriaId = "criteria-A";
  i.createdIncidentTemplateId = "template-1";
  if (fingerprint) {
    i.seriesFingerprint = fingerprint;
  }
  return i;
}

function alert(fingerprint: string | undefined): Alert {
  const a: Alert = new Alert();
  a.createdCriteriaId = "criteria-A";
  if (fingerprint) {
    a.seriesFingerprint = fingerprint;
  }
  return a;
}

function criteria(id: string): MonitorCriteriaInstance {
  const c: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  c.data!.id = id;
  return c;
}

const INCIDENT_AUTO_RESOLVE: Dictionary<Array<string>> = {
  "criteria-A": ["template-1"],
};
const ALERT_AUTO_RESOLVE: Dictionary<Array<string>> = {
  "criteria-A": ["template-1"],
};

function shouldCloseIncident(input: Record<string, unknown>): boolean {
  return (MonitorIncident as any).shouldCloseIncident(input);
}
function shouldCloseAlert(input: Record<string, unknown>): boolean {
  return (MonitorAlert as any).shouldCloseAlert(input);
}

describe("Series absence-resolution guard (incoming-request grouping)", () => {
  describe("MonitorIncident.shouldCloseIncident", () => {
    it("does NOT absence-resolve a per-key incident on the no-criteria-met path when the guard is on (HIGH)", () => {
      expect(
        shouldCloseIncident({
          openIncident: incident("fp-RAM"),
          autoResolveCriteriaInstanceIdIncidentIdsDictionary:
            INCIDENT_AUTO_RESOLVE,
          criteriaInstance: null, // no criteria met (e.g. heartbeat cron tick)
          breachingSeriesFingerprints: undefined,
          disableSeriesAbsenceResolution: true,
        }),
      ).toBe(false);
    });

    it("WOULD absence-resolve it without the guard — proving the guard is load-bearing", () => {
      expect(
        shouldCloseIncident({
          openIncident: incident("fp-RAM"),
          autoResolveCriteriaInstanceIdIncidentIdsDictionary:
            INCIDENT_AUTO_RESOLVE,
          criteriaInstance: null,
          breachingSeriesFingerprints: undefined,
          disableSeriesAbsenceResolution: false,
        }),
      ).toBe(true);
    });

    it("does NOT cross-criteria absence-resolve a per-key incident when the guard is on (MEDIUM)", () => {
      expect(
        shouldCloseIncident({
          openIncident: incident("fp-RAM"), // created by criteria-A
          autoResolveCriteriaInstanceIdIncidentIdsDictionary:
            INCIDENT_AUTO_RESOLVE,
          criteriaInstance: criteria("criteria-B"), // a DIFFERENT criteria fired
          breachingSeriesFingerprints: undefined,
          disableSeriesAbsenceResolution: true,
        }),
      ).toBe(false);
    });

    it("still resolves a NON-grouped incoming incident (no seriesFingerprint) — guard is inert", () => {
      expect(
        shouldCloseIncident({
          openIncident: incident(undefined),
          autoResolveCriteriaInstanceIdIncidentIdsDictionary:
            INCIDENT_AUTO_RESOLVE,
          criteriaInstance: null,
          breachingSeriesFingerprints: undefined,
          disableSeriesAbsenceResolution: true,
        }),
      ).toBe(true);
    });

    it("does not change metric per-series behaviour (guard off, snapshot absence-resolve still works)", () => {
      // Fingerprint not in the still-breaching set + auto-resolve configured ⇒ resolve.
      expect(
        shouldCloseIncident({
          openIncident: incident("fp-host-2"),
          autoResolveCriteriaInstanceIdIncidentIdsDictionary:
            INCIDENT_AUTO_RESOLVE,
          criteriaInstance: criteria("criteria-A"),
          breachingSeriesFingerprints: new Set<string>(["fp-host-1"]),
          disableSeriesAbsenceResolution: false,
        }),
      ).toBe(true);
    });
  });

  describe("MonitorAlert.shouldCloseAlert", () => {
    it("does NOT absence-resolve a per-key alert on the no-criteria-met path when the guard is on", () => {
      expect(
        shouldCloseAlert({
          openAlert: alert("fp-RAM"),
          autoResolveCriteriaInstanceIdAlertIdsDictionary: ALERT_AUTO_RESOLVE,
          criteriaInstance: null,
          breachingSeriesFingerprints: undefined,
          disableSeriesAbsenceResolution: true,
        }),
      ).toBe(false);
    });

    it("WOULD absence-resolve it without the guard", () => {
      expect(
        shouldCloseAlert({
          openAlert: alert("fp-RAM"),
          autoResolveCriteriaInstanceIdAlertIdsDictionary: ALERT_AUTO_RESOLVE,
          criteriaInstance: null,
          breachingSeriesFingerprints: undefined,
          disableSeriesAbsenceResolution: false,
        }),
      ).toBe(true);
    });

    it("does NOT cross-criteria absence-resolve a per-key alert when the guard is on", () => {
      expect(
        shouldCloseAlert({
          openAlert: alert("fp-RAM"),
          autoResolveCriteriaInstanceIdAlertIdsDictionary: ALERT_AUTO_RESOLVE,
          criteriaInstance: criteria("criteria-B"),
          breachingSeriesFingerprints: undefined,
          disableSeriesAbsenceResolution: true,
        }),
      ).toBe(false);
    });

    it("still resolves a NON-grouped incoming alert (no seriesFingerprint) — guard is inert", () => {
      expect(
        shouldCloseAlert({
          openAlert: alert(undefined),
          autoResolveCriteriaInstanceIdAlertIdsDictionary: ALERT_AUTO_RESOLVE,
          criteriaInstance: null,
          breachingSeriesFingerprints: undefined,
          disableSeriesAbsenceResolution: true,
        }),
      ).toBe(true);
    });
  });
});
