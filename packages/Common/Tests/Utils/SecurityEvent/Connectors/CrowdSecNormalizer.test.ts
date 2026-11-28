import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "../../../../Types/JSON";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity, {
  OcsfSeverityId,
} from "../../../../Types/SecurityEvent/OcsfSeverity";
import SecurityEventFormat from "../../../../Types/SecurityEvent/SecurityEventFormat";
import {
  CROWDSEC_META_BLOCK,
  CROWDSEC_META_CONNECTION,
  CROWDSEC_META_ENDS,
  CROWDSEC_ONEUPTIME_ORIGIN,
  CROWDSEC_ONEUPTIME_SCENARIO,
} from "../../../../Types/SecurityEvent/CrowdSec/CrowdSecDecisions";
import CrowdSecNormalizer, {
  CROWDSEC_ALERT_TYPE_ATTRIBUTE,
  CROWDSEC_EVENTS_KEPT_WHOLE,
  CROWDSEC_PRODUCT_NAME,
  CROWDSEC_VALUES_PER_KEY,
  CROWDSEC_VENDOR_NAME,
  CrowdSecAlertType,
  isCrowdSecAlert,
  parseCrowdSecTime,
  readCrowdSecAlertType,
  readCrowdSecDecisions,
  readCrowdSecMeta,
} from "../../../../Utils/SecurityEvent/Connectors/CrowdSecNormalizer";
import { contentHashEventUid } from "../../../../Utils/SecurityEvent/NormalizerHelpers";
import SecurityEventNormalizer from "../../../../Utils/SecurityEvent/SecurityEventNormalizer";
import {
  APPSEC_RCE_URI,
  APPSEC_SQLI_URI,
  APPSEC_XSS_URI,
  CROWDSEC_APPSEC_OUTOFBAND_ALERT,
  CROWDSEC_DOCS_SSH_BF_ALERT,
  CROWDSEC_DOCS_SSH_BF_NOTIFICATION,
  CROWDSEC_MANUAL_DECISION_ALERT,
  CROWDSEC_NOTIFICATIONS_TEST_ALERT,
  copyOf,
} from "./CrowdSecFixtures";

/*
 * CrowdSec's alerts, as its http notification plugin sends them (#11158):
 * recognised among the formats the ingest sniffs, read into the event
 * model - the address CrowdSec blamed, the host, user and URL it went for,
 * the decision it took - with a severity and MITRE ATT&CK techniques from
 * what the scenario detects, and told apart from what is no detection of
 * CrowdSec's: a person's ban, a Console's, a test, and OneUptime's own ban
 * coming back. Pinned against CrowdSec's own recorded payloads
 * (CrowdSecFixtures).
 */

function normalize(payload: JSONObject): NormalizedSecurityEvent {
  return CrowdSecNormalizer.normalize(payload);
}

function oneUptimeBan(overrides?: JSONObject): JSONObject {
  return {
    capacity: 0,
    decisions: [
      {
        duration: "23h59m58s",
        origin: CROWDSEC_ONEUPTIME_ORIGIN,
        scenario: CROWDSEC_ONEUPTIME_SCENARIO,
        scope: "Ip",
        type: "ban",
        value: "192.0.2.44",
      },
    ],
    events: [],
    events_count: 1,
    kind: "cscli",
    leakspeed: "0",
    machine_id: "oneuptime",
    message: "OneUptime case CASE-12 until 2026-11-29 10:00 UTC",
    meta: [
      { key: CROWDSEC_META_CONNECTION, value: "conn-1" },
      { key: CROWDSEC_META_BLOCK, value: "block-1" },
      { key: CROWDSEC_META_ENDS, value: "2026-11-29T10:00:00.000Z" },
    ],
    remediation: true,
    scenario: CROWDSEC_ONEUPTIME_SCENARIO,
    scenario_hash: "",
    scenario_version: "",
    simulated: false,
    source: { ip: "192.0.2.44", scope: "Ip", value: "192.0.2.44" },
    start_at: "2026-11-28T10:00:00Z",
    stop_at: "2026-11-28T10:00:00Z",
    uuid: "2bb6c7c6-6f71-4c3e-8a5f-5d6c1f0f2a3b",
    ...(overrides || {}),
  };
}

describe("CrowdSec alerts are recognised", () => {
  test("every recorded CrowdSec payload is a CrowdSec alert", () => {
    for (const alert of [
      CROWDSEC_DOCS_SSH_BF_ALERT,
      CROWDSEC_APPSEC_OUTOFBAND_ALERT,
      CROWDSEC_NOTIFICATIONS_TEST_ALERT,
      CROWDSEC_MANUAL_DECISION_ALERT,
      oneUptimeBan(),
    ]) {
      expect(isCrowdSecAlert(alert)).toBe(true);
      expect(SecurityEventNormalizer.detectFormat(alert)).toBe(
        SecurityEventFormat.CrowdSec,
      );
    }
  });

  test("a CrowdStrike Falcon alert, which has a scenario too, is not one", () => {
    const falcon: JSONObject = {
      composite_id: "92012896127c4a8236ba7601b886b0:ind:abc:123",
      scenario: "NGAV",
      severity: 21,
      name: "PrewittPupAdwareSensorDetect-Lowest",
      device: { hostname: "LAPTOP-01", local_ip: "10.0.0.4" },
    };

    expect(isCrowdSecAlert(falcon)).toBe(false);
    expect(SecurityEventNormalizer.detectFormat(falcon)).not.toBe(
      SecurityEventFormat.CrowdSec,
    );
  });

  test("a scenario without the source CrowdSec blames, or without a bucket field, is not one", () => {
    const noScope: JSONObject = copyOf(CROWDSEC_DOCS_SSH_BF_ALERT);
    (noScope["source"] as JSONObject)["scope"] = "";
    expect(isCrowdSecAlert(noScope)).toBe(false);

    const noSource: JSONObject = copyOf(CROWDSEC_DOCS_SSH_BF_ALERT);
    delete noSource["source"];
    expect(isCrowdSecAlert(noSource)).toBe(false);

    expect(
      isCrowdSecAlert({
        scenario: "crowdsecurity/ssh-bf",
        source: { scope: "Ip", value: "203.0.113.7" },
      }),
    ).toBe(false);

    expect(isCrowdSecAlert({ scenario: "", source: {}, leakspeed: "1s" })).toBe(
      false,
    );
  });

  test("an OCSF or UDM event is still read as what it is", () => {
    expect(
      SecurityEventNormalizer.detectFormat({
        class_uid: 3002,
        severity_id: 4,
        scenario: "crowdsecurity/ssh-bf",
      }),
    ).toBe(SecurityEventFormat.Ocsf);
  });

  test("the format can be named crowdsec, in any case, or crowdsec-alert", () => {
    expect(SecurityEventNormalizer.parseFormat("crowdsec")).toBe(
      SecurityEventFormat.CrowdSec,
    );
    expect(SecurityEventNormalizer.parseFormat(" CrowdSec ")).toBe(
      SecurityEventFormat.CrowdSec,
    );
    expect(SecurityEventNormalizer.parseFormat("crowdsec-alert")).toBe(
      SecurityEventFormat.CrowdSec,
    );
  });

  test("a payload sent as crowdsec that is not a CrowdSec alert is read as any JSON is", () => {
    const event: NormalizedSecurityEvent | null =
      SecurityEventNormalizer.normalize(
        { message: "12 failed SSH logins", src_ip: "203.0.113.9" },
        SecurityEventFormat.CrowdSec,
      );

    expect(event?.vendorName).not.toBe(CROWDSEC_VENDOR_NAME);
    expect(event?.principalIp).toBe("203.0.113.9");
  });
});

describe("the documented SSH brute force becomes a Detection Finding", () => {
  const event: NormalizedSecurityEvent = normalize(CROWDSEC_DOCS_SSH_BF_ALERT);

  test("as a Detection Finding CrowdSec made, Medium for a brute force", () => {
    expect(event.classUid).toBe(2004);
    expect(event.className).toBe("Detection Finding");
    expect(event.categoryName).toBe("Findings");
    expect(event.activityName).toBe("Create");
    expect(event.severityName).toBe(OcsfSeverity.Medium);
    expect(event.severityId).toBe(OcsfSeverityId[OcsfSeverity.Medium]);
    expect(event.vendorName).toBe(CROWDSEC_VENDOR_NAME);
    expect(event.productName).toBe(CROWDSEC_PRODUCT_NAME);
    expect(event.attributes[CROWDSEC_ALERT_TYPE_ATTRIBUTE]).toBe(
      CrowdSecAlertType.Detection,
    );
    expect(CrowdSecNormalizer.isDetection(event)).toBe(true);
  });

  test("dated when the bucket overflowed, which is when CrowdSec decided", () => {
    expect(event.time.toISOString()).toBe("2022-02-12T14:10:23.000Z");
  });

  test("named by its scenario and the Hub's name for it, with its MITRE technique and tactic", () => {
    expect(event.ruleId).toBe("crowdsecurity/ssh-bf");
    expect(event.ruleName).toBe("SSH Bruteforce");
    expect(event.mitreTechniques).toEqual(["T1110"]);
    expect(event.mitreTactics).toEqual(["TA0006"]);
  });

  test("blames the address CrowdSec banned, and names the host and user it went for", () => {
    expect(event.principalIp).toBe("35.188.49.176");
    expect(event.targetHost).toBe("sd-126005");
    expect(event.targetUser).toBe("pascal");
    expect(event.principalUser).toBe("");
    expect(event.statusName).toBe("Blocked");
    expect(event.message).toBe(
      "SSH Bruteforce from 35.188.49.176 on sd-126005, banned for 4h",
    );
  });

  test("its observables are what it is about", () => {
    expect(event.observables).toEqual(
      expect.arrayContaining([
        "35.188.49.176",
        "35.184.0.0/13",
        "sd-126005",
        "pascal",
      ]),
    );
  });

  test("without an id of its own, the same alert sent twice is one event", () => {
    expect(event.eventUid).toBe(
      contentHashEventUid(CROWDSEC_DOCS_SSH_BF_ALERT),
    );
    expect(normalize(copyOf(CROWDSEC_DOCS_SSH_BF_ALERT)).eventUid).toBe(
      event.eventUid,
    );
  });

  test("keeps every field, and sums up its events a key at a time", () => {
    expect(event.attributes["scenario_hash"]).toBe(
      "4441dcff07020f6690d998b7101e642359ba405c2abb83565bbbdcee36de280f",
    );
    expect(event.attributes["crowdsec.scenario"]).toBe("crowdsecurity/ssh-bf");
    expect(event.attributes["crowdsec.scenario_version"]).toBe("0.1");
    expect(event.attributes["crowdsec.behavior"]).toBe("bruteforce");
    expect(event.attributes["crowdsec.behavior_from"]).toBe("hub");
    expect(event.attributes["crowdsec.machine_id"]).toBe(
      "4e1c7990a4af460a9c622d2c80a856334U2v5NbKX14uQKFa",
    );
    expect(event.attributes["crowdsec.source.as_name"]).toBe("Google LLC");
    expect(event.attributes["crowdsec.source.as_number"]).toBe("15169");
    expect(event.attributes["crowdsec.source.cn"]).toBe("US");
    expect(event.attributes["crowdsec.source.range"]).toBe("35.184.0.0/13");
    expect(event.attributes["crowdsec.decisions.0.type"]).toBe("ban");
    expect(event.attributes["crowdsec.decisions.0.duration"]).toBe("4h");
    expect(event.attributes["crowdsec.decisions.0.origin"]).toBe("crowdsec");
    expect(event.attributes["crowdsec.events_count"]).toBe("6");
    expect(event.attributes["crowdsec.events_kept"]).toBe("6");
    expect(event.attributes["crowdsec.remediation"]).toBe("true");
    expect(event.attributes["crowdsec.simulated"]).toBe("false");
    expect(event.attributes["crowdsec.event.target_user"]).toBe(
      "pascal,pascal1,pascal2,pascal3,pascal4,pascal5",
    );
    expect(event.attributes["crowdsec.event.service"]).toBe("ssh");
    expect(event.attributes["crowdsec.message"]).toBe(
      "Ip 35.188.49.176 performed 'crowdsecurity/ssh-bf' (6 events over 2s) at 2022-02-12 14:10:23 +0000 UTC",
    );
  });

  test("the plugin's list is read whole by the ingest's normalizer, sniffed or named", () => {
    const sniffed: Array<NormalizedSecurityEvent | null> =
      CROWDSEC_DOCS_SSH_BF_NOTIFICATION.map((alert: unknown) => {
        return SecurityEventNormalizer.normalize(alert as JSONObject);
      });
    const named: Array<NormalizedSecurityEvent | null> =
      CROWDSEC_DOCS_SSH_BF_NOTIFICATION.map((alert: unknown) => {
        return SecurityEventNormalizer.normalize(
          alert as JSONObject,
          SecurityEventFormat.CrowdSec,
        );
      });

    expect(sniffed).toHaveLength(1);
    expect(sniffed[0]?.eventUid).toBe(event.eventUid);
    expect(named[0]?.message).toBe(event.message);
  });
});

describe("the documented AppSec alert, read back from LAPI", () => {
  const event: NormalizedSecurityEvent = normalize(
    CROWDSEC_APPSEC_OUTOFBAND_ALERT,
  );

  test("is an exploit: High, Exploit Public-Facing Application, Initial Access", () => {
    expect(event.severityName).toBe(OcsfSeverity.High);
    expect(event.mitreTechniques).toEqual(["T1190"]);
    expect(event.mitreTactics).toEqual(["TA0001"]);
    expect(event.ruleName).toBe(
      "Triggered multiple OutOfBand CrowdSec AppSec rules",
    );
  });

  test("keeps its uuid as its id, so CrowdSec's copy and the plugin's are one", () => {
    expect(event.eventUid).toBe(
      "crowdsec:a0ad365a-ef08-4c18-af80-20cc02625c35",
    );
  });

  test("names the URL attacked, from the alert's context", () => {
    expect(event.targetResource).toBe(APPSEC_RCE_URI);
    expect(event.targetHost).toBe("localhost");
    expect(event.attributes["crowdsec.context.target_uri"]).toBe(
      [APPSEC_RCE_URI, APPSEC_XSS_URI, APPSEC_SQLI_URI].join(","),
    );
    expect(event.attributes["crowdsec.context.rules"]).toBe(
      "native_rule:901340",
    );
  });

  test("keeps an event's Go slice as the text it is, and the decision's id", () => {
    expect(event.attributes["crowdsec.event.rule_ids"]).toContain(
      "[901340 930120 932230",
    );
    expect(event.attributes["crowdsec.decisions.0.id"]).toBe("19719904");
    expect(event.attributes["crowdsec.alert_id"]).toBe("2172");
    expect(event.attributes["crowdsec.kind"]).toBe("crowdsec");
  });

  test("says what CrowdSec did, for the time the ban had left", () => {
    expect(event.statusName).toBe("Blocked");
    expect(event.message).toBe(
      "Triggered multiple OutOfBand CrowdSec AppSec rules from 203.0.113.7 on localhost, banned for 3h57m38s",
    );
    expect(event.time.toISOString()).toBe("2025-08-22T09:39:50.000Z");
  });
});

describe("what is no detection of CrowdSec's never reads as one", () => {
  test("cscli notifications test is CrowdSec's test, Informational", () => {
    const event: NormalizedSecurityEvent = normalize(
      CROWDSEC_NOTIFICATIONS_TEST_ALERT,
    );

    expect(event.attributes[CROWDSEC_ALERT_TYPE_ATTRIBUTE]).toBe(
      CrowdSecAlertType.Test,
    );
    expect(event.severityName).toBe(OcsfSeverity.Informational);
    expect(event.mitreTechniques).toEqual([]);
    expect(event.mitreTactics).toEqual([]);
    expect(event.message).toBe(
      "CrowdSec's test notification (cscli notifications test), for 10.10.10.10",
    );
    expect(event.time.toISOString()).toBe("2026-11-28T10:00:00.000Z");
    expect(CrowdSecNormalizer.isDetection(event)).toBe(false);
  });

  test("a person's cscli decision is a manual one", () => {
    const event: NormalizedSecurityEvent = normalize(
      CROWDSEC_MANUAL_DECISION_ALERT,
    );

    expect(event.attributes[CROWDSEC_ALERT_TYPE_ATTRIBUTE]).toBe(
      CrowdSecAlertType.Manual,
    );
    expect(event.severityName).toBe(OcsfSeverity.Informational);
    expect(event.message).toBe(
      "198.51.100.23 banned for 24h by hand in CrowdSec (manual 'ban' from 'localhost')",
    );
    expect(event.eventUid).toBe(
      "crowdsec:6b0e2f53-3c43-4a0c-9a66-6f2f1d0d8f4e",
    );
    expect(event.time.toISOString()).toBe("2026-11-28T09:12:00.000Z");
  });

  test("an imported decision is manual too", () => {
    const imported: JSONObject = copyOf(CROWDSEC_MANUAL_DECISION_ALERT);
    delete imported["kind"];
    ((imported["decisions"] as Array<JSONObject>)[0] as JSONObject)["origin"] =
      "cscli-import";

    expect(readCrowdSecAlertType(imported)).toBe(CrowdSecAlertType.Manual);
  });

  test("a decision from CrowdSec's Console is the Console's", () => {
    const console: JSONObject = copyOf(CROWDSEC_MANUAL_DECISION_ALERT);
    console["kind"] = "papi";
    expect(readCrowdSecAlertType(console)).toBe(CrowdSecAlertType.Console);

    const byOrigin: JSONObject = copyOf(CROWDSEC_MANUAL_DECISION_ALERT);
    delete byOrigin["kind"];
    ((byOrigin["decisions"] as Array<JSONObject>)[0] as JSONObject)["origin"] =
      "console";
    expect(readCrowdSecAlertType(byOrigin)).toBe(CrowdSecAlertType.Console);
    expect(normalize(byOrigin).message).toBe(
      "198.51.100.23 banned for 24h from CrowdSec's Console (manual 'ban' from 'localhost')",
    );
  });

  test("an address of a blocklist CrowdSec pulls is the blocklist's", () => {
    for (const origin of ["CAPI", "lists"]) {
      const listed: JSONObject = copyOf(CROWDSEC_MANUAL_DECISION_ALERT);
      delete listed["kind"];
      ((listed["decisions"] as Array<JSONObject>)[0] as JSONObject)["origin"] =
        origin;
      expect(readCrowdSecAlertType(listed)).toBe(CrowdSecAlertType.Blocklist);
    }

    const capi: JSONObject = copyOf(CROWDSEC_MANUAL_DECISION_ALERT);
    capi["kind"] = "capi";
    expect(readCrowdSecAlertType(capi)).toBe(CrowdSecAlertType.Blocklist);
  });

  test("OneUptime's own ban, back through the plugin, is OneUptime's: by its scenario, its meta or its decision", () => {
    expect(readCrowdSecAlertType(oneUptimeBan())).toBe(
      CrowdSecAlertType.OneUptime,
    );
    expect(
      readCrowdSecAlertType(
        oneUptimeBan({ scenario: "renamed by a profile", meta: [] }),
      ),
    ).toBe(CrowdSecAlertType.OneUptime);
    expect(
      readCrowdSecAlertType(
        oneUptimeBan({
          scenario: "renamed by a profile",
          decisions: [],
        }),
      ),
    ).toBe(CrowdSecAlertType.OneUptime);

    const event: NormalizedSecurityEvent = normalize(oneUptimeBan());

    expect(event.severityName).toBe(OcsfSeverity.Informational);
    expect(event.mitreTechniques).toEqual([]);
    expect(event.message).toBe(
      "OneUptime's ban of 192.0.2.44 is held by CrowdSec: banned for 23h59m58s",
    );
    expect(CrowdSecNormalizer.isDetection(event)).toBe(false);
  });
});

describe("what CrowdSec did, as the event's outcome", () => {
  test("a scenario in simulation mode applied nothing", () => {
    const simulated: JSONObject = copyOf(CROWDSEC_DOCS_SSH_BF_ALERT);
    simulated["simulated"] = true;
    const event: NormalizedSecurityEvent = normalize(simulated);

    expect(event.statusName).toBe("Logged");
    expect(event.message).toBe(
      "SSH Bruteforce from 35.188.49.176 on sd-126005 (simulation mode: nothing applied)",
    );
    expect(event.severityName).toBe(OcsfSeverity.Medium);
  });

  test("an alert no profile remediated is logged", () => {
    const logged: JSONObject = copyOf(CROWDSEC_DOCS_SSH_BF_ALERT);
    logged["decisions"] = [];
    const event: NormalizedSecurityEvent = normalize(logged);

    expect(event.statusName).toBe("Logged");
    expect(event.message).toBe(
      "SSH Bruteforce from 35.188.49.176 on sd-126005",
    );
  });

  test("a captcha is a challenge, and a custom decision another outcome", () => {
    const captcha: JSONObject = copyOf(CROWDSEC_DOCS_SSH_BF_ALERT);
    ((captcha["decisions"] as Array<JSONObject>)[0] as JSONObject)["type"] =
      "captcha";
    expect(normalize(captcha).statusName).toBe("Challenge");
    expect(normalize(captcha).message).toContain("challenged for 4h");

    const custom: JSONObject = copyOf(CROWDSEC_DOCS_SSH_BF_ALERT);
    ((custom["decisions"] as Array<JSONObject>)[0] as JSONObject)["type"] =
      "throttle";
    expect(normalize(custom).statusName).toBe("Other");
    expect(normalize(custom).message).toContain(
      "given a throttle decision for 4h",
    );
  });

  test("a decision read back after it ended says no time left", () => {
    const ended: JSONObject = copyOf(CROWDSEC_APPSEC_OUTOFBAND_ALERT);
    ((ended["decisions"] as Array<JSONObject>)[0] as JSONObject)["duration"] =
      "-1m2s";
    expect(normalize(ended).message).toBe(
      "Triggered multiple OutOfBand CrowdSec AppSec rules from 203.0.113.7 on localhost, banned",
    );
  });
});

describe("the source CrowdSec blames", () => {
  test("a range scenario blames the address in it, and keeps the range", () => {
    const range: JSONObject = copyOf(CROWDSEC_DOCS_SSH_BF_ALERT);
    range["source"] = {
      ip: "203.0.113.9",
      range: "203.0.113.0/24",
      scope: "Range",
      value: "203.0.113.0/24",
    };
    const event: NormalizedSecurityEvent = normalize(range);

    expect(event.principalIp).toBe("203.0.113.9");
    expect(event.observables).toEqual(
      expect.arrayContaining(["203.0.113.9", "203.0.113.0/24"]),
    );
    expect(event.message).toContain("from 203.0.113.0/24");
  });

  test("an address given only as the source's value is the principal", () => {
    const valueOnly: JSONObject = copyOf(CROWDSEC_DOCS_SSH_BF_ALERT);
    valueOnly["source"] = { scope: "Ip", value: "198.51.100.77" };
    expect(normalize(valueOnly).principalIp).toBe("198.51.100.77");
  });

  test("a scope other than an address names no principal address", () => {
    const user: JSONObject = copyOf(CROWDSEC_DOCS_SSH_BF_ALERT);
    user["source"] = { scope: "username", value: "pascal" };
    const event: NormalizedSecurityEvent = normalize(user);

    expect(event.principalIp).toBe("");
    expect(event.message).toContain("from pascal");
  });

  test("an HTTP scenario's host is the one it targeted, and its port and address when the logs name them", () => {
    const http: JSONObject = copyOf(CROWDSEC_DOCS_SSH_BF_ALERT);
    http["events"] = [
      {
        meta: [
          { key: "target_fqdn", value: "shop.example.com" },
          { key: "machine", value: "web-01" },
          { key: "http_path", value: "/wp-login.php" },
          { key: "dst_ip", value: "192.0.2.10" },
          { key: "dst_port", value: "443" },
        ],
        timestamp: "2022-02-12T14:10:23Z",
      },
    ];
    const event: NormalizedSecurityEvent = normalize(http);

    expect(event.targetHost).toBe("shop.example.com");
    expect(event.targetResource).toBe("/wp-login.php");
    expect(event.targetIp).toBe("192.0.2.10");
    expect(event.targetPort).toBe(443);
  });

  test("a port that is no port is none", () => {
    const http: JSONObject = copyOf(CROWDSEC_DOCS_SSH_BF_ALERT);
    http["events"] = [
      {
        meta: [{ key: "dst_port", value: "99999" }],
        timestamp: "2022-02-12T14:10:23Z",
      },
    ];
    expect(normalize(http).targetPort).toBe(0);
  });
});

describe("a bucket of many events", () => {
  function withEvents(count: number): JSONObject {
    const alert: JSONObject = copyOf(CROWDSEC_DOCS_SSH_BF_ALERT);
    const events: Array<JSONObject> = [];

    for (let index: number = 0; index < count; index++) {
      events.push({
        meta: [
          { key: "source_ip", value: "35.188.49.176" },
          { key: "target_user", value: `user${index}` },
        ],
        timestamp: "2022-02-12T14:10:23Z",
      });
    }

    alert["events"] = events;
    alert["events_count"] = count;
    return alert;
  }

  test("keeps the first events whole and sums up the rest", () => {
    const event: NormalizedSecurityEvent = normalize(withEvents(40));

    expect(event.attributes["crowdsec.events_count"]).toBe("40");
    expect(event.attributes["crowdsec.events_kept"]).toBe(
      String(CROWDSEC_EVENTS_KEPT_WHOLE),
    );
    expect(
      event.attributes[`events.${CROWDSEC_EVENTS_KEPT_WHOLE - 1}.timestamp`],
    ).toBe("2022-02-12T14:10:23Z");
    expect(
      event.attributes[`events.${CROWDSEC_EVENTS_KEPT_WHOLE}.timestamp`],
    ).toBeUndefined();

    const users: Array<string> = String(
      event.attributes["crowdsec.event.target_user"],
    ).split(",");
    expect(users).toHaveLength(CROWDSEC_VALUES_PER_KEY);
    expect(users[0]).toBe("user0");
  });
});

describe("CrowdSec's times", () => {
  test("RFC 3339, to the nanosecond, and with an offset", () => {
    expect(
      parseCrowdSecTime("2024-01-15T10:20:30.123456789Z")?.toISOString(),
    ).toBe("2024-01-15T10:20:30.123Z");
    expect(parseCrowdSecTime("2022-02-12T14:10:23+02:00")?.toISOString()).toBe(
      "2022-02-12T12:10:23.000Z",
    );
  });

  test("Go's String(), as LAPI reads an event back, in any zone", () => {
    expect(
      parseCrowdSecTime("2022-02-12 14:10:23 +0000 UTC")?.toISOString(),
    ).toBe("2022-02-12T14:10:23.000Z");
    expect(
      parseCrowdSecTime(
        "2025-08-22 09:39:50.326505724 +0000 UTC",
      )?.toISOString(),
    ).toBe("2025-08-22T09:39:50.326Z");
    expect(
      parseCrowdSecTime("2022-02-12 14:10:23.5 +0200 CEST")?.toISOString(),
    ).toBe("2022-02-12T12:10:23.500Z");
    expect(
      parseCrowdSecTime(
        "2026-11-28 10:00:00.000000001 +0000 UTC m=+12.000000001",
      )?.toISOString(),
    ).toBe("2026-11-28T10:00:00.000Z");
  });

  test("nothing that is no time", () => {
    expect(parseCrowdSecTime("")).toBeNull();
    expect(parseCrowdSecTime("soon")).toBeNull();
    expect(parseCrowdSecTime(12)).toBeNull();
    expect(parseCrowdSecTime(null)).toBeNull();
    expect(parseCrowdSecTime("0001-01-01T00:00:00Z")).toBeNull();
  });

  test("an alert with no time is placed when it arrives", () => {
    const timeless: JSONObject = copyOf(CROWDSEC_DOCS_SSH_BF_ALERT);
    delete timeless["stop_at"];
    delete timeless["start_at"];
    const before: number = Date.now();
    const time: number = normalize(timeless).time.getTime();

    expect(time).toBeGreaterThanOrEqual(before);
  });
});

describe("CrowdSec's key/value meta", () => {
  test("reads a context value's JSON list, each value once", () => {
    const meta: Map<string, Array<string>> = readCrowdSecMeta([
      { key: "target_uri", value: '["/a","/b","/a"]' },
      { key: "target_uri", value: "/c" },
      { key: "status", value: 403 },
      { key: "flag", value: true },
      { key: "go_slice", value: "[1 2 3]" },
      { key: "", value: "dropped" },
      { value: "no key" },
      "not an item",
    ]);

    expect(meta.get("target_uri")).toEqual(["/a", "/b", "/c"]);
    expect(meta.get("status")).toEqual(["403"]);
    expect(meta.get("flag")).toEqual(["true"]);
    expect(meta.get("go_slice")).toEqual(["[1 2 3]"]);
    expect(meta.size).toBe(4);
  });

  test("nothing from what is no list", () => {
    expect(readCrowdSecMeta(undefined).size).toBe(0);
    expect(readCrowdSecMeta({ key: "a", value: "b" }).size).toBe(0);
  });

  test("a decision's every field", () => {
    expect(readCrowdSecDecisions(CROWDSEC_APPSEC_OUTOFBAND_ALERT)).toEqual([
      {
        type: "ban",
        duration: "3h57m38s",
        origin: "crowdsec",
        scope: "Ip",
        value: "203.0.113.7",
        scenario: "crowdsecurity/crowdsec-appsec-outofband",
        id: "19719904",
        simulated: false,
      },
    ]);
    expect(readCrowdSecDecisions({ decisions: "none" })).toEqual([]);
  });
});

describe("a scenario OneUptime does not know", () => {
  test("is read by its name, and Medium when its name says nothing", () => {
    const custom: JSONObject = copyOf(CROWDSEC_DOCS_SSH_BF_ALERT);
    custom["scenario"] = "acme/odd-thing";
    const event: NormalizedSecurityEvent = normalize(custom);

    expect(event.severityName).toBe(OcsfSeverity.Medium);
    expect(event.mitreTechniques).toEqual([]);
    expect(event.ruleName).toBe("acme/odd-thing");
    expect(event.attributes["crowdsec.behavior"]).toBe("unknown");
    expect(event.attributes["crowdsec.behavior_from"]).toBe("name");
  });

  test("a scenario named like an object's own key is no Hub scenario", () => {
    for (const name of ["constructor", "__proto__", "toString"]) {
      const odd: JSONObject = copyOf(CROWDSEC_DOCS_SSH_BF_ALERT);
      odd["scenario"] = name;
      const event: NormalizedSecurityEvent = normalize(odd);

      expect(event.ruleName).toBe(name);
      expect(event.attributes["crowdsec.behavior_from"]).toBe("name");
    }
  });
});
