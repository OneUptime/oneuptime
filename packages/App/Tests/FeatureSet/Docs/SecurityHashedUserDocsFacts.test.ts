import { SECURITY_EVENTS } from "./AiObservabilityDocsPages";
import { DocsHeading, readPage, scanMarkdown } from "./DocsContentSupport";
import { DROP_FILTERS_AND_SCRUB_RULES } from "./TelemetryAdminDocsPages";
import { HIDDEN_BY_A_SCRUB_RULE } from "../../../FeatureSet/Dashboard/src/Components/SecurityEvents/HiddenClientAddressCopy";
import {
  SecurityEventDetailField,
  buildHiddenUserField,
} from "../../../FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventDetailFields";
import SecurityUserVault from "Common/Models/AnalyticsModels/SecurityUserVault";
import { nameHashedUser } from "Common/Server/Utils/SecurityEvent/UserVault/SecurityUserVaultLookup";
import { hashesUsers } from "Common/Server/Utils/SecurityEvent/UserVault/SecurityUserVaultWriter";
import { JSONObject } from "Common/Types/JSON";
import LogScrubAction from "Common/Types/Log/LogScrubAction";
import LogScrubPatternType from "Common/Types/Log/LogScrubPatternType";
import {
  SecurityEntityType,
  canActOnSecurityEntity,
} from "Common/Types/SecurityCase/SecurityEntity";
import { SECURITY_USER_VAULT_RETENTION_IN_DAYS } from "Common/Types/SecurityEvent/SecurityUserVaultRetention";
import {
  HASHED_USER_ATTRIBUTES,
  SCRUBBED_USER_ATTRIBUTES,
  ScrubbedUserRole,
  USER_HIDDEN_BY_SCRUB_RULE,
  nameHashedEventUser,
  readEventUser,
} from "Common/Utils/SecurityEvent/ScrubbedUser";
import { TRACE_SCAN_ATTRIBUTE_KEYS } from "Common/Utils/SecurityEvent/TelemetryScan/TraceSignals";
import { describe, expect, it } from "@jest/globals";

/*
 * What the docs say about a user a scrub rule hid, held to the code that
 * does it (#10435, #10632): the Security Events page's "Hidden by a scrub
 * rule" (Principal User and Target User say so; a Hash rule's user named by
 * the user vault, what the rule left kept beside it, a token with no user
 * kept staying the user and never acted on), and the scrub rules page's
 * user vault (which users it keeps, for how long, and that a Redact, Mask
 * or IP Address rule keeps none). Their other languages are held line for
 * line by AiToolingAndSecurityDocsTranslations and
 * TelemetryAdminDocsTranslations.
 */

const LINE_BREAK: RegExp = /\n/;
const INLINE_CODE: RegExp = /`([^`]+)`/g;
const TOKEN: string = "[HASHED:5e29db14e508e09a]";

// A section of a page, from its heading to the next heading of its level or above.
function section(markdown: string, heading: string): string {
  const headings: Array<DocsHeading> = scanMarkdown(markdown).headings;
  const index: number = headings.findIndex((entry: DocsHeading): boolean => {
    return entry.text === heading;
  });

  expect({ heading, found: index >= 0 }).toEqual({ heading, found: true });

  const start: DocsHeading = headings[index] as DocsHeading;
  const next: DocsHeading | undefined = headings
    .slice(index + 1)
    .find((entry: DocsHeading): boolean => {
      return entry.level <= start.level;
    });
  const lines: Array<string> = markdown.split(LINE_BREAK);

  return lines
    .slice(start.line, next ? next.line - 1 : lines.length)
    .join("\n");
}

// The one line of a text that starts with these words.
function lineStarting(text: string, start: string): string {
  const line: string | undefined = text
    .split(LINE_BREAK)
    .find((candidate: string): boolean => {
      return candidate.startsWith(start);
    });

  expect({ start, found: line !== undefined }).toEqual({ start, found: true });

  return line as string;
}

function code(text: string): Array<string> {
  return Array.from(text.matchAll(INLINE_CODE)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

describe("the Security Events page on a user a scrub rule hid", () => {
  const hidden: string = section(
    readPage("en", SECURITY_EVENTS),
    "Hidden by a scrub rule",
  );
  const line: string = lineStarting(
    hidden,
    "A rule that redacts or masks a user",
  );

  it("says it as the code does", () => {
    expect(line).toBe(
      "A rule that redacts or masks a user hides them the same way: where the event would name the user, **Principal User** or **Target User** says a scrub rule hid them. Where Security Events reads a user, a rule that hashes keeps the user for it: a request's `enduser.id` or `user.id`, an AI call's user, and a user a log line names, such as a cloud audit log's principal. So the event names the user behind the token, a case about them names the account, and a playbook can act on it as on any other user. What the rule left is in `oneuptime.principal_user_hashed_as` or `oneuptime.target_user_hashed_as`, so you can find the user in your logs and traces, which hold only the token. A token with no user kept for it, such as one made before tokens had a key, stays the event's user: rules count it as one account, and no playbook acts on it.",
    );
  });

  it("has no user where a rule redacted or masked it, and Principal User or Target User says a scrub rule hid it", () => {
    for (const placeholder of ["[REDACTED]", "j***@***.com"]) {
      expect(readEventUser(placeholder).user).toBe("");
    }

    for (const role of [ScrubbedUserRole.Principal, ScrubbedUserRole.Target]) {
      const attributes: JSONObject = {
        [SCRUBBED_USER_ATTRIBUTES[role].hidden]: USER_HIDDEN_BY_SCRUB_RULE,
        [SCRUBBED_USER_ATTRIBUTES[role].scrubbed]: "[REDACTED]",
      };
      const field: SecurityEventDetailField | null = buildHiddenUserField(
        { attributes },
        role,
      );

      expect(field).toMatchObject({
        label:
          role === ScrubbedUserRole.Principal
            ? "Principal User"
            : "Target User",
        value: HIDDEN_BY_A_SCRUB_RULE,
      });
    }
  });

  it("names the user behind a token where Security Events reads one, keeps what the rule left beside it, and lets a playbook act on the account", () => {
    // Where a request's user is read: the paragraph's first two code spans.
    expect([...TRACE_SCAN_ATTRIBUTE_KEYS.userId]).toEqual(
      code(line).slice(0, 2),
    );

    // What the rule left, under the attributes the paragraph names.
    expect([
      HASHED_USER_ATTRIBUTES[ScrubbedUserRole.Principal],
      HASHED_USER_ATTRIBUTES[ScrubbedUserRole.Target],
    ]).toEqual(code(line).slice(2));

    const event: {
      principalUser?: string | undefined;
      targetUser?: string | undefined;
      observables?: Array<string> | undefined;
      attributes: JSONObject;
    } = {
      principalUser: TOKEN,
      observables: [TOKEN],
      attributes: {
        [SCRUBBED_USER_ATTRIBUTES[ScrubbedUserRole.Principal].hidden]:
          USER_HIDDEN_BY_SCRUB_RULE,
        [SCRUBBED_USER_ATTRIBUTES[ScrubbedUserRole.Principal].scrubbed]: TOKEN,
      },
    };

    nameHashedEventUser(event, {
      role: ScrubbedUserRole.Principal,
      hashed: TOKEN,
      named: "alice@example.com",
    });

    expect(event.principalUser).toBe("alice@example.com");
    expect(event.observables).toEqual(["alice@example.com"]);
    expect(
      event.attributes[HASHED_USER_ATTRIBUTES[ScrubbedUserRole.Principal]],
    ).toBe(TOKEN);
    expect(
      event.attributes[
        SCRUBBED_USER_ATTRIBUTES[ScrubbedUserRole.Principal].hidden
      ],
    ).toBeUndefined();

    // The account, as any other user: a playbook may act on it.
    expect(
      canActOnSecurityEntity({
        type: SecurityEntityType.User,
        value: "alice@example.com",
      }),
    ).toBe(true);
  });

  it("keeps a token with no user kept for it as the event's user, one account no playbook acts on", () => {
    expect(nameHashedUser(TOKEN, new Map<string, string>())).toBeNull();
    // A token of the form made before tokens had a key is never looked up.
    expect(
      nameHashedUser(
        "[HASHED:8c87b489]",
        new Map<string, string>([["[HASHED:8c87b489]", "alice@example.com"]]),
      ),
    ).toBeNull();
    expect(readEventUser(TOKEN).user).toBe(TOKEN);
    expect(
      canActOnSecurityEntity({ type: SecurityEntityType.User, value: TOKEN }),
    ).toBe(false);
  });
});

describe("the scrub rules page on Security Events' user vault", () => {
  const line: string = lineStarting(
    readPage("en", DROP_FILTERS_AND_SCRUB_RULES),
    "- **Security Events can still name a hashed user.**",
  );

  it("says it as the code does", () => {
    expect(line).toBe(
      "- **Security Events can still name a hashed user.** Where [Security Events](/docs/telemetry/security-events) reads a user in your logs or traces, such as a request's `enduser.id`, an AI call's user or a cloud audit log's principal, a rule that hashes the user also keeps it beside its token, in a store only Security Events' scans read: no page, search, export, API or AI tool can. So a case about an account your logs show only as a token names the account, and a playbook can act on it. Each user is kept until 30 days after it was last seen. A value hashed where Security Events reads no user, such as an email address in an error message, is never kept, and a rule that redacts or masks keeps nothing. To take one person out of it for good, file an erasure request: see [Erase a person](/docs/telemetry/security-events#erase-a-person).",
    );
  });

  it("keeps each user for as long as it says, from when it was last seen", () => {
    expect(line).toContain(
      `Each user is kept until ${SECURITY_USER_VAULT_RETENTION_IN_DAYS} days after it was last seen.`,
    );
    expect(new SecurityUserVault().tableDescription).toContain(
      `kept ${SECURITY_USER_VAULT_RETENTION_IN_DAYS} days after it was last seen`,
    );
  });

  it("is kept by a rule that hashes, and never by one that redacts or masks, nor by an IP Address rule, whose tokens the address vault keeps", () => {
    const rule: (
      patternType: LogScrubPatternType,
      scrubAction: LogScrubAction,
    ) => Array<{ rule: { patternType: string; scrubAction: string } }> = (
      patternType: LogScrubPatternType,
      scrubAction: LogScrubAction,
    ): Array<{ rule: { patternType: string; scrubAction: string } }> => {
      return [{ rule: { patternType, scrubAction } }];
    };

    expect(
      hashesUsers(rule(LogScrubPatternType.Email, LogScrubAction.Hash)),
    ).toBe(true);
    expect(
      hashesUsers(rule(LogScrubPatternType.Email, LogScrubAction.Redact)),
    ).toBe(false);
    expect(
      hashesUsers(rule(LogScrubPatternType.Email, LogScrubAction.Mask)),
    ).toBe(false);
    expect(
      hashesUsers(rule(LogScrubPatternType.IPAddress, LogScrubAction.Hash)),
    ).toBe(false);
  });

  it("is read by no page, search, export, API or AI tool: the store has no API, MCP tools or readers", () => {
    const model: SecurityUserVault = new SecurityUserVault();

    expect(model.crudApiPath).toBeUndefined();
    expect(model.enableMCP).toBe(false);
    expect(model.getReadPermissions()).toEqual([]);
  });
});
