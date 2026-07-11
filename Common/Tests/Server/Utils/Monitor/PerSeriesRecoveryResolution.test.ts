import MonitorIncident from "../../../../Server/Utils/Monitor/MonitorIncident";
import MonitorAlert from "../../../../Server/Utils/Monitor/MonitorAlert";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Alert from "../../../../Models/DatabaseModels/Alert";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import Dictionary from "../../../../Types/Dictionary";
import { describe, expect, it } from "@jest/globals";

/*
 * Regression tests for per-series offline/online auto-resolve.
 *
 * Per-series offline monitors (Host / Proxmox / Ceph / IoTDevice) pair
 * an OFFLINE criteria that creates incidents (e.g. Min(device_up) < 1)
 * with a RECOVERY criteria that does not (Min(device_up) >= 1), grouped
 * by a device/host key. Exactly one criteria wins per evaluation tick,
 * and the breaching-series set handed to shouldClose{Incident,Alert} is
 * that winning criteria's per-series matches.
 *
 * On the recovery tick the RECOVERY criteria wins, so its matches are
 * the healthy series — NOT breaches. The bug: membership in that set was
 * treated as "still breaching", so the open offline incident's own
 * fingerprint kept it pinned open forever once no other series was down.
 * The fix only counts membership when the matched criteria actually
 * creates incidents/alerts.
 */

const CREATED_CRITERIA_ID: string = "offline-criteria";
const TEMPLATE_ID: string = "template-1";
const DEVICE_FP: string = "fp-device-1";

const INCIDENT_AUTO_RESOLVE: Dictionary<Array<string>> = {
  [CREATED_CRITERIA_ID]: [TEMPLATE_ID],
};
const ALERT_AUTO_RESOLVE: Dictionary<Array<string>> = {
  [CREATED_CRITERIA_ID]: [TEMPLATE_ID],
};

function incident(fingerprint: string): Incident {
  const i: Incident = new Incident();
  i.createdCriteriaId = CREATED_CRITERIA_ID;
  i.createdIncidentTemplateId = TEMPLATE_ID;
  i.seriesFingerprint = fingerprint;
  return i;
}

function alert(fingerprint: string): Alert {
  const a: Alert = new Alert();
  a.createdCriteriaId = CREATED_CRITERIA_ID;
  a.seriesFingerprint = fingerprint;
  return a;
}

function criteria(id: string, creates: boolean): MonitorCriteriaInstance {
  const c: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  c.data!.id = id;
  // Same flag drives both — the templates set createIncidents/createAlerts together.
  c.data!.createIncidents = creates;
  c.data!.createAlerts = creates;
  return c;
}

function shouldCloseIncident(input: Record<string, unknown>): boolean {
  return (
    MonitorIncident as unknown as {
      shouldCloseIncident: (i: Record<string, unknown>) => boolean;
    }
  ).shouldCloseIncident(input);
}
function shouldCloseAlert(input: Record<string, unknown>): boolean {
  return (
    MonitorAlert as unknown as {
      shouldCloseAlert: (i: Record<string, unknown>) => boolean;
    }
  ).shouldCloseAlert(input);
}

describe("Per-series offline/online auto-resolve", () => {
  describe("MonitorIncident.shouldCloseIncident", () => {
    it("RESOLVES on the recovery tick even though the recovered series is in the matched (recovery) criteria's set", () => {
      /*
       * The device is back up: the RECOVERY criteria won, its match set
       * contains the now-healthy device. It must NOT keep the incident open.
       */
      expect(
        shouldCloseIncident({
          openIncident: incident(DEVICE_FP),
          autoResolveCriteriaInstanceIdIncidentIdsDictionary:
            INCIDENT_AUTO_RESOLVE,
          criteriaInstance: criteria("recovery-criteria", false),
          breachingSeriesFingerprints: new Set<string>([DEVICE_FP]),
          disableSeriesAbsenceResolution: false,
        }),
      ).toBe(true);
    });

    it("keeps the incident open while the device is still down (offline criteria won, series still breaching)", () => {
      expect(
        shouldCloseIncident({
          openIncident: incident(DEVICE_FP),
          autoResolveCriteriaInstanceIdIncidentIdsDictionary:
            INCIDENT_AUTO_RESOLVE,
          criteriaInstance: criteria(CREATED_CRITERIA_ID, true),
          breachingSeriesFingerprints: new Set<string>([DEVICE_FP]),
          disableSeriesAbsenceResolution: false,
        }),
      ).toBe(false);
    });

    it("resolves when this device recovered but another device is still down (offline criteria won, fp absent)", () => {
      expect(
        shouldCloseIncident({
          openIncident: incident(DEVICE_FP),
          autoResolveCriteriaInstanceIdIncidentIdsDictionary:
            INCIDENT_AUTO_RESOLVE,
          criteriaInstance: criteria(CREATED_CRITERIA_ID, true),
          // Only some OTHER device is still breaching the offline criteria.
          breachingSeriesFingerprints: new Set<string>(["fp-device-2"]),
          disableSeriesAbsenceResolution: false,
        }),
      ).toBe(true);
    });

    it("does not resolve on recovery when the creating criteria did not opt into auto-resolve", () => {
      expect(
        shouldCloseIncident({
          openIncident: incident(DEVICE_FP),
          autoResolveCriteriaInstanceIdIncidentIdsDictionary: {}, // not configured
          criteriaInstance: criteria("recovery-criteria", false),
          breachingSeriesFingerprints: new Set<string>([DEVICE_FP]),
          disableSeriesAbsenceResolution: false,
        }),
      ).toBe(false);
    });

    it("still respects the event-driven guard (incoming-request) over recovery resolution", () => {
      expect(
        shouldCloseIncident({
          openIncident: incident(DEVICE_FP),
          autoResolveCriteriaInstanceIdIncidentIdsDictionary:
            INCIDENT_AUTO_RESOLVE,
          criteriaInstance: criteria("recovery-criteria", false),
          breachingSeriesFingerprints: new Set<string>([DEVICE_FP]),
          disableSeriesAbsenceResolution: true,
        }),
      ).toBe(false);
    });
  });

  describe("MonitorAlert.shouldCloseAlert", () => {
    it("RESOLVES on the recovery tick even though the recovered series is in the matched (recovery) criteria's set", () => {
      expect(
        shouldCloseAlert({
          openAlert: alert(DEVICE_FP),
          autoResolveCriteriaInstanceIdAlertIdsDictionary: ALERT_AUTO_RESOLVE,
          criteriaInstance: criteria("recovery-criteria", false),
          breachingSeriesFingerprints: new Set<string>([DEVICE_FP]),
          disableSeriesAbsenceResolution: false,
        }),
      ).toBe(true);
    });

    it("keeps the alert open while the device is still down", () => {
      expect(
        shouldCloseAlert({
          openAlert: alert(DEVICE_FP),
          autoResolveCriteriaInstanceIdAlertIdsDictionary: ALERT_AUTO_RESOLVE,
          criteriaInstance: criteria(CREATED_CRITERIA_ID, true),
          breachingSeriesFingerprints: new Set<string>([DEVICE_FP]),
          disableSeriesAbsenceResolution: false,
        }),
      ).toBe(false);
    });

    it("resolves when this device recovered but another is still down", () => {
      expect(
        shouldCloseAlert({
          openAlert: alert(DEVICE_FP),
          autoResolveCriteriaInstanceIdAlertIdsDictionary: ALERT_AUTO_RESOLVE,
          criteriaInstance: criteria(CREATED_CRITERIA_ID, true),
          breachingSeriesFingerprints: new Set<string>(["fp-device-2"]),
          disableSeriesAbsenceResolution: false,
        }),
      ).toBe(true);
    });

    it("still respects the event-driven guard over recovery resolution", () => {
      expect(
        shouldCloseAlert({
          openAlert: alert(DEVICE_FP),
          autoResolveCriteriaInstanceIdAlertIdsDictionary: ALERT_AUTO_RESOLVE,
          criteriaInstance: criteria("recovery-criteria", false),
          breachingSeriesFingerprints: new Set<string>([DEVICE_FP]),
          disableSeriesAbsenceResolution: true,
        }),
      ).toBe(false);
    });
  });
});
