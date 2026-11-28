import { describe, expect, test } from "@jest/globals";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import {
  CloudConnectionField,
  SECURITY_CASE_CHECKS_FIELD_KEY,
  WAF_BLOCKLIST_FIELD_KEY,
  getCloudConnectionDefinition,
} from "../../../Types/CloudConnection/CloudConnectionCatalog";
import {
  ConnectorField,
  SecurityEventConnectorDefinition,
  getSecurityEventConnectorDefinition,
} from "../../../Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import SecurityEventConnectorProvider from "../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import {
  CHECK_ACCOUNT_CHANGES_EDIT_CONNECTION,
  CHECK_ACCOUNT_CHANGES_FACT_AWS_NOT_GRANTED,
  CHECK_ACCOUNT_CHANGES_FACT_AWS_NO_CONNECTION,
  CHECK_ACCOUNT_CHANGES_FACT_AWS_RUN_AGAIN,
  CHECK_ACCOUNT_CHANGES_FACT_GOOGLE_GROUPS,
  CHECK_ACCOUNT_CHANGES_FACT_GOOGLE_GROUPS_SCOPE,
  CHECK_ACCOUNT_CHANGES_OPEN_CLOUD_CONNECTIONS,
  CHECK_ACCOUNT_CHANGES_OPEN_SECURITY_EVENT_CONNECTIONS,
  CHECK_ACCOUNT_CHANGE_INLINE_POLICY_CHANGED,
  CHECK_ACCOUNT_CHANGE_INLINE_POLICY_CONFIRM,
  CHECK_ACCOUNT_CHANGE_INLINE_POLICY_STILL,
  CHECK_ACCOUNT_CHANGE_PROVIDER_ANYONE,
  CHECK_ACCOUNT_CHANGE_PROVIDER_ANY_ORGANIZATION,
  CHECK_ACCOUNT_CHANGE_PROVIDER_HELD,
  CHECK_ACCOUNT_CHANGE_PROVIDER_HELD_TO_SEVERAL,
  CHECK_ACCOUNT_CHANGE_PROVIDER_SAML,
  CHECK_ACCOUNT_CHANGE_ROLE_INLINE_POLICY_CHANGED,
  CHECK_ACCOUNT_CHANGE_ROLE_INLINE_POLICY_CONFIRM,
  CHECK_ACCOUNT_CHANGE_ROLE_INLINE_POLICY_STILL,
} from "../../../Utils/SecurityCase/ResponsePlan/StepCheckWords";
import { isRightToLeftLanguage } from "../../../Types/ReadingDirection";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * WHAT TO GRANT, SAID IN EVERY LANGUAGE AS ITS FORMS SAY IT (#10900, #10901,
 * #11038).
 *
 * The Fix step "Undo what changed on the account" tells a person how to let
 * OneUptime read the rest back: turn on the AWS connection's Security case
 * checks - or, on, run its command again since they read roles too - or add
 * a Google Workspace scope. A person finds the setting by its
 * name, so each language's lines name it as that language's AWS form titles
 * it; the scope is filled in whole, never translated; the setting says, as
 * every other setting that changes the command does in that language, that
 * the command changes with it; and the Google Workspace key's field still
 * names both scopes as Google writes them.
 */

const LANGUAGES: ReadonlyArray<string> = ["en", ...DASHBOARD_LANGUAGES];
const ACCOUNT: string = "123456789012";
const GROUP_MEMBER_SCOPE: string =
  "https://www.googleapis.com/auth/admin.directory.group.member.readonly";

function awsField(key: string): CloudConnectionField {
  const field: CloudConnectionField | undefined = getCloudConnectionDefinition(
    CloudProvider.AWS,
  )?.configFields.find((candidate: CloudConnectionField): boolean => {
    return candidate.key === key;
  });

  expect(field).toBeDefined();

  return field as CloudConnectionField;
}

// A language's wording of an English key: English's own for English.
function wordingOf(language: string, key: string): string {
  const wording: string | undefined = readDashboardLocale(language)[key];

  expect({ language, key, worded: Boolean(wording) }).toEqual({
    language,
    key,
    worded: true,
  });

  return wording as string;
}

// The last sentence of a wording: what follows its last full stop but one.
function lastSentence(wording: string): string {
  const stops: Array<number> = Array.from(
    wording.matchAll(/[.。।](?=\s|$)|。/gu),
  ).map((match: RegExpMatchArray): number => {
    return match.index as number;
  });

  return wording
    .slice(stops.length > 1 ? stops[stops.length - 2]! + 1 : 0)
    .trim();
}

describe("the step names the setting as each language's AWS form titles it", () => {
  const title: string = awsField(SECURITY_CASE_CHECKS_FIELD_KEY).title;

  test("in every language, each AWS line names it, the account filled in", () => {
    expect(title).toBe("Security case checks");

    for (const language of LANGUAGES) {
      const named: string = wordingOf(language, title).toLowerCase();

      for (const key of [
        CHECK_ACCOUNT_CHANGES_FACT_AWS_NO_CONNECTION,
        CHECK_ACCOUNT_CHANGES_FACT_AWS_NOT_GRANTED,
        CHECK_ACCOUNT_CHANGES_FACT_AWS_RUN_AGAIN,
      ]) {
        const line: string = dashboardTranslator(language).translateTemplate(
          key,
          { cloudAccount: ACCOUNT },
        );

        expect({
          language,
          key,
          names: line.toLowerCase().includes(named),
        }).toEqual({ language, key, names: true });
        expect({ language, key, account: line.includes(ACCOUNT) }).toEqual({
          language,
          key,
          account: true,
        });
        expect(line).not.toContain("{{");
      }
    }
  });

  test("in every language, the Google Workspace line fills in the scope whole", () => {
    for (const language of LANGUAGES) {
      for (const key of [
        CHECK_ACCOUNT_CHANGES_FACT_GOOGLE_GROUPS,
        CHECK_ACCOUNT_CHANGES_FACT_GOOGLE_GROUPS_SCOPE,
      ]) {
        const line: string = dashboardTranslator(language).translateTemplate(
          key,
          { scope: GROUP_MEMBER_SCOPE },
        );

        expect({
          language,
          key,
          scope: line.includes(GROUP_MEMBER_SCOPE),
        }).toEqual({ language, key, scope: true });
        expect(line).not.toContain("{{");
      }
    }
  });

  /*
   * #11376: the line says where the connection is, for a reader the link
   * is not drawn for, as that language's menu names it - its words for
   * Security Events and Connections, the way the AWS lines name Cloud →
   * Connect: an arrow that points the way its words are read.
   */
  test("in every language, the Google Workspace line names Security Events → Connections as its menu does", () => {
    for (const language of LANGUAGES) {
      const line: string = wordingOf(
        language,
        CHECK_ACCOUNT_CHANGES_FACT_GOOGLE_GROUPS_SCOPE,
      );
      const arrow: string = isRightToLeftLanguage(language) ? "←" : "→";
      const path: string = `${wordingOf(language, "Security Events")} ${arrow} ${wordingOf(language, "Connections")}`;

      expect({ language, names: line.includes(path) }).toEqual({
        language,
        names: true,
      });
    }
  });

  test("in every language, the link to the page is its own words, as Cloud > Connect's is", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      for (const words of [
        CHECK_ACCOUNT_CHANGES_OPEN_SECURITY_EVENT_CONNECTIONS,
        CHECK_ACCOUNT_CHANGES_OPEN_CLOUD_CONNECTIONS,
        CHECK_ACCOUNT_CHANGES_EDIT_CONNECTION,
      ]) {
        expect({
          language,
          words,
          ownWords: wordingOf(language, words) !== words,
        }).toEqual({ language, words, ownWords: true });
      }
    }
  });
});

/*
 * #11377, #11378: an inline policy said by its document, and whom a role
 * lets in, each a sentence of its own in every language - every value
 * filled in, nothing of English's left where the language has its words.
 */
describe("the lines of an inline policy and of whom a role lets in, in every language", () => {
  const VALUES: Record<string, string> = {
    account: "Deploy",
    object: "ci-deploy",
    provider: "token.actions.githubusercontent.com",
    claim: "sub",
    value: "repo:octo-org/app:*",
  };
  const KEYS: ReadonlyArray<string> = [
    CHECK_ACCOUNT_CHANGE_INLINE_POLICY_STILL,
    CHECK_ACCOUNT_CHANGE_INLINE_POLICY_CHANGED,
    CHECK_ACCOUNT_CHANGE_INLINE_POLICY_CONFIRM,
    CHECK_ACCOUNT_CHANGE_ROLE_INLINE_POLICY_STILL,
    CHECK_ACCOUNT_CHANGE_ROLE_INLINE_POLICY_CHANGED,
    CHECK_ACCOUNT_CHANGE_ROLE_INLINE_POLICY_CONFIRM,
    CHECK_ACCOUNT_CHANGE_PROVIDER_HELD,
    CHECK_ACCOUNT_CHANGE_PROVIDER_ANY_ORGANIZATION,
    CHECK_ACCOUNT_CHANGE_PROVIDER_ANYONE,
    CHECK_ACCOUNT_CHANGE_PROVIDER_SAML,
  ];

  test("each is worded, its own words, every value filled in", () => {
    for (const language of LANGUAGES) {
      for (const key of KEYS) {
        const worded: string = wordingOf(language, key);
        const line: string = dashboardTranslator(language).translateTemplate(
          key,
          VALUES,
        );

        expect(line).not.toContain("{{");

        // Every value the English line names, the language's names too.
        for (const name of key.match(/{{(\w+)}}/g) || []) {
          const value: string = VALUES[name.slice(2, -2)]!;

          expect({ language, key, value, named: line.includes(value) }).toEqual(
            { language, key, value, named: true },
          );
        }

        if (language !== "en") {
          expect({ language, key, ownWords: worded !== key }).toEqual({
            language,
            key,
            ownWords: true,
          });
        }
      }
    }
  });

  test("the count of values a provider is held to, in every language, the first named", () => {
    for (const language of LANGUAGES) {
      for (const count of [2, 5, 21]) {
        const line: string = dashboardTranslator(language).translatePlural(
          CHECK_ACCOUNT_CHANGE_PROVIDER_HELD_TO_SEVERAL,
          count,
          VALUES,
        );

        expect(line).not.toContain("{{");
        expect({
          language,
          count,
          named: line.includes(VALUES["value"]!),
        }).toEqual({ language, count, named: true });
      }
    }
  });
});

describe("the setting, as each language's form draws it", () => {
  const checks: CloudConnectionField = awsField(SECURITY_CASE_CHECKS_FIELD_KEY);
  const blocklist: CloudConnectionField = awsField(WAF_BLOCKLIST_FIELD_KEY);

  test("says the command changes with it, in the words the blocklist's setting beside it uses", () => {
    expect(lastSentence(checks.description)).toBe(
      "The command changes with it.",
    );
    expect(lastSentence(blocklist.description)).toBe(
      "The command changes with it.",
    );

    for (const language of LANGUAGES) {
      expect({
        language,
        ends: lastSentence(wordingOf(language, checks.description)),
      }).toEqual({
        language,
        ends: lastSentence(wordingOf(language, blocklist.description)),
      });
    }
  });

  test("its title, and its two choices, are each language's own words", () => {
    const choices: Array<string> = (checks.options || []).map(
      (option: { label: string }): string => {
        return option.label;
      },
    );

    expect(choices).toEqual(["Off", "On"]);

    for (const language of DASHBOARD_LANGUAGES) {
      for (const words of [checks.title, ...choices]) {
        expect({
          language,
          words,
          ownWords: wordingOf(language, words) !== words,
        }).toEqual({ language, words, ownWords: true });
      }
    }
  });
});

describe("the Google Workspace key's field", () => {
  test("names both scopes as Google writes them, in every language", () => {
    const definition: SecurityEventConnectorDefinition | undefined =
      getSecurityEventConnectorDefinition(
        SecurityEventConnectorProvider.GoogleWorkspace,
      );
    const key: ConnectorField | undefined = definition?.secretFields.find(
      (field: ConnectorField): boolean => {
        return field.key === "serviceAccountJson";
      },
    );

    expect(key?.description).toContain("admin.directory.group.member.readonly");

    for (const language of LANGUAGES) {
      const wording: string = wordingOf(language, key!.description);

      for (const scope of [
        "admin.reports.audit.readonly",
        "admin.directory.group.member.readonly",
      ]) {
        expect({ language, scope, named: wording.includes(scope) }).toEqual({
          language,
          scope,
          named: true,
        });
      }
    }
  });
});
