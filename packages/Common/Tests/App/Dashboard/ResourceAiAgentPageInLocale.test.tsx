import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import fs from "fs";
import path from "path";
import React from "react";
import { MemoryRouter, Route as PageRoute, Routes } from "react-router-dom";
import ResourceAiAgentPage from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceAiAgent/ResourceAiAgentPage";
import {
  ResourceAiAgentDescriptor,
  getResourceAiAgentDescriptor,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceAiAgent/ResourceAiAgentDescriptors";
import { RESOURCE_REMEDIATION_MODE_SUMMARIES } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceAiAgent/ResourceAiAccessSettingsUtil";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Project from "../../../Models/DatabaseModels/Project";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import AiResourceType from "../../../Types/ResourceAiAgent/AiResourceType";
import {
  ResourceAiAccessGap,
  ResourceAiAccessGapCode,
  ResourceAiAccessStatus,
  ResourceAiAgentSummary,
  ResourceAiRemediationMode,
} from "../../../Types/ResourceAiAgent/ResourceAiAccess";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "../../../UI/Utils/Permission";
import User from "../../../UI/Utils/User";
import { toSentenceTerm } from "../../../UI/Utils/TranslateTemplate";
import { goTo, PROJECT_ID } from "./SideMenuHarness";

/*
 * A resource's AI agent page in the reader's language, read from the
 * shipped locale files: the agent card's sentence, the "Needs attention"
 * steps with their settings links, and the "What AI may do" rows.
 *
 * The agent's connected and unreachable sentences, most steps and the
 * settings links used to read English in every language: template
 * literals, plain strings, and a link that drew its title as given. Each
 * is now one whole key, the agent's and the resource's names in
 * {{placeholders}}.
 *
 * The Dashboard sets i18next up once, globally, with react-i18next; so
 * does this file. Each jest file has its own module registry, so it
 * reaches no other suite.
 */

const WAIT_TIMEOUT: number = 20000;

const RESOURCE_ID: string = "44444444-0000-4000-8000-000000000004";

const DOCKER: ResourceAiAgentDescriptor = getResourceAiAgentDescriptor(
  AiResourceType.DockerHost,
);

const LANGUAGES: Array<string> = ["de", "fr", "ja"];

const BASE_PERMISSIONS: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
];

// May loosen AI access and change the project's AI settings.
const ADMIN_PERMISSIONS: Array<Permission> = [
  ...BASE_PERMISSIONS,
  Permission.ProjectAdmin,
];

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

type Locale = Record<string, string>;

function readLocale(code: string): Locale {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${code}.json`), "utf8"),
  ) as Locale;
}

const LOCALES: Record<string, Locale> = {
  de: readLocale("de"),
  fr: readLocale("fr"),
  ja: readLocale("ja"),
};

// The locale's wording of `key`, failing when it has none of its own.
function wordingIn(code: string, key: string): string {
  const value: string | undefined = LOCALES[code]![key];

  if (!value || value === key) {
    throw new Error(`${code}.json has no wording of its own for "${key}".`);
  }

  return value;
}

/*
 * A name as a translated sentence shows it: the locale's word, or the
 * English one where the locale keeps it (most keep the agents' names).
 */
function nameIn(code: string, key: string): string {
  return LOCALES[code]![key] || key;
}

// The locale's sentence for `template`, its {{placeholders}} filled.
function filledIn(
  code: string,
  template: string,
  values: Record<string, string>,
): string {
  let sentence: string = wordingIn(code, template);

  for (const name of Object.keys(values)) {
    sentence = sentence.split(`{{${name}}}`).join(values[name]!);
  }

  return sentence;
}

// The agent and the resource as the sentences name them.
function namesIn(code: string): Record<string, string> {
  return {
    agent: nameIn(code, DOCKER.agentName),
    noun: toSentenceTerm(nameIn(code, DOCKER.noun), code),
  };
}

let postSpy: ReturnType<typeof jest.spyOn>;

function makeAgent(
  overrides: Partial<ResourceAiAgentSummary> = {},
): ResourceAiAgentSummary {
  return {
    agentId: "99999999-0000-4000-8000-000000000009",
    connectionStatus: "connected",
    isOnline: true,
    agentVersion: "14.1.0",
    lastAliveAt: new Date().toISOString(),
    lastRegisteredAt: new Date().toISOString(),
    posture: {
      resourceType: AiResourceType.DockerHost,
      resourceIdentifier: "prod-docker-01",
      agentVersion: "14.1.0",
      allowWrites: false,
      writeTargets: [],
      protectedTargets: [],
      toolVersion: "27.3.1",
      reachable: true,
      details: {},
    },
    ...overrides,
  };
}

function gap(code: ResourceAiAccessGapCode): ResourceAiAccessGap {
  return {
    code,
    title: `Title of ${code}`,
    nextStep: `Next step for ${code}`,
    blocksInvestigation: true,
    blocksRemediation: true,
  };
}

function makeStatus(
  overrides: Partial<ResourceAiAccessStatus> = {},
): ResourceAiAccessStatus {
  return {
    resourceType: AiResourceType.DockerHost,
    resourceId: RESOURCE_ID,
    resourceName: "prod-docker-01",
    isAiInvestigationEnabled: true,
    aiRemediationMode: ResourceAiRemediationMode.Disabled,
    aiCommandAllowlist: [],
    agent: makeAgent(),
    gaps: [],
    isInvestigationReady: true,
    isRemediationReady: false,
    ...overrides,
  };
}

function serve(status: ResourceAiAccessStatus): void {
  postSpy.mockImplementation(async (): Promise<HTTPResponse<JSONObject>> => {
    return new HTTPResponse<JSONObject>(
      200,
      status as unknown as JSONObject,
      {},
    );
  });
}

function grant(permissions: Array<Permission>): void {
  jest.spyOn(User, "isMasterAdmin").mockReturnValue(false);
  jest.spyOn(PermissionUtil, "getAllPermissions").mockReturnValue(permissions);
  jest.spyOn(PermissionUtil, "getGlobalPermissions").mockReturnValue(null);
  jest.spyOn(PermissionUtil, "getProjectPermissions").mockReturnValue({
    projectId: new ObjectID(PROJECT_ID),
    userId: ObjectID.generate(),
    permissions: permissions.map((permission: Permission) => {
      return {
        permission: permission,
        labelIds: [],
        _type: "UserPermission",
      };
    }),
    _type: "UserTenantAccessPermission",
  } as unknown as ReturnType<typeof PermissionUtil.getProjectPermissions>);
}

async function setLanguage(code: string): Promise<void> {
  await act(async (): Promise<void> => {
    await i18next.changeLanguage(code);
  });
}

function openAgentPage(): void {
  const pagePath: string = RouteMap[DOCKER.agentPage]!.toString()
    .replace(":projectId", PROJECT_ID)
    .replace(":id", RESOURCE_ID);
  goTo(pagePath);

  render(
    <MemoryRouter initialEntries={[pagePath]}>
      <Routes>
        <PageRoute
          path={String(RouteMap[DOCKER.agentPage])}
          element={
            <ResourceAiAgentPage
              descriptor={DOCKER}
              pageRoute={RouteMap[DOCKER.agentPage] as Route}
              currentProject={Object.assign(new Project(), { name: "Acme" })}
              hasPaymentMethod={true}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

async function findTestId(testId: string): Promise<HTMLElement> {
  return await screen.findByTestId(testId, {}, { timeout: WAIT_TIMEOUT });
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "de",
    fallbackLng: "en",
    resources: {
      de: { translation: LOCALES["de"]! },
      fr: { translation: LOCALES["fr"]! },
      ja: { translation: LOCALES["ja"]! },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  grant(ADMIN_PERMISSIONS);
  postSpy = jest.spyOn(API, "post");
  jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

afterAll(async () => {
  await setLanguage("en");
});

describe("a resource's AI agent page in the reader's language", () => {
  test.each(LANGUAGES)(
    "%s: a connected agent's sentence names the agent and the resource",
    async (code: string) => {
      await setLanguage(code);
      serve(makeStatus());
      openAgentPage();

      expect(await findTestId("ai-agent-sentence")).toHaveTextContent(
        filledIn(
          code,
          "The {{agent}} is running next to this {{noun}}.",
          namesIn(code),
        ),
      );
    },
  );

  test.each(LANGUAGES)(
    "%s: an agent that cannot reach the resource: its own error, as it said it",
    async (code: string) => {
      await setLanguage(code);
      serve(
        makeStatus({
          agent: makeAgent({
            posture: {
              ...makeAgent().posture!,
              reachable: false,
              reachError: "Cannot connect to the Docker daemon",
            },
          }),
        }),
      );
      openAgentPage();

      expect(await findTestId("ai-agent-sentence")).toHaveTextContent(
        filledIn(
          code,
          "The {{agent}} is running, but it could not reach this {{noun}} at its last check: {{error}} Check its logs:",
          {
            ...namesIn(code),
            error: "Cannot connect to the Docker daemon",
          },
        ),
      );
    },
  );

  test.each(LANGUAGES)(
    "%s: Needs attention: each step in the page's words, with its settings link",
    async (code: string) => {
      await setLanguage(code);
      serve(
        makeStatus({
          agent: makeAgent({ isOnline: false, connectionStatus: "connected" }),
          isInvestigationReady: false,
          gaps: [
            gap("ai_agent_offline"),
            gap("ai_disabled_for_project"),
            gap("llm_provider_missing"),
            gap("ai_balance_insufficient"),
          ],
        }),
      );
      openAgentPage();

      expect(
        await findTestId("ai-agent-gap-ai_agent_offline"),
      ).toHaveTextContent(
        filledIn(
          code,
          "Bring the {{agent}} back online. Its logs say why it is offline (the command is above).",
          { agent: nameIn(code, DOCKER.agentName) },
        ),
      );

      for (const [gapCode, step, link] of [
        [
          "ai_disabled_for_project",
          "Turn on AI for this project.",
          "Open AI Features",
        ],
        [
          "llm_provider_missing",
          "Add an AI provider for this project, or use OneUptime AI credits.",
          "Open LLM Providers",
        ],
        [
          "ai_balance_insufficient",
          "Add AI credits to this project, or turn on auto-recharge.",
          "Open AI Credits",
        ],
      ] as Array<[string, string, string]>) {
        const row: HTMLElement = screen.getByTestId(`ai-agent-gap-${gapCode}`);

        expect(row).toHaveTextContent(wordingIn(code, step));
        expect(
          within(row).getByText(wordingIn(code, link)).closest("a"),
        ).not.toBeNull();
      }
    },
  );

  test.each(LANGUAGES)(
    "%s: What AI may do: the rows, their badges, the fixes summary and the hint",
    async (code: string) => {
      await setLanguage(code);
      serve(makeStatus());
      openAgentPage();

      expect(await findTestId("ai-access-fixes-value")).toHaveTextContent(
        wordingIn(
          code,
          RESOURCE_REMEDIATION_MODE_SUMMARIES[
            ResourceAiRemediationMode.Disabled
          ],
        ),
      );
      expect(screen.getByTestId("ai-access-fixes-badge")).toHaveTextContent(
        wordingIn(code, "Off"),
      );
      expect(
        screen.getByTestId("ai-access-investigation-badge"),
      ).toHaveTextContent(wordingIn(code, "On"));
      expect(screen.getByTestId("ai-access-fixes-off-hint")).toHaveTextContent(
        wordingIn(
          code,
          "Want AI to propose fixes? Click Change and choose Ask for approval.",
        ),
      );
    },
  );
});
