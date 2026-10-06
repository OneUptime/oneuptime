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
import { AUTOMATIC_INVESTIGATION_CONFIRMATIONS } from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesAiAgentStatus";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Project from "../../../Models/DatabaseModels/Project";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import {
  KubernetesAiAgentSummary,
  KubernetesAiAutomaticInvestigationSettings,
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
  KUBERNETES_AI_AGENT_DISPLAY_NAME,
} from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "../../../UI/Utils/Permission";
import User from "../../../UI/Utils/User";
import { goTo, PROJECT_ID } from "./SideMenuHarness";

/*
 * The cluster's AI agent page in the reader's language: the "Turn on
 * automatic investigation?" dialog, read from the shipped locale files.
 *
 * Its sentence names the project. Built with the name already in it, the
 * sentence was no key a locale file could hold, so the dialog read English
 * in every language. Each case is now one whole sentence with a
 * {{project}} slot, and the locale puts the name where its grammar wants
 * it: German keeps the English order, Japanese moves the name to the
 * middle of the sentence.
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

// The locale's sentence for `template`, with the project's name in its slot.
function sentenceIn(code: string, template: string, project: string): string {
  return wordingIn(code, template).replace("{{project}}", project);
}

let postSpy: ReturnType<typeof jest.spyOn>;
let updateByIdSpy: ReturnType<typeof jest.spyOn>;

function makeAgent(): KubernetesAiAgentSummary {
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
  };
}

// A connected agent, with the project's automatic-investigation opt-ins.
function makeStatus(
  automaticInvestigation: KubernetesAiAutomaticInvestigationSettings,
): KubernetesClusterAiAccessStatus {
  const agent: KubernetesAiAgentSummary = makeAgent();

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
    automaticInvestigation,
    kubectlAllowlist: [],
    isInvestigationEnabled: true,
    isInvestigationReady: true,
    remediationMode: KubernetesAiRemediationMode.Disabled,
    isRemediationReady: false,
    gaps: [],
    evaluatedAt: new Date().toISOString(),
  };
}

function serve(
  automaticInvestigation: KubernetesAiAutomaticInvestigationSettings,
): void {
  postSpy.mockImplementation(async (): Promise<HTTPResponse<JSONObject>> => {
    return new HTTPResponse<JSONObject>(
      200,
      makeStatus(automaticInvestigation) as unknown as JSONObject,
      {},
    );
  });
}

// A project owner or admin, who may turn the project's opt-ins on.
function grantProjectAdmin(): void {
  const permissions: Array<Permission> = [
    Permission.Public,
    Permission.User,
    Permission.CurrentUser,
    Permission.ProjectAdmin,
  ];

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

// Opens the dialog from the footer's Turn on and returns it.
async function openConfirmation(code: string): Promise<HTMLElement> {
  fireEvent.click(
    await screen.findByTestId(
      "ai-access-automatic-investigation-turn-on",
      {},
      { timeout: WAIT_TIMEOUT },
    ),
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
  grantProjectAdmin();

  postSpy = jest.spyOn(API, "post");
  updateByIdSpy = jest.spyOn(ModelAPI, "updateById");
  updateByIdSpy.mockImplementation(
    async (): Promise<HTTPResponse<JSONObject>> => {
      return new HTTPResponse<JSONObject>(200, {}, {});
    },
  );
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
  test.each(["de", "fr", "ja"])(
    "%s: the title, the sentence with the project's name, the buttons and the link",
    async (code: string) => {
      await setLanguage(code);
      serve({ incidents: false, alerts: false });
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
      settings: KubernetesAiAutomaticInvestigationSettings;
      template: string;
    }) => {
      await setLanguage("de");
      serve(data.settings);
      openAgentPage(acme());

      expect(descriptionOf(await openConfirmation("de"))).toBe(
        sentenceIn("de", data.template, PROJECT_NAME),
      );
    },
  );

  // Even without the project's name the sentence stays in one language.
  test("de: a project whose name the page does not know is this project, in German", async () => {
    await setLanguage("de");
    serve({ incidents: false, alerts: false });
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
