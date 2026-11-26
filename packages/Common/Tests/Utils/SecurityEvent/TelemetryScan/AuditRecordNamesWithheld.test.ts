import { describe, expect, test } from "@jest/globals";
import AuditLogAction from "../../../../Types/AuditLog/AuditLogAction";
import { JSONObject } from "../../../../Types/JSON";
import Permission from "../../../../Types/Permission";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import { SECURITY_LOG_SOURCE_ATTRIBUTE } from "../../../../Types/SecurityEvent/SecurityLogFormat";
import { WorkflowRunAs } from "../../../../Types/Workflow/WorkflowRunAs";
import { markdownCodeSpan } from "../../../../Utils/Markdown/MarkdownEscape";
import {
  AUDIT_ATTRIBUTES,
  AUDIT_SECURITY_RESOURCE_TYPES,
  AuditRecordNameReaders,
  AuditResourceType,
  AuditScanRecord,
  buildAuditRecordEvent,
} from "../../../../Utils/SecurityEvent/TelemetryScan/AuditLogSignals";
import {
  AuditChangeSaying,
  SAMPLE_EVENT_PREFIXES,
  getAuditChangeSayings,
  isAuditEventNamingItsRecord,
  withholdAuditRecordNameInEvent,
  withholdAuditRecordNameInMessage,
  withholdAuditRecordNameInSentence,
  withholdAuditRecordNamesInEachLine,
  withholdAuditRecordNamesInSampleLines,
} from "../../../../Utils/SecurityEvent/TelemetryScan/AuditRecordNamesWithheld";

/*
 * AN EVENT STORED BEFORE #10663 READS AS ONE WRITTEN NOW (#10663).
 *
 * Before #10663 an event about a change in OneUptime named its record in
 * its message, its target and `audit.resource_name`. Now an event names it
 * only where every reader of security events reads it - none of the types
 * the scan reports. The events already stored, and the text made of them,
 * are reworded once: here every way the scan says a change, by every kind
 * of actor, about records named every awkward way, is stored as it used to
 * be, reworded, and compared with the event the scan writes today.
 */

const ID: string = "0192f1a0-0000-7000-8000-00000000d001";
const RESOURCE_ID: string = "0192f1a0-0000-7000-8000-00000000d002";

// Readers who read every record: the event as it was written before #10663.
const NAMED_AS_BEFORE: AuditRecordNameReaders = {
  eventReaders: [Permission.ProjectOwner],
  getRecordReaders: (): Array<Permission> => {
    return [Permission.ProjectOwner];
  },
};

const EVERY_TYPE_WITHHELD: (resourceType: string) => boolean = (): boolean => {
  return true;
};

const ACTORS: Record<string, Partial<AuditScanRecord>> = {
  person: { userEmail: "alice@example.com", userName: "Alice" },
  "person by name": { userEmail: "", userName: "Alice Liddell" },
  "API key": {
    userEmail: "",
    userName: "",
    userType: "API",
    apiKeyId: "0192f1a0-0000-7000-8000-00000000d0aa",
    apiKeyName: "ci",
  },
  "workflow given an API key's permissions": {
    userEmail: "",
    userName: "",
    userType: "Workflow",
    workflowId: "0192f1a0-0000-7000-8000-00000000d0bb",
    workflowName: "Access Sync",
    workflowRunAs: WorkflowRunAs.CustomRole,
    workflowRunAsCustomRoleName: "Cleanup Crew",
    workflowRunAsGiverName: "terraform",
    workflowRunAsGiverApiKeyId: "0192f1a0-0000-7000-8000-00000000d0cc",
  },
  "MCP client": {
    userEmail: "",
    userName: "",
    mcpClientName: "Claude Desktop",
  },
  OneUptime: { userEmail: "", userName: "", userId: "", userType: "System" },
  nobody: { userEmail: "", userName: "", userId: "", userType: "" },
};

const NAMES: Record<string, string> = {
  plain: "terraform-prod",
  "with quotes": 'the "prod" key',
  "ending with a quote": 'prod "',
  "with an apostrophe and a backslash": "O'Brien\\ops",
  unicode: "Équipe d'astreinte — 夜勤",
  emoji: "🔑 deploy",
  "longer than a message quotes": "k".repeat(150),
  "longer than an attribute keeps": "a".repeat(2500),
  "emoji, long": "🔑".repeat(130),
  "that says a change itself": 'x" created the API key "y',
  "padded with spaces": "  padded  ",
};

function record(overrides: Partial<AuditScanRecord>): AuditScanRecord {
  return {
    id: ID,
    createdAt: new Date("2026-11-10T10:00:00.000Z"),
    resourceType: AuditResourceType.ApiKey,
    resourceId: RESOURCE_ID,
    resourceName: "terraform-prod",
    action: AuditLogAction.Create,
    userId: "0192f1a0-0000-7000-8000-00000000d003",
    userName: "",
    userEmail: "",
    userType: "User",
    apiKeyId: "",
    apiKeyName: "",
    mcpClientName: "",
    workflowId: "",
    workflowName: "",
    workflowRunAs: "",
    workflowRunAsCustomRoleName: "",
    workflowRunAsGiverName: "",
    workflowRunAsGiverApiKeyId: "",
    ...overrides,
  };
}

// The event as it was stored, and as it is written now.
function eventsOf(overrides: Partial<AuditScanRecord>): {
  before: NormalizedSecurityEvent;
  now: NormalizedSecurityEvent;
} {
  return {
    before: buildAuditRecordEvent(record(overrides), NAMED_AS_BEFORE)!,
    now: buildAuditRecordEvent(record(overrides))!,
  };
}

interface Case {
  label: string;
  overrides: Partial<AuditScanRecord>;
}

function corpus(): Array<Case> {
  const cases: Array<Case> = [];

  for (const saying of getAuditChangeSayings()) {
    for (const [actorLabel, actor] of Object.entries(ACTORS)) {
      for (const [nameLabel, resourceName] of Object.entries(NAMES)) {
        cases.push({
          label: `${saying.resourceType} ${saying.action}, by ${actorLabel}, named ${nameLabel}`,
          overrides: {
            ...actor,
            resourceType: saying.resourceType,
            action: saying.action,
            resourceName,
          },
        });
      }
    }
  }

  return cases;
}

describe("the ways the scan says a change", () => {
  test("are every type it reads and every action that is a signal, longer words first", () => {
    const sayings: Array<AuditChangeSaying> = getAuditChangeSayings();

    expect(
      new Set(
        sayings.map((saying: AuditChangeSaying): string => {
          return saying.resourceType;
        }),
      ),
    ).toEqual(new Set(AUDIT_SECURITY_RESOURCE_TYPES));

    for (let index: number = 1; index < sayings.length; index++) {
      expect(sayings[index - 1]!.named.length).toBeGreaterThanOrEqual(
        sayings[index]!.named.length,
      );
    }

    expect(sayings).toContainEqual({
      resourceType: AuditResourceType.ApiKey,
      action: AuditLogAction.Create,
      named: "created the API key",
      unnamed: "created an API key",
    });
  });
});

describe("an event stored before #10663, reworded", () => {
  const cases: Array<Case> = corpus();

  test("the corpus is every saying, by every actor, about every kind of name", () => {
    expect(cases.length).toBe(
      getAuditChangeSayings().length *
        Object.keys(ACTORS).length *
        Object.keys(NAMES).length,
    );
  });

  test("reads exactly as the event the scan writes now: its message, its target and its attributes", () => {
    const mismatches: Array<JSONObject> = [];

    for (const testCase of cases) {
      const { before, now } = eventsOf(testCase.overrides);
      const reworded: NormalizedSecurityEvent | null =
        withholdAuditRecordNameInEvent({
          event: before,
          isNameWithheld: EVERY_TYPE_WITHHELD,
        });

      if (
        !reworded ||
        reworded.message !== now.message ||
        reworded.targetResource !== now.targetResource ||
        JSON.stringify(reworded.attributes) !== JSON.stringify(now.attributes)
      ) {
        mismatches.push({
          case: testCase.label,
          stored: before.message,
          reworded: reworded?.message || null,
          now: now.message,
        });
      }
    }

    expect(mismatches).toEqual([]);
  });

  test("keeps everything that is not the name: the type, the id, who and when", () => {
    const { before } = eventsOf({ resourceName: "terraform-prod" });
    const reworded: NormalizedSecurityEvent = withholdAuditRecordNameInEvent({
      event: before,
      isNameWithheld: EVERY_TYPE_WITHHELD,
    })!;

    expect(reworded.attributes[AUDIT_ATTRIBUTES.resourceName]).toBeUndefined();
    expect(reworded.attributes[AUDIT_ATTRIBUTES.resourceType]).toBe(
      AuditResourceType.ApiKey,
    );
    expect(reworded.attributes[AUDIT_ATTRIBUTES.resourceId]).toBe(RESOURCE_ID);
    expect(reworded.attributes[AUDIT_ATTRIBUTES.recordId]).toBe(ID);
    expect(reworded.eventUid).toBe(before.eventUid);
    expect(reworded.time).toEqual(before.time);
    expect(reworded.principalUser).toBe(before.principalUser);
    expect(reworded.severityName).toBe(before.severityName);
    expect(reworded.targetResource).toBe(`API Key: ${RESOURCE_ID}`);
    expect(JSON.stringify(reworded)).not.toContain("terraform-prod");
  });

  test("an MCP client's authorization keeps the client it was made through, which is the actor's", () => {
    const { before } = eventsOf({
      resourceType: AuditResourceType.McpClientAuthorization,
      resourceName: "grant-for-claude",
      mcpClientName: "Claude Desktop",
    });
    const reworded: NormalizedSecurityEvent = withholdAuditRecordNameInEvent({
      event: before,
      isNameWithheld: EVERY_TYPE_WITHHELD,
    })!;

    expect(reworded.message).toBe(before.message);
    expect(reworded.message).toContain('"Claude Desktop"');
    expect(JSON.stringify(reworded)).not.toContain("grant-for-claude");
  });

  test("an event that names no record, is not the audit log's, or is of a type still named, is left alone", () => {
    const { before, now } = eventsOf({ resourceName: "terraform-prod" });

    // Already said without its name.
    expect(
      withholdAuditRecordNameInEvent({
        event: now,
        isNameWithheld: EVERY_TYPE_WITHHELD,
      }),
    ).toBeNull();

    // Another source's event, with keys that look like the audit log's.
    expect(
      withholdAuditRecordNameInEvent({
        event: {
          ...before,
          vendorName: "Acme",
          productName: "Acme Gateway",
          attributes: {
            ...before.attributes,
            [SECURITY_LOG_SOURCE_ATTRIBUTE]: "logs",
          },
        },
        isNameWithheld: EVERY_TYPE_WITHHELD,
      }),
    ).toBeNull();

    // A type every reader of security events reads keeps its name.
    expect(
      withholdAuditRecordNameInEvent({
        event: before,
        isNameWithheld: (resourceType: string): boolean => {
          return resourceType !== AuditResourceType.ApiKey;
        },
      }),
    ).toBeNull();
  });

  test("a copy that kept the event's vendor and product but not its source is still the audit log's", () => {
    const { before } = eventsOf({ resourceName: "terraform-prod" });
    const attributes: JSONObject = { ...before.attributes };
    delete attributes[SECURITY_LOG_SOURCE_ATTRIBUTE];

    expect(
      isAuditEventNamingItsRecord({
        attributes,
        vendorName: before.vendorName,
        productName: before.productName,
      }),
    ).toBe(true);
    expect(isAuditEventNamingItsRecord({ attributes })).toBe(false);
  });
});

describe("a message, by the change it was", () => {
  test("ends with the words and the name it quoted: the words of a record it does not name take their place", () => {
    expect(
      withholdAuditRecordNameInMessage({
        message: 'alice@example.com deleted the team "Ops"',
        resourceType: AuditResourceType.Team,
        action: AuditLogAction.Delete,
        resourceName: "Ops",
      }),
    ).toBe("alice@example.com deleted a team");
  });

  test("whatever the name as the message cut it, the last place it says the words decides", () => {
    expect(
      withholdAuditRecordNameInMessage({
        message: 'alice@example.com deleted the team "Op…"',
        resourceType: AuditResourceType.Team,
        action: AuditLogAction.Delete,
        resourceName: "Operations",
      }),
    ).toBe("alice@example.com deleted a team");
  });

  test("a message that does not say the change's words is as it was", () => {
    expect(
      withholdAuditRecordNameInMessage({
        message: "alice@example.com deleted a team",
        resourceType: AuditResourceType.Team,
        action: AuditLogAction.Delete,
        resourceName: "Ops",
      }),
    ).toBe("alice@example.com deleted a team");
    expect(
      withholdAuditRecordNameInMessage({
        message: 'Somebody wrote "deleted the team"',
        resourceType: AuditResourceType.Team,
        action: AuditLogAction.Delete,
      }),
    ).toBe('Somebody wrote "deleted the team"');
  });
});

describe("text that quotes an event", () => {
  const stored: string =
    'The API key "ci" created the API key "terraform-prod"';
  const now: string = 'The API key "ci" created an API key';

  test("a sentence alone, by the words it says last: the actor's own quoted name is kept", () => {
    expect(withholdAuditRecordNameInSentence(stored)).toBe(now);
    expect(
      withholdAuditRecordNameInSentence(
        'The workflow "Access Sync", running as the custom role "Cleanup Crew" with the permissions the API key "terraform" gave it, deleted the team "Ops"',
      ),
    ).toBe(
      'The workflow "Access Sync", running as the custom role "Cleanup Crew" with the permissions the API key "terraform" gave it, deleted a team',
    );
    expect(
      withholdAuditRecordNameInSentence(
        'alice@example.com took a custom role away from an API key "Admins"',
      ),
    ).toBe("alice@example.com took a custom role away from an API key");
  });

  test("every saying but an MCP client's, as an alert, a case and a feed quote it", () => {
    for (const saying of getAuditChangeSayings()) {
      const sentence: string = `alice@example.com ${saying.named} "Secret Name"`;
      const said: string = withholdAuditRecordNameInSentence(sentence);

      if (saying.resourceType === AuditResourceType.McpClientAuthorization) {
        // What an MCP client's authorization quotes may be the actor's client.
        expect(said).toBe(sentence);
        continue;
      }

      expect([saying.resourceType, saying.action, said]).toEqual([
        saying.resourceType,
        saying.action,
        `alice@example.com ${saying.unnamed}`,
      ]);
    }
  });

  test("only the types withheld, when told which", () => {
    expect(
      withholdAuditRecordNameInSentence(stored, (resourceType: string) => {
        return resourceType !== AuditResourceType.ApiKey;
      }),
    ).toBe(stored);
  });

  test("an alert's description: its sample line reworded, every other line as it was", () => {
    const description: string = [
      "Somebody created an API key or gave an MCP client access to the project.",
      "Detection rule matched 1 security event between 10:00 and 10:15.",
      `Sample event: ${stored}`,
      "Observables: ci, 203.0.113.9",
    ].join("\n\n");

    expect(withholdAuditRecordNamesInSampleLines(description)).toBe(
      description.replace(stored, now),
    );
  });

  test("a case's description, which quotes the sample as code", () => {
    const description: string = `Detection rule **New API key** matched 1 security event.\n\nSample event: ${markdownCodeSpan(stored)}`;

    expect(withholdAuditRecordNamesInSampleLines(description)).toBe(
      `Detection rule **New API key** matched 1 security event.\n\nSample event: ${markdownCodeSpan(now)}`,
    );
  });

  test("a case opened by hand from the event, which quotes its message", () => {
    const description: string = `Opened by hand from a Account Change security event.\n\n**Message:** ${markdownCodeSpan(stored)}`;

    expect(withholdAuditRecordNamesInSampleLines(description)).toBe(
      `Opened by hand from a Account Change security event.\n\n**Message:** ${markdownCodeSpan(now)}`,
    );
  });

  test("a message quoted as code with backticks in it, and a line that ends in spaces", () => {
    const withTicks: string = 'alice created the API key "a`b"';

    expect(
      withholdAuditRecordNamesInSampleLines(
        `Sample event: ${markdownCodeSpan(withTicks)}   \nnext`,
      ),
    ).toBe(
      `Sample event: ${markdownCodeSpan("alice created an API key")}   \nnext`,
    );
  });

  test("a sample that is not the audit log's, or says no name, is as it was", () => {
    const other: string =
      "Sample event: Failed password for root from 203.0.113.9 port 22";

    expect(withholdAuditRecordNamesInSampleLines(other)).toBe(other);
    expect(withholdAuditRecordNamesInSampleLines(`Sample event: ${now}`)).toBe(
      `Sample event: ${now}`,
    );
    expect(withholdAuditRecordNamesInSampleLines("")).toBe("");
    expect(SAMPLE_EVENT_PREFIXES).toEqual(["Sample event: ", "**Message:** "]);
  });

  test("a case feed's list of the events added as evidence, one a line", () => {
    const lines: string = [
      `- 2026-11-10 10:00 UTC · Low · ${stored}`,
      "- 2026-11-10 10:01 UTC · High · Failed password for root",
    ].join("\n");

    expect(withholdAuditRecordNamesInEachLine(lines)).toBe(
      [
        `- 2026-11-10 10:00 UTC · Low · ${now}`,
        "- 2026-11-10 10:01 UTC · High · Failed password for root",
      ].join("\n"),
    );
  });
});
