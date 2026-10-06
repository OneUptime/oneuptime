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
  fireEvent,
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
import KubernetesClusterAiAgent from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/AI/Agent";
import {
  AI_AGENT_NOT_INSTALLED_TEXT,
  AI_AGENT_OTHER_RELEASE_TEXT,
  AI_AGENT_PAGE_SUBTITLE,
  AI_AGENT_PAGE_TITLE,
  AI_AGENT_READY_TEXT,
  AI_AGENT_SILENT_TEXT,
  ASK_PROJECT_ADMIN_TEXT,
  AUTOMATIC_INVESTIGATION_CONFIRMATIONS,
  AUTOMATIC_INVESTIGATION_LINE,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesAiAgentStatus";
import {
  INVESTIGATION_ON_SENTENCE,
  REMEDIATION_MODE_SUMMARIES,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesAiAccessSettings";
import {
  AI_AGENT_CLUSTER_WIDE_NAMESPACES_FLAG,
  AI_AGENT_EXAMPLE_WRITE_NAMESPACES,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesAiAccessSetup";
import {
  AI_ACCESS_PROTECTIONS_TITLE,
  formatAiAccessProtections,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AiAccess/AiAccessModes";
import { AI_ACCESS_ALLOWLIST_EMPTY_TEXT } from "../../../../App/FeatureSet/Dashboard/src/Components/AiAccess/AiAccessRow";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import Project from "../../../Models/DatabaseModels/Project";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import {
  KubernetesAiAccessGap,
  KubernetesAiAccessGapCode,
  KubernetesAiAgentSummary,
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
  KUBERNETES_AI_AGENT_ALIVE_WINDOW_IN_MINUTES,
  KUBERNETES_AI_AGENT_DISPLAY_NAME,
  PROTECTED_KUBERNETES_NAMESPACES,
} from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "../../../UI/Utils/Permission";
import User from "../../../UI/Utils/User";
import { toSentenceTerm } from "../../../UI/Utils/TranslateTemplate";
import { goTo, PROJECT_ID } from "./SideMenuHarness";

/*
 * The cluster's AI agent page in the reader's language, read from the
 * shipped locale files.
 *
 * Most of the page used to read English in every language: its sentences
 * were plain strings, or had their values - the project's name, the agent's
 * name, a Runner's, the alive window - glued in, so no locale file could
 * hold a key for them. Each is now one whole key with its values in
 * {{placeholders}}, and the locale puts each value where its grammar wants
 * it: German keeps the English order of "Turn on automatic investigation?",
 * Japanese moves the project's name to the middle of the sentence.
 *
 * The Dashboard sets i18next up once, globally, with react-i18next; so
 * does this file. Each jest file has its own module registry, so it
 * reaches no other suite.
 */

const WAIT_TIMEOUT: number = 20000;

const CLUSTER_ID: ObjectID = new ObjectID(
  "44444444-0000-4000-8000-000000000004",
);
const AGENT_PAGE_PATH: string = `/dashboard/${PROJECT_ID}/kubernetes/${CLUSTER_ID.toString()}/ai/agent`;
const PROJECT_NAME: string = "Acme";

const TITLE: string = "Turn on automatic investigation?";
const TURN_ON: string = "Turn on";
const CANCEL: string = "Cancel";
const OPEN_SETTINGS: string = "Open settings";
const UNNAMED_PROJECT: string = "this project";

const LANGUAGES: Array<string> = ["de", "fr", "ja"];

const BASE_PERMISSIONS: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
];

// May turn the project's opt-ins on, and change the cluster's AI access.
const ADMIN_PERMISSIONS: Array<Permission> = [
  ...BASE_PERMISSIONS,
  Permission.ProjectAdmin,
];

// May see the page, and nothing more.
const MEMBER_PERMISSIONS: Array<Permission> = [
  ...BASE_PERMISSIONS,
  Permission.ProjectMember,
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
 * The locale's value for `key`, which may read the same as the English
 * (French says "Investigation", French and Italian say "cluster").
 */
function valueIn(code: string, key: string): string {
  const value: string | undefined = LOCALES[code]![key];

  if (!value) {
    throw new Error(`${code}.json has no "${key}".`);
  }

  return value;
}

// A word the locale puts into the middle of a sentence ({{noun}}).
function termIn(code: string, key: string): string {
  return toSentenceTerm(valueIn(code, key), code);
}

// The locale's list of the protected namespaces, joined with "and" or "or".
function namespacesIn(code: string, conjunction: "and" | "or"): string {
  return filledIn(code, `{{first}}, {{second}} ${conjunction} {{third}}`, {
    first: PROTECTED_KUBERNETES_NAMESPACES[0]!,
    second: PROTECTED_KUBERNETES_NAMESPACES[1]!,
    third: PROTECTED_KUBERNETES_NAMESPACES[2]!,
  });
}

// The locale's sentence for `template`, with the project's name in its slot.
function sentenceIn(code: string, template: string, project: string): string {
  return wordingIn(code, template).replace("{{project}}", project);
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

/*
 * The locale's sentence for `template` as a pattern, for a value the test
 * cannot know exactly (a date, "a few seconds ago").
 */
function patternIn(code: string, template: string): RegExp {
  return new RegExp(
    wordingIn(code, template)
      .split(/\{\{\w+\}\}/)
      .map((part: string): string => {
        return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      })
      .join(".+"),
  );
}

let postSpy: ReturnType<typeof jest.spyOn>;
let updateByIdSpy: ReturnType<typeof jest.spyOn>;
let getItemSpy: ReturnType<typeof jest.spyOn>;

function makeAgent(
  overrides: Partial<KubernetesAiAgentSummary> = {},
): KubernetesAiAgentSummary {
  return {
    id: "99999999-0000-4000-8000-000000000009",
    isOnline: true,
    connectionStatus: "connected",
    lastAliveAt: new Date().toISOString(),
    agentVersion: "14.1.0",
    posture: {
      clusterIdentifier: "prod-east",
      inCluster: true,
      allowWrites: false,
      writeNamespaces: [],
      podNamespace: "monitoring",
      kubectlVersion: "v1.31.2",
    },
    ...overrides,
  };
}

// The cluster reached through its agent; nothing needs attention.
function makeStatus(
  overrides: Partial<KubernetesClusterAiAccessStatus> = {},
  agent: KubernetesAiAgentSummary = makeAgent(),
): KubernetesClusterAiAccessStatus {
  return {
    clusterId: CLUSTER_ID.toString(),
    clusterName: "prod-east",
    clusterIdentifier: "prod-east",
    runner: {
      id: agent.id,
      name: KUBERNETES_AI_AGENT_DISPLAY_NAME,
      kind: "ai_agent",
      isOnline: agent.isOnline,
      lastAliveAt: agent.lastAliveAt,
      canRunAiCommands: true,
      posture: agent.posture,
    },
    accessMethod: "in_cluster",
    aiAgent: agent,
    automaticInvestigation: { incidents: false, alerts: false },
    kubectlAllowlist: [],
    isInvestigationEnabled: true,
    isInvestigationReady: true,
    remediationMode: KubernetesAiRemediationMode.Disabled,
    isRemediationReady: false,
    gaps: [],
    evaluatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function gap(
  code: KubernetesAiAccessGapCode,
  blocks: KubernetesAiAccessGap["blocks"] = "both",
): KubernetesAiAccessGap {
  return {
    code,
    title: `title of ${code}`,
    description: `description of ${code}`,
    nextStep: `next step for ${code}`,
    blocks,
  };
}

function serve(status: KubernetesClusterAiAccessStatus): void {
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

function openAgentPage(currentProject: Project | null): void {
  goTo(AGENT_PAGE_PATH);

  render(
    <MemoryRouter initialEntries={[AGENT_PAGE_PATH]}>
      <Routes>
        <PageRoute
          path={String(RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_AI_AGENT])}
          element={
            <KubernetesClusterAiAgent
              pageRoute={
                RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_AI_AGENT] as Route
              }
              currentProject={currentProject}
              hasPaymentMethod={true}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

function acme(): Project {
  return Object.assign(new Project(), { name: PROJECT_NAME });
}

async function findTestId(testId: string): Promise<HTMLElement> {
  return await screen.findByTestId(testId, {}, { timeout: WAIT_TIMEOUT });
}

// Opens the dialog from the footer's Turn on and returns it.
async function openConfirmation(code: string): Promise<HTMLElement> {
  fireEvent.click(
    await findTestId("ai-access-automatic-investigation-turn-on"),
  );

  return await screen.findByRole(
    "dialog",
    { name: wordingIn(code, TITLE) },
    { timeout: WAIT_TIMEOUT },
  );
}

function descriptionOf(dialog: HTMLElement): string {
  return (
    within(dialog).getByTestId("confirm-modal-description").textContent || ""
  );
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
  updateByIdSpy = jest.spyOn(ModelAPI, "updateById");
  updateByIdSpy.mockImplementation(
    async (): Promise<HTTPResponse<JSONObject>> => {
      return new HTTPResponse<JSONObject>(200, {}, {});
    },
  );
  // The Change modal reads the cluster's saved settings.
  getItemSpy = jest.spyOn(ModelAPI, "getItem");
  getItemSpy.mockImplementation(async (): Promise<KubernetesCluster> => {
    return Object.assign(new KubernetesCluster(), {
      _id: CLUSTER_ID.toString(),
      isAiInvestigationEnabled: true,
      aiRemediationMode: KubernetesAiRemediationMode.Disabled,
      aiKubectlCommandAllowlist: [],
    });
  });
  jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

afterAll(async () => {
  await setLanguage("en");
});

describe("the automatic investigation dialog in the reader's language", () => {
  test.each(LANGUAGES)(
    "%s: the title, the sentence with the project's name, the buttons, the link and the notice",
    async (code: string) => {
      await setLanguage(code);
      serve(makeStatus());
      openAgentPage(acme());

      const dialog: HTMLElement = await openConfirmation(code);

      expect(descriptionOf(dialog)).toBe(
        sentenceIn(
          code,
          AUTOMATIC_INVESTIGATION_CONFIRMATIONS.incidentsAndAlerts,
          PROJECT_NAME,
        ),
      );
      expect(
        within(dialog)
          .getByTestId("modal-footer-submit-button")
          .textContent?.trim(),
      ).toBe(wordingIn(code, TURN_ON));
      expect(
        within(dialog)
          .getByTestId("modal-footer-close-button")
          .textContent?.trim(),
      ).toBe(wordingIn(code, CANCEL));
      expect(
        within(dialog)
          .getByText(wordingIn(code, OPEN_SETTINGS))
          .closest("a")
          ?.getAttribute("href"),
      ).toBe(`/dashboard/${PROJECT_ID}/incidents/ai/settings`);

      fireEvent.click(within(dialog).getByTestId("modal-footer-submit-button"));

      await waitFor(
        () => {
          expect(updateByIdSpy).toHaveBeenCalledTimes(1);
        },
        { timeout: WAIT_TIMEOUT },
      );
      const request: JSONObject = updateByIdSpy.mock.calls[0]![0] as JSONObject;
      expect(request["modelType"]).toBe(Project);
      expect(String(request["id"])).toBe(PROJECT_ID);
      expect(request["data"]).toEqual({
        enableAutomaticIncidentInvestigation: true,
        enableAutomaticAlertInvestigation: true,
      });

      // The notice was a property the extractor does not read: English.
      expect(await findTestId("ai-agent-action-notice")).toHaveTextContent(
        wordingIn(code, "Automatic investigation is on for this project."),
      );
    },
  );

  test.each([
    {
      what: "incidents",
      settings: { incidents: false, alerts: true },
      template: AUTOMATIC_INVESTIGATION_CONFIRMATIONS.incidents,
    },
    {
      what: "alerts",
      settings: { incidents: true, alerts: false },
      template: AUTOMATIC_INVESTIGATION_CONFIRMATIONS.alerts,
    },
  ])(
    "de: turning on $what alone reads its own sentence",
    async (data: {
      what: string;
      settings: KubernetesClusterAiAccessStatus["automaticInvestigation"];
      template: string;
    }) => {
      await setLanguage("de");
      serve(makeStatus({ automaticInvestigation: data.settings }));
      openAgentPage(acme());

      expect(descriptionOf(await openConfirmation("de"))).toBe(
        sentenceIn("de", data.template, PROJECT_NAME),
      );
    },
  );

  // Even without the project's name the sentence stays in one language.
  test("de: a project whose name the page does not know is this project, in German", async () => {
    await setLanguage("de");
    serve(makeStatus());
    openAgentPage(null);

    expect(descriptionOf(await openConfirmation("de"))).toBe(
      sentenceIn(
        "de",
        AUTOMATIC_INVESTIGATION_CONFIRMATIONS.incidentsAndAlerts,
        wordingIn("de", UNNAMED_PROJECT),
      ),
    );
  });
});

describe("the AI agent page in the reader's language", () => {
  test.each(LANGUAGES)(
    "%s: the heading, the agent's sentence, the meta line, the ready line and the opt-ins",
    async (code: string) => {
      await setLanguage(code);
      serve(
        makeStatus(
          {},
          makeAgent({
            posture: {
              ...makeAgent().posture!,
              allowWrites: true,
              writeNamespaces: ["web", "api"],
              allowNodeOperations: false,
            },
          }),
        ),
      );
      openAgentPage(acme());

      expect(await findTestId("ai-agent-sentence")).toHaveTextContent(
        wordingIn(code, "The AI agent is running in this cluster."),
      );

      const heading: HTMLElement = screen.getByTestId("ai-agent-page-heading");
      expect(within(heading).getByRole("heading").textContent).toBe(
        wordingIn(code, AI_AGENT_PAGE_TITLE),
      );
      expect(heading).toHaveTextContent(
        wordingIn(code, AI_AGENT_PAGE_SUBTITLE),
      );

      expect(screen.getByTestId("ai-agent-ready")).toHaveTextContent(
        wordingIn(code, AI_AGENT_READY_TEXT),
      );

      const meta: HTMLElement = screen.getByTestId("ai-agent-meta");
      expect(meta.textContent).toMatch(patternIn(code, "last seen {{time}}"));
      expect(meta).toHaveTextContent(
        filledIn(code, "Can change: {{namespaces}}", {
          namespaces: "web, api",
        }),
      );
      expect(meta).toHaveTextContent(wordingIn(code, "node operations off"));

      // Each opt-in's state is translated along with the line.
      expect(
        screen.getByTestId("ai-access-automatic-investigation"),
      ).toHaveTextContent(
        filledIn(code, AUTOMATIC_INVESTIGATION_LINE, {
          incidents: wordingIn(code, "Off"),
          alerts: wordingIn(code, "Off"),
        }),
      );
    },
  );

  test.each(LANGUAGES)(
    "%s: an agent that went quiet: the alive window goes into the sentence",
    async (code: string) => {
      await setLanguage(code);
      serve(
        makeStatus(
          {},
          makeAgent({
            isOnline: false,
            lastAliveAt: new Date(Date.now() - 12 * 60 * 1000).toISOString(),
          }),
        ),
      );
      openAgentPage(acme());

      expect(await findTestId("ai-agent-sentence")).toHaveTextContent(
        filledIn(code, AI_AGENT_SILENT_TEXT, {
          minutes: String(KUBERNETES_AI_AGENT_ALIVE_WINDOW_IN_MINUTES),
        }),
      );
    },
  );

  test.each(LANGUAGES)(
    "%s: not installed: the install sentence, and a step that names the agent in the reader's language",
    async (code: string) => {
      await setLanguage(code);
      serve(
        makeStatus({
          runner: null,
          aiAgent: null,
          accessMethod: "none",
          isInvestigationReady: false,
          gaps: [gap("ai_agent_not_connected")],
        }),
      );
      openAgentPage(acme());

      expect(await findTestId("ai-agent-sentence")).toHaveTextContent(
        wordingIn(code, AI_AGENT_NOT_INSTALLED_TEXT),
      );
      expect(
        screen.getByText(wordingIn(code, AI_AGENT_OTHER_RELEASE_TEXT)),
      ).toBeInTheDocument();
      expect(screen.getByTestId("ai-agent-attention-title")).toHaveTextContent(
        wordingIn(code, "OneUptime AI can't investigate this cluster"),
      );
      // The name, cased mid-sentence: French "l'agent IA Kubernetes".
      expect(
        screen.getByTestId("ai-agent-gap-ai_agent_not_connected"),
      ).toHaveTextContent(
        filledIn(code, "Install the {{agent}} with the command above.", {
          agent: toSentenceTerm(
            wordingIn(code, KUBERNETES_AI_AGENT_DISPLAY_NAME),
            code,
          ),
        }),
      );
    },
  );

  test.each(LANGUAGES)(
    "%s: Needs attention: each project step with its settings link",
    async (code: string) => {
      await setLanguage(code);
      serve(
        makeStatus({
          isInvestigationReady: false,
          gaps: [
            gap("project_ai_disabled"),
            gap("llm_provider_missing"),
            gap("ai_balance_insufficient"),
          ],
        }),
      );
      openAgentPage(acme());

      expect(await findTestId("ai-agent-attention-title")).toHaveTextContent(
        wordingIn(code, "OneUptime AI can't investigate this cluster"),
      );

      for (const [gapCode, step, link] of [
        [
          "project_ai_disabled",
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
    "%s: turning investigation on from its step, and the notice that says so",
    async (code: string) => {
      await setLanguage(code);
      serve(
        makeStatus({
          aiSettingsSource: "oneuptime",
          isInvestigationEnabled: false,
          isInvestigationReady: false,
          gaps: [gap("investigation_disabled", "investigation")],
        }),
      );
      openAgentPage(acme());

      expect(
        await findTestId("ai-agent-gap-investigation_disabled"),
      ).toHaveTextContent(
        wordingIn(code, "Turn on AI investigation with kubectl."),
      );

      fireEvent.click(screen.getByTestId("ai-agent-gap-turn-on-investigation"));

      expect(await findTestId("ai-agent-action-notice")).toHaveTextContent(
        wordingIn(code, "AI may now investigate this cluster with kubectl."),
      );
      const request: JSONObject = updateByIdSpy.mock.calls[0]![0] as JSONObject;
      expect(request["modelType"]).toBe(KubernetesCluster);
      expect(request["data"]).toEqual({ isAiInvestigationEnabled: true });
    },
  );

  test.each(LANGUAGES)(
    "%s: a Runner without a name is unnamed in the reader's language; the credential's name stays as typed",
    async (code: string) => {
      await setLanguage(code);
      serve(
        makeStatus({
          runner: {
            id: "55555555-0000-4000-8000-000000000006",
            name: "",
            kind: "runner",
            isOnline: true,
            lastAliveAt: new Date().toISOString(),
            canRunAiCommands: true,
            posture: { inCluster: false, kubectlVersion: "v1.29.1" },
          },
          accessMethod: "credential",
          credentialId: "cred-1",
          credentialName: "prod token",
        }),
      );
      openAgentPage(acme());

      expect(await findTestId("ai-agent-sentence")).toHaveTextContent(
        filledIn(
          code,
          'Reached through Runner "{{runner}}" with credential "{{credential}}".',
          { runner: wordingIn(code, "(unnamed)"), credential: "prod token" },
        ),
      );
    },
  );

  test.each(LANGUAGES)(
    "%s: another agent that tried to register for this cluster",
    async (code: string) => {
      await setLanguage(code);
      serve(
        makeStatus(
          {},
          makeAgent({
            lastRefusedRegistrationAt: new Date().toISOString(),
            lastRefusedRegistrationReason: "previous_instance_online",
          }),
        ),
      );
      openAgentPage(acme());

      expect(
        (await findTestId("ai-agent-refused-registration")).textContent,
      ).toMatch(
        patternIn(
          code,
          "Another agent tried to register for this cluster at {{time}} while this one was online. If the chart is installed twice with the same cluster name, remove one or give it its own clusterName.",
        ),
      );
    },
  );

  test("de: someone who may not turn the opt-ins on is told whom to ask", async () => {
    grant(MEMBER_PERMISSIONS);
    await setLanguage("de");
    serve(makeStatus());
    openAgentPage(acme());

    expect(
      await findTestId("ai-access-automatic-investigation-ask"),
    ).toHaveTextContent(wordingIn("de", ASK_PROJECT_ADMIN_TEXT));
  });
});

/*
 * The "What AI may do" card and its Change modal in the reader's language.
 * Its rows, badges, mode summaries, hints and the allowlist's words used to
 * read English in every language: the building blocks drew their text as
 * given, and the mode maps were keyed by an enum the extractor cannot read.
 */
describe("What AI may do, in the reader's language", () => {
  async function findRow(testId: string): Promise<HTMLElement> {
    return await findTestId(testId);
  }

  test.each(LANGUAGES)(
    "%s: the rows, their badges and sentences, the card's description and the fixes-off hint",
    async (code: string) => {
      await setLanguage(code);
      serve(makeStatus());
      openAgentPage(acme());

      const investigation: HTMLElement = await findRow(
        "ai-access-investigation",
      );
      expect(within(investigation).getByRole("heading").textContent).toBe(
        valueIn(code, "Investigation"),
      );
      expect(
        screen.getByTestId("ai-access-investigation-badge"),
      ).toHaveTextContent(valueIn(code, "On"));
      expect(
        screen.getByTestId("ai-access-investigation-value"),
      ).toHaveTextContent(wordingIn(code, INVESTIGATION_ON_SENTENCE));

      const fixes: HTMLElement = screen.getByTestId("ai-access-fixes");
      expect(within(fixes).getByRole("heading").textContent).toBe(
        valueIn(code, "Fixes"),
      );
      expect(screen.getByTestId("ai-access-fixes-badge")).toHaveTextContent(
        wordingIn(code, "Off"),
      );
      expect(screen.getByTestId("ai-access-fixes-value")).toHaveTextContent(
        wordingIn(
          code,
          REMEDIATION_MODE_SUMMARIES[KubernetesAiRemediationMode.Disabled],
        ),
      );
      expect(
        screen.getByText(
          filledIn(
            code,
            "For incidents and alerts on this {{noun}}. Changes apply from the next one.",
            { noun: termIn(code, "cluster") },
          ),
        ),
      ).toBeInTheDocument();
      // An admin may turn fixes on: the hint sends them to Change.
      expect(screen.getByTestId("ai-access-fixes-off-hint")).toHaveTextContent(
        wordingIn(
          code,
          "Want AI to propose fixes? Click Change and choose Ask for approval.",
        ),
      );
    },
  );

  test.each(LANGUAGES)(
    "%s: Automatic mode: its summary and the allowlist in effect",
    async (code: string) => {
      await setLanguage(code);
      serve(
        makeStatus({ remediationMode: KubernetesAiRemediationMode.Automatic }),
      );
      openAgentPage(acme());

      expect(await findTestId("ai-access-fixes-badge")).toHaveTextContent(
        wordingIn(code, "Automatic"),
      );
      expect(screen.getByTestId("ai-access-fixes-value")).toHaveTextContent(
        wordingIn(
          code,
          REMEDIATION_MODE_SUMMARIES[KubernetesAiRemediationMode.Automatic],
        ),
      );

      const allowlist: HTMLElement = screen.getByTestId(
        "kubectl-allowlist-in-effect",
      );
      expect(allowlist).toHaveTextContent(wordingIn(code, "kubectl allowlist"));
      expect(allowlist).toHaveTextContent(
        wordingIn(code, AI_ACCESS_ALLOWLIST_EMPTY_TEXT),
      );
    },
  );

  test.each(LANGUAGES)(
    "%s: the write-access panel, its notes and the disclosure, the namespaces listed in the reader's words",
    async (code: string) => {
      await setLanguage(code);
      serve(
        makeStatus({
          remediationMode: KubernetesAiRemediationMode.RequireApproval,
        }),
      );
      openAgentPage(acme());

      const panel: HTMLElement = await findTestId("ai-access-write-commands");
      expect(panel).toHaveTextContent(
        wordingIn(code, "Give the agent write access"),
      );
      expect(
        screen.getByTestId("ai-access-helm-remediation-scoped-note"),
      ).toHaveTextContent(
        filledIn(
          code,
          "Replace {{exampleNamespaces}} with the namespaces AI may fix. Each one must already exist: the chart never creates a namespace, and a missing one fails the whole upgrade. A fix anywhere else is refused. To allow the whole cluster later, use {{clusterWideFlag}} (not =null, which Helm ignores with --reuse-values). nodeOperations=false keeps fixes off nodes; set it to true to allow cordon, uncordon, drain and taint (a drain, a taint or a node patch still waits for a person).",
          {
            exampleNamespaces: AI_AGENT_EXAMPLE_WRITE_NAMESPACES,
            clusterWideFlag: AI_AGENT_CLUSTER_WIDE_NAMESPACES_FLAG,
          },
        ),
      );
      expect(
        screen.getByTestId("ai-access-helm-remediation-note"),
      ).toHaveTextContent(
        filledIn(
          code,
          "{{clusterWideFlag}} clears any namespace list stored on the release, so the agent may change every namespace (needs Helm 3.10 or later). Node operations keep the release's setting.",
          { clusterWideFlag: AI_AGENT_CLUSTER_WIDE_NAMESPACES_FLAG },
        ),
      );
      expect(
        screen.getByTestId("ai-access-write-disclosure"),
      ).toHaveTextContent(
        filledIn(
          code,
          "Write access lets the agent patch and update Deployments, StatefulSets, DaemonSets, ReplicaSets, Jobs, CronJobs, Pods and HPAs, create Jobs and HPAs, and delete Pods and Jobs — and, unless aiAgent.remediation.nodeOperations=false, cordon, uncordon, drain and taint every node. In a namespace, that is equivalent to running any image as any ServiceAccount in that namespace and reading its Secrets. Without aiAgent.remediation.namespaces it applies cluster-wide — {{protectedNamespaces}} and the agent's own namespace included. There OneUptime still holds the line: a change in {{anyProtectedNamespace}} always needs a person, and the agent never changes its own namespace.",
          {
            protectedNamespaces: namespacesIn(code, "and"),
            anyProtectedNamespace: namespacesIn(code, "or"),
          },
        ),
      );
    },
  );

  test.each(LANGUAGES)(
    "%s: the Change modal: the mode cards, the current one marked, the field's help and the protections",
    async (code: string) => {
      await setLanguage(code);
      serve(makeStatus());
      openAgentPage(acme());

      fireEvent.click(await findTestId("ai-access-change-button"));
      const dialog: HTMLElement = await screen.findByRole(
        "dialog",
        {},
        { timeout: WAIT_TIMEOUT },
      );
      const modeField: HTMLElement = await within(dialog).findByTestId(
        "ai-remediation-mode-field",
        {},
        { timeout: WAIT_TIMEOUT },
      );

      expect(
        within(modeField)
          .getAllByRole("radio")
          .map((card: HTMLElement): string => {
            return card.querySelector("span.font-semibold")?.textContent || "";
          }),
      ).toEqual([
        filledIn(code, "{{mode}} (current)", { mode: wordingIn(code, "Off") }),
        wordingIn(code, "Ask for approval"),
        wordingIn(code, "Automatic"),
        wordingIn(code, "Bypass approval"),
      ]);
      expect(
        within(dialog).getByText(
          filledIn(
            code,
            "What AI does when it finds a fix for a problem on this {{noun}}.",
            { noun: termIn(code, "cluster") },
          ),
        ),
      ).toBeInTheDocument();

      const protections: HTMLElement = within(dialog).getByTestId(
        "ai-access-protections",
      );
      expect(protections).toHaveTextContent(
        wordingIn(code, AI_ACCESS_PROTECTIONS_TITLE),
      );
      expect(
        Array.from(
          within(protections)
            .getByTestId("ai-access-protections-list")
            .querySelectorAll("li"),
        ).map((item: Element): string => {
          return item.textContent || "";
        }),
      ).toEqual(
        formatAiAccessProtections([
          wordingIn(
            code,
            "destructive commands (deleting namespaces, volumes, nodes, secrets or CRDs; exec; apply) never run",
          ),
          filledIn(
            code,
            "a write in {{namespaces}}, a node drain, a node taint and a patch of a node always need a human",
            { namespaces: namespacesIn(code, "or") },
          ),
          wordingIn(
            code,
            "the in-cluster agent never changes its own namespace or anything outside the namespaces its chart may write",
          ),
          wordingIn(
            code,
            "an unattended run becomes a proposal when the hourly per-cluster circuit breaker trips or another unattended round already holds the cluster",
          ),
        ]),
      );
    },
  );

  test.each(LANGUAGES)(
    "%s: someone who may not run the connection test is told why",
    async (code: string) => {
      // May read the cluster, not edit it: the test needs edit access.
      grant([...BASE_PERMISSIONS, Permission.ReadKubernetesCluster]);
      await setLanguage(code);
      serve(makeStatus());
      openAgentPage(acme());

      expect(
        (await findTestId("ai-agent-test-permission-note")).textContent,
      ).toMatch(
        patternIn(
          code,
          "Testing the connection needs permission to edit this {{noun}} (one of: {{permissions}}).",
        ),
      );
      expect(
        screen.getByTestId("ai-agent-test-permission-note"),
      ).toHaveTextContent(termIn(code, "cluster"));
    },
  );
});
