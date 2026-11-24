import { describe, expect, test } from "@jest/globals";
import crypto from "crypto";
import ScrubAction from "../../../Server/Utils/Telemetry/ScrubAction";
import LogScrubAction from "../../../Types/Log/LogScrubAction";
import LogScrubPatternType from "../../../Types/Log/LogScrubPatternType";
import {
  LLM_USAGE_HIDDEN_GROUP_KEY,
  LlmUsageDimension,
  isLlmUsageHiddenGroup,
} from "../../../Types/Telemetry/LlmUsageApi";
import {
  isLlmCallNameHidden,
  readLlmCallPerson,
  readLlmCallTeam,
} from "../../../Utils/Telemetry/LlmCallIdentity";
import LlmMetricUsageUtil from "../../../Utils/Telemetry/LlmMetricUsage";

/*
 * WHO MADE AN AI CALL, READ PAST WHAT A SCRUB RULE LEFT (#10631).
 *
 * The Usage tab stopped putting AI spend on a "[REDACTED]" person (#10435):
 * a call whose email a rule hid is filed under its id when the rule left
 * that whole, and otherwise under one hidden group. Conversations and the
 * Calls table still drew what the rule left as if it were a person. They
 * now read a call's person with this one reader - the browser's and the
 * transcript's twin of the SQL the Usage tab and the conversation list
 * group by (LlmCallIdentitySql) - so the three always agree:
 *
 *   - the email when no rule touched it, else the id when no rule touched
 *     it;
 *   - else the hidden key when a rule hid either: Redact's "[REDACTED]", a
 *     mask, a Hash token of either form, whole or inside the value - no
 *     token names anybody;
 *   - else "": a call that names nobody, which the views draw apart from
 *     a hidden one.
 *
 * The placeholders are made by the engines' own code where they can be
 * (ScrubAction), so the reader is held to what a rule really leaves.
 */

const PROJECT_ID: string = "0192f1a0-0000-7000-8000-00000000c0a1";

// What an Email rule's action leaves of an address, as ingest runs it.
function leftOfEmail(action: LogScrubAction): string {
  return ScrubAction.apply({
    match: "jane.doe@example.com",
    action,
    patternType: LogScrubPatternType.Email,
    projectId: PROJECT_ID,
  });
}

// A Hash token from before tokens were keyed (#10394): 8 hex characters.
function legacyToken(value: string): string {
  return `[HASHED:${crypto.createHash("sha256").update(value).digest("hex").substring(0, 8)}]`;
}

const REDACTED: string = leftOfEmail(LogScrubAction.Redact);
const MASKED: string = leftOfEmail(LogScrubAction.Mask);
const HASHED: string = leftOfEmail(LogScrubAction.Hash);
const LEGACY_HASHED: string = legacyToken("jane.doe@example.com");

/*
 * Every form a rule leaves of a name: whole, and inside a value (an id a
 * custom rule hid part of, as Auth0's "auth0|" ids are).
 */
const HIDDEN_FORMS: Array<[string, string]> = [
  ["redacted", REDACTED],
  ["redacted inside a value", `auth0|${REDACTED}`],
  ["masked", MASKED],
  ["masked inside a value", "user-***-of-acme"],
  ["a keyed Hash token", HASHED],
  ["a keyed Hash token inside a value", `auth0|${HASHED}`],
  ["a legacy Hash token", LEGACY_HASHED],
  ["a legacy Hash token inside a value", `auth0|${LEGACY_HASHED}`],
];

const ANA: string = "ana@example.com";
const ID: string = "acct-9f2";

describe("what an Email rule leaves, made by the engines", () => {
  test("is what the reader is held to: Redact's text, a mask's stars, a keyed token", () => {
    expect(REDACTED).toBe("[REDACTED]");
    expect(MASKED).toContain("***");
    expect(HASHED).toMatch(/^\[HASHED:[0-9a-f]{16}\]$/);
    expect(LEGACY_HASHED).toMatch(/^\[HASHED:[0-9a-f]{8}\]$/);
  });
});

describe("a call's person", () => {
  test("is its email when no rule touched it, whatever its id", () => {
    expect(readLlmCallPerson({ email: ANA, id: ID })).toBe(ANA);
    expect(readLlmCallPerson({ email: ANA, id: "" })).toBe(ANA);
    expect(readLlmCallPerson({ email: ANA, id: REDACTED })).toBe(ANA);
  });

  test("is its id when it sent no email", () => {
    expect(readLlmCallPerson({ email: "", id: ID })).toBe(ID);
    expect(readLlmCallPerson({ email: undefined, id: ID })).toBe(ID);
    expect(readLlmCallPerson({ email: null, id: ID })).toBe(ID);
  });

  test.each(HIDDEN_FORMS)(
    "is its id when a rule left the id whole and its email is %s",
    (_form: string, email: string) => {
      expect(readLlmCallPerson({ email, id: ID })).toBe(ID);
    },
  );

  test.each(HIDDEN_FORMS)(
    "is its email when a rule left the email whole and its id is %s",
    (_form: string, id: string) => {
      expect(readLlmCallPerson({ email: ANA, id })).toBe(ANA);
    },
  );

  test.each(HIDDEN_FORMS)(
    "is the hidden key when its id is %s and it sent no email",
    (_form: string, id: string) => {
      expect(readLlmCallPerson({ email: "", id })).toBe(
        LLM_USAGE_HIDDEN_GROUP_KEY,
      );
      expect(readLlmCallPerson({ email: undefined, id })).toBe(
        LLM_USAGE_HIDDEN_GROUP_KEY,
      );
    },
  );

  test("is the hidden key when a rule hid both, whichever forms it left", () => {
    for (const [emailForm, email] of HIDDEN_FORMS) {
      for (const [idForm, id] of HIDDEN_FORMS) {
        expect({
          emailForm,
          idForm,
          person: readLlmCallPerson({ email, id }),
        }).toEqual({ emailForm, idForm, person: LLM_USAGE_HIDDEN_GROUP_KEY });
      }
    }
  });

  test.each(HIDDEN_FORMS)(
    "is the hidden key when its email is %s and it has no id",
    (_form: string, email: string) => {
      const person: string = readLlmCallPerson({ email, id: "" });

      expect(person).toBe(LLM_USAGE_HIDDEN_GROUP_KEY);
      expect(isLlmUsageHiddenGroup(person)).toBe(true);
      expect(readLlmCallPerson({ email, id: undefined })).toBe(
        LLM_USAGE_HIDDEN_GROUP_KEY,
      );
    },
  );

  test("is nobody when the call named nobody: unknown, never hidden", () => {
    expect(readLlmCallPerson({ email: "", id: "" })).toBe("");
    expect(readLlmCallPerson({ email: undefined, id: undefined })).toBe("");
    expect(readLlmCallPerson({ email: null, id: null })).toBe("");
    expect(isLlmCallNameHidden(readLlmCallPerson({ email: "", id: "" }))).toBe(
      false,
    );
  });

  test("reads anything that is no text as nothing", () => {
    expect(readLlmCallPerson({ email: 42, id: ID })).toBe(ID);
    expect(readLlmCallPerson({ email: { value: ANA }, id: [ID] })).toBe("");
  });

  // What an unset environment variable sends at the emitter; ingest trims it too.
  test("reads whitespace alone as nothing, and trims a name", () => {
    expect(readLlmCallPerson({ email: "   ", id: ID })).toBe(ID);
    expect(readLlmCallPerson({ email: `  ${ANA}\n`, id: ID })).toBe(ANA);
    expect(readLlmCallPerson({ email: " ", id: "\t" })).toBe("");
    expect(readLlmCallPerson({ email: ` ${REDACTED} `, id: "  " })).toBe(
      LLM_USAGE_HIDDEN_GROUP_KEY,
    );
    expect(readLlmCallPerson({ email: ` ${MASKED} `, id: ` ${ID} ` })).toBe(ID);
  });

  /*
   * What no rule writes is a name: the engines' tokens are lowercase hex,
   * a mask has three stars or more, Redact's text has its brackets. The
   * SQL reads them the same (ScrubPlaceholderSql), so the two agree on
   * these too.
   */
  test.each([
    ["two stars", "a**b@example.com"],
    ["REDACTED without its brackets", "REDACTED"],
    ["an uppercase token", "[HASHED:3F9A1C0E7B2D4A68]"],
    ["a token of another length", "[HASHED:3f9a1c0e7b]"],
    ["a token with a letter past f", "[HASHED:3f9a1c0e7b2d4a6z]"],
  ])("takes %s for a name", (_case: string, name: string) => {
    expect(readLlmCallPerson({ email: name, id: ID })).toBe(name);
    expect(isLlmCallNameHidden(name)).toBe(false);
  });

  /*
   * The Usage tab files a usage metric's person (one name, no id) through
   * LlmMetricUsageUtil.normalizeGroup: a call that sends the same name is
   * read as the same person, or as the same hidden group.
   */
  test("agrees with how the Usage tab files a usage metric's person", () => {
    for (const name of [
      ANA,
      ID,
      "",
      "   ",
      ...HIDDEN_FORMS.map((form: [string, string]): string => {
        return form[1];
      }),
    ]) {
      expect({
        name,
        person: readLlmCallPerson({ email: name, id: "" }),
      }).toEqual({
        name,
        person: LlmMetricUsageUtil.normalizeGroup(
          LlmUsageDimension.Employee,
          name,
        ),
      });
    }
  });
});

describe("a call's team", () => {
  test("is its name when no rule touched it", () => {
    expect(readLlmCallTeam("payments")).toBe("payments");
    expect(readLlmCallTeam("  payments ")).toBe("payments");
  });

  test.each(HIDDEN_FORMS)(
    "is the hidden key when it is %s",
    (_form: string, team: string) => {
      expect(readLlmCallTeam(team)).toBe(LLM_USAGE_HIDDEN_GROUP_KEY);
    },
  );

  test("is nothing when the call named none", () => {
    expect(readLlmCallTeam("")).toBe("");
    expect(readLlmCallTeam("   ")).toBe("");
    expect(readLlmCallTeam(undefined)).toBe("");
    expect(readLlmCallTeam(null)).toBe("");
    expect(readLlmCallTeam(7)).toBe("");
  });

  test("agrees with how the Usage tab files a usage metric's team", () => {
    for (const team of [
      "payments",
      "",
      ...HIDDEN_FORMS.map((form: [string, string]): string => {
        return form[1];
      }),
    ]) {
      expect({ team, read: readLlmCallTeam(team) }).toEqual({
        team,
        read: LlmMetricUsageUtil.normalizeGroup(LlmUsageDimension.Team, team),
      });
    }
  });
});

describe("whether a person or a team is drawn as hidden", () => {
  test("the hidden key is", () => {
    expect(isLlmCallNameHidden(LLM_USAGE_HIDDEN_GROUP_KEY)).toBe(true);
  });

  /*
   * A server that read the person before #10631 answered what the rule
   * left: the page still draws it as hidden, never as a name.
   */
  test.each(HIDDEN_FORMS)(
    "what a rule left is, %s",
    (_form: string, value: string) => {
      expect(isLlmCallNameHidden(value)).toBe(true);
      expect(isLlmCallNameHidden(` ${value} `)).toBe(true);
    },
  );

  test("a name, nothing, and anything that is no text are not", () => {
    expect(isLlmCallNameHidden(ANA)).toBe(false);
    expect(isLlmCallNameHidden(ID)).toBe(false);
    expect(isLlmCallNameHidden("")).toBe(false);
    expect(isLlmCallNameHidden(undefined)).toBe(false);
    expect(isLlmCallNameHidden(null)).toBe(false);
    expect(isLlmCallNameHidden(["[REDACTED]"])).toBe(false);
  });
});
