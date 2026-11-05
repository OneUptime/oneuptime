import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "../../../../Types/JSON";
import {
  DETECTION_RULE_LIBRARY,
  DetectionRuleLibraryEntry,
} from "../../../../Types/SecurityEvent/DetectionRuleLibrary";
import { DetectionRuleDataKind } from "../../../../Types/SecurityEvent/DetectionRuleDataKind";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../../Types/SecurityEvent/OcsfSeverity";
import { DetectionRuleDefinition } from "../../../../Types/SecurityEvent/SigmaCorrelation";
import SigmaRule from "../../../../Types/SecurityEvent/SigmaRule";
import OpenStackAuditLogParser, {
  OpenStackAuditAttribute,
  OpenStackAuditSignal,
  describeOpenStackProject,
  readOpenStackAuditNotification,
} from "../../../../Utils/SecurityEvent/LogParsers/OpenStackAuditLogParser";
import { matchesSecurityLogPrefilter } from "../../../../Utils/SecurityEvent/LogParsers/SecurityLogParser";
import SigmaRuleParser from "../../../../Utils/SecurityEvent/Sigma/SigmaRuleParser";
import SigmaRuleSetParser from "../../../../Utils/SecurityEvent/Sigma/SigmaRuleSetParser";
import {
  OPENSTACK_AUDIT_RECORDED_CLOUD,
  OPENSTACK_AUDIT_RECORDED_RELEASES,
  PhaseFacts,
  RecordedLine,
  eventsOf,
  readRecordedFacts,
  readRecordedPhase,
} from "./OpenStackAuditFixtures";
import { sigmaRuleMatchesEvent } from "./SigmaTestMatcher";

/*
 * WHAT REAL CLOUDS WROTE, FROM THE LINE TO THE EVENT.
 *
 * Tests/Ops/openstack-e2e/logs-record.sh makes each of these things happen on a real DevStack,
 * and import-log-recording.py keeps the lines an audit trail is read from. Each line here goes
 * the way it goes in production: stamped at ingest (stampOpenStackLogRecord), asked for by the
 * log scan (matchesSecurityLogPrefilter), read into an event (SecurityLogParser), and held to
 * the rule library's detections.
 *
 * The fixture's passwords and tokens were replaced when it was copied, keeping their shape. So
 * what proves nothing is kept is that what a line held of a credential is gone from what is
 * stored, on lines shown to hold it: see "what is never stored".
 */

function ofType(
  events: Array<NormalizedSecurityEvent>,
  type: string,
): Array<NormalizedSecurityEvent> {
  return events.filter((event: NormalizedSecurityEvent): boolean => {
    return event.attributes[OpenStackAuditAttribute.EventType] === type;
  });
}

function libraryEntry(title: string): DetectionRuleLibraryEntry {
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

/*
 * The rule a detection reads each event with: its own, or the base rule of a correlation,
 * whose whole grouping the rule library test holds it to.
 */
function ruleOf(title: string): SigmaRule {
  const entry: DetectionRuleLibraryEntry = libraryEntry(title);
  const definition: DetectionRuleDefinition = SigmaRuleSetParser.parse(
    entry.sigmaRuleYaml,
  );

  if (definition.kind === "correlation") {
    return definition.steps[0]?.rule as SigmaRule;
  }

  return SigmaRuleParser.parse(entry.sigmaRuleYaml);
}

function matching(
  title: string,
  events: Array<NormalizedSecurityEvent>,
): Array<NormalizedSecurityEvent> {
  const rule: SigmaRule = ruleOf(title);

  return events.filter((event: NormalizedSecurityEvent): boolean => {
    return sigmaRuleMatchesEvent(rule, event);
  });
}

const CLOUD: string = OPENSTACK_AUDIT_RECORDED_CLOUD;

test("there are recordings to read, of the releases this leans on", () => {
  expect(OPENSTACK_AUDIT_RECORDED_RELEASES).toEqual(
    expect.arrayContaining(["epoxy-ovn", "flamingo-ovn"]),
  );
});

describe.each(OPENSTACK_AUDIT_RECORDED_RELEASES)("%s", (release: string) => {
  const facts: Record<string, PhaseFacts> = readRecordedFacts(release);
  const devstack: PhaseFacts = facts["devstack"] as PhaseFacts;
  const lines: Array<RecordedLine> = readRecordedPhase(release, "devstack");
  const events: Array<NormalizedSecurityEvent> = eventsOf(lines);

  describe("a role grant", () => {
    const grants: Array<NormalizedSecurityEvent> = ofType(
      events,
      "identity.role_assignment.created",
    );
    const onAdmin: NormalizedSecurityEvent | undefined = grants.find(
      (event: NormalizedSecurityEvent): boolean => {
        return (
          event.attributes[OpenStackAuditAttribute.ProjectId] ===
          devstack.ids["admin_project"]
        );
      },
    );

    test("reaches Security Events, saying who, what and on what", () => {
      expect(onAdmin).toBeDefined();
      expect(onAdmin?.principalUser).toBe("admin");
      expect(onAdmin?.principalIp).toBeTruthy();
      expect(onAdmin?.targetUser).toBe(devstack.ids["identity_user"]);
      expect(onAdmin?.activityName).toBe("Assign Privileges");
      expect(onAdmin?.statusName).toBe("Success");
      expect(onAdmin?.attributes[OpenStackAuditAttribute.RoleId]).toBeTruthy();
      expect(onAdmin?.targetResource).toBe(
        describeOpenStackProject(devstack.ids["admin_project"] as string),
      );
      expect(onAdmin?.targetHost).toBe(CLOUD);
    });

    test("names the project for a case, and says the user's ID is a user's", () => {
      expect(onAdmin?.observables).toContain(
        describeOpenStackProject(devstack.ids["admin_project"] as string),
      );
      expect(onAdmin?.observables).toContain(
        `user ${devstack.ids["identity_user"]}`,
      );
    });

    test("fires the detection on the project that administers the cloud, once its name is known", () => {
      const named: NormalizedSecurityEvent = {
        ...(onAdmin as NormalizedSecurityEvent),
        attributes: {
          ...onAdmin?.attributes,
          [OpenStackAuditAttribute.ProjectName]: "admin",
        },
      };

      expect(
        matching("OpenStack role granted on a protected project", [named]),
      ).toHaveLength(1);
    });

    test("stays quiet on an ordinary project", () => {
      const other: NormalizedSecurityEvent | undefined = grants.find(
        (event: NormalizedSecurityEvent): boolean => {
          return event !== onAdmin;
        },
      );

      expect(other).toBeDefined();
      expect(
        matching("OpenStack role granted on a protected project", [
          {
            ...(other as NormalizedSecurityEvent),
            attributes: {
              ...other?.attributes,
              [OpenStackAuditAttribute.ProjectName]: "ou-payments",
            },
          },
        ]),
      ).toEqual([]);
    });

    test("taken away is said to be", () => {
      const taken: Array<NormalizedSecurityEvent> = ofType(
        events,
        "identity.role_assignment.deleted",
      );

      expect(taken.length).toBeGreaterThan(0);
      expect(taken[0]?.activityName).toBe("Revoke Privileges");
      expect(
        matching("OpenStack role granted on a protected project", taken),
      ).toEqual([]);
    });
  });

  describe("a security group opened", () => {
    const opened: Array<NormalizedSecurityEvent> = ofType(
      events,
      "security_group_rule.create.end",
    );

    test("reaches Security Events, saying who, what and on what", () => {
      expect(opened.length).toBeGreaterThanOrEqual(3);

      for (const event of opened) {
        expect(event.principalUser).toBeTruthy();
        expect(event.attributes[OpenStackAuditAttribute.TargetId]).toBe(
          devstack.ids["security_group"],
        );
        expect(
          event.attributes[OpenStackAuditAttribute.ProjectId],
        ).toBeTruthy();
        expect(event.targetHost).toBe(CLOUD);
        expect(event.message).toContain("opened security group");
        expect(event.message).toContain("in project ");
      }
    });

    test("on SSH, on RDP over IPv6, and on every port, each name the door", () => {
      const doors: Array<string> = opened.map(
        (event: NormalizedSecurityEvent): string => {
          return String(event.attributes[OpenStackAuditAttribute.OpenPort]);
        },
      );

      expect(doors).toEqual(expect.arrayContaining(["22", "3389"]));
      expect(
        opened.some((event: NormalizedSecurityEvent): boolean => {
          return event.message?.includes("to ::/0 on port 3389") === true;
        }),
      ).toBe(true);
      // Asked for 1 to 65535, Neutron stores no range at all.
      expect(
        opened.some((event: NormalizedSecurityEvent): boolean => {
          return event.message?.includes("on every port") === true;
        }),
      ).toBe(true);
    });

    test("fires the detection, on those and nothing else", () => {
      const fired: Array<NormalizedSecurityEvent> = matching(
        "OpenStack security group opened to the world",
        events,
      );

      expect(fired).toEqual(
        opened.filter((event: NormalizedSecurityEvent): boolean => {
          return (
            event.attributes[OpenStackAuditAttribute.Signal] ===
            OpenStackAuditSignal.SecurityGroupOpenSensitive
          );
        }),
      );
      expect(fired.length).toBeGreaterThanOrEqual(3);
      expect(fired[0]?.severityName).toBe(OcsfSeverity.High);
    });

    test("a rule from a private range makes no event, though Neutron sent it", () => {
      const fromPrivate: Array<RecordedLine> = lines.filter(
        (line: RecordedLine): boolean => {
          return (
            line.body.includes("security_group_rule.create.end") &&
            line.body.includes('"remote_ip_prefix":"10.0.0.0/8"')
          );
        },
      );

      expect(fromPrivate.length).toBeGreaterThan(0);

      for (const line of fromPrivate) {
        expect(line.events).toEqual([]);
      }
    });

    test("names the project for a case", () => {
      for (const event of opened) {
        expect(
          event.observables.some((value: string): boolean => {
            return value.startsWith("project ");
          }),
        ).toBe(true);
      }
    });
  });

  describe("an application credential", () => {
    const created: Array<NormalizedSecurityEvent> = ofType(
      events,
      "identity.application_credential.created",
    );

    test("fires the detection on both kinds, which read the same", () => {
      expect(created).toHaveLength(2);
      expect(
        matching("OpenStack application credential created", events),
      ).toEqual(created);
    });

    test("whether it is unrestricted is nowhere in what Keystone sent", () => {
      const made: Array<RecordedLine> = lines.filter(
        (line: RecordedLine): boolean => {
          return line.body.includes("identity.application_credential.created");
        },
      );

      expect(made).toHaveLength(2);

      for (const line of made) {
        expect(line.raw.toLowerCase()).not.toContain("unrestricted");
      }

      // The two lines differ only in what any two events do.
      const fieldsOf: (line: RecordedLine) => Array<string> = (
        line: RecordedLine,
      ): Array<string> => {
        const notification: JSONObject = readOpenStackAuditNotification(
          line.body,
        ) as JSONObject;

        return Object.keys(notification["payload"] as JSONObject).sort();
      };

      expect(fieldsOf(made[0] as RecordedLine)).toEqual(
        fieldsOf(made[1] as RecordedLine),
      );
    });
  });

  describe("an image", () => {
    const publicImage: string = devstack.ids["public_image"] as string;

    const seen: Array<NormalizedSecurityEvent> = events.filter(
      (event: NormalizedSecurityEvent): boolean => {
        return (
          event.attributes[OpenStackAuditAttribute.Signal] ===
          OpenStackAuditSignal.ImagePublic
        );
      },
    );

    test("made public says who and which", () => {
      expect(seen.length).toBeGreaterThan(0);

      for (const event of seen) {
        expect(event.attributes[OpenStackAuditAttribute.TargetId]).toBe(
          publicImage,
        );
        expect(event.attributes[OpenStackAuditAttribute.PartId]).toBe(
          publicImage,
        );
        expect(event.principalUser).toBeTruthy();
        expect(event.message).toContain("public image ou-log-public");
      }
    });

    test("is one new value for the detection, however many events Glance sends", () => {
      const ids: Set<unknown> = new Set(
        matching("OpenStack public image published", events).map(
          (event: NormalizedSecurityEvent): unknown => {
            return event.attributes[OpenStackAuditAttribute.TargetId];
          },
        ),
      );

      expect(ids).toEqual(new Set([publicImage]));
    });

    test("that is private says nothing, whatever Glance sent about it", () => {
      const privateOnes: Array<RecordedLine> = lines.filter(
        (line: RecordedLine): boolean => {
          return (
            line.body.includes('"event_type":"image.') &&
            line.body.includes('"visibility":"shared"')
          );
        },
      );

      expect(privateOnes.length).toBeGreaterThan(0);

      for (const line of privateOnes) {
        expect(line.events).toEqual([]);
      }
    });
  });

  describe("a call through the audit filter", () => {
    const calls: Array<NormalizedSecurityEvent> = ofType(
      events,
      "audit.http.response",
    );

    test("says which part it touched, though its target says unknown", () => {
      const stopped: NormalizedSecurityEvent | undefined = calls.find(
        (event: NormalizedSecurityEvent): boolean => {
          return event.activityName === "update/os-stop";
        },
      );

      expect(stopped).toBeDefined();
      expect(stopped?.attributes[OpenStackAuditAttribute.PartId]).toBe(
        devstack.ids["instance_ok"],
      );
      expect(stopped?.attributes[OpenStackAuditAttribute.PartKind]).toBe(
        "Instance",
      );
      expect(stopped?.attributes[OpenStackAuditAttribute.TargetId]).toBe(
        undefined,
      );
      expect(stopped?.message).toBe(
        `admin update/os-stop on instance ${devstack.ids["instance_ok"]}`,
      );
      expect(stopped?.principalUser).toBe("admin");
      expect(stopped?.principalIp).toBeTruthy();
    });

    test("that was refused is medium, and failed", () => {
      const refused: Array<NormalizedSecurityEvent> = calls.filter(
        (event: NormalizedSecurityEvent): boolean => {
          return event.attributes[OpenStackAuditAttribute.ReasonCode] === "403";
        },
      );

      expect(refused.length).toBeGreaterThan(0);

      for (const event of refused) {
        expect(event.statusName).toBe("Failure");
        expect(event.severityName).toBe(OcsfSeverity.Medium);
        expect(event.message).toContain("was refused");
      }
    });

    test("no read that was answered is an event, and no request half of a call", () => {
      const quiet: Array<RecordedLine> = lines.filter(
        (line: RecordedLine): boolean => {
          const notification: JSONObject | null =
            readOpenStackAuditNotification(line.body);
          const payload: JSONObject | undefined = notification?.["payload"] as
            | JSONObject
            | undefined;
          const reason: JSONObject | undefined = payload?.["reason"] as
            | JSONObject
            | undefined;

          return (
            notification?.["event_type"] === "audit.http.request" ||
            (notification?.["event_type"] === "audit.http.response" &&
              String(payload?.["action"]).startsWith("read") &&
              reason?.["reasonCode"] !== "401" &&
              reason?.["reasonCode"] !== "403")
          );
        },
      );

      expect(quiet.length).toBeGreaterThan(0);

      for (const line of quiet) {
        expect(line.events).toEqual([]);
      }
    });

    test("what a service tells Nova is nobody's doing", () => {
      expect(
        calls.filter((event: NormalizedSecurityEvent): boolean => {
          return String(
            event.attributes[OpenStackAuditAttribute.RequestPath],
          ).includes("os-server-external-events");
        }),
      ).toEqual([]);
    });
  });

  describe("what is never stored", () => {
    // Everything the recording holds, in every format it was written in.
    const everyPhase: Array<RecordedLine> = Object.keys(facts).flatMap(
      (phase: string): Array<RecordedLine> => {
        return readRecordedPhase(release, phase);
      },
    );

    const FORBIDDEN: ReadonlyArray<string> = [
      '"credential"',
      '\\"credential\\"',
      '"attachments"',
      '\\"attachments\\"',
      "partial_password_hash",
      "fake-wrong-password",
      "fake-user-password",
      "fake-admin-password",
      "fake-credential-blob",
      "fake-hash-secret",
      "gAAAA",
    ];

    test("the recording does hold a credential's block, so this reads a real one", () => {
      expect(
        everyPhase.some((line: RecordedLine): boolean => {
          return line.raw.includes("credential");
        }),
      ).toBe(true);
    });

    test("no line keeps a credential's block as it is stored", () => {
      for (const line of everyPhase) {
        for (const word of FORBIDDEN) {
          expect(line.body).not.toContain(word);
        }
      }
    });

    test("no event keeps anything of one, in any of its fields", () => {
      for (const event of eventsOf(everyPhase)) {
        const text: string = JSON.stringify(event);

        for (const word of [
          ...FORBIDDEN,
          '"token"',
          "***",
          "identity_status",
        ]) {
          expect(text).not.toContain(word);
        }
      }
    });

    test("an event keeps only the fields the parser names", () => {
      const named: Array<string> = Object.values(OpenStackAuditAttribute);

      for (const event of eventsOf(everyPhase)) {
        for (const key of Object.keys(event.attributes)) {
          if (!key.startsWith("oneuptime.")) {
            expect(named).toContain(key);
          }
        }
      }
    });
  });

  describe("the log scan", () => {
    test("every line that makes an event is one it asks for", () => {
      const everyPhase: Array<RecordedLine> = Object.keys(facts).flatMap(
        (phase: string): Array<RecordedLine> => {
          return readRecordedPhase(release, phase);
        },
      );

      for (const line of everyPhase) {
        if (line.events.length > 0) {
          expect(matchesSecurityLogPrefilter(line.body)).toBe(true);
        }
      }
    });

    test("reading a line never needs anything but the line", () => {
      for (const line of lines) {
        expect(
          OpenStackAuditLogParser.parse({
            body: line.body,
            attributes: line.attributes,
            time: new Date("2026-11-04T00:00:00.000Z"),
            logId: "again",
          }).length,
        ).toBe(line.events.length);
      }
    });
  });

  test("every template fires on something this cloud really did", () => {
    const templates: Array<DetectionRuleLibraryEntry> =
      DETECTION_RULE_LIBRARY.filter(
        (entry: DetectionRuleLibraryEntry): boolean => {
          return (
            entry.dataKind === DetectionRuleDataKind.OpenStackAuditTrail &&
            // These recordings' failed-logins scene never reached Keystone.
            entry.title !== "OpenStack failed logins burst"
          );
        },
      );

    for (const template of templates) {
      /*
       * Project names come from the inventory, so a grant is held to its rule with the
       * name this recording's admin project has.
       */
      const named: Array<NormalizedSecurityEvent> = events.map(
        (event: NormalizedSecurityEvent): NormalizedSecurityEvent => {
          return event.attributes[OpenStackAuditAttribute.ProjectId] ===
            devstack.ids["admin_project"]
            ? {
                ...event,
                attributes: {
                  ...event.attributes,
                  [OpenStackAuditAttribute.ProjectName]: "admin",
                },
              }
            : event;
        },
      );

      expect({
        template: template.title,
        fires: matching(template.title, named).length > 0,
      }).toEqual({ template: template.title, fires: true });
    }
  });
});
