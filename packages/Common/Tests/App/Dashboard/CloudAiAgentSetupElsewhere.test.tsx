import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import * as React from "react";
import { I18nextProvider } from "react-i18next";
import CloudAiAgentSetupModal from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudAiAgentSetupModal";
import {
  CLOUD_AI_AGENT_ELSEWHERE_TEXTS,
  getCloudAiAgentElsewhereValues,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudAiAgentSetup";
import { getResourceAiAgentDescriptor } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceAiAgent/ResourceAiAgentDescriptors";
import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import germanLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import persianLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/fa.json";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import { buildCloudAiAgentKey } from "../../../Types/CloudConnection/CloudAiAgentKey";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import AiResourceType from "../../../Types/ResourceAiAgent/AiResourceType";
import {
  AWS_CLOUD_AI_AGENT_WRITE_ROLE_NAME,
  AZURE_CLOUD_AI_AGENT_WRITE_IDENTITY_NAME,
  GCP_CLOUD_AI_AGENT_WRITE_SERVICE_ACCOUNT_ID,
  getAzureCloudAiAgentWriteIdentityId,
} from "../../../Types/ResourceAiAgent/CloudAiAgentNames";
import {
  RESOURCE_AI_AWS_WRITE_ROLE_ARN_ENV,
  RESOURCE_AI_AZURE_WRITE_IDENTITY_ENV,
  RESOURCE_AI_GCP_WRITE_SERVICE_ACCOUNT_ENV,
} from "../../../Types/ResourceAiAgent/ResourceAiAccess";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import { getJestSpyOn } from "../../Spy";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

/*
 * "Run the agent somewhere else", under More fields of Let AI fix problems
 * on a cloud account: what a team that deploys the agent its own way gives
 * it besides the variables, said for each cloud as its setup command makes
 * it - the agent's own identity changes nothing, and each change runs as
 * the write role, identity or account:
 *
 *   - AWS: a role that may only assume OneUptimeAiAgentWrite, which trusts
 *     it and holds the changes' permissions;
 *   - Azure: a managed identity of its own that only reads, and the write
 *     identity oneuptime-ai-agent-write attached;
 *   - Google Cloud: a service account that only reads, with Service Account
 *     Token Creator on the write account oneuptime-ai-agent-write.
 *
 * Drawn for real in English, German and Persian, from the locale files, and
 * held in every other language to its names and placeholders.
 */

jest.mock("../../../UI/Config", () => {
  return {
    ...(jest.requireActual("../../../UI/Config") as Record<string, unknown>),
    HOST: "oneuptime.example.com",
    HTTP_PROTOCOL: "https",
  };
});

const CLOUD_ACCOUNT_ID: string = "30000000-0000-4000-8000-000000000001";
const AZURE_SUBSCRIPTION: string = "7c4a1f2e-9d3b-4e5f-8a6b-1c2d3e4f5a6b";
const GCP_PROJECT: string = "shop-prod-1234";
const KEY_ROUTE: string = "/resource-ai-access/agent-key";
const STATUS_ROUTE: string = "/resource-ai-access/status";

const instances: Record<string, i18n> = {};

beforeAll(async () => {
  for (const [language, locale] of [
    ["en", englishLocale],
    ["de", germanLocale],
    ["fa", persianLocale],
  ] as Array<[string, Record<string, unknown>]>) {
    const instance: i18n = createInstance();

    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: {
        en: { translation: englishLocale },
        [language]: { translation: locale },
      },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });

    instances[language] = instance;
  }
});

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}/cloud/accounts/${CLOUD_ACCOUNT_ID}`);
  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(
    new ObjectID(PROJECT_ID),
  );
  getJestSpyOn(ModelAPI, "getList").mockResolvedValue({
    data: [],
    count: 0,
    skip: 0,
    limit: 10,
  });
  getJestSpyOn(API, "post").mockImplementation(
    async (request: unknown): Promise<unknown> => {
      const url: string = String((request as JSONObject)["url"]);

      if (url.endsWith(KEY_ROUTE)) {
        return new HTTPResponse<JSONObject>(
          200,
          {
            agentKey: buildCloudAiAgentKey({
              cloudAccountId: CLOUD_ACCOUNT_ID,
              secret: "a".repeat(64),
            }),
          },
          {},
        );
      }

      if (url.endsWith(STATUS_ROUTE)) {
        return new HTTPResponse<JSONObject>(
          200,
          {
            resourceId: CLOUD_ACCOUNT_ID,
            resourceName: "prod",
            isAiInvestigationEnabled: true,
            aiRemediationMode: "Disabled",
            aiCommandAllowlist: [],
            agent: null,
            gaps: [],
            isInvestigationReady: true,
            isRemediationReady: false,
          },
          {},
        );
      }

      return new HTTPResponse(200, {}, {});
    },
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

const TYPES: Readonly<Record<CloudProvider, AiResourceType>> = {
  [CloudProvider.AWS]: AiResourceType.AwsAccount,
  [CloudProvider.Azure]: AiResourceType.AzureSubscription,
  [CloudProvider.GCP]: AiResourceType.GoogleCloudProject,
};

const ACCOUNT_IDS: Readonly<Record<CloudProvider, string>> = {
  [CloudProvider.AWS]: "123456789012",
  [CloudProvider.Azure]: AZURE_SUBSCRIPTION,
  [CloudProvider.GCP]: GCP_PROJECT,
};

// The dialog, in a language, with More fields open; the sentence it draws.
async function elsewhereSentence(
  provider: CloudProvider,
  language: string,
): Promise<HTMLElement> {
  await act(async () => {
    render(
      <I18nextProvider i18n={instances[language]!}>
        <CloudAiAgentSetupModal
          descriptor={getResourceAiAgentDescriptor(TYPES[provider])}
          cloudAccountId={new ObjectID(CLOUD_ACCOUNT_ID)}
          provider={provider}
          accountId={ACCOUNT_IDS[provider]}
          isAiLogReadEnabled={false}
          status={null}
          onClose={() => {
            // closed by the test's cleanup
          }}
        />
      </I18nextProvider>,
    );
  });

  // The command is written once the key is in: the variables follow it.
  await screen.findByTestId("cloud-ai-agent-setup-command");

  const moreFields: HTMLElement = screen.getByTestId(
    "cloud-ai-agent-setup-more-fields",
  );

  fireEvent.click(moreFields.querySelector("button") as HTMLElement);

  return screen.getByTestId("cloud-ai-agent-setup-elsewhere");
}

describe("Run the agent somewhere else, in English", () => {
  test("AWS: the role it runs as may only assume the write role, which trusts it and holds the changes", async () => {
    const sentence: HTMLElement = await elsewhereSentence(
      CloudProvider.AWS,
      "en",
    );

    expect(sentence).toHaveTextContent(
      `Deploy the image docker.io/oneuptime/resource-ai-agent:release your own way, with these variables. The role it runs as needs only to assume the write role ${AWS_CLOUD_AI_AGENT_WRITE_ROLE_NAME}, which trusts it and holds the enabled changes' permissions, as the setup command makes them.`,
    );
    // The variables name that write role.
    expect(screen.getByTestId("cloud-ai-agent-setup")).toHaveTextContent(
      `${RESOURCE_AI_AWS_WRITE_ROLE_ARN_ENV}=arn:aws:iam::123456789012:role/OneUptimeAiAgentWrite`,
    );
  });

  test("Azure: an identity of its own that only reads, and the write identity attached", async () => {
    const sentence: HTMLElement = await elsewhereSentence(
      CloudProvider.Azure,
      "en",
    );

    expect(sentence).toHaveTextContent(
      `Deploy the image docker.io/oneuptime/resource-ai-agent:release your own way in Azure, with these variables. Give it a managed identity of its own that only reads, and attach the write identity ${AZURE_CLOUD_AI_AGENT_WRITE_IDENTITY_NAME}, which holds the enabled changes' permissions, as the setup command makes them.`,
    );
    // The variables name that identity, by the resource ID the agent asks for its token with.
    expect(screen.getByTestId("cloud-ai-agent-setup")).toHaveTextContent(
      `${RESOURCE_AI_AZURE_WRITE_IDENTITY_ENV}=${getAzureCloudAiAgentWriteIdentityId(AZURE_SUBSCRIPTION)}`,
    );
  });

  test("Google Cloud: a service account that only reads, with Service Account Token Creator on the write account", async () => {
    const sentence: HTMLElement = await elsewhereSentence(
      CloudProvider.GCP,
      "en",
    );

    expect(sentence).toHaveTextContent(
      `Deploy the image docker.io/oneuptime/resource-ai-agent:release your own way in Google Cloud, with these variables. Run it as a service account that only reads, with Service Account Token Creator on the write account ${GCP_CLOUD_AI_AGENT_WRITE_SERVICE_ACCOUNT_ID}, which holds the enabled changes' permissions, as the setup command makes them.`,
    );
    expect(GCP_CLOUD_AI_AGENT_WRITE_SERVICE_ACCOUNT_ID).toBe(
      "oneuptime-ai-agent-write",
    );
    // The variables name that account, in this project.
    expect(screen.getByTestId("cloud-ai-agent-setup")).toHaveTextContent(
      `${RESOURCE_AI_GCP_WRITE_SERVICE_ACCOUNT_ENV}=oneuptime-ai-agent-write@${GCP_PROJECT}.iam.gserviceaccount.com`,
    );
  });

  test("each cloud names its own write role, identity or account, and no other cloud's", () => {
    expect(getCloudAiAgentElsewhereValues(CloudProvider.AWS)).toEqual({
      image: "docker.io/oneuptime/resource-ai-agent:release",
      writeRole: "OneUptimeAiAgentWrite",
    });
    expect(getCloudAiAgentElsewhereValues(CloudProvider.Azure)).toEqual({
      image: "docker.io/oneuptime/resource-ai-agent:release",
      writeIdentity: "oneuptime-ai-agent-write",
    });
    expect(getCloudAiAgentElsewhereValues(CloudProvider.GCP)).toEqual({
      image: "docker.io/oneuptime/resource-ai-agent:release",
      writeAccount: "oneuptime-ai-agent-write",
    });

    // The one sentence for every cloud that said only "a role" is gone.
    expect(
      Object.prototype.hasOwnProperty.call(
        englishLocale,
        "Deploy the image {{image}} your own way, with these variables and a role that holds the enabled changes' permissions.",
      ),
    ).toBe(false);
  });
});

describe("Run the agent somewhere else, in German and Persian", () => {
  for (const language of ["de", "fa"]) {
    test.each([CloudProvider.AWS, CloudProvider.Azure, CloudProvider.GCP])(
      `${language}: %s's sentence in the reader's language, with its names as they are`,
      async (provider: CloudProvider) => {
        const sentence: HTMLElement = await elsewhereSentence(
          provider,
          language,
        );
        const expected: string = dashboardTranslator(
          language,
        ).translateTemplate(
          CLOUD_AI_AGENT_ELSEWHERE_TEXTS[provider],
          getCloudAiAgentElsewhereValues(provider),
        );
        const drawn: string = withoutIsolateMarks(sentence.textContent || "");

        expect(drawn).toBe(withoutIsolateMarks(expected));
        // Translated: never the English sentence.
        expect(drawn).not.toContain("Deploy the image");
        expect(drawn).not.toContain("your own way");

        for (const name of Object.values(
          getCloudAiAgentElsewhereValues(provider),
        )) {
          expect(drawn).toContain(name);
        }

        if (provider === CloudProvider.GCP) {
          expect(drawn).toContain("Service Account Token Creator");
        }
      },
    );
  }

  test("German words: the Dashboard's own terms for the agent's identities", async () => {
    const azure: string = (await elsewhereSentence(CloudProvider.Azure, "de"))
      .textContent as string;

    expect(azure).toContain("verwaltete Identität");
    expect(azure).toContain("Einrichtungsbefehl");
    cleanup();

    const gcp: string = (await elsewhereSentence(CloudProvider.GCP, "de"))
      .textContent as string;

    expect(gcp).toContain("Dienstkonto");
  });

  test("Persian words: the Dashboard's own terms, read right to left around Latin names", async () => {
    const azure: string = withoutIsolateMarks(
      (await elsewhereSentence(CloudProvider.Azure, "fa"))
        .textContent as string,
    );

    expect(azure).toContain("هویت مدیریت‌شده");
    expect(azure).toContain("فرمان راه‌اندازی");
    cleanup();

    const gcp: string = withoutIsolateMarks(
      (await elsewhereSentence(CloudProvider.GCP, "fa")).textContent as string,
    );

    expect(gcp).toContain("حساب سرویس");
  });
});

describe("Run the agent somewhere else, in every language", () => {
  const PLACEHOLDER: RegExp = /\{\{[a-zA-Z]+\}\}/g;

  function placeholdersOf(text: string): Array<string> {
    return (text.match(PLACEHOLDER) || []).slice().sort();
  }

  test.each(DASHBOARD_LANGUAGES as Array<string>)(
    "%s: each cloud's sentence is translated, with the English placeholders and the Google Cloud role's name",
    (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);

      for (const provider of [
        CloudProvider.AWS,
        CloudProvider.Azure,
        CloudProvider.GCP,
      ]) {
        const english: string = CLOUD_AI_AGENT_ELSEWHERE_TEXTS[provider];
        const translated: string | undefined = words[english];

        expect({ language, provider, translated: Boolean(translated) }).toEqual(
          { language, provider, translated: true },
        );
        expect(translated).not.toBe(english);
        expect(placeholdersOf(translated as string)).toEqual(
          placeholdersOf(english),
        );

        if (provider === CloudProvider.GCP) {
          expect(translated).toContain("Service Account Token Creator");
        }
      }
    },
  );
});
