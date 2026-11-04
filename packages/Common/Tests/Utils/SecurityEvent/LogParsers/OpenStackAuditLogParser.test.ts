import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "../../../../Types/JSON";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import { DetectionRuleDataKind } from "../../../../Types/SecurityEvent/DetectionRuleDataKind";
import {
  DETECTION_RULE_LIBRARY,
  DetectionRuleLibraryEntry,
} from "../../../../Types/SecurityEvent/DetectionRuleLibrary";
import OcsfSeverity from "../../../../Types/SecurityEvent/OcsfSeverity";
import SigmaRule from "../../../../Types/SecurityEvent/SigmaRule";
import SecurityLogFormat, {
  SECURITY_LOG_FORMAT_ATTRIBUTE,
} from "../../../../Types/SecurityEvent/SecurityLogFormat";
import OpenStackAuditLogParser, {
  OPENSTACK_AUDIT_PREFILTER_REQUIRES,
  OPENSTACK_AUDIT_PREFILTER_WORDS,
  OpenStackAuditAttribute,
  OpenStackAuditSignal,
  describeOpenStackProject,
  isOpenStackPortInRule,
  isOpenStackRuleOpenToWorld,
  readOpenStackAuditNotification,
} from "../../../../Utils/SecurityEvent/LogParsers/OpenStackAuditLogParser";
import SecurityLogParser, {
  matchesSecurityLogPrefilter,
} from "../../../../Utils/SecurityEvent/LogParsers/SecurityLogParser";
import SigmaRuleParser from "../../../../Utils/SecurityEvent/Sigma/SigmaRuleParser";
import { generatedTexts } from "../../../Helpers/GeneratedTexts";
import { logLine } from "./LogParserFixtures";
import { sigmaRuleMatchesEvent } from "./SigmaTestMatcher";

/*
 * Who did what in a cloud, from its audit trail.
 *
 * HAND-WRITTEN FIXTURES, from Keystone's and keystonemiddleware's documented CADF events.
 * OpenStackRecordedLogs.test.ts reads what the services really sent, and proves the same thing
 * on those: no credential gets through.
 */

const CLOUD_ATTRIBUTES: JSONObject = {
  "resource.openstack.cloud.name": "production",
};

const CREDENTIAL_TOKEN: string = "gAAAAABpartofatoken-MUST-NOT-STAY";
const PASSWORD_HASH: string = "PARTIAL-PASSWORD-HASH-MUST-NOT-STAY";
const USER_ID: string = "0123456789abcdef0123456789abcdef";
const PROJECT_ID: string = "fedcba9876543210fedcba9876543210";
const ROLE_ID: string = "aaaabbbbccccddddeeeeffff00001111";

function cadf(
  eventType: string,
  payload: JSONObject,
  more: JSONObject = {},
): JSONObject {
  return {
    message_id: "6d3e8f6b-9f4a-4d3d-9a6b-1f1b2a3c4d5e",
    event_type: eventType,
    priority: "INFO",
    publisher_id: "identity.controller",
    timestamp: "2026-10-30 10:00:00.000000",
    payload: {
      typeURI: "http://schemas.dmtf.org/cloud/audit/1.0/event",
      eventType: "activity",
      id: "payload-id",
      eventTime: "2026-10-30T10:00:01.000000+0000",
      initiator: {
        typeURI: "service/security/account/user",
        id: "hashed-initiator-id",
        user_id: USER_ID,
        username: "alice",
        project_id: PROJECT_ID,
        host: { address: "203.0.113.7", agent: "curl/8" },
        credential: { token: CREDENTIAL_TOKEN, identity_status: "Confirmed" },
      },
      target: {
        typeURI: "service/security/account/user",
        id: "target-id",
      },
      observer: { typeURI: "service/security", id: "observer-id" },
      ...payload,
    },
    ...more,
  };
}

function parse(
  message: JSONObject | string,
  attributes: JSONObject = CLOUD_ATTRIBUTES,
): Array<NormalizedSecurityEvent> {
  return OpenStackAuditLogParser.parse(
    logLine(
      typeof message === "string" ? message : JSON.stringify(message),
      attributes,
    ),
  );
}

function one(
  message: JSONObject | string,
  attributes?: JSONObject,
): NormalizedSecurityEvent {
  const events: Array<NormalizedSecurityEvent> = parse(message, attributes);

  expect(events).toHaveLength(1);

  return events[0]!;
}

describe("a login", () => {
  test("that failed says who, from where, and is a failure", () => {
    const event: NormalizedSecurityEvent = one(
      cadf("identity.authenticate", {
        action: "authenticate",
        outcome: "failure",
        reason: { reasonCode: "401", reasonType: "Unauthorized" },
      }),
    );

    expect(event.statusName).toBe("Failure");
    expect(event.activityName).toBe("Logon");
    expect(event.principalUser).toBe("alice");
    expect(event.principalIp).toBe("203.0.113.7");
    expect(event.targetResource).toBe("Keystone");
    expect(event.targetHost).toBe("production");
    expect(event.message).toBe("alice failed to sign in to OpenStack");
    expect(event.severityName).toBe(OcsfSeverity.Low);
    expect(event.attributes[OpenStackAuditAttribute.Outcome]).toBe("failure");
    expect(event.attributes[OpenStackAuditAttribute.ReasonCode]).toBe("401");
    expect(event.attributes[OpenStackAuditAttribute.Cloud]).toBe("production");
    expect(event.attributes[SECURITY_LOG_FORMAT_ATTRIBUTE]).toBe(
      SecurityLogFormat.OpenStackAudit,
    );
    expect(event.eventUid).toBe(
      "openstack-audit:6d3e8f6b-9f4a-4d3d-9a6b-1f1b2a3c4d5e",
    );
  });

  test("that worked is a success", () => {
    const event: NormalizedSecurityEvent = one(
      cadf("identity.authenticate", {
        action: "authenticate",
        outcome: "success",
      }),
    );

    expect(event.statusName).toBe("Success");
    expect(event.message).toBe("alice signed in to OpenStack");
  });

  test("still pending says nothing yet", () => {
    expect(
      parse(
        cadf("identity.authenticate", {
          action: "authenticate",
          outcome: "pending",
        }),
      ),
    ).toEqual([]);
  });

  test("names the user by id when it has no name", () => {
    const event: NormalizedSecurityEvent = one(
      cadf("identity.authenticate", {
        outcome: "failure",
        initiator: { id: "hash", user_id: USER_ID },
      }),
    );

    expect(event.principalUser).toBe(USER_ID);
  });

  test("is dated by what it says", () => {
    expect(
      one(
        cadf("identity.authenticate", { outcome: "failure" }),
      ).time.toISOString(),
    ).toBe("2026-10-30T10:00:01.000Z");
  });

  test("is read from a whole log line as well as from JSON on its own", () => {
    const event: NormalizedSecurityEvent = one(
      `2026-10-30 10:00:01.000 1234 INFO oslo.messaging.notification.identity.authenticate [-] ${JSON.stringify(
        cadf("identity.authenticate", { outcome: "failure" }),
      )}`,
    );

    expect(event.statusName).toBe("Failure");
  });
});

describe("a role grant", () => {
  const grant: JSONObject = cadf("identity.role_assignment.created", {
    action: "created.role_assignment",
    outcome: "success",
    role: ROLE_ID,
    project: PROJECT_ID,
    user: "target-user-id",
  });

  test("says who granted what to whom, on what", () => {
    const event: NormalizedSecurityEvent = one(grant);

    expect(event.activityName).toBe("Assign Privileges");
    expect(event.principalUser).toBe("alice");
    expect(event.targetUser).toBe("target-user-id");
    expect(event.targetResource).toBe(describeOpenStackProject(PROJECT_ID));
    expect(event.message).toBe(
      `alice granted role ${ROLE_ID} to target-user-id on project ${PROJECT_ID}`,
    );
    expect(event.severityName).toBe(OcsfSeverity.Medium);
    expect(event.attributes[OpenStackAuditAttribute.RoleId]).toBe(ROLE_ID);
    expect(event.attributes[OpenStackAuditAttribute.ProjectId]).toBe(
      PROJECT_ID,
    );
    expect(event.attributes[OpenStackAuditAttribute.UserId]).toBe(
      "target-user-id",
    );
  });

  test("taken away says so", () => {
    const event: NormalizedSecurityEvent = one(
      cadf("identity.role_assignment.deleted", {
        action: "deleted.role_assignment",
        outcome: "success",
        role: ROLE_ID,
        project: PROJECT_ID,
        user: "target-user-id",
      }),
    );

    expect(event.activityName).toBe("Revoke Privileges");
    expect(event.message).toContain("took role");
  });

  test("on a domain, or to a group", () => {
    const event: NormalizedSecurityEvent = one(
      cadf("identity.role_assignment.created", {
        outcome: "success",
        role: ROLE_ID,
        domain: "domain-id",
        group: "group-id",
      }),
    );

    expect(event.message).toBe(
      `alice granted role ${ROLE_ID} to group group-id on domain domain-id`,
    );
    expect(event.attributes[OpenStackAuditAttribute.DomainId]).toBe(
      "domain-id",
    );
    expect(event.attributes[OpenStackAuditAttribute.GroupId]).toBe("group-id");
  });
});

describe("a change to Keystone's records", () => {
  test("a project created names it, so a case can", () => {
    const event: NormalizedSecurityEvent = one(
      cadf("identity.project.created", {
        action: "created.project",
        outcome: "success",
        resource_info: PROJECT_ID,
      }),
    );

    expect(event.activityName).toBe("created");
    expect(event.attributes[OpenStackAuditAttribute.ProjectId]).toBe(
      PROJECT_ID,
    );
    expect(event.targetResource).toBe(describeOpenStackProject(PROJECT_ID));
    expect(event.message).toBe(`alice created project ${PROJECT_ID}`);
  });

  test("an application credential is worth a security team's attention", () => {
    const event: NormalizedSecurityEvent = one(
      cadf("identity.application_credential.created", {
        action: "created.application_credential",
        outcome: "success",
        resource_info: "credential-id",
      }),
    );

    expect(event.severityName).toBe(OcsfSeverity.Medium);
    expect(event.targetResource).toBe("application credential credential-id");
    expect(event.message).toBe(
      "alice created application credential credential-id",
    );
  });

  test("a user's change is an account change, and names the account", () => {
    const event: NormalizedSecurityEvent = one(
      cadf("identity.user.updated", {
        outcome: "success",
        resource_info: "user-id",
      }),
    );

    expect(event.targetUser).toBe("user-id");
    expect(event.attributes[OpenStackAuditAttribute.UserId]).toBe("user-id");
  });

  test.each(["identity.", "identity.project"])(
    "%s is not one",
    (type: string) => {
      expect(parse(cadf(type, { outcome: "success" }))).toEqual([]);
    },
  );
});

describe("a call through the audit filter", () => {
  function call(payload: JSONObject): JSONObject {
    return cadf("audit.http.response", {
      target: {
        typeURI: "service/compute/servers/action",
        id: "server-id",
        name: "nova",
      },
      requestPath: "/v2.1/servers/server-id/action?secret=dont-keep",
      ...payload,
    });
  }

  test("that changed something says so", () => {
    const event: NormalizedSecurityEvent = one(
      call({ action: "update", outcome: "success" }),
    );

    expect(event.activityName).toBe("update");
    expect(event.statusName).toBe("Success");
    expect(event.principalUser).toBe("alice");
    expect(event.attributes[OpenStackAuditAttribute.TargetId]).toBe(
      "server-id",
    );
    expect(event.attributes[OpenStackAuditAttribute.ProjectId]).toBe(
      PROJECT_ID,
    );
    expect(event.targetResource).toBe(
      `project ${PROJECT_ID} service/compute/servers/action`,
    );
  });

  test("keeps its path without its query string, which can hold anything", () => {
    const event: NormalizedSecurityEvent = one(
      call({ action: "update", outcome: "success" }),
    );

    expect(event.attributes[OpenStackAuditAttribute.RequestPath]).toBe(
      "/v2.1/servers/server-id/action",
    );
    expect(JSON.stringify(event)).not.toContain("dont-keep");
  });

  test("a read is no event: an audit log is mostly reads", () => {
    expect(parse(call({ action: "read", outcome: "success" }))).toEqual([]);
    expect(parse(call({ action: "read/list", outcome: "success" }))).toEqual(
      [],
    );
  });

  test.each(["401", "403"])(
    "a read refused with %s is what someone probing a cloud looks like",
    (code: string) => {
      const event: NormalizedSecurityEvent = one(
        call({
          action: "read/list",
          outcome: "failure",
          reason: { reasonCode: code, reasonType: "Forbidden" },
        }),
      );

      expect(event.severityName).toBe(OcsfSeverity.Medium);
      expect(event.message).toBe(
        `alice was refused read/list on service/compute/servers/action (${code})`,
      );
    },
  );

  test("the request half of a call says nothing: the response has how it went", () => {
    expect(
      parse(
        cadf("audit.http.request", {
          action: "update",
          outcome: "pending",
        }),
      ),
    ).toEqual([]);
  });

  test("with no outcome yet says nothing", () => {
    expect(parse(call({ action: "update", outcome: "pending" }))).toEqual([]);
  });
});

describe("a security group opened to the world", () => {
  function rule(fields: JSONObject): JSONObject {
    return {
      event_type: "security_group_rule.create.end",
      priority: "INFO",
      message_id: "m-1",
      timestamp: "2026-10-30 10:00:00.000000",
      payload: {
        security_group_rule: {
          id: "rule-id",
          security_group_id: "group-id",
          project_id: PROJECT_ID,
          direction: "ingress",
          ethertype: "IPv4",
          protocol: "tcp",
          remote_ip_prefix: "0.0.0.0/0",
          remote_group_id: null,
          port_range_min: 22,
          port_range_max: 22,
          ...fields,
        },
      },
    };
  }

  const WHO: JSONObject = {
    ...CLOUD_ATTRIBUTES,
    "openstack.user_name": "alice",
    "openstack.user_id": USER_ID,
    "openstack.request_id": "req-1",
  };

  test("on a sensitive port is high, and names the door", () => {
    const event: NormalizedSecurityEvent = one(rule({}), WHO);

    expect(event.severityName).toBe(OcsfSeverity.High);
    expect(event.message).toBe(
      `alice opened security group group-id to 0.0.0.0/0 on port 22 in project ${PROJECT_ID}`,
    );
    expect(event.targetPort).toBe(22);
    expect(event.attributes[OpenStackAuditAttribute.Signal]).toBe(
      OpenStackAuditSignal.SecurityGroupOpenSensitive,
    );
    expect(event.attributes[OpenStackAuditAttribute.OpenPort]).toBe("22");
    expect(event.attributes[OpenStackAuditAttribute.InitiatorName]).toBe(
      "alice",
    );
    expect(event.attributes[OpenStackAuditAttribute.TargetId]).toBe("group-id");
    expect(event.attributes[OpenStackAuditAttribute.ProjectId]).toBe(
      PROJECT_ID,
    );
    expect(event.targetResource).toBe(
      `project ${PROJECT_ID} security group group-id`,
    );
  });

  test("a range holding a sensitive port names it", () => {
    const event: NormalizedSecurityEvent = one(
      rule({ port_range_min: 3000, port_range_max: 3500 }),
    );

    expect(event.attributes[OpenStackAuditAttribute.OpenPort]).toBe("3306");
    expect(event.message).toContain("ports 3000 to 3500");
  });

  test("no ports named means every port", () => {
    const event: NormalizedSecurityEvent = one(
      rule({ port_range_min: null, port_range_max: null }),
    );

    expect(event.attributes[OpenStackAuditAttribute.Signal]).toBe(
      OpenStackAuditSignal.SecurityGroupOpenSensitive,
    );
    expect(event.message).toContain("every port");
  });

  test("on an ordinary port is worth a note, not an alarm", () => {
    const event: NormalizedSecurityEvent = one(
      rule({ port_range_min: 443, port_range_max: 443 }),
    );

    expect(event.severityName).toBe(OcsfSeverity.Informational);
    expect(event.attributes[OpenStackAuditAttribute.Signal]).toBe(
      OpenStackAuditSignal.SecurityGroupOpen,
    );
  });

  test("ICMP's numbers are its type and code, and hold no port", () => {
    const event: NormalizedSecurityEvent = one(
      rule({ protocol: "icmp", port_range_min: 22, port_range_max: 22 }),
    );

    expect(event.attributes[OpenStackAuditAttribute.Signal]).toBe(
      OpenStackAuditSignal.SecurityGroupOpen,
    );
  });

  test.each([
    [{ direction: "egress" }],
    [{ remote_ip_prefix: "10.0.0.0/8" }],
    [{ remote_group_id: "other-group", remote_ip_prefix: null }],
    [{ remote_address_group_id: "addresses", remote_ip_prefix: null }],
  ])("%j is no opening", (fields: JSONObject) => {
    expect(parse(rule(fields))).toEqual([]);
  });

  test.each([["0.0.0.0/0"], ["::/0"], [null]])(
    "from %j is from everywhere",
    (prefix: string | null) => {
      expect(
        isOpenStackRuleOpenToWorld({
          direction: "ingress",
          remote_ip_prefix: prefix,
        }),
      ).toBe(true);
    },
  );

  test.each([
    [22, null, null, true],
    [22, 22, 22, true],
    [22, 20, 25, true],
    [22, 23, 25, false],
    [22, 22, null, true],
    [22, null, 22, true],
  ])(
    "port %i against %j to %j",
    (port: number, min: number | null, max: number | null, inside: boolean) => {
      expect(isOpenStackPortInRule({ port, min, max })).toBe(inside);
    },
  );
});

describe("an image published", () => {
  function image(type: string, visibility: string): JSONObject {
    return {
      event_type: type,
      priority: "INFO",
      message_id: "m-2",
      timestamp: "2026-10-30 10:00:00.000000",
      payload: {
        id: "image-id",
        name: "golden",
        owner: PROJECT_ID,
        visibility,
      },
    };
  }

  test.each(["image.create", "image.update", "image.activate"])(
    "%s, made public, says so",
    (type: string) => {
      const event: NormalizedSecurityEvent = one(image(type, "public"), {
        ...CLOUD_ATTRIBUTES,
        "openstack.user_name": "alice",
      });

      expect(event.message).toBe("alice made image golden public");
      expect(event.attributes[OpenStackAuditAttribute.Signal]).toBe(
        OpenStackAuditSignal.ImagePublic,
      );
      expect(event.attributes[OpenStackAuditAttribute.ProjectId]).toBe(
        PROJECT_ID,
      );
    },
  );

  test.each(["private", "shared", "community"])(
    "%s is not published",
    (visibility: string) => {
      expect(parse(image("image.update", visibility))).toEqual([]);
    },
  );

  test("another image event says nothing", () => {
    expect(parse(image("image.send", "public"))).toEqual([]);
  });
});

describe("what never gets stored", () => {
  const LEAKING: JSONObject = cadf("identity.authenticate", {
    outcome: "failure",
    action: "authenticate",
    attachments: [
      {
        typeURI: "mime:application/json",
        name: "partial_password_hash",
        content: PASSWORD_HASH,
      },
    ],
    requestPayload: '{"password":"REQUEST-BODY-MUST-NOT-STAY"}',
    responsePayload: "RESPONSE-BODY-MUST-NOT-STAY",
    reqPayload: "ANOTHER-BODY-MUST-NOT-STAY",
    newFieldNextReleaseAdds: "NEW-FIELD-MUST-NOT-STAY",
  });

  test("a credential, a password's hash or a body, in any event", () => {
    const text: string = JSON.stringify(one(LEAKING));

    expect(text).not.toContain(CREDENTIAL_TOKEN);
    expect(text).not.toContain(PASSWORD_HASH);
    expect(text).not.toContain("MUST-NOT-STAY");
  });

  test.each([
    ["identity.role_assignment.created", { outcome: "success", role: "r" }],
    ["identity.project.created", { outcome: "success", resource_info: "p" }],
    ["audit.http.response", { outcome: "success", action: "update" }],
  ])("%s", (type: string, payload: JSONObject) => {
    const text: string = JSON.stringify(
      one(
        cadf(type, {
          ...payload,
          requestPayload: "BODY-MUST-NOT-STAY",
          attachments: [{ content: PASSWORD_HASH }],
        }),
      ),
    );

    expect(text).not.toContain(CREDENTIAL_TOKEN);
    expect(text).not.toContain(PASSWORD_HASH);
    expect(text).not.toContain("BODY-MUST-NOT-STAY");
  });

  test("the event holds only the fields named here, whatever else arrives", () => {
    const event: NormalizedSecurityEvent = one(LEAKING);
    // What every source's event has: which parser it came from, and what it came from.
    const names: Array<string> = Object.keys(event.attributes).filter(
      (key: string): boolean => {
        return (
          key !== SECURITY_LOG_FORMAT_ATTRIBUTE && !key.startsWith("oneuptime.")
        );
      },
    );
    const allowed: Array<string> = Object.values(OpenStackAuditAttribute);

    for (const name of names) {
      expect(allowed).toContain(name);
    }
  });

  test("a body too long to be a notification is not read", () => {
    expect(
      readOpenStackAuditNotification(
        `{"event_type": "identity.authenticate", "x": "${"a".repeat(3_000_000)}"}`,
      ),
    ).toBeNull();
  });
});

describe("what is not an audit event", () => {
  test.each([
    "",
    "plain text",
    '{"event_type": "x"}',
    '{"event_type": "x", "payload": "text"}',
    '{"event_type": 12, "payload": {}}',
    '{"event_type": "instance.create.end", "payload": {"nova_object.data": {}}}',
    '"event_type" but no JSON',
    '{"event_type": "identity.authenticate", not json',
  ])("%j", (body: string) => {
    expect(parse(body)).toEqual([]);
  });

  test("an identity event that is not CADF is not trusted as one", () => {
    expect(
      parse(
        cadf("identity.authenticate", {
          typeURI: "not-cadf",
          outcome: "failure",
        }),
      ),
    ).toEqual([]);
  });
});

describe("the log scan", () => {
  test("reads every line that makes an event, and the common parser reaches this one", () => {
    const body: string = JSON.stringify(
      cadf("identity.authenticate", { outcome: "failure" }),
    );

    expect(matchesSecurityLogPrefilter(body)).toBe(true);

    const events: Array<NormalizedSecurityEvent> = SecurityLogParser.parse(
      logLine(body, CLOUD_ATTRIBUTES),
    );

    expect(events).toHaveLength(1);
    expect(events[0]?.attributes[SECURITY_LOG_FORMAT_ATTRIBUTE]).toBe(
      SecurityLogFormat.OpenStackAudit,
    );
  });

  test.each([
    cadf("identity.role_assignment.created", { outcome: "success" }),
    cadf("audit.http.response", { outcome: "success", action: "update" }),
    {
      event_type: "security_group_rule.create.end",
      payload: { security_group_rule: { direction: "ingress" } },
    },
    {
      event_type: "image.update",
      payload: { id: "i", visibility: "public" },
    },
  ])("the prefilter asks for %#", (message: JSONObject) => {
    expect(matchesSecurityLogPrefilter(JSON.stringify(message))).toBe(true);
    // As oslo.messaging's log driver writes it, with spaces.
    expect(matchesSecurityLogPrefilter(JSON.stringify(message, null, 1))).toBe(
      true,
    );
  });

  test("the prefilter's words all hold what every one of them requires", () => {
    for (const word of OPENSTACK_AUDIT_PREFILTER_WORDS) {
      expect(
        word.startsWith(OPENSTACK_AUDIT_PREFILTER_REQUIRES) ||
          word.startsWith('"visibility"'),
      ).toBe(true);
    }
  });

  test("the rest of a cloud's lines are not asked for", () => {
    expect(
      matchesSecurityLogPrefilter(
        "2026-10-30 10:00:00.123 1234 INFO nova.compute.manager [-] Took 3 seconds to build",
      ),
    ).toBe(false);
  });
});

describe("the rule library's detections", () => {
  function rule(title: string): SigmaRule {
    const entry: DetectionRuleLibraryEntry | undefined =
      DETECTION_RULE_LIBRARY.find(
        (candidate: DetectionRuleLibraryEntry): boolean => {
          return candidate.title === title;
        },
      );

    if (!entry) {
      throw new Error(`No library rule titled ${title}`);
    }

    return SigmaRuleParser.parse(entry.sigmaRuleYaml);
  }

  const FAILED: JSONObject = cadf("identity.authenticate", {
    outcome: "failure",
    action: "authenticate",
  });

  function protectedGrant(projectName: string): NormalizedSecurityEvent {
    const event: NormalizedSecurityEvent = one(
      cadf("identity.role_assignment.created", {
        outcome: "success",
        role: ROLE_ID,
        project: PROJECT_ID,
        user: "u",
      }),
    );

    event.attributes[OpenStackAuditAttribute.ProjectName] = projectName;

    return event;
  }

  function ruleOf(
    fields: JSONObject,
    attributes: JSONObject = CLOUD_ATTRIBUTES,
  ): NormalizedSecurityEvent {
    return one(
      {
        event_type: "security_group_rule.create.end",
        message_id: "m-3",
        payload: {
          security_group_rule: {
            direction: "ingress",
            protocol: "tcp",
            remote_ip_prefix: "0.0.0.0/0",
            security_group_id: "group-id",
            ...fields,
          },
        },
      },
      attributes,
    );
  }

  test("every OpenStack rule reads only the attributes the parser keeps", () => {
    const rules: Array<DetectionRuleLibraryEntry> =
      DETECTION_RULE_LIBRARY.filter(
        (entry: DetectionRuleLibraryEntry): boolean => {
          return entry.dataKind === DetectionRuleDataKind.OpenStackAuditTrail;
        },
      );
    const kept: Array<string> = Object.values(OpenStackAuditAttribute);

    expect(rules).toHaveLength(6);

    for (const entry of rules) {
      for (const match of entry.sigmaRuleYaml.matchAll(
        /openstack\.audit\.[a-z_]+/g,
      )) {
        expect(kept).toContain(match[0]);
      }

      if (entry.groupByField) {
        expect(kept).toContain(entry.groupByField);
      }
    }
  });

  test("failed logins fire the burst, and a login that worked does not", () => {
    const burst: SigmaRule = rule("OpenStack failed logins burst");

    expect(sigmaRuleMatchesEvent(burst, one(FAILED))).toBe(true);
    expect(
      sigmaRuleMatchesEvent(
        burst,
        one(cadf("identity.authenticate", { outcome: "success" })),
      ),
    ).toBe(false);
  });

  test("a role granted on a protected project fires, by the project's name", () => {
    const granted: SigmaRule = rule(
      "OpenStack role granted on a protected project",
    );

    expect(sigmaRuleMatchesEvent(granted, protectedGrant("admin"))).toBe(true);
    expect(sigmaRuleMatchesEvent(granted, protectedGrant("service"))).toBe(
      true,
    );
    expect(sigmaRuleMatchesEvent(granted, protectedGrant("payments"))).toBe(
      false,
    );
  });

  test("an application credential fires on being created", () => {
    const created: SigmaRule = rule("OpenStack application credential created");

    expect(
      sigmaRuleMatchesEvent(
        created,
        one(
          cadf("identity.application_credential.created", {
            outcome: "success",
            resource_info: "c",
          }),
        ),
      ),
    ).toBe(true);
    expect(
      sigmaRuleMatchesEvent(
        created,
        one(
          cadf("identity.application_credential.deleted", {
            outcome: "success",
            resource_info: "c",
          }),
        ),
      ),
    ).toBe(false);
  });

  test("a security group opened on a sensitive port fires, and an ordinary port does not", () => {
    const opened: SigmaRule = rule(
      "OpenStack security group opened to the world",
    );

    expect(
      sigmaRuleMatchesEvent(
        opened,
        ruleOf({ port_range_min: 22, port_range_max: 22 }),
      ),
    ).toBe(true);
    expect(
      sigmaRuleMatchesEvent(
        opened,
        ruleOf({ port_range_min: 443, port_range_max: 443 }),
      ),
    ).toBe(false);
  });

  test("an image made public fires", () => {
    expect(
      sigmaRuleMatchesEvent(
        rule("OpenStack public image published"),
        one({
          event_type: "image.update",
          payload: { id: "i", name: "golden", visibility: "public" },
        }),
      ),
    ).toBe(true);
  });

  test("the admin account's sign-in is what a new address is looked for on", () => {
    const entry: DetectionRuleLibraryEntry | undefined =
      DETECTION_RULE_LIBRARY.find(
        (candidate: DetectionRuleLibraryEntry): boolean => {
          return (
            candidate.title ===
            "OpenStack admin credential used from a new address"
          );
        },
      );

    expect(entry?.sigmaRuleYaml).toContain("type: new_value");
    expect(entry?.sigmaRuleYaml).toContain(
      `field: ${OpenStackAuditAttribute.InitiatorAddress}`,
    );

    const signIn: NormalizedSecurityEvent = one(
      cadf("identity.authenticate", {
        outcome: "success",
        initiator: {
          id: "hash",
          username: "admin",
          host: { address: "203.0.113.7" },
        },
      }),
    );

    expect(signIn.attributes[OpenStackAuditAttribute.InitiatorName]).toBe(
      "admin",
    );
    expect(signIn.attributes[OpenStackAuditAttribute.InitiatorAddress]).toBe(
      "203.0.113.7",
    );
  });
});

describe("whatever arrives, nothing throws", () => {
  test.each(
    generatedTexts(2000, 5741, [
      '"event_type"',
      '"identity.authenticate"',
      '"payload"',
      '"typeURI"',
      '"http://schemas.dmtf.org/cloud/audit/1.0/event"',
      '"initiator"',
      '"outcome"',
      '"failure"',
      '"security_group_rule"',
      "{",
      "}",
      "[",
      "]",
      ":",
      ",",
      "null",
      "1",
      '"',
      "\\",
    ]).map((text: string, index: number): [number, string] => {
      return [index, text];
    }),
  )("generated %i", (_index: number, text: string) => {
    expect(Array.isArray(parse(text))).toBe(true);
  });

  test("however its fields are shaped", () => {
    const shapes: Array<unknown> = [null, 1, "x", [], {}, true];

    for (const shape of shapes) {
      for (const key of [
        "initiator",
        "target",
        "reason",
        "attachments",
        "outcome",
        "action",
        "security_group_rule",
      ]) {
        expect(
          Array.isArray(
            parse(
              cadf("identity.authenticate", {
                outcome: "failure",
                [key]: shape as JSONObject,
              }),
            ),
          ),
        ).toBe(true);
      }
    }
  });
});
