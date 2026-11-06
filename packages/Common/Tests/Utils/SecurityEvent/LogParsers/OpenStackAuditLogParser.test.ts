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
import { DetectionRuleDefinition } from "../../../../Types/SecurityEvent/SigmaCorrelation";
import SigmaRuleSetParser from "../../../../Utils/SecurityEvent/Sigma/SigmaRuleSetParser";
import SecurityLogFormat, {
  SECURITY_LOG_FORMAT_ATTRIBUTE,
} from "../../../../Types/SecurityEvent/SecurityLogFormat";
import OpenStackAuditLogParser, {
  OPENSTACK_AUDIT_PREFILTER_REQUIRES,
  OPENSTACK_AUDIT_PREFILTER_WORDS,
  OpenStackAuditAttribute,
  OpenStackAuditSignal,
  describeOpenStackPart,
  describeOpenStackProject,
  describeOpenStackUser,
  isOpenStackPortInRule,
  isOpenStackRuleOpenToWorld,
  readOpenStackAuditNotification,
  readOpenStackPartOfPath,
} from "../../../../Utils/SecurityEvent/LogParsers/OpenStackAuditLogParser";
import { OpenStackResourceKind } from "../../../../Types/OpenStack/OpenStackResourceKind";
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
 * HAND-WRITTEN FIXTURES, in the shape of what real clouds recorded, for what a recording cannot
 * say: every shape a field can come in. OpenStackAuditRecordings.test.ts reads what the services
 * really sent, and proves the same things on those.
 */

const CLOUD_ATTRIBUTES: JSONObject = {
  "resource.openstack.cloud.name": "production",
};

const CREDENTIAL_TOKEN: string = "gAAAAABpartofatoken-MUST-NOT-STAY";
const PASSWORD_HASH: string = "PARTIAL-PASSWORD-HASH-MUST-NOT-STAY";
const USER_ID: string = "0123456789abcdef0123456789abcdef";
const PROJECT_ID: string = "fedcba9876543210fedcba9876543210";
const ROLE_ID: string = "aaaabbbbccccddddeeeeffff00001111";
const INSTANCE_ID: string = "bcee0abb-08c3-430a-9a53-cce3284714eb";
const VOLUME_ID: string = "0a188b56-1c4a-4a19-9340-8cc48f11774e";

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

  test("for a user who does not exist names what was typed, and no ID made up from it", () => {
    const event: NormalizedSecurityEvent = one(
      cadf("identity.authenticate", {
        outcome: "failure",
        reason: {
          reasonCode: "404",
          reasonType: "Could not find user: ou-nobody.",
        },
        initiator: {
          id: "538d0206-1d02-5dc9-a264-2dc9b75bc163",
          user_name: "ou-nobody",
          domain_id: "default",
          host: { address: "203.0.113.7" },
        },
      }),
    );

    expect(event.principalUser).toBe("ou-nobody");
    expect(event.message).toBe("ou-nobody failed to sign in to OpenStack");
    expect(
      event.attributes[OpenStackAuditAttribute.InitiatorId],
    ).toBeUndefined();
    expect(event.attributes[OpenStackAuditAttribute.Reason]).toBe(
      "Could not find user: ou-nobody.",
    );
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

  test("its target is the project, and not the UUID the event makes up", () => {
    const event: NormalizedSecurityEvent = one(grant);

    expect(event.attributes[OpenStackAuditAttribute.TargetId]).toBe(PROJECT_ID);
    expect(event.attributes[OpenStackAuditAttribute.TargetType]).toBe(
      "project",
    );
    expect(event.attributes[OpenStackAuditAttribute.PartId]).toBe(PROJECT_ID);
    expect(event.attributes[OpenStackAuditAttribute.PartKind]).toBe(
      OpenStackResourceKind.Project,
    );
  });

  test("names the project for a case, and the user it has only an ID for", () => {
    const event: NormalizedSecurityEvent = one(
      cadf("identity.role_assignment.created", {
        outcome: "success",
        role: ROLE_ID,
        project: PROJECT_ID,
        user: USER_ID,
      }),
    );

    expect(event.observables).toContain(describeOpenStackProject(PROJECT_ID));
    expect(event.observables).toContain(describeOpenStackUser(USER_ID));
    expect(event.observables).not.toContain(USER_ID);
  });

  test("handed down to a domain's projects says so", () => {
    const event: NormalizedSecurityEvent = one(
      cadf("identity.role_assignment.created", {
        outcome: "success",
        role: ROLE_ID,
        domain: "domain-id",
        user: "u",
        inherited_to_projects: true,
      }),
    );

    expect(event.message).toBe(
      `alice granted role ${ROLE_ID} to u on domain domain-id, and every project under it`,
    );
    expect(event.attributes[OpenStackAuditAttribute.TargetType]).toBe("domain");
  });

  test("on the system says so", () => {
    const event: NormalizedSecurityEvent = one(
      cadf("identity.role_assignment.created", {
        outcome: "success",
        role: ROLE_ID,
        user: "u",
      }),
    );

    expect(event.message).toBe(
      `alice granted role ${ROLE_ID} to u on the system`,
    );
    expect(event.attributes[OpenStackAuditAttribute.TargetType]).toBe("system");
  });

  test("with no initiator, as a grant handed down has none, says who from its line", () => {
    const named: NormalizedSecurityEvent = one(
      cadf("identity.role_assignment.created", {
        outcome: "success",
        role: ROLE_ID,
        domain: "default",
        user: "u",
        inherited_to_projects: true,
        initiator: undefined as unknown as JSONObject,
      }),
      { ...CLOUD_ATTRIBUTES, "openstack.user_name": "alice" },
    );
    const byId: NormalizedSecurityEvent = one(
      cadf("identity.role_assignment.created", {
        outcome: "success",
        role: ROLE_ID,
        domain: "default",
        user: "u",
        initiator: undefined as unknown as JSONObject,
      }),
      { ...CLOUD_ATTRIBUTES, "openstack.user_id": USER_ID },
    );

    expect(named.principalUser).toBe("alice");
    expect(byId.principalUser).toBe(USER_ID);
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

  test("a trust is named as Keystone's extension does not, and is worth attention", () => {
    const event: NormalizedSecurityEvent = one(
      cadf("identity.OS-TRUST:trust.created", {
        action: "created.OS-TRUST:trust",
        outcome: "success",
        resource_info: "trust-id",
      }),
    );

    expect(event.severityName).toBe(OcsfSeverity.Medium);
    expect(event.message).toBe("alice created trust trust-id");
    expect(event.targetResource).toBe("trust trust-id");
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
  // As a cloud whose endpoints have no port of their own records it.
  function call(payload: JSONObject): JSONObject {
    return cadf("audit.http.response", {
      target: { typeURI: "unknown", id: "unknown", name: "unknown" },
      initiator: {
        typeURI: "service/security/account/user",
        id: USER_ID,
        name: "alice",
        project_id: PROJECT_ID,
        host: { address: "203.0.113.7", agent: "openstacksdk/4.4.1" },
        credential: { token: "***", identity_status: "Confirmed" },
      },
      observer: { id: "target" },
      requestPath: `/compute/v2.1/servers/${INSTANCE_ID}/action?secret=dont-keep`,
      ...payload,
    });
  }

  test("that changed something says who did what, to which part", () => {
    const event: NormalizedSecurityEvent = one(
      call({ action: "update/os-stop", outcome: "success" }),
    );

    expect(event.activityName).toBe("update/os-stop");
    expect(event.statusName).toBe("Success");
    expect(event.principalUser).toBe("alice");
    expect(event.principalIp).toBe("203.0.113.7");
    expect(event.message).toBe(
      `alice update/os-stop on ${describeOpenStackPart(
        OpenStackResourceKind.Instance,
        INSTANCE_ID,
      )}`,
    );
    expect(event.attributes[OpenStackAuditAttribute.PartId]).toBe(INSTANCE_ID);
    expect(event.attributes[OpenStackAuditAttribute.PartKind]).toBe(
      OpenStackResourceKind.Instance,
    );
    expect(event.attributes[OpenStackAuditAttribute.ProjectId]).toBe(
      PROJECT_ID,
    );
    expect(event.targetResource).toBe(
      `project ${PROJECT_ID} instance ${INSTANCE_ID}`,
    );
  });

  test("names the project and the part for a case", () => {
    const event: NormalizedSecurityEvent = one(
      call({ action: "delete", outcome: "success" }),
    );

    expect(event.observables).toContain(describeOpenStackProject(PROJECT_ID));
    expect(event.observables).toContain(`instance ${INSTANCE_ID}`);
  });

  test("what pyCADF does not know is not kept as if it did", () => {
    const event: NormalizedSecurityEvent = one(
      call({ action: "update", outcome: "success" }),
    );

    expect(
      event.attributes[OpenStackAuditAttribute.TargetType],
    ).toBeUndefined();
    expect(event.attributes[OpenStackAuditAttribute.TargetId]).toBeUndefined();
    expect(
      event.attributes[OpenStackAuditAttribute.TargetName],
    ).toBeUndefined();
    expect(event.message).not.toContain("unknown");
  });

  test("with nobody behind it says someone, and names nobody", () => {
    const event: NormalizedSecurityEvent = one(
      call({
        action: "update",
        outcome: "success",
        initiator: {
          id: "unknown",
          name: "unknown",
          project_id: "unknown",
          host: { address: "203.0.113.7" },
        },
      }),
    );

    expect(event.principalUser).toBe("");
    expect(event.message).toContain("Someone update on instance");
    expect(event.attributes[OpenStackAuditAttribute.ProjectId]).toBeUndefined();
    expect(event.targetResource).toBe(`instance ${INSTANCE_ID}`);
  });

  test("on a path with no part in it says the path", () => {
    const event: NormalizedSecurityEvent = one(
      call({
        action: "create",
        outcome: "success",
        requestPath: "/compute/v2.1/servers",
      }),
    );

    expect(event.message).toBe("alice create on /compute/v2.1/servers");
    expect(event.attributes[OpenStackAuditAttribute.PartId]).toBeUndefined();
  });

  test("where the catalog was found says the target's type, when no part is in the path", () => {
    const event: NormalizedSecurityEvent = one(
      call({
        action: "create",
        outcome: "success",
        requestPath: "/networking/v2.0/ports",
        target: {
          typeURI: "service/network/ports",
          id: "service-id",
          name: "neutron",
        },
      }),
    );

    expect(event.message).toBe("alice create on service/network/ports");
    expect(event.attributes[OpenStackAuditAttribute.TargetId]).toBe(
      "service-id",
    );
  });

  test("a part the inventory has no row for is still named, with no kind", () => {
    const event: NormalizedSecurityEvent = one(
      call({
        action: "update",
        outcome: "success",
        requestPath: `/networking/v2.0/ports/${VOLUME_ID}`,
      }),
    );

    expect(event.message).toBe(`alice update on port ${VOLUME_ID}`);
    expect(event.attributes[OpenStackAuditAttribute.PartId]).toBe(VOLUME_ID);
    expect(event.attributes[OpenStackAuditAttribute.PartKind]).toBeUndefined();
  });

  test("keeps its path without its query string, which can hold anything", () => {
    const event: NormalizedSecurityEvent = one(
      call({ action: "update", outcome: "success" }),
    );

    expect(event.attributes[OpenStackAuditAttribute.RequestPath]).toBe(
      `/compute/v2.1/servers/${INSTANCE_ID}/action`,
    );
    expect(JSON.stringify(event)).not.toContain("dont-keep");
  });

  test("a read is no event: an audit log is mostly reads", () => {
    expect(parse(call({ action: "read", outcome: "success" }))).toEqual([]);
    expect(parse(call({ action: "read/list", outcome: "success" }))).toEqual(
      [],
    );
  });

  test("a read that found nothing is no event: every lookup by name is one", () => {
    expect(
      parse(
        call({
          action: "read",
          outcome: "failure",
          reason: { reasonCode: "404", reasonType: "HTTP" },
          requestPath: "/compute/v2.1/servers/ou-log-vm",
        }),
      ),
    ).toEqual([]);
  });

  test.each(["401", "403"])(
    "a read refused with %s is what someone probing a cloud looks like",
    (code: string) => {
      const event: NormalizedSecurityEvent = one(
        call({
          action: "read/list",
          outcome: "failure",
          reason: { reasonCode: code, reasonType: "HTTP" },
          requestPath: "/compute/v2.1/servers/detail",
        }),
      );

      expect(event.severityName).toBe(OcsfSeverity.Medium);
      expect(event.message).toBe(
        `alice was refused read/list on /compute/v2.1/servers/detail (${code})`,
      );
    },
  );

  test("a change refused says what it was refused on", () => {
    const event: NormalizedSecurityEvent = one(
      call({
        action: "update/os-migrateLive",
        outcome: "failure",
        reason: { reasonCode: "403", reasonType: "HTTP" },
      }),
    );

    expect(event.statusName).toBe("Failure");
    expect(event.message).toBe(
      `alice was refused update/os-migrateLive on instance ${INSTANCE_ID} (403)`,
    );
  });

  test("what the services tell one another is nobody's doing", () => {
    expect(
      parse(
        call({
          action: "update",
          outcome: "success",
          requestPath: "/compute/v2.1/os-server-external-events",
        }),
      ),
    ).toEqual([]);
  });

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

describe("the part a path names", () => {
  test.each([
    [
      `/compute/v2.1/servers/${INSTANCE_ID}`,
      "instance",
      OpenStackResourceKind.Instance,
      INSTANCE_ID,
    ],
    [
      `/v2.1/servers/${INSTANCE_ID}/action`,
      "instance",
      OpenStackResourceKind.Instance,
      INSTANCE_ID,
    ],
    // A volume detached from an instance is about the instance first.
    [
      `/compute/v2.1/servers/${INSTANCE_ID}/os-volume_attachments/${VOLUME_ID}`,
      "instance",
      OpenStackResourceKind.Instance,
      INSTANCE_ID,
    ],
    // A project's ID in a path is no part, and has no dashes.
    [
      `/v3/${PROJECT_ID}/volumes/${VOLUME_ID}/action`,
      "volume",
      OpenStackResourceKind.Volume,
      VOLUME_ID,
    ],
    [
      `/volume/v3/snapshots/${VOLUME_ID}`,
      "snapshot",
      OpenStackResourceKind.Snapshot,
      VOLUME_ID,
    ],
    [
      `/volume/v3/backups/${VOLUME_ID}`,
      "backup",
      OpenStackResourceKind.Backup,
      VOLUME_ID,
    ],
    [
      `/v2/images/${VOLUME_ID}/file`,
      "image",
      OpenStackResourceKind.Image,
      VOLUME_ID,
    ],
    [
      `/networking/v2.0/networks/${VOLUME_ID}`,
      "network",
      OpenStackResourceKind.Network,
      VOLUME_ID,
    ],
    [
      `/networking/v2.0/subnets/${VOLUME_ID}`,
      "subnet",
      OpenStackResourceKind.Subnet,
      VOLUME_ID,
    ],
    [
      `/networking/v2.0/routers/${VOLUME_ID}/add_router_interface`,
      "router",
      OpenStackResourceKind.Router,
      VOLUME_ID,
    ],
    [
      `/networking/v2.0/floatingips/${VOLUME_ID}`,
      "floating IP",
      OpenStackResourceKind.FloatingIp,
      VOLUME_ID,
    ],
    [`/networking/v2.0/ports/${VOLUME_ID}`, "port", undefined, VOLUME_ID],
    [
      `/networking/v2.0/security-groups/${VOLUME_ID}`,
      "security group",
      undefined,
      VOLUME_ID,
    ],
    [
      `/compute/v2.1/os-services/${VOLUME_ID}`,
      "compute service",
      undefined,
      VOLUME_ID,
    ],
  ])(
    "%s",
    (
      path: string,
      noun: string,
      kind: OpenStackResourceKind | undefined,
      id: string,
    ) => {
      const part: ReturnType<typeof readOpenStackPartOfPath> =
        readOpenStackPartOfPath(path);

      expect(part?.noun).toBe(noun);
      expect(part?.kind).toBe(kind);
      expect(part?.id).toBe(id);
    },
  );

  test.each([
    "",
    "/",
    "/compute/v2.1/servers",
    "/compute/v2.1/servers/detail",
    "/compute/v2.1/servers/ou-log-vm",
    "/compute/v2.1/os-server-external-events",
    `/compute/v2.1/flavors/${VOLUME_ID}`,
    `/${VOLUME_ID}`,
  ])("%j names none", (path: string) => {
    expect(readOpenStackPartOfPath(path)).toBeNull();
  });

  test("however many words a path holds, it is read once", () => {
    const words: string = "/servers".repeat(100000);

    expect(readOpenStackPartOfPath(words)).toBeNull();
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
    expect(event.message).toContain("for icmp");
    expect(event.targetPort).toBe(0);
  });

  test("ICMP with no numbers at all says so, and not port null", () => {
    const event: NormalizedSecurityEvent = one(
      rule({ protocol: "icmp", port_range_min: null, port_range_max: null }),
    );

    expect(event.message).toContain("for icmp");
    expect(event.message).not.toContain("null");
  });

  test.each(["udp", "sctp", "dccp", "udplite", "6", "17", "33", "132", "136"])(
    "%s's numbers are ports",
    (protocol: string) => {
      const event: NormalizedSecurityEvent = one(
        rule({ protocol, port_range_min: 53, port_range_max: 3389 }),
      );

      expect(event.attributes[OpenStackAuditAttribute.Signal]).toBe(
        OpenStackAuditSignal.SecurityGroupOpenSensitive,
      );
    },
  );

  test("one number of the two is that port, and never null", () => {
    expect(one(rule({ port_range_max: null })).message).toContain("on port 22");
    expect(one(rule({ port_range_min: null })).message).toContain("on port 22");
  });

  test("any protocol at all, with no ports, is every port", () => {
    const event: NormalizedSecurityEvent = one(
      rule({ protocol: null, port_range_min: null, port_range_max: null }),
    );

    expect(event.attributes[OpenStackAuditAttribute.Signal]).toBe(
      OpenStackAuditSignal.SecurityGroupOpenSensitive,
    );
    expect(event.message).toContain("on every port");
  });

  test("names the project for a case", () => {
    expect(one(rule({})).observables).toContain(
      describeOpenStackProject(PROJECT_ID),
    );
  });

  test("who did it, by ID where a cloud's lines give no name", () => {
    const event: NormalizedSecurityEvent = one(rule({}), {
      ...CLOUD_ATTRIBUTES,
      "openstack.user_id": USER_ID,
    });

    expect(event.principalUser).toBe(USER_ID);
    expect(event.observables).toContain(describeOpenStackUser(USER_ID));
    expect(event.message).toContain(`${USER_ID} opened security group`);
  });

  describe("several in one notification, as a list of rules makes", () => {
    function bulk(rules: Array<JSONObject>): JSONObject {
      return {
        event_type: "security_group_rule.create.end",
        message_id: "m-bulk",
        timestamp: "2026-10-30 10:00:00.000000",
        payload: { security_group_rules: rules },
      };
    }

    const OPEN: JSONObject = {
      security_group_id: "group-id",
      project_id: PROJECT_ID,
      direction: "ingress",
      protocol: "tcp",
      remote_ip_prefix: "0.0.0.0/0",
      port_range_min: 6379,
      port_range_max: 6379,
    };

    test("each is an event of its own, with an ID of its own", () => {
      const events: Array<NormalizedSecurityEvent> = parse(
        bulk([OPEN, { ...OPEN, port_range_min: 3306, port_range_max: 3306 }]),
      );

      expect(events).toHaveLength(2);
      expect(events[0]?.eventUid).toBe("openstack-audit:m-bulk:0");
      expect(events[1]?.eventUid).toBe("openstack-audit:m-bulk:1");
      expect(events[0]?.targetPort).toBe(6379);
      expect(events[1]?.targetPort).toBe(3306);
    });

    test("only those open to the world are events", () => {
      expect(
        parse(
          bulk([
            { ...OPEN, remote_ip_prefix: "10.0.0.0/8" },
            OPEN,
            { ...OPEN, direction: "egress" },
          ]),
        ),
      ).toHaveLength(1);
    });

    test.each([[[]], [[null, 1, "x"]]])("%j makes none", (rules: unknown) => {
      expect(parse(bulk(rules as Array<JSONObject>))).toEqual([]);
    });

    test("a notification of a great many is held to a number", () => {
      expect(parse(bulk(new Array(1000).fill(OPEN))).length).toBe(200);
    });
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

describe("an image that is public", () => {
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

  test.each([
    ["image.create", "created"],
    ["image.update", "changed"],
    ["image.activate", "activated"],
  ])(
    "%s says what was done, and no more than it knows",
    (type: string, verb: string) => {
      const event: NormalizedSecurityEvent = one(image(type, "public"), {
        ...CLOUD_ATTRIBUTES,
        "openstack.user_name": "alice",
      });

      expect(event.message).toBe(`alice ${verb} public image golden`);
      expect(event.attributes[OpenStackAuditAttribute.Signal]).toBe(
        OpenStackAuditSignal.ImagePublic,
      );
      expect(event.attributes[OpenStackAuditAttribute.ProjectId]).toBe(
        PROJECT_ID,
      );
      expect(event.attributes[OpenStackAuditAttribute.PartId]).toBe("image-id");
      expect(event.attributes[OpenStackAuditAttribute.PartKind]).toBe(
        OpenStackResourceKind.Image,
      );
      expect(event.observables).toContain(describeOpenStackProject(PROJECT_ID));
      expect(event.observables).toContain("image golden");
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

describe("what can follow a notification on its line", () => {
  const LINE: string = `INFO oslo.messaging.notification.identity.authenticate [-] ${JSON.stringify(
    cadf("identity.authenticate", { outcome: "failure" }),
  )}`;

  test.each([
    [
      "uWSGI's next line, which a collector can join on",
      "\n[pid: 82795|app: 0|req: 40/86] 10.1.0.196 () {58 vars in 1480 bytes} [Thu Nov  5 03:27:28 2026] PUT /identity/v3/projects => generated 0 bytes",
    ],
    ["DevStack's colour", "\u001b[00m"],
    [
      "DevStack's function",
      " {{(pid=86963) notify /opt/stack/data/venv/lib/python3.12/site-packages/oslo_messaging/notify/_impl_log.py:42}}",
    ],
    ["a brace that never closes", " {"],
    ["a closing brace too many", " }"],
  ])("%s", (_what: string, rest: string) => {
    expect(one(`${LINE}${rest}`).statusName).toBe("Failure");
  });

  test("a brace in a value is not the end of the notification", () => {
    const event: NormalizedSecurityEvent = one(
      cadf("identity.authenticate", {
        outcome: "failure",
        reason: { reasonCode: "404", reasonType: 'Could not find user: }{"' },
      }),
    );

    expect(event.attributes[OpenStackAuditAttribute.Reason]).toBe(
      'Could not find user: }{"',
    );
  });
});

describe("a line that only looks like the log driver's", () => {
  const FORGED: string = JSON.stringify(
    cadf("identity.authenticate", { outcome: "failure" }),
  );

  test("a name someone chose, in another logger's line, is no event", () => {
    expect(
      parse(
        `2026-10-30 10:00:01.000 1234 INFO nova.compute.api [req-1 a b] Creating server ${FORGED}`,
      ),
    ).toEqual([]);
  });

  test("whatever the line says, the logger a cloud's line was stamped with decides", () => {
    expect(
      parse(FORGED, {
        ...CLOUD_ATTRIBUTES,
        "openstack.logger": "nova.compute.api",
      }),
    ).toEqual([]);
    expect(
      parse(`oslo.messaging.notification.x ${FORGED}`, {
        ...CLOUD_ATTRIBUTES,
        "openstack.logger": "nova.compute.api",
      }),
    ).toEqual([]);
  });

  test("the log driver's own line is one, stamped or not", () => {
    expect(
      parse(FORGED, {
        ...CLOUD_ATTRIBUTES,
        "openstack.logger": "oslo.messaging.notification.identity.authenticate",
      }),
    ).toHaveLength(1);
    expect(
      parse(
        `INFO oslo.messaging.notification.identity.authenticate [-] ${FORGED}`,
      ),
    ).toHaveLength(1);
    // A forwarder that ships the notification alone.
    expect(parse(FORGED)).toHaveLength(1);
  });

  test("the word after the JSON is no help", () => {
    expect(
      parse(`Creating server ${FORGED} oslo.messaging.notification.x`),
    ).toEqual([]);
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
  function entryOf(title: string): DetectionRuleLibraryEntry {
    const entry: DetectionRuleLibraryEntry | undefined =
      DETECTION_RULE_LIBRARY.find(
        (candidate: DetectionRuleLibraryEntry): boolean => {
          return candidate.title === title;
        },
      );

    if (!entry) {
      throw new Error(`No library rule titled ${title}`);
    }

    return entry;
  }

  function rule(title: string): SigmaRule {
    return SigmaRuleParser.parse(entryOf(title).sigmaRuleYaml);
  }

  /*
   * What a new_value rule reads: its base rule, and which of its fields must be new for which
   * group. CorrelationQueries does this in ClickHouse: this is the same thing in a loop, over
   * a run of events, each window one event.
   */
  function newValuesOf(
    title: string,
    events: Array<NormalizedSecurityEvent>,
  ): Array<NormalizedSecurityEvent> {
    const definition: DetectionRuleDefinition = SigmaRuleSetParser.parse(
      entryOf(title).sigmaRuleYaml,
    );

    if (definition.kind !== "correlation") {
      throw new Error(`${title} is no correlation`);
    }

    const base: SigmaRule = definition.steps[0]?.rule as SigmaRule;
    const groupBy: Array<string> = definition.correlation.groupBy;
    const field: string = definition.correlation.condition.fields[0] as string;
    const seen: Set<string> = new Set();
    const read: (event: NormalizedSecurityEvent, key: string) => string = (
      event: NormalizedSecurityEvent,
      key: string,
    ): string => {
      const column: unknown = (event as unknown as JSONObject)[key];

      return String(
        typeof column === "string" ? column : event.attributes[key] || "",
      );
    };

    return events.filter((event: NormalizedSecurityEvent): boolean => {
      if (!sigmaRuleMatchesEvent(base, event)) {
        return false;
      }

      const key: string = [
        ...groupBy.map((group: string): string => {
          return read(event, group);
        }),
        read(event, field),
      ].join("|");

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);

      return true;
    });
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

  test("every OpenStack rule reads only what the parser keeps", () => {
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

      if (entry.groupByField?.startsWith("openstack.")) {
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

  test("the burst takes ten, from one address", () => {
    const entry: DetectionRuleLibraryEntry = entryOf(
      "OpenStack failed logins burst",
    );

    expect(entry.matchCountThreshold).toBe(10);
    expect(entry.groupByField).toBe(OpenStackAuditAttribute.InitiatorAddress);
    expect(entry.evaluationIntervalInMinutes).toBe(5);
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

  test("a role taken away from a protected project is no grant", () => {
    const event: NormalizedSecurityEvent = one(
      cadf("identity.role_assignment.deleted", {
        outcome: "success",
        role: ROLE_ID,
        project: PROJECT_ID,
        user: "u",
      }),
    );

    event.attributes[OpenStackAuditAttribute.ProjectName] = "admin";

    expect(
      sigmaRuleMatchesEvent(
        rule("OpenStack role granted on a protected project"),
        event,
      ),
    ).toBe(false);
  });

  test("a grant groups by the project as a case names it", () => {
    expect(
      entryOf("OpenStack role granted on a protected project").groupByField,
    ).toBe("targetResource");
  });

  test("an application credential fires on being created, by whoever made it", () => {
    const entry: DetectionRuleLibraryEntry = entryOf(
      "OpenStack application credential created",
    );
    const created: SigmaRule = SigmaRuleParser.parse(entry.sigmaRuleYaml);

    expect(entry.groupByField).toBe("principalUser");
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

  describe("an image seen public for the first time", () => {
    const TITLE: string = "OpenStack public image published";

    function image(
      type: string,
      visibility: string,
      id: string = "image-id",
    ): NormalizedSecurityEvent {
      return OpenStackAuditLogParser.parse(
        logLine(
          JSON.stringify({
            event_type: type,
            message_id: `m-${id}-${type}`,
            payload: { id, name: id, owner: PROJECT_ID, visibility },
          }),
          CLOUD_ATTRIBUTES,
        ),
      )[0] as NormalizedSecurityEvent;
    }

    test("fires, whichever of Glance's events says it first", () => {
      expect(
        newValuesOf(TITLE, [image("image.create", "public")]),
      ).toHaveLength(1);
      expect(
        newValuesOf(TITLE, [image("image.update", "public")]),
      ).toHaveLength(1);
    });

    test("fires once for one image's whole upload", () => {
      expect(
        newValuesOf(TITLE, [
          image("image.create", "public"),
          image("image.update", "public"),
          image("image.activate", "public"),
          image("image.update", "public"),
        ]),
      ).toHaveLength(1);
    });

    test("stays quiet on an edit to an image known to be public", () => {
      const first: NormalizedSecurityEvent = image("image.update", "public");
      const edit: NormalizedSecurityEvent = image("image.update", "public");

      expect(newValuesOf(TITLE, [first, edit])).toEqual([first]);
    });

    test("each image on its own", () => {
      expect(
        newValuesOf(TITLE, [
          image("image.create", "public", "one"),
          image("image.create", "public", "two"),
        ]),
      ).toHaveLength(2);
    });
  });

  describe("the admin account from a new address", () => {
    const TITLE: string = "OpenStack admin credential used from a new address";

    function signIn(
      address: string,
      username: string = "admin",
    ): NormalizedSecurityEvent {
      return one(
        cadf("identity.authenticate", {
          outcome: "success",
          initiator: { id: "hash", username, host: { address } },
        }),
      );
    }

    function apiCall(address: string): NormalizedSecurityEvent {
      return one(
        cadf("audit.http.response", {
          action: "update",
          outcome: "success",
          requestPath: `/compute/v2.1/servers/${INSTANCE_ID}`,
          initiator: {
            id: USER_ID,
            name: "admin",
            project_id: PROJECT_ID,
            host: { address },
          },
        }),
      );
    }

    test("fires on the first time from an address, and not the next", () => {
      const first: NormalizedSecurityEvent = signIn("203.0.113.7");

      expect(newValuesOf(TITLE, [first, signIn("203.0.113.7")])).toEqual([
        first,
      ]);
    });

    test("a second address fires again", () => {
      expect(
        newValuesOf(TITLE, [signIn("203.0.113.7"), signIn("203.0.113.8")]),
      ).toHaveLength(2);
    });

    test("with sign-ins opted out, a call through the audit filter still says it", () => {
      expect(newValuesOf(TITLE, [apiCall("203.0.113.7")])).toHaveLength(1);
    });

    test("anyone else is no one's business here", () => {
      expect(newValuesOf(TITLE, [signIn("203.0.113.7", "alice")])).toEqual([]);
    });

    test("a login that failed is the burst's, and used nothing", () => {
      expect(
        newValuesOf(TITLE, [
          one(
            cadf("identity.authenticate", {
              outcome: "failure",
              initiator: {
                id: "hash",
                username: "admin",
                host: { address: "203.0.113.7" },
              },
            }),
          ),
        ]),
      ).toEqual([]);
    });
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
