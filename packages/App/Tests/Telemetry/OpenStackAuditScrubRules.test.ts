import { describe, expect, test } from "@jest/globals";
import LogScrubRule from "Common/Models/DatabaseModels/LogScrubRule";
import { OPENSTACK_DEFAULT_SCRUB_RULES } from "Common/Server/Utils/OpenStack/OpenStackLogDefaults";
import { JSONObject } from "Common/Types/JSON";
import LogScrubAction from "Common/Types/Log/LogScrubAction";
import LogScrubPatternType from "Common/Types/Log/LogScrubPatternType";
import { stampOpenStackLogRecord } from "Common/Utils/OpenStack/OpenStackLogs";
import OpenStackAuditLogParser, {
  OpenStackAuditAttribute,
} from "Common/Utils/SecurityEvent/LogParsers/OpenStackAuditLogParser";
import NormalizedSecurityEvent from "Common/Types/SecurityEvent/NormalizedSecurityEvent";
import LogScrubRuleService from "../../FeatureSet/Telemetry/Services/LogScrubRuleService";

/*
 * Audit records go through a project's scrub rules, because the log scan only ever reads what
 * ingest stored: a line is stamped, scrubbed by the project's own rules, and stored, and an event
 * is read from that. So what a rule takes out of a line is not in its event, and a rule's mask
 * does not cost the event the rest of what the line said.
 *
 * The line is as Keystone writes it, in the shape real clouds recorded.
 */

const LINE: string = `INFO oslo.messaging.notification.identity.role_assignment.created [None req-23a990c7-7963-425a-a432-f58aadf5f188 admin admin] ${JSON.stringify(
  {
    message_id: "585056df-bb5c-48ff-9082-9eaf0c347785",
    publisher_id: "identity.controller",
    event_type: "identity.role_assignment.created",
    priority: "INFO",
    payload: {
      typeURI: "http://schemas.dmtf.org/cloud/audit/1.0/event",
      eventType: "activity",
      id: "ecc1312a-7c8f-5fc0-af4e-e473ba5de7eb",
      eventTime: "2026-11-04T21:38:10.595450+0000",
      action: "created.role_assignment",
      outcome: "success",
      initiator: {
        id: "f1bb4b45f20b4c7cb9b41f867a053086",
        user_id: "f1bb4b45f20b4c7cb9b41f867a053086",
        username: "ada.lovelace@example.com",
        project_id: "635fc523390942fe8c8c2bd3a26d1f1b",
        host: { address: "203.0.113.7", agent: "openstacksdk/4.4.1" },
      },
      target: {
        id: "a1efb7e8-a86b-5539-bbd0-8d31efbf3955",
        typeURI: "service/security/account/user",
      },
      project: "635fc523390942fe8c8c2bd3a26d1f1b",
      role: "8a15c885b81b4744b8e471c9f233c60c",
      user: "e988af08b4024d1f9af182fda1f9b42a",
    },
  },
)}`;

type GetRegexForPattern = (type: string, pattern: string) => unknown;

function customRule(pattern: string): Array<unknown> {
  const rule: LogScrubRule = new LogScrubRule();

  rule.patternType = LogScrubPatternType.Custom;
  rule.customRegex = pattern;
  rule.scrubAction = LogScrubAction.Redact;
  rule.fieldsToScrub = "both";

  return [
    {
      rule,
      regex: (
        LogScrubRuleService as unknown as {
          getRegexForPattern: GetRegexForPattern;
        }
      ).getRegexForPattern(LogScrubPatternType.Custom, pattern),
    },
  ];
}

// What ingest does to a line, in the order it does it, and what the log scan then reads.
function eventAfter(rules: Array<unknown>): NormalizedSecurityEvent {
  const attributes: JSONObject = {
    "resource.openstack.cloud.name": "production",
    "journald.unit": "devstack@keystone.service",
  };
  const stamped: { body: string; attributes: Record<string, string> } =
    stampOpenStackLogRecord({ attributes, body: LINE, severityNumber: 0 });
  const stored: JSONObject = LogScrubRuleService.scrubLog(
    {
      body: stamped.body,
      attributes: { ...attributes, ...stamped.attributes },
    },
    rules as never,
  );
  const events: Array<NormalizedSecurityEvent> = OpenStackAuditLogParser.parse({
    body: stored["body"] as string,
    attributes: stored["attributes"] as JSONObject,
    time: new Date(0),
  });

  expect(events).toHaveLength(1);

  return events[0] as NormalizedSecurityEvent;
}

describe("a project's scrub rules, on an audit record", () => {
  test("what a rule takes out of the line is not in the event", () => {
    const event: NormalizedSecurityEvent = eventAfter(
      customRule("[a-z.]+@example\\.com"),
    );
    const text: string = JSON.stringify(event);

    expect(text).not.toContain("ada.lovelace@example.com");
    expect(event.principalUser).toBe("[REDACTED]");
  });

  test("an address a rule takes out is no address, and the event still says what happened", () => {
    const event: NormalizedSecurityEvent = eventAfter(
      customRule("203\\.0\\.113\\.7"),
    );

    expect(JSON.stringify(event)).not.toContain("203.0.113.7");
    expect(event.principalIp).toBe("");
    expect(event.attributes[OpenStackAuditAttribute.ProjectId]).toBe(
      "635fc523390942fe8c8c2bd3a26d1f1b",
    );
    expect(event.message).toContain("granted role");
  });

  test("the rules every OpenStack project starts with leave an audit record readable", () => {
    const event: NormalizedSecurityEvent = eventAfter(
      OPENSTACK_DEFAULT_SCRUB_RULES.flatMap(
        (rule: { customRegex: string }): Array<unknown> => {
          return customRule(rule.customRegex);
        },
      ),
    );

    expect(event.principalUser).toBe("ada.lovelace@example.com");
    expect(event.statusName).toBe("Success");
    expect(event.attributes[OpenStackAuditAttribute.RoleId]).toBe(
      "8a15c885b81b4744b8e471c9f233c60c",
    );
  });

  test("with no rules it reads as it was written", () => {
    expect(eventAfter([]).principalUser).toBe("ada.lovelace@example.com");
  });
});
