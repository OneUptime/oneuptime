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
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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
import {
  ADD_AI_CREDITS_STEP,
  WHO_CAN_ADD_AI_CREDITS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ProjectBalance/ProjectBalanceCopy";
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
import Host from "../../../Models/DatabaseModels/Host";
import { getConfiguredOneUptimeUrl } from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/ConfiguredOneUptimeUrl";

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

// A host's agent comes with an installer of its own.
const HOST: ResourceAiAgentDescriptor = getResourceAiAgentDescriptor(
  AiResourceType.Host,
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

function openAgentPage(descriptor: ResourceAiAgentDescriptor = DOCKER): void {
  const pagePath: string = RouteMap[descriptor.agentPage]!.toString()
    .replace(":projectId", PROJECT_ID)
    .replace(":id", RESOURCE_ID);
  goTo(pagePath);

  render(
    <MemoryRouter initialEntries={[pagePath]}>
      <Routes>
        <PageRoute
          path={String(RouteMap[descriptor.agentPage])}
          element={
            <ResourceAiAgentPage
              descriptor={descriptor}
              pageRoute={RouteMap[descriptor.agentPage] as Route}
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

/*
 * A host's AI agent page, with no agent yet: its installer first - how to
 * run it, that it can be read first, what it asks for with the answers the
 * page knows - and the compose snippet folded under "Install it yourself
 * with Docker Compose", every word in the reader's language.
 */
describe("the Host AI agent's installer in the reader's language", () => {
  test.each(LANGUAGES)(
    "%s: the installer, what it asks for and the way by hand",
    async (code: string) => {
      await setLanguage(code);
      jest
        .spyOn(ModelAPI, "getItem")
        .mockImplementation(async (): Promise<unknown> => {
          return Object.assign(new Host(), {
            _id: RESOURCE_ID,
            hostIdentifier: "web-prod-01",
          });
        });
      serve(
        makeStatus({
          resourceType: AiResourceType.Host,
          resourceName: "web-prod-01",
          agent: null,
          gaps: [gap("ai_agent_not_connected")],
          isInvestigationReady: false,
        }),
      );
      openAgentPage(HOST);

      const installer: HTMLElement = await findTestId(
        "ai-agent-install-installer",
      );
      expect(installer).toHaveTextContent(
        wordingIn(code, "Run the installer on the host:"),
      );

      await waitFor(
        () => {
          expect(
            screen.getByTestId("ai-agent-install-installer-notes"),
          ).toHaveTextContent(
            filledIn(
              code,
              "It asks for your OneUptime URL ({{url}}), your project's telemetry ingestion key and this host's name ({{name}}).",
              { url: getConfiguredOneUptimeUrl(), name: "web-prod-01" },
            ),
          );
        },
        { timeout: WAIT_TIMEOUT },
      );

      const notes: HTMLElement = screen.getByTestId(
        "ai-agent-install-installer-notes",
      );
      expect(notes).toHaveTextContent(
        wordingIn(
          code,
          "The first line downloads the script as install.sh, so you can read it before you run it.",
        ),
      );
      expect(notes).toHaveTextContent(
        wordingIn(
          code,
          "It runs privileged, as root, in the host's pid namespace: the host's own systemctl, journalctl and ps run through nsenter. Rootless Docker cannot do that.",
        ),
      );
      expect(
        within(screen.getByTestId("ai-agent-install-by-hand")).getByRole(
          "button",
          {
            name: wordingIn(code, "Install it yourself with Docker Compose"),
          },
        ),
      ).toBeInTheDocument();
    },
  );
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
      ] as Array<[string, string, string]>) {
        const row: HTMLElement = screen.getByTestId(`ai-agent-gap-${gapCode}`);

        expect(row).toHaveTextContent(wordingIn(code, step));
        expect(
          within(row).getByText(wordingIn(code, link)).closest("a"),
        ).not.toBeNull();
      }

      /*
       * Only an owner or someone with Manage Billing may add AI credits
       * (#4470). An admin reads who can, in their language, with no link.
       */
      const creditsRow: HTMLElement = screen.getByTestId(
        "ai-agent-gap-ai_balance_insufficient",
      );

      expect(creditsRow).toHaveTextContent(
        wordingIn(code, ADD_AI_CREDITS_STEP),
      );
      expect(creditsRow).toHaveTextContent(
        wordingIn(code, WHO_CAN_ADD_AI_CREDITS),
      );
      expect(
        within(creditsRow).queryByText(wordingIn(code, "Open AI Credits")),
      ).toBeNull();
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
