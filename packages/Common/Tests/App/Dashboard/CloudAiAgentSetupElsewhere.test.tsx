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
  CLOUD_AI_AGENT_ELSEWHERE_IDENTITIES_TEXT,
  CLOUD_AI_AGENT_ELSEWHERE_TEXTS,
  CloudAiAgentElsewhereTexts,
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
import { isolated, withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import { getJestSpyOn } from "../../Spy";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

/*
 * "Run the agent somewhere else", under More fields of Let AI fix problems
 * on a cloud account: what a team that deploys the agent its own way gives
 * it, as each cloud's setup command makes it. First the image, with the
 * variables under that line (in Azure or Google Cloud, where its
 * identities come from); then "Give it two identities", a list of two:
 *
 *   - AWS: a role of its own that may only assume the write role, and the
 *     write role OneUptimeAiAgentWrite, which trusts it and holds the
 *     changes' permissions;
 *   - Azure: a managed identity of its own that only reads, and the write
 *     identity oneuptime-ai-agent-write attached where the agent runs;
 *   - Google Cloud: a service account of its own that only reads, with
 *     Service Account Token Creator on the write account, and the write
 *     account oneuptime-ai-agent-write.
 *
 * Drawn for real in English, German and Persian, from the locale files, and
 * held in every other language to its names, placeholders and colons.
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
const IMAGE: string = "docker.io/oneuptime/resource-ai-agent:release";
const CLOUDS: ReadonlyArray<CloudProvider> = [
  CloudProvider.AWS,
  CloudProvider.Azure,
  CloudProvider.GCP,
];

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

// Each cloud's write role, identity or account, as its last line names it.
const WRITE_NAMES: Readonly<Record<CloudProvider, string>> = {
  [CloudProvider.AWS]: AWS_CLOUD_AI_AGENT_WRITE_ROLE_NAME,
  [CloudProvider.Azure]: AZURE_CLOUD_AI_AGENT_WRITE_IDENTITY_NAME,
  [CloudProvider.GCP]: GCP_CLOUD_AI_AGENT_WRITE_SERVICE_ACCOUNT_ID,
};

interface ElsewhereSection {
  // The line with the image, over the variables.
  deploy: HTMLElement;
  // The list of the two identities.
  identities: HTMLElement;
  // Its two lines.
  items: Array<HTMLElement>;
  // The line over the list.
  identitiesLead: HTMLElement;
  // The variables, as their code block draws them.
  variables: HTMLElement | null;
}

// The dialog, in a language, with More fields open: the section's parts.
async function openElsewhere(
  provider: CloudProvider,
  language: string,
): Promise<ElsewhereSection> {
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

  const deploy: HTMLElement = screen.getByTestId(
    "cloud-ai-agent-setup-elsewhere",
  );
  const identities: HTMLElement = screen.getByTestId(
    "cloud-ai-agent-setup-elsewhere-identities",
  );
  const section: HTMLElement = deploy.parentElement as HTMLElement;

  return {
    deploy,
    identities,
    items: Array.from(identities.querySelectorAll("li")),
    identitiesLead: identities.previousElementSibling as HTMLElement,
    variables: section.querySelector("pre"),
  };
}

// What a line says, without the isolates a Persian line sets its names in.
function said(element: Element): string {
  return withoutIsolateMarks(element.textContent || "");
}

// A line in a language, its names filled in.
function lineIn(
  language: string,
  template: string,
  provider: CloudProvider,
): string {
  return withoutIsolateMarks(
    dashboardTranslator(language).translateTemplate(
      template,
      getCloudAiAgentElsewhereValues(provider),
    ),
  );
}

// Whether `first` comes before `second` in the page.
function comesBefore(first: Element, second: Element): boolean {
  return Boolean(
    first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

describe("Run the agent somewhere else, in English", () => {
  test("AWS: the image with its variables, then a role of its own that may only assume the write role, which trusts it and holds the changes", async () => {
    const section: ElsewhereSection = await openElsewhere(
      CloudProvider.AWS,
      "en",
    );

    expect(section.deploy).toHaveTextContent(
      `Deploy the image ${IMAGE} your own way, with these variables:`,
    );
    expect(section.identitiesLead).toHaveTextContent(
      "Give it two identities, as the setup command does:",
    );
    expect(
      section.items.map((item: HTMLElement): string => {
        return item.textContent || "";
      }),
    ).toEqual([
      "A role of its own that may only assume the write role.",
      `The write role ${AWS_CLOUD_AI_AGENT_WRITE_ROLE_NAME}, which trusts the agent's role and holds the permissions of the changes AI may make.`,
    ]);
    // The variables name that write role.
    expect(section.variables).toHaveTextContent(
      `${RESOURCE_AI_AWS_WRITE_ROLE_ARN_ENV}=arn:aws:iam::123456789012:role/OneUptimeAiAgentWrite`,
    );
  });

  test("Azure: the image in Azure, then a managed identity of its own that only reads, and the write identity attached where the agent runs", async () => {
    const section: ElsewhereSection = await openElsewhere(
      CloudProvider.Azure,
      "en",
    );

    expect(section.deploy).toHaveTextContent(
      `Deploy the image ${IMAGE} your own way in Azure, with these variables:`,
    );
    expect(
      section.items.map((item: HTMLElement): string => {
        return item.textContent || "";
      }),
    ).toEqual([
      "A managed identity of its own that only reads.",
      `The write identity ${AZURE_CLOUD_AI_AGENT_WRITE_IDENTITY_NAME}, attached where the agent runs, which holds the permissions of the changes AI may make.`,
    ]);
    // The variables name that identity, by the resource ID the agent asks for its token with.
    expect(section.variables).toHaveTextContent(
      `${RESOURCE_AI_AZURE_WRITE_IDENTITY_ENV}=${getAzureCloudAiAgentWriteIdentityId(AZURE_SUBSCRIPTION)}`,
    );
  });

  test("Google Cloud: the image in Google Cloud, then a service account that only reads, with Token Creator on the write account, and the write account", async () => {
    const section: ElsewhereSection = await openElsewhere(
      CloudProvider.GCP,
      "en",
    );

    expect(section.deploy).toHaveTextContent(
      `Deploy the image ${IMAGE} your own way in Google Cloud, with these variables:`,
    );
    expect(
      section.items.map((item: HTMLElement): string => {
        return item.textContent || "";
      }),
    ).toEqual([
      "A service account of its own that only reads, with Service Account Token Creator on the write account.",
      `The write account ${GCP_CLOUD_AI_AGENT_WRITE_SERVICE_ACCOUNT_ID}, which holds the permissions of the changes AI may make.`,
    ]);
    expect(GCP_CLOUD_AI_AGENT_WRITE_SERVICE_ACCOUNT_ID).toBe(
      "oneuptime-ai-agent-write",
    );
    // The variables name that account, in this project.
    expect(section.variables).toHaveTextContent(
      `${RESOURCE_AI_GCP_WRITE_SERVICE_ACCOUNT_ENV}=oneuptime-ai-agent-write@${GCP_PROJECT}.iam.gserviceaccount.com`,
    );
  });

  test.each(CLOUDS as Array<CloudProvider>)(
    "%s: the image's line, then its variables, then the two identities - in that order, and two lines only",
    async (provider: CloudProvider) => {
      const section: ElsewhereSection = await openElsewhere(provider, "en");

      expect(section.variables).not.toBeNull();
      expect(comesBefore(section.deploy, section.variables as Element)).toBe(
        true,
      );
      expect(
        comesBefore(section.variables as Element, section.identitiesLead),
      ).toBe(true);
      expect(comesBefore(section.identitiesLead, section.identities)).toBe(
        true,
      );
      expect(section.identities.tagName).toBe("UL");
      expect(section.items).toHaveLength(2);
    },
  );

  test("each cloud names its own write role, identity or account, and no other cloud's", () => {
    expect(getCloudAiAgentElsewhereValues(CloudProvider.AWS)).toEqual({
      image: IMAGE,
      writeRole: "OneUptimeAiAgentWrite",
    });
    expect(getCloudAiAgentElsewhereValues(CloudProvider.Azure)).toEqual({
      image: IMAGE,
      writeIdentity: "oneuptime-ai-agent-write",
    });
    expect(getCloudAiAgentElsewhereValues(CloudProvider.GCP)).toEqual({
      image: IMAGE,
      writeAccount: "oneuptime-ai-agent-write",
    });

    for (const provider of CLOUDS) {
      const texts: CloudAiAgentElsewhereTexts =
        CLOUD_AI_AGENT_ELSEWHERE_TEXTS[provider];
      const writePlaceholders: Array<string> = Object.keys(
        getCloudAiAgentElsewhereValues(provider),
      ).filter((name: string): boolean => {
        return name !== "image";
      });

      // The image is in the first line only, the write name in the last only.
      expect(texts.deploy).toContain("{{image}}");
      expect(texts.ownIdentity).not.toContain("{{");
      expect(writePlaceholders).toHaveLength(1);
      expect(texts.writeIdentity).toContain(`{{${writePlaceholders[0]}}}`);
      expect(texts.writeIdentity).not.toContain("{{image}}");
    }
  });

  test("the sentences these lines replace are gone from the locale files", () => {
    for (const gone of [
      // The one sentence for every cloud that said only "a role".
      "Deploy the image {{image}} your own way, with these variables and a role that holds the enabled changes' permissions.",
      // One run-on sentence per cloud, before this section had a list.
      "Deploy the image {{image}} your own way, with these variables. The role it runs as needs only to assume the write role {{writeRole}}, which trusts it and holds the enabled changes' permissions, as the setup command makes them.",
      "Deploy the image {{image}} your own way in Azure, with these variables. Give it a managed identity of its own that only reads, and attach the write identity {{writeIdentity}}, which holds the enabled changes' permissions, as the setup command makes them.",
      "Deploy the image {{image}} your own way in Google Cloud, with these variables. Run it as a service account that only reads, with Service Account Token Creator on the write account {{writeAccount}}, which holds the enabled changes' permissions, as the setup command makes them.",
    ]) {
      expect(Object.prototype.hasOwnProperty.call(englishLocale, gone)).toBe(
        false,
      );
    }
  });

  test("the names are code, kept whole on a line when they fit one: never broken at a hyphen", async () => {
    const section: ElsewhereSection = await openElsewhere(
      CloudProvider.Azure,
      "en",
    );
    const names: Array<Element> = Array.from(
      section.deploy.parentElement!.querySelectorAll(
        '[data-testid="cloud-ai-agent-setup-elsewhere-name"]',
      ),
    );

    expect(
      names.map((name: Element): string => {
        return name.textContent || "";
      }),
    ).toEqual([IMAGE, AZURE_CLOUD_AI_AGENT_WRITE_IDENTITY_NAME]);

    for (const name of names) {
      expect(name.tagName).toBe("CODE");
      /*
       * A box of its own, as wide as the name or the line: it moves to the
       * next line whole, and only a name longer than the line breaks, at
       * its end - never at "oneuptime-ai-agent-" / "write".
       */
      expect(name).toHaveClass("inline-block", "max-w-full", "break-all");
    }

    // The first line holds the image, the list's last line the write identity.
    expect(section.deploy).toContainElement(names[0] as HTMLElement);
    expect(section.items[1]).toContainElement(names[1] as HTMLElement);
    expect(section.items[0]!.querySelector("code")).toBeNull();
  });
});

describe("Run the agent somewhere else, in German and Persian", () => {
  for (const language of ["de", "fa"]) {
    test.each(CLOUDS as Array<CloudProvider>)(
      `${language}: %s's lines in the reader's language, with its names as they are`,
      async (provider: CloudProvider) => {
        const section: ElsewhereSection = await openElsewhere(
          provider,
          language,
        );
        const texts: CloudAiAgentElsewhereTexts =
          CLOUD_AI_AGENT_ELSEWHERE_TEXTS[provider];

        expect(said(section.deploy)).toBe(
          lineIn(language, texts.deploy, provider),
        );
        expect(said(section.identitiesLead)).toBe(
          lineIn(language, CLOUD_AI_AGENT_ELSEWHERE_IDENTITIES_TEXT, provider),
        );
        expect(said(section.items[0]!)).toBe(
          lineIn(language, texts.ownIdentity, provider),
        );
        expect(said(section.items[1]!)).toBe(
          lineIn(language, texts.writeIdentity, provider),
        );

        // Translated: never the English lines.
        const all: string = said(section.deploy.parentElement as HTMLElement);

        expect(all).not.toContain("Deploy the image");
        expect(all).not.toContain("your own way");
        expect(all).not.toContain("Give it two identities");
        expect(all).not.toContain("of its own");
        expect(all).not.toContain("which holds the permissions");

        // The names as they are.
        expect(said(section.deploy)).toContain(IMAGE);
        expect(said(section.items[1]!)).toContain(WRITE_NAMES[provider]);

        if (provider === CloudProvider.GCP) {
          expect(said(section.items[0]!)).toContain(
            "Service Account Token Creator",
          );
        }
      },
    );
  }

  test("German words: the Dashboard's own terms for the agent's identities", async () => {
    const azure: ElsewhereSection = await openElsewhere(
      CloudProvider.Azure,
      "de",
    );

    expect(said(azure.items[0]!)).toContain("verwaltete Identität");
    expect(said(azure.items[1]!)).toContain("Schreibidentität");
    expect(said(azure.identitiesLead)).toContain("Einrichtungsbefehl");
    cleanup();

    const gcp: ElsewhereSection = await openElsewhere(CloudProvider.GCP, "de");

    expect(said(gcp.items[0]!)).toContain("Dienstkonto");
    expect(said(gcp.items[1]!)).toContain("Schreibkonto");
    cleanup();

    const aws: ElsewhereSection = await openElsewhere(CloudProvider.AWS, "de");

    expect(said(aws.items[1]!)).toContain("Schreibrolle");
  });

  test("Persian words: the Dashboard's own terms, read right to left around Latin names", async () => {
    const azure: ElsewhereSection = await openElsewhere(
      CloudProvider.Azure,
      "fa",
    );

    expect(said(azure.items[0]!)).toContain("هویت مدیریت‌شده");
    expect(said(azure.identitiesLead)).toContain("فرمان راه‌اندازی");
    // Each Latin name is set apart, so it never moves the Persian words around it.
    expect(azure.items[1]!.textContent).toContain(
      isolated(AZURE_CLOUD_AI_AGENT_WRITE_IDENTITY_NAME),
    );
    expect(azure.deploy.textContent).toContain(isolated(IMAGE));
    cleanup();

    const gcp: ElsewhereSection = await openElsewhere(CloudProvider.GCP, "fa");

    expect(said(gcp.items[0]!)).toContain("حساب سرویس");
  });

  test("the names are code in every language - and set apart only where the lines read right to left", async () => {
    for (const language of ["en", "de", "fa"]) {
      const section: ElsewhereSection = await openElsewhere(
        CloudProvider.GCP,
        language,
      );
      const names: Array<string> = Array.from(
        section.deploy.parentElement!.querySelectorAll("p code, li code"),
      ).map((code: Element): string => {
        return code.textContent || "";
      });

      expect({ language, names }).toEqual({
        language,
        names: [IMAGE, GCP_CLOUD_AI_AGENT_WRITE_SERVICE_ACCOUNT_ID],
      });

      for (const line of [section.deploy, section.items[1]!]) {
        if (language === "fa") {
          expect(line.textContent).not.toBe(said(line));
        } else {
          expect(line.textContent).toBe(said(line));
        }
      }

      cleanup();
    }
  });
});

describe("Run the agent somewhere else, in every language", () => {
  const PLACEHOLDER: RegExp = /\{\{[a-zA-Z]+\}\}/g;
  // A line a list or a code block follows ends with its language's colon.
  const ENDS_WITH_COLON: RegExp = /[:：]$/;

  function placeholdersOf(text: string): Array<string> {
    return (text.match(PLACEHOLDER) || []).slice().sort();
  }

  // Every line the section can show, on every cloud.
  const LINES: Array<string> = [
    CLOUD_AI_AGENT_ELSEWHERE_IDENTITIES_TEXT,
    ...CLOUDS.flatMap((provider: CloudProvider): Array<string> => {
      const texts: CloudAiAgentElsewhereTexts =
        CLOUD_AI_AGENT_ELSEWHERE_TEXTS[provider];

      return [texts.deploy, texts.ownIdentity, texts.writeIdentity];
    }),
  ];

  test("ten lines in all: three a cloud, and the one over the list", () => {
    expect(new Set(LINES).size).toBe(10);

    for (const line of LINES) {
      expect(readDashboardLocale("en")[line]).toBe(line);
    }
  });

  test.each(DASHBOARD_LANGUAGES as Array<string>)(
    "%s: every line is translated, with the English placeholders, the colons before the variables and the list, and the Google Cloud role's name",
    (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);

      for (const english of LINES) {
        const translated: string | undefined = words[english];

        expect({ language, english, translated: Boolean(translated) }).toEqual({
          language,
          english,
          translated: true,
        });
        expect(translated).not.toBe(english);
        expect(placeholdersOf(translated as string)).toEqual(
          placeholdersOf(english),
        );

        if (ENDS_WITH_COLON.test(english)) {
          expect({ language, english, translated }).toEqual({
            language,
            english,
            translated: expect.stringMatching(ENDS_WITH_COLON),
          });
        }
      }

      expect(
        words[CLOUD_AI_AGENT_ELSEWHERE_TEXTS[CloudProvider.GCP].ownIdentity],
      ).toContain("Service Account Token Creator");
    },
  );
});
