import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import * as React from "react";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import {
  CloudConnectionDefinition,
  getCloudConnectionDefinition,
} from "../../../Types/CloudConnection/CloudConnectionCatalog";
import {
  AWS_ROLE_WITHOUT_EXTERNAL_ID_REFUSAL,
  AWS_ROLE_WITHOUT_EXTERNAL_ID_WORDS,
} from "../../../Types/CloudConnection/AwsRoleExternalIdRefusal";
import {
  getAwsExternalIdConditionText,
  getAwsExternalIdForProject,
} from "../../../Types/CloudConnection/CloudConnectionSetupCommands";
import {
  CloudConnectionFailureKind,
  CloudConnectionTestResult,
} from "../../../Types/CloudConnection/CloudConnectionTest";
import { getRefusalText } from "../../../Types/Exception/RefusalWithValues";
import { fillTemplate } from "../../../Types/Translator";
import getJestMockFunction from "../../MockType";
import { readDashboardLocaleAsDrawn } from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import CloudConnectionTestPanel from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/Connect/CloudConnectionTestPanel";

/*
 * AN AWS ROLE WITHOUT THE PROJECT'S EXTERNAL ID, IN THE READER'S LANGUAGE
 * (#10425).
 *
 * A test that refuses such a role (#10405) said "A setting is not right."
 * in the reader's language and the refusal - what to add to the role's
 * trust policy - in English below it, on a German, a Persian or a Japanese
 * page alike. It has a headline and advice of its own now, and its details
 * are the refusal in the reader's language, around the exact condition the
 * setup command writes. Drawn here from the Dashboard's own locale files,
 * as it hands them to i18next.
 */

const AWS: CloudConnectionDefinition = getCloudConnectionDefinition(
  CloudProvider.AWS,
)!;
const PROJECT: string = "11111111-1111-4111-8111-111111111111";
const CONDITION: string = getAwsExternalIdConditionText(
  getAwsExternalIdForProject(PROJECT),
);
const REFUSAL: string = getRefusalText(AWS_ROLE_WITHOUT_EXTERNAL_ID_REFUSAL, {
  condition: CONDITION,
});
const LANGUAGES: ReadonlyArray<string> = ["de", "fa", "ar", "ja"];

const REFUSED: CloudConnectionTestResult = {
  provider: CloudProvider.AWS,
  status: "fail",
  message: REFUSAL,
  failureKind: CloudConnectionFailureKind.Settings,
  durationMs: 40,
};

async function inLanguage(language: string): Promise<void> {
  await act(async (): Promise<void> => {
    await i18next.changeLanguage(language);
  });
}

async function testedAnswer(): Promise<HTMLElement> {
  render(
    <CloudConnectionTestPanel
      definition={AWS}
      readIntervalInMinutes={10}
      runTest={getJestMockFunction().mockResolvedValue(REFUSED) as never}
    />,
  );

  await act(async () => {
    fireEvent.click(screen.getByTestId("cloud-connection-test-button"));
  });

  return await screen.findByTestId("cloud-connection-test-fail");
}

function textOf(element: Element): string {
  return withoutIsolateMarks(element.textContent || "");
}

beforeAll(async () => {
  const resources: Record<string, { translation: Record<string, string> }> = {};

  for (const language of ["en", ...LANGUAGES]) {
    resources[language] = { translation: readDashboardLocaleAsDrawn(language) };
  }

  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources,
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterEach(async () => {
  cleanup();
  await inLanguage("en");
});

afterAll(() => {
  cleanup();
});

describe("a test that refuses an AWS role without the project's external id", () => {
  test("in English: its own headline and advice, and the refusal with its condition as the details", async () => {
    const answer: HTMLElement = await testedAnswer();

    expect(answer).toHaveTextContent(
      AWS_ROLE_WITHOUT_EXTERNAL_ID_WORDS.headline,
    );
    expect(answer).toHaveTextContent(AWS_ROLE_WITHOUT_EXTERNAL_ID_WORDS.advice);
    expect(answer).not.toHaveTextContent("A setting is not right.");
    expect(textOf(screen.getByTestId("cloud-connection-test-details"))).toBe(
      REFUSAL,
    );
  });

  test.each(
    LANGUAGES.map((language: string): [string] => {
      return [language];
    }),
  )(
    "in %s: the headline, the advice and the refusal in that language, the condition as written",
    async (language: string) => {
      const words: Record<string, string> =
        readDashboardLocaleAsDrawn(language);

      await inLanguage(language);

      const answer: HTMLElement = await testedAnswer();
      const details: string = textOf(
        screen.getByTestId("cloud-connection-test-details"),
      );

      expect(textOf(answer)).toContain(
        withoutIsolateMarks(
          words[AWS_ROLE_WITHOUT_EXTERNAL_ID_WORDS.headline]!,
        ),
      );
      expect(textOf(answer)).toContain(
        withoutIsolateMarks(words[AWS_ROLE_WITHOUT_EXTERNAL_ID_WORDS.advice]!),
      );
      expect(textOf(answer)).not.toContain(
        withoutIsolateMarks(words["A setting is not right."]!),
      );
      expect(details).toBe(
        withoutIsolateMarks(
          fillTemplate(words[AWS_ROLE_WITHOUT_EXTERNAL_ID_REFUSAL.template]!, {
            condition: CONDITION,
          }),
        ),
      );
      // The exact condition, and none of the English around it.
      expect(details).toContain(CONDITION);
      expect(details).not.toContain("trusts OneUptime");
      expect(textOf(answer)).not.toContain("external ID");
    },
  );
});
