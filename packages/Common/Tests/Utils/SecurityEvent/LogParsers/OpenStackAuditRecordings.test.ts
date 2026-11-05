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
  RecordedScene,
  eventsOf,
  readRecordedCollector,
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
    expect.arrayContaining(["epoxy-ovn", "flamingo-ovn", "hibiscus-ovn"]),
  );
});

test("at least one recording holds a wrong password's hash, so what follows reads a real one", () => {
  const holding: Array<string> = OPENSTACK_AUDIT_RECORDED_RELEASES.filter(
    (release: string): boolean => {
      return readRecordedPhase(release, "devstack").some(
        (line: RecordedLine): boolean => {
          return line.raw.includes("partial_password_hash");
        },
      );
    },
  );

  expect(holding).toContain("hibiscus-ovn");
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

  describe("failed logins", () => {
    const signIns: Array<NormalizedSecurityEvent> = ofType(
      events,
      "identity.authenticate",
    );
    const failed: Array<NormalizedSecurityEvent> = signIns.filter(
      (event: NormalizedSecurityEvent): boolean => {
        return event.statusName === "Failure";
      },
    );
    const burst: DetectionRuleLibraryEntry = libraryEntry(
      "OpenStack failed logins burst",
    );

    test("with Keystone's own defaults, each is sent, and a login that worked is not", () => {
      const defaults: Array<NormalizedSecurityEvent> = ofType(
        eventsOf(readRecordedPhase(release, "keystone-defaults")),
        "identity.authenticate",
      );

      expect(
        facts["keystone-defaults"]?.scenes.map((scene: RecordedScene) => {
          return [scene.scene, scene.exitCode];
        }),
      ).toEqual([["failed-logins", 0]]);
      expect(defaults).toHaveLength(24);
      expect(
        defaults.every((event: NormalizedSecurityEvent): boolean => {
          return event.statusName === "Failure";
        }),
      ).toBe(true);
    });

    test("reach Security Events, saying who, from where and against what", () => {
      expect(failed).toHaveLength(24);

      for (const event of failed) {
        expect(event.activityName).toBe("Logon");
        expect(event.severityName).toBe(OcsfSeverity.Low);
        expect(event.principalIp).toBeTruthy();
        expect(
          event.attributes[OpenStackAuditAttribute.InitiatorAddress],
        ).toBeTruthy();
        expect(event.targetResource).toBe("Keystone");
        expect(event.targetHost).toBe(CLOUD);
        expect(event.message).toBe(
          `${event.principalUser} failed to sign in to OpenStack`,
        );
      }
    });

    test("a real user's name them, and their ID", () => {
      const admin: Array<NormalizedSecurityEvent> = failed.filter(
        (event: NormalizedSecurityEvent): boolean => {
          return event.principalUser === "admin";
        },
      );

      expect(admin).toHaveLength(12);

      for (const event of admin) {
        expect(event.attributes[OpenStackAuditAttribute.InitiatorId]).toMatch(
          /^[0-9a-f]{32}$/,
        );
      }
    });

    test("a user who does not exist is named by what was typed, and has no ID", () => {
      const nobody: Array<NormalizedSecurityEvent> = failed.filter(
        (event: NormalizedSecurityEvent): boolean => {
          return event.principalUser === "ou-nobody";
        },
      );

      expect(nobody).toHaveLength(12);

      for (const event of nobody) {
        expect(
          event.attributes[OpenStackAuditAttribute.InitiatorId],
        ).toBeUndefined();
        expect(event.attributes[OpenStackAuditAttribute.ReasonCode]).toBe(
          "404",
        );
        expect(event.attributes[OpenStackAuditAttribute.Reason]).toBe(
          "Could not find user: ou-nobody.",
        );
      }
    });

    test("an account Keystone has locked says so, and is still a failed login", () => {
      expect(
        failed.some((event: NormalizedSecurityEvent): boolean => {
          return String(
            event.attributes[OpenStackAuditAttribute.Reason],
          ).startsWith("The account is locked");
        }),
      ).toBe(true);
    });

    test("fire the burst, from one address, at its threshold and not before", () => {
      const matched: Array<NormalizedSecurityEvent> = matching(
        burst.title,
        events,
      );
      const addresses: Set<unknown> = new Set(
        matched.map((event: NormalizedSecurityEvent): unknown => {
          return event.attributes[burst.groupByField as string];
        }),
      );

      expect(matched).toEqual(failed);
      expect(addresses.size).toBe(1);
      expect(matched.length).toBeGreaterThanOrEqual(burst.matchCountThreshold);
      expect(burst.matchCountThreshold).toBe(10);
    });

    test("a login that worked is no part of the burst", () => {
      const worked: Array<NormalizedSecurityEvent> = signIns.filter(
        (event: NormalizedSecurityEvent): boolean => {
          return event.statusName === "Success";
        },
      );

      expect(worked.length).toBeGreaterThan(0);
      expect(matching(burst.title, worked)).toEqual([]);
    });

    test("are read the same in every format a cloud logs in", () => {
      for (const phase of ["oslo-default", "json", "journal-native"]) {
        const inPhase: Array<NormalizedSecurityEvent> = ofType(
          eventsOf(readRecordedPhase(release, phase)),
          "identity.authenticate",
        ).filter((event: NormalizedSecurityEvent): boolean => {
          return event.statusName === "Failure";
        });

        expect({ phase, count: inPhase.length }).toEqual({ phase, count: 24 });
        expect(
          new Set(
            inPhase.map((event: NormalizedSecurityEvent): string => {
              return event.principalUser;
            }),
          ),
        ).toEqual(new Set(["admin", "ou-nobody"]));
      }
    });
  });

  describe("every other shape of grant", () => {
    const grants: Array<NormalizedSecurityEvent> = ofType(
      events,
      "identity.role_assignment.created",
    );

    function attributeOf(
      event: NormalizedSecurityEvent,
      key: OpenStackAuditAttribute,
    ): unknown {
      return event.attributes[key];
    }

    test("Keystone sends nothing for one on the system, though the scene made one", () => {
      /*
       * On admin and on ou-payments for one user, on ou-payments for the one refused below,
       * on the domain directly and handed down, and to a group. --system all made none.
       */
      expect(grants).toHaveLength(6);
      expect(
        grants.filter((event: NormalizedSecurityEvent): boolean => {
          return (
            attributeOf(event, OpenStackAuditAttribute.TargetType) === "system"
          );
        }),
      ).toEqual([]);
    });

    test("on a domain names the domain", () => {
      const onDomain: Array<NormalizedSecurityEvent> = grants.filter(
        (event: NormalizedSecurityEvent): boolean => {
          return (
            attributeOf(event, OpenStackAuditAttribute.TargetType) === "domain"
          );
        },
      );

      expect(onDomain).toHaveLength(2);

      for (const event of onDomain) {
        expect(attributeOf(event, OpenStackAuditAttribute.DomainId)).toBe(
          "default",
        );
        expect(event.targetResource).toBe("domain default");
      }
    });

    test("handed down to a domain's projects says so, and who, though the event has no initiator", () => {
      const inherited: NormalizedSecurityEvent | undefined = grants.find(
        (event: NormalizedSecurityEvent): boolean => {
          return event.message?.includes("every project under it") === true;
        },
      );

      expect(inherited).toBeDefined();
      expect(inherited?.principalUser).toBe("admin");
      expect(inherited?.message?.startsWith("admin granted role")).toBe(true);
    });

    test("to a group names the group", () => {
      const toGroup: NormalizedSecurityEvent | undefined = grants.find(
        (event: NormalizedSecurityEvent): boolean => {
          return Boolean(attributeOf(event, OpenStackAuditAttribute.GroupId));
        },
      );

      expect(toGroup).toBeDefined();
      expect(toGroup?.message).toContain(
        `to group ${attributeOf(toGroup!, OpenStackAuditAttribute.GroupId)}`,
      );
      expect(toGroup?.targetUser).toBe("");
    });
  });

  describe("the records a credential lives in", () => {
    test("a credential's blob, and an EC2 secret, are nowhere: only its ID is sent", () => {
      const created: Array<NormalizedSecurityEvent> = ofType(
        events,
        "identity.credential.created",
      );

      expect(created).toHaveLength(2);

      for (const event of created) {
        // One of the two has no initiator: its line says who it was for.
        expect(event.principalUser).toBe("admin");
        expect(event.severityName).toBe(OcsfSeverity.Medium);
        expect(JSON.stringify(event)).not.toContain("blob");
      }
    });

    test("a trust's line is read as the log driver's, though its logger holds a colon", () => {
      const trust: RecordedLine | undefined = lines.find(
        (line: RecordedLine): boolean => {
          return line.raw.startsWith(
            "INFO oslo.messaging.notification.identity.OS-TRUST:trust.created",
          );
        },
      );

      expect(trust?.attributes["openstack.logger"]).toBe(
        "oslo.messaging.notification.identity.OS-TRUST:trust.created",
      );
    });

    test("a trust is named as a trust, and is worth attention", () => {
      const trusts: Array<NormalizedSecurityEvent> = ofType(
        events,
        "identity.OS-TRUST:trust.created",
      );

      expect(trusts).toHaveLength(1);
      expect(trusts[0]?.message).toMatch(/^admin created trust [0-9a-f]{32}$/);
      expect(trusts[0]?.severityName).toBe(OcsfSeverity.Medium);
    });

    test("a password changed says whose, and holds no password", () => {
      const changed: Array<NormalizedSecurityEvent> = ofType(
        events,
        "identity.user.updated",
      );

      expect(changed).toHaveLength(1);
      expect(changed[0]?.targetUser).toMatch(/^[0-9a-f]{32}$/);
    });
  });

  describe("someone asking for what they may not have", () => {
    const refused: Array<NormalizedSecurityEvent> = ofType(
      events,
      "audit.http.response",
    ).filter((event: NormalizedSecurityEvent): boolean => {
      return event.principalUser === "ou-log-prober";
    });

    test("reaches Security Events, each saying what was refused", () => {
      const lines: Array<string> = refused.map(
        (event: NormalizedSecurityEvent): string => {
          return String(event.message);
        },
      );

      expect(refused.length).toBeGreaterThanOrEqual(6);

      for (const event of refused) {
        expect(event.statusName).toBe("Failure");
        expect(event.severityName).toBe(OcsfSeverity.Medium);
        expect(event.attributes[OpenStackAuditAttribute.ReasonCode]).toBe(
          "403",
        );
      }

      expect(lines).toEqual(
        expect.arrayContaining([
          "ou-log-prober was refused read/list on /compute/v2.1/os-services (403)",
        ]),
      );
    });

    test("a token that means nothing never reaches the filter, so says nothing here", () => {
      expect(
        refused.filter((event: NormalizedSecurityEvent): boolean => {
          return event.attributes[OpenStackAuditAttribute.ReasonCode] === "401";
        }),
      ).toEqual([]);
    });
  });

  describe("what a real collector sent, with each of the agent's logs profiles", () => {
    const fromJournal: Array<RecordedLine> = readRecordedCollector(
      release,
      "devstack",
    );
    const fromFiles: Array<RecordedLine> = readRecordedCollector(
      release,
      "oslo-default",
    );

    test("the journal profile's lines read as the journal's do, whatever it joined to them", () => {
      const read: Array<NormalizedSecurityEvent> = eventsOf(fromJournal);

      for (const type of [
        "identity.role_assignment.created",
        "identity.application_credential.created",
        "identity.credential.created",
        "security_group_rule.create.end",
      ]) {
        expect({ type, count: ofType(read, type).length }).toEqual({
          type,
          count: ofType(events, type).length,
        });
      }

      expect(
        ofType(read, "identity.authenticate").filter(
          (event: NormalizedSecurityEvent): boolean => {
            return event.statusName === "Failure";
          },
        ),
      ).toHaveLength(24);
    });

    test("uWSGI's next line, joined on, costs no event", () => {
      const joined: Array<RecordedLine> = fromJournal.filter(
        (line: RecordedLine): boolean => {
          return (
            line.raw.includes("\n[pid: ") &&
            line.raw.startsWith("INFO oslo.messaging.notification.identity.")
          );
        },
      );

      expect(joined.length).toBeGreaterThan(0);

      for (const line of joined) {
        expect(line.events.length).toBeGreaterThan(0);
      }
    });

    test("names its cloud by what the profile stamps, and its who and what", () => {
      const grant: NormalizedSecurityEvent = ofType(
        eventsOf(fromJournal),
        "identity.role_assignment.created",
      )[0] as NormalizedSecurityEvent;

      expect(grant.targetHost).toBe(CLOUD);
      expect(grant.principalUser).toBe("admin");
    });

    test("the files profile's lines read too", () => {
      const read: Array<NormalizedSecurityEvent> = eventsOf(fromFiles);

      expect(
        ofType(read, "identity.authenticate").filter(
          (event: NormalizedSecurityEvent): boolean => {
            return event.statusName === "Failure";
          },
        ),
      ).toHaveLength(24);
      expect(
        ofType(read, "identity.role_assignment.created").length,
      ).toBeGreaterThan(0);
      expect(
        ofType(read, "security_group_rule.create.end").length,
      ).toBeGreaterThanOrEqual(3);
    });

    test("no line or event holds a credential, as the collector sent it", () => {
      for (const line of [...fromJournal, ...fromFiles]) {
        expect(line.body).not.toContain("partial_password_hash");
        expect(line.body).not.toContain('"attachments"');
        expect(line.body).not.toContain('"credential"');
        expect(JSON.stringify(line.events)).not.toContain(
          "partial_password_hash",
        );
      }
    });
  });

  describe("in oslo.log's own format, which names a user by ID", () => {
    const oslo: Array<NormalizedSecurityEvent> = eventsOf(
      readRecordedPhase(release, "oslo-default"),
    );

    test("a security group opened still says who, by ID, and a case says it is a user", () => {
      const opened: Array<NormalizedSecurityEvent> = ofType(
        oslo,
        "security_group_rule.create.end",
      );

      expect(opened.length).toBeGreaterThanOrEqual(3);

      for (const event of opened) {
        expect(event.principalUser).toMatch(/^[0-9a-f]{32}$/);
        expect(event.observables).toContain(`user ${event.principalUser}`);
        expect(event.observables).not.toContain(event.principalUser);
      }
    });

    test("a role grant reads as it does anywhere else", () => {
      const grants: Array<NormalizedSecurityEvent> = ofType(
        oslo,
        "identity.role_assignment.created",
      );

      expect(grants.length).toBeGreaterThan(0);
      expect(grants[0]?.principalUser).toBe("admin");
      expect(grants[0]?.message).toContain("granted role");
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
          return entry.dataKind === DetectionRuleDataKind.OpenStackAuditTrail;
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
