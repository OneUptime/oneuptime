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
  CHECK_ACCOUNT_CHANGES_FACT_AWS_NOT_GRANTED,
  CHECK_ACCOUNT_CHANGES_FACT_AWS_NO_CONNECTION,
  CHECK_ACCOUNT_CHANGES_FACT_AWS_RUN_AGAIN,
  CHECK_ACCOUNT_CHANGES_FACT_GOOGLE_GROUPS,
} from "../../../Utils/SecurityCase/ResponsePlan/StepCheckWords";
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
      const line: string = dashboardTranslator(language).translateTemplate(
        CHECK_ACCOUNT_CHANGES_FACT_GOOGLE_GROUPS,
        { scope: GROUP_MEMBER_SCOPE },
      );

      expect({ language, scope: line.includes(GROUP_MEMBER_SCOPE) }).toEqual({
        language,
        scope: true,
      });
      expect(line).not.toContain("{{");
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
