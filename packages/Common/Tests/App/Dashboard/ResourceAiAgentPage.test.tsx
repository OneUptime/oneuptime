import "@testing-library/jest-dom";
import {
  afterEach,
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
import React from "react";
import { MemoryRouter, Route as PageRoute, Routes } from "react-router-dom";
import ResourceAiAgentPage from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceAiAgent/ResourceAiAgentPage";
import {
  ResourceAiAgentDescriptor,
  getResourceAiAgentDescriptor,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceAiAgent/ResourceAiAgentDescriptors";
import {
  RESOURCE_AGENT_SET_INVESTIGATION_STEP_TEXT,
  RESOURCE_AI_AGENT_STATUS_POLL_INTERVAL_MS,
  RESOURCE_AI_SETTINGS_SET_BY_TEXT,
  getResourceAiAgentInstallInvestigationText,
  getResourceAiAgentNotInstalledText,
  getResourceAiAgentPageSubtitle,
  getResourceAiAgentReadyText,
  getResourceAiAgentSignedOffText,
  getResourceAiAgentSilentText,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceAiAgent/ResourceAiAgentStatus";
import {
  RESOURCE_REMEDIATION_MODE_SHORT_NAMES,
  RESOURCE_REMEDIATION_MODE_SUMMARIES,
  getEveryModeProtections,
  getResourceInvestigationOnSentence,
  getResourceRemediationModeOptionDescriptions,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceAiAgent/ResourceAiAccessSettingsUtil";
import {
  AI_ACCESS_PROTECTIONS_TITLE,
  AI_FIXES_MODE_TONES,
  AI_FIXES_OFF_AGENT_SET_HINT,
  formatAiAccessProtections,
  getAiAccessCardDescription,
  getAiFixesFieldDescription,
  getAiFixesOffHint,
  getAiInvestigationOffSentence,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AiAccess/AiAccessModes";
import {
  COMPOSE_DIRECTORY_COMMENT,
  RESOURCE_AI_SETTINGS_UPGRADE_STEP_TITLE,
  getResourceAiAgentComposeSnippet,
  getResourceAiAgentLogsCommand,
  getResourceAiAgentServiceName,
  getResourceAiAgentSettingsEnv,
  getResourceAiAgentUpgradeCommand,
  getResourceAiAgentWriteAccessCommands,
  getResourceAiAgentWriteDisclosure,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceAiAgent/ResourceAiAgentInstall";
import { getResourceAccessTestPermissionRequirement } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceAiAgent/ResourceAiAccessPermissions";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import DatabaseServer from "../../../Models/DatabaseModels/DatabaseServer";
import DockerHost from "../../../Models/DatabaseModels/DockerHost";
import Project from "../../../Models/DatabaseModels/Project";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import ExceptionCode from "../../../Types/Exception/ExceptionCode";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import AiResourceType, {
  ALL_AI_RESOURCE_TYPES,
} from "../../../Types/ResourceAiAgent/AiResourceType";
import {
  ResourceAiAccessGap,
  ResourceAiAccessGapCode,
  ResourceAiAccessStatus,
  ResourceAiAgentPosture,
  ResourceAiAgentSummary,
  ResourceAiRemediationMode,
} from "../../../Types/ResourceAiAgent/ResourceAiAccess";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "../../../UI/Utils/Permission";
import User from "../../../UI/Utils/User";
import { goTo, PROJECT_ID } from "./SideMenuHarness";

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

/*
 * A resource's AI agent page (AI → AI agent) renders for real on its real
 * route, with the status, test and reset-agent routes, the model API and
 * the permission snapshot stubbed. One generic page serves every resource
 * type through its descriptor; most cases run on a Docker host, and a
 * table runs the page on each of the eight. Three cards at most: the
 * agent's card in each of its states (connected, offline, unreachable, not
 * installed — with the install instructions), "Needs attention" only when
 * the server has gaps — as ONE item: a headline and a short step per gap —
 * and "What AI may do" — one row for investigation and one for fixes, each
 * with a badge and one plain sentence — with its Change modal, whose mode
 * cards, loosening rules, allowlist checks and confirmations mirror the
 * server's.
 */

// Real components fetch; give the waits room on a loaded CI box.
const WAIT_TIMEOUT: number = 20000;

const RESOURCE_ID: string = "44444444-0000-4000-8000-000000000004";
const AGENT_ID: string = "99999999-0000-4000-8000-000000000009";

const DOCKER: ResourceAiAgentDescriptor = getResourceAiAgentDescriptor(
  AiResourceType.DockerHost,
);

const STATUS_ROUTE: string = "/resource-ai-access/status";
const TEST_ROUTE: string = "/resource-ai-access/test";
const RESET_ROUTE: string = "/resource-ai-access/reset-agent";

const SETTINGS_CARD_TITLE: string = "What AI may do";
const GAPS_CARD_TITLE: string = "Needs attention";

const BASE_PERMISSIONS: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
];

// May edit the resource, but not loosen AI access.
const MEMBER_PERMISSIONS: Array<Permission> = [
  ...BASE_PERMISSIONS,
  Permission.ProjectMember,
];

// May loosen AI access, reset the agent and change project AI settings.
const ADMIN_PERMISSIONS: Array<Permission> = [
  ...BASE_PERMISSIONS,
  Permission.ProjectAdmin,
];

const READER_PERMISSIONS: Array<Permission> = [
  ...BASE_PERMISSIONS,
  Permission.ReadDockerHost,
];

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

function makePosture(
  overrides: Partial<ResourceAiAgentPosture> = {},
): ResourceAiAgentPosture {
  return {
    resourceType: AiResourceType.DockerHost,
    resourceIdentifier: "prod-docker-01",
    agentVersion: "14.1.0",
    allowWrites: false,
    writeTargets: [],
    protectedTargets: [],
    toolVersion: "27.3.1",
    reachable: true,
    details: {},
    ...overrides,
  };
}

function makeAgent(
  overrides: Partial<ResourceAiAgentSummary> = {},
): ResourceAiAgentSummary {
  return {
    agentId: AGENT_ID,
    connectionStatus: "connected",
    isOnline: true,
    agentVersion: "14.1.0",
    lastAliveAt: new Date().toISOString(),
    lastRegisteredAt: minutesAgo(60),
    posture: makePosture(),
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

// A gap with the flags the server gives it, for the headline's sake.
function flaggedGap(
  code: ResourceAiAccessGapCode,
  blocksInvestigation: boolean,
  blocksRemediation: boolean,
): ResourceAiAccessGap {
  return { ...gap(code), blocksInvestigation, blocksRemediation };
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
    gaps: [gap("remediation_disabled")],
    isInvestigationReady: true,
    isRemediationReady: false,
    ...overrides,
  };
}

function notInstalledStatus(): ResourceAiAccessStatus {
  return makeStatus({
    agent: null,
    isInvestigationReady: false,
    gaps: [gap("ai_agent_not_connected")],
  });
}

function statusResponse(
  status: ResourceAiAccessStatus,
): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(200, status as unknown as JSONObject, {});
}

let postSpy: ReturnType<typeof jest.spyOn>;
let getItemSpy: ReturnType<typeof jest.spyOn>;
let updateByIdSpy: ReturnType<typeof jest.spyOn>;
let savedModel: JSONObject = {};

type RouteAnswer = () => Promise<HTTPResponse<JSONObject> | HTTPErrorResponse>;

/*
 * Answers the status route with `status`, and the test and reset routes
 * with their handlers (a plain 200 by default).
 */
function serve(
  status: ResourceAiAccessStatus,
  handlers: { test?: RouteAnswer; reset?: RouteAnswer } = {},
): void {
  postSpy.mockImplementation(
    async (
      request: unknown,
    ): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
      const url: string = String((request as JSONObject)["url"]);
      if (url.endsWith(TEST_ROUTE) && handlers.test) {
        return await handlers.test();
      }
      if (url.endsWith(RESET_ROUTE)) {
        return handlers.reset
          ? await handlers.reset()
          : new HTTPResponse<JSONObject>(200, { ok: true }, {});
      }
      return statusResponse(status);
    },
  );
}

async function failStatusRequest(): Promise<HTTPResponse<JSONObject>> {
  throw new Error("Network Error");
}

// The resource row the modal (and the install instructions) read.
function serveModel(overrides: JSONObject = {}): void {
  savedModel = {
    _id: RESOURCE_ID,
    hostIdentifier: "prod-docker-01",
    name: "prod-docker-01",
    isAiInvestigationEnabled: true,
    aiRemediationMode: ResourceAiRemediationMode.RequireApproval,
    aiCommandAllowlist: [],
    ...overrides,
  };
}

function postsTo(route: string): Array<JSONObject> {
  return postSpy.mock.calls
    .map((call: Array<unknown>): JSONObject => {
      return (call[0] || {}) as JSONObject;
    })
    .filter((request: JSONObject): boolean => {
      return String(request["url"]).endsWith(route);
    });
}

function updateRequests(): Array<JSONObject> {
  return updateByIdSpy.mock.calls.map((call: Array<unknown>): JSONObject => {
    return (call[0] || {}) as JSONObject;
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

function pagePath(descriptor: ResourceAiAgentDescriptor): string {
  return RouteMap[descriptor.agentPage]!.toString()
    .replace(":projectId", PROJECT_ID)
    .replace(":id", RESOURCE_ID);
}

function openAgentPage(descriptor: ResourceAiAgentDescriptor = DOCKER): void {
  const path: string = pagePath(descriptor);
  goTo(path);

  render(
    <MemoryRouter initialEntries={[path]}>
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

async function findText(text: string | RegExp): Promise<HTMLElement> {
  return await screen.findByText(text, {}, { timeout: WAIT_TIMEOUT });
}

async function findTestId(testId: string): Promise<HTMLElement> {
  return await screen.findByTestId(testId, {}, { timeout: WAIT_TIMEOUT });
}

// The command a CodeBlock inside the element shows, exactly.
function codeIn(element: HTMLElement): string {
  return element.querySelector("code")?.textContent || "";
}

async function openChangeModal(
  descriptor: ResourceAiAgentDescriptor = DOCKER,
): Promise<HTMLElement> {
  fireEvent.click(await findTestId("ai-access-change-button"));
  const dialog: HTMLElement = await screen.findByRole(
    "dialog",
    {},
    { timeout: WAIT_TIMEOUT },
  );
  // The form is on screen once its first field label is.
  await within(dialog).findByText(
    descriptor.investigateTitle,
    {},
    { timeout: WAIT_TIMEOUT },
  );
  return dialog;
}

// The Change modal's Fixes picker: one card (role "radio") per mode.
function modeField(dialog: HTMLElement): HTMLElement {
  return within(dialog).getByTestId("ai-remediation-mode-field");
}

function modeCards(dialog: HTMLElement): Array<HTMLElement> {
  return within(modeField(dialog)).getAllByRole("radio");
}

// Each card's title, in the order the picker shows them.
function modeCardTitles(dialog: HTMLElement): Array<string> {
  return modeCards(dialog).map((card: HTMLElement): string => {
    return card.querySelector("span.font-semibold")?.textContent || "";
  });
}

function modeCard(
  dialog: HTMLElement,
  mode: ResourceAiRemediationMode,
): HTMLElement {
  return within(modeField(dialog)).getByTestId(`card-select-option-${mode}`);
}

function pickMode(dialog: HTMLElement, mode: ResourceAiRemediationMode): void {
  fireEvent.click(modeCard(dialog, mode));
  expect(modeCard(dialog, mode)).toHaveAttribute("aria-checked", "true");
}

// The "What AI may do" card, by its title.
async function settingsCard(): Promise<HTMLElement> {
  const card: HTMLElement | null = (
    await findText(SETTINGS_CARD_TITLE)
  ).closest('[data-testid="card"]');
  if (!card) {
    throw new Error(`"${SETTINGS_CARD_TITLE}" is not inside a card.`);
  }
  return card;
}

async function toggleSwitch(
  dialog: HTMLElement,
  testId: string,
  from: boolean,
): Promise<void> {
  const toggle: HTMLElement = within(dialog).getByTestId(testId);
  await waitFor(
    () => {
      expect(toggle).toHaveAttribute("aria-checked", String(from));
    },
    { timeout: WAIT_TIMEOUT },
  );
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute("aria-checked", String(!from));
}

async function setAllowlistText(
  dialog: HTMLElement,
  value: string,
): Promise<void> {
  const field: HTMLElement = await within(dialog).findByTestId(
    "ai-command-allowlist-field",
    {},
    { timeout: WAIT_TIMEOUT },
  );
  fireEvent.change(field, { target: { value } });
}

async function waitForOneUpdate(): Promise<JSONObject> {
  await waitFor(
    () => {
      expect(updateByIdSpy).toHaveBeenCalledTimes(1);
    },
    { timeout: WAIT_TIMEOUT },
  );
  return updateRequests()[0]!["data"] as JSONObject;
}

function saveChangeModal(dialog: HTMLElement): void {
  fireEvent.click(within(dialog).getByTestId("modal-footer-submit-button"));
}

async function findDialogTitled(title: string): Promise<HTMLElement> {
  const heading: HTMLElement = await findText(title);
  const dialog: HTMLElement | null = heading.closest('[role="dialog"]');
  if (!dialog) {
    throw new Error(`"${title}" is not inside a dialog.`);
  }
  return dialog;
}

/*
 * The agent card's actions sit in one ⋯ beside its status: "We can have
 * both of these buttons, like "Test Connection" and "Reset Agent," in a
 * more button style with three dots. Please do this for all the other
 * resources in the project."
 */
const ACTIONS_BUTTON_TEST_ID: string = "ai-agent-actions-button";
const TEST_ACTION_TEST_ID: string = "ai-agent-test-button";
const RESET_ACTION_TEST_ID: string = "ai-agent-reset-button";

// The agent card's header: its status, then its ⋯ when it has one.
async function agentCardHeader(
  descriptor: ResourceAiAgentDescriptor = DOCKER,
): Promise<HTMLElement> {
  const card: HTMLElement | null = (
    await findText(descriptor.agentName)
  ).closest('[data-testid="card"]');
  if (!card) {
    throw new Error(`"${descriptor.agentName}" is not inside a card.`);
  }
  return within(card).getByTestId("card-header-actions");
}

// Opens the agent card's ⋯ and returns the menu it opened.
async function openAgentActions(): Promise<HTMLElement> {
  fireEvent.click(await findTestId(ACTIONS_BUTTON_TEST_ID));
  return await screen.findByRole("menu", {}, { timeout: WAIT_TIMEOUT });
}

// The ⋯'s items, by label, in the order they are listed.
function actionLabels(menu: HTMLElement): Array<string> {
  return within(menu)
    .getAllByRole("menuitem")
    .map((item: HTMLElement): string => {
      return (item.textContent || "").trim();
    });
}

// Picks one of the agent card's actions from its ⋯.
async function pickAgentAction(testId: string): Promise<void> {
  const menu: HTMLElement = await openAgentActions();
  fireEvent.click(within(menu).getByTestId(testId));
}

// The page has loaded, and its agent card has no ⋯ at all.
async function expectNoAgentActions(): Promise<void> {
  await findTestId("ai-agent-status");
  expect(screen.queryByTestId(ACTIONS_BUTTON_TEST_ID)).not.toBeInTheDocument();
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(screen.queryByTestId(TEST_ACTION_TEST_ID)).not.toBeInTheDocument();
  expect(screen.queryByTestId(RESET_ACTION_TEST_ID)).not.toBeInTheDocument();
}

// Answers the test route with a promise the test resolves when it likes.
function holdTheTest(): {
  answer: (value: HTTPResponse<JSONObject>) => void;
} {
  const held: { answer: (value: HTTPResponse<JSONObject>) => void } = {
    answer: (): void => {
      // replaced when the test is asked for
    },
  };
  serve(makeStatus(), {
    test: (): Promise<HTTPResponse<JSONObject>> => {
      return new Promise(
        (resolve: (value: HTTPResponse<JSONObject>) => void) => {
          held.answer = resolve;
        },
      );
    },
  });
  return held;
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  grant(MEMBER_PERMISSIONS);

  postSpy = jest.spyOn(API, "post");
  serve(makeStatus());

  serveModel();
  getItemSpy = jest.spyOn(ModelAPI, "getItem");
  getItemSpy.mockImplementation(async (): Promise<unknown> => {
    return Object.assign(new DockerHost(), savedModel);
  });

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
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("the agent card", () => {
  test("a connected agent: pill, sentence, meta line and the ready line", async () => {
    openAgentPage();

    expect(await findText("Docker AI agent")).toBeInTheDocument();
    expect(await findTestId("ai-agent-status")).toHaveTextContent("Connected");
    expect(screen.getByTestId("ai-agent-sentence")).toHaveTextContent(
      "The Docker AI agent is running next to this Docker host.",
    );
    // The agent's version as it reported it, drawn by AgentVersion.
    expect(screen.getByTestId("ai-agent-meta")).toHaveTextContent(
      "agent 14.1.0 · Docker 27.3.1 · Read-only",
    );
    expect(screen.getByTestId("ai-agent-version")).toHaveTextContent(
      "agent 14.1.0",
    );
    expect(screen.getByTestId("ai-agent-meta")).toHaveTextContent(
      /^last seen /,
    );
    expect(screen.getByTestId("ai-agent-ready")).toHaveTextContent(
      getResourceAiAgentReadyText(DOCKER),
    );
    expect(screen.queryByTestId("ai-agent-install")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("ai-agent-logs-command"),
    ).not.toBeInTheDocument();
  });

  test("not installed: the service to add, pinned to this host's name, and nothing to test", async () => {
    serve(notInstalledStatus());
    openAgentPage();

    expect(await findTestId("ai-agent-status")).toHaveTextContent(
      "Not installed",
    );
    expect(screen.getByTestId("ai-agent-sentence")).toHaveTextContent(
      getResourceAiAgentNotInstalledText(DOCKER),
    );

    // The name the collector reports, read from the host's row.
    await waitFor(
      () => {
        expect(codeIn(screen.getByTestId("ai-agent-install-command"))).toBe(
          getResourceAiAgentComposeSnippet({
            resourceType: AiResourceType.DockerHost,
            resourceId: RESOURCE_ID,
            identity: "prod-docker-01",
          }),
        );
      },
      { timeout: WAIT_TIMEOUT },
    );
    const identityRequest: JSONObject = getItemSpy.mock
      .calls[0]![0] as JSONObject;
    expect(identityRequest["modelType"]).toBe(DockerHost);
    expect(String(identityRequest["id"])).toBe(RESOURCE_ID);
    expect(identityRequest["select"]).toEqual({
      _id: true,
      hostIdentifier: true,
    });

    // No installer creates a Docker agent directory: never `cd` into one.
    expect(codeIn(screen.getByTestId("ai-agent-install-start"))).toBe(
      "# In the directory of your docker-compose.yml:\ndocker compose up -d oneuptime-docker-ai-agent",
    );
    // install.sh, the usual way, comes first.
    expect(screen.getByTestId("ai-agent-install-where")).toHaveTextContent(
      /^Installed the Docker agent with install\.sh\? Run it again/,
    );
    expect(
      screen.getByTestId("ai-agent-install-variable-DOCKER_HOST_NAME"),
    ).toHaveTextContent("prod-docker-01");
    expect(
      screen.getByTestId("ai-agent-install-variable-ONEUPTIME_AI_ALLOW_WRITES"),
    ).toHaveTextContent("false");
    expect(
      screen.getByTestId("ai-agent-install-prerequisites"),
    ).toHaveTextContent("docker run");
    // Nothing to test or reset, so no ⋯ at all.
    await expectNoAgentActions();
    expect(screen.queryByTestId("ai-agent-ready")).not.toBeInTheDocument();
    expect(screen.queryByTestId("ai-agent-meta")).not.toBeInTheDocument();
  });

  /*
   * Investigation is on by default for every resource, so installing the
   * agent is the only step: the instructions open by saying so.
   */
  test("not installed: the instructions open with AI investigations being on by default", async () => {
    serve(notInstalledStatus());
    openAgentPage();

    const line: HTMLElement = await findTestId(
      "ai-agent-install-investigation",
    );

    expect(line).toHaveTextContent(
      getResourceAiAgentInstallInvestigationText(DOCKER),
    );
    expect(line).toHaveTextContent(
      "AI investigations are on by default: once the Docker AI agent connects, OneUptime AI runs read-only docker commands on this Docker host whenever it investigates an incident or alert here. Fixes stay off until you allow them.",
    );
    // First in the instructions, before where to add the agent.
    expect(
      line.compareDocumentPosition(
        screen.getByTestId("ai-agent-install-where"),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      within(screen.getByTestId("ai-agent-install")).getByTestId(
        "ai-agent-install-investigation",
      ),
    ).toBe(line);
  });

  test("not installed, with investigation turned off before installing: no such line", async () => {
    serve({ ...notInstalledStatus(), isAiInvestigationEnabled: false });
    openAgentPage();

    expect(await findTestId("ai-agent-install-command")).toBeInTheDocument();
    expect(
      screen.queryByTestId("ai-agent-install-investigation"),
    ).not.toBeInTheDocument();
  });

  test("a connected agent shows no install instructions, so no such line either", async () => {
    openAgentPage();

    expect(await findTestId("ai-agent-status")).toHaveTextContent("Connected");
    expect(
      screen.queryByTestId("ai-agent-install-investigation"),
    ).not.toBeInTheDocument();
  });

  test("not installed, and the host's name cannot be read: the collector's own variable", async () => {
    serve(notInstalledStatus());
    getItemSpy.mockImplementation(async (): Promise<never> => {
      throw new Error("no access");
    });
    openAgentPage();

    expect(codeIn(await findTestId("ai-agent-install-command"))).toContain(
      "DOCKER_HOST_NAME=${DOCKER_HOST_NAME:-docker-host}",
    );
    expect(
      screen.getByTestId("ai-agent-install-variable-DOCKER_HOST_NAME"),
    ).toHaveTextContent("from .env");
  });

  test("offline: the logs command for the agent's container", async () => {
    serve(
      makeStatus({
        agent: makeAgent({ isOnline: false, lastAliveAt: minutesAgo(12) }),
      }),
    );
    openAgentPage();

    expect(await findTestId("ai-agent-status")).toHaveTextContent("Offline");
    expect(screen.getByTestId("ai-agent-sentence")).toHaveTextContent(
      getResourceAiAgentSilentText(DOCKER),
    );
    expect(codeIn(screen.getByTestId("ai-agent-logs-command"))).toBe(
      getResourceAiAgentLogsCommand(AiResourceType.DockerHost),
    );
    expect(codeIn(screen.getByTestId("ai-agent-logs-command"))).toBe(
      "docker logs --tail 100 oneuptime-docker-ai-agent",
    );
  });

  test("offline right after a sign-off: says it reconnects", async () => {
    serve(
      makeStatus({
        agent: makeAgent({
          isOnline: false,
          connectionStatus: "disconnected",
          lastAliveAt: new Date().toISOString(),
        }),
      }),
    );
    openAgentPage();

    expect(await findTestId("ai-agent-sentence")).toHaveTextContent(
      getResourceAiAgentSignedOffText(DOCKER),
    );
    expect(screen.getByTestId("ai-agent-sentence")).not.toHaveTextContent(
      "has not checked in",
    );
  });

  test("online but unable to reach the host: why, the logs, and a test from the gap", async () => {
    serve(
      makeStatus({
        agent: makeAgent({
          posture: makePosture({
            reachable: false,
            reachError: "Cannot connect to the Docker daemon",
          }),
        }),
        isInvestigationReady: false,
        gaps: [gap("ai_agent_unreachable_resource")],
      }),
      {
        test: async (): Promise<HTTPResponse<JSONObject>> => {
          return new HTTPResponse<JSONObject>(
            200,
            { ok: true, message: "It works.", results: [] },
            {},
          );
        },
      },
    );
    grant(ADMIN_PERMISSIONS);
    openAgentPage();

    expect(await findTestId("ai-agent-status")).toHaveTextContent("Connected");
    expect(screen.getByTestId("ai-agent-sentence")).toHaveTextContent(
      "could not reach this Docker host at its last check: Cannot connect to the Docker daemon",
    );
    expect(screen.getByTestId("ai-agent-logs-command")).toBeInTheDocument();

    const row: HTMLElement = await findTestId(
      "ai-agent-gap-ai_agent_unreachable_resource",
    );
    expect(row).toHaveTextContent(
      "Let the Docker AI agent reach this Docker host (its error and the logs command are above), then test the connection.",
    );
    fireEvent.click(within(row).getByTestId("ai-agent-gap-test-connection"));
    expect(await findText("The connection works")).toBeInTheDocument();
  });

  test("warns when another agent tried to register for the host", async () => {
    serve(
      makeStatus({
        agent: makeAgent({
          lastRefusedRegistrationAt: new Date().toISOString(),
          lastRefusedRegistrationReason: "previous_instance_online",
        }),
      }),
    );
    openAgentPage();

    const warning: HTMLElement = await findTestId(
      "ai-agent-refused-registration",
    );
    expect(warning).toHaveTextContent(
      "Another agent tried to register for this Docker host at",
    );
    expect(warning).toHaveTextContent("DOCKER_HOST_NAME");
  });

  test("shows the last command error the server recorded", async () => {
    serve(
      makeStatus({
        aiAccessLastError: "docker: permission denied",
        aiAccessLastVerifiedAt: minutesAgo(90),
      }),
    );
    openAgentPage();

    const line: HTMLElement = await findTestId("ai-agent-last-error");
    expect(line).toHaveTextContent("Last command error (last worked");
    expect(line).toHaveTextContent("docker: permission denied");
  });
});

describe("the page heading", () => {
  test("names the page and the resource", async () => {
    openAgentPage();

    const heading: HTMLElement = await screen.findByRole(
      "heading",
      { level: 2, name: "AI agent" },
      { timeout: WAIT_TIMEOUT },
    );
    expect(heading).toBeInTheDocument();
    expect(screen.getByTestId("ai-agent-page-heading")).toHaveTextContent(
      getResourceAiAgentPageSubtitle(DOCKER),
    );
  });

  test("is shown while the status loads, and above the error when it fails", async () => {
    let answer: (value: HTTPResponse<JSONObject>) => void = () => {
      return undefined;
    };
    postSpy.mockImplementation((): Promise<HTTPResponse<JSONObject>> => {
      return new Promise<HTTPResponse<JSONObject>>(
        (resolve: (value: HTTPResponse<JSONObject>) => void) => {
          answer = resolve;
        },
      );
    });
    openAgentPage();

    expect(screen.getByTestId("ai-agent-page-heading")).toHaveTextContent(
      "AI agent",
    );
    expect(screen.queryByText("Docker AI agent")).not.toBeInTheDocument();

    await act(async () => {
      answer(statusResponse(makeStatus()));
    });
    expect(await findText("Docker AI agent")).toBeInTheDocument();
    cleanup();

    postSpy.mockImplementation(failStatusRequest);
    openAgentPage();
    expect(await findText("Network Error")).toBeInTheDocument();
    expect(screen.getByTestId("ai-agent-page-heading")).toBeInTheDocument();
    expect(screen.queryByText("Docker AI agent")).not.toBeInTheDocument();
  });
});

describe("status polling", () => {
  test("asks about this resource once on load, by type and id", async () => {
    openAgentPage();

    expect(await findText(SETTINGS_CARD_TITLE)).toBeInTheDocument();
    expect(postsTo(STATUS_ROUTE)).toHaveLength(1);
    expect(postsTo(STATUS_ROUTE)[0]!["data"]).toEqual({
      resourceType: AiResourceType.DockerHost,
      resourceId: RESOURCE_ID,
    });
  });

  test("keeps the last good status and warns inline when a background poll fails", async () => {
    jest.useFakeTimers();
    postSpy
      .mockResolvedValueOnce(statusResponse(makeStatus()))
      .mockImplementationOnce(failStatusRequest)
      .mockResolvedValue(statusResponse(makeStatus()));

    openAgentPage();
    expect(await findText("Docker AI agent")).toBeInTheDocument();

    await act(async () => {
      jest.advanceTimersByTime(RESOURCE_AI_AGENT_STATUS_POLL_INTERVAL_MS);
    });

    const warning: HTMLElement = await findTestId("ai-access-refresh-warning");
    expect(warning).toHaveTextContent("Could not refresh the AI agent status");
    expect(warning).toHaveTextContent("Network Error");
    expect(screen.getByTestId("ai-agent-status")).toHaveTextContent(
      "Connected",
    );

    await act(async () => {
      jest.advanceTimersByTime(RESOURCE_AI_AGENT_STATUS_POLL_INTERVAL_MS);
    });

    await waitFor(
      () => {
        expect(
          screen.queryByTestId("ai-access-refresh-warning"),
        ).not.toBeInTheDocument();
      },
      { timeout: WAIT_TIMEOUT },
    );
  });

  test("picks up an agent that connects while the page is open", async () => {
    jest.useFakeTimers();
    postSpy
      .mockResolvedValueOnce(statusResponse(notInstalledStatus()))
      .mockResolvedValue(statusResponse(makeStatus()));

    openAgentPage();
    expect(await findTestId("ai-agent-status")).toHaveTextContent(
      "Not installed",
    );

    await act(async () => {
      jest.advanceTimersByTime(RESOURCE_AI_AGENT_STATUS_POLL_INTERVAL_MS);
    });

    await waitFor(
      () => {
        expect(screen.getByTestId("ai-agent-status")).toHaveTextContent(
          "Connected",
        );
      },
      { timeout: WAIT_TIMEOUT },
    );
    expect(screen.queryByTestId("ai-agent-install")).not.toBeInTheDocument();
  });

  test("keeps the page when a poll returns a status it cannot read", async () => {
    jest.useFakeTimers();
    postSpy
      .mockResolvedValueOnce(statusResponse(makeStatus()))
      .mockResolvedValue(
        new HTTPResponse<JSONObject>(200, { unexpected: true }, {}),
      );

    openAgentPage();
    expect(await findText("Docker AI agent")).toBeInTheDocument();

    await act(async () => {
      jest.advanceTimersByTime(RESOURCE_AI_AGENT_STATUS_POLL_INTERVAL_MS);
    });

    expect(await findTestId("ai-access-refresh-warning")).toHaveTextContent(
      "cannot read",
    );
    expect(screen.getByText("Docker AI agent")).toBeInTheDocument();
  });
});

describe("Needs attention", () => {
  test("is not shown when the only gap is the fixes-off choice", async () => {
    openAgentPage();

    expect(await findText(SETTINGS_CARD_TITLE)).toBeInTheDocument();
    expect(screen.queryByText(GAPS_CARD_TITLE)).not.toBeInTheDocument();
  });

  test("merges every server gap into one item: a headline, then a numbered step each", async () => {
    serve(
      makeStatus({
        isInvestigationReady: false,
        gaps: [
          gap("ai_balance_insufficient"),
          gap("remediation_disabled"),
          gap("llm_provider_missing"),
        ],
      }),
    );
    openAgentPage();

    const item: HTMLElement = await findTestId("ai-agent-attention");
    expect(screen.getAllByTestId("ai-agent-attention")).toHaveLength(1);
    expect(screen.getByText(GAPS_CARD_TITLE)).toBeInTheDocument();
    expect(
      within(item).getByTestId("ai-agent-attention-title"),
    ).toHaveTextContent("OneUptime AI can't investigate this Docker host");

    // The fixes-off choice is not a step.
    const steps: Array<HTMLElement> = within(
      within(item).getByTestId("ai-agent-gaps"),
    ).getAllByRole("listitem");
    expect(steps).toHaveLength(2);
    expect(steps[0]).toHaveAttribute(
      "data-testid",
      "ai-agent-gap-ai_balance_insufficient",
    );
    expect(
      within(steps[0]!).getByTestId("ai-agent-gap-number"),
    ).toHaveTextContent("1.");
    expect(steps[0]).toHaveTextContent(
      "Add AI credits to this project, or turn on auto-recharge.",
    );
    expect(steps[1]).toHaveAttribute(
      "data-testid",
      "ai-agent-gap-llm_provider_missing",
    );
    expect(
      within(steps[1]!).getByTestId("ai-agent-gap-number"),
    ).toHaveTextContent("2.");
    expect(steps[1]).toHaveTextContent(
      "Add an AI provider for this project, or use OneUptime AI credits.",
    );

    // Not a row per gap with the server's title and next step any more.
    expect(item).not.toHaveTextContent("Title of");
    expect(item).not.toHaveTextContent("Next step for");
    expect(screen.queryByText(/Each item stops/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("ai-agent-ready")).not.toBeInTheDocument();
  });

  test("a new database server: what is wrong in one line, and the two steps that fix it", async () => {
    const database: ResourceAiAgentDescriptor = getResourceAiAgentDescriptor(
      AiResourceType.DatabaseServer,
    );
    serve(
      makeStatus({
        resourceType: AiResourceType.DatabaseServer,
        resourceName: "orders-db",
        agent: null,
        isAiInvestigationEnabled: false,
        isInvestigationReady: false,
        // The server's own words, as the screenshot showed them.
        gaps: [
          {
            code: "ai_agent_not_connected",
            title: "No Database AI agent is connected",
            nextStep: `Install the Database AI agent next to this database server's telemetry collector: run the oneuptime/resource-ai-agent image with ONEUPTIME_AI_AGENT_RESOURCE_TYPE=database and DATABASE_SERVER_ID=${RESOURCE_ID}. The complete snippet is on the database server's AI agent page (AI → AI agent).`,
            blocksInvestigation: true,
            blocksRemediation: true,
          },
          {
            code: "investigation_disabled",
            title: "AI investigation is turned off for this database server",
            nextStep:
              "Turn on AI investigation on the database server's AI agent page (AI → AI agent).",
            blocksInvestigation: true,
            blocksRemediation: false,
          },
          {
            code: "remediation_disabled",
            title: "AI fixes are turned off for this database server",
            nextStep:
              'Set "Fixes" to "Ask for approval", "Automatic" or "Bypass approval" on the database server\'s AI agent page (AI → AI agent).',
            blocksInvestigation: false,
            blocksRemediation: true,
          },
        ],
      }),
    );
    openAgentPage(database);

    const item: HTMLElement = await findTestId("ai-agent-attention");
    expect(
      within(item).getByTestId("ai-agent-attention-title"),
    ).toHaveTextContent("OneUptime AI can't investigate this database server");
    const steps: Array<HTMLElement> = within(item).getAllByRole("listitem");
    expect(steps).toHaveLength(2);
    expect(steps[0]).toHaveTextContent(
      "Install the Database AI agent with the instructions above.",
    );
    expect(within(steps[0]!).queryByRole("button")).not.toBeInTheDocument();
    expect(steps[1]).toHaveTextContent("Turn on AI investigation.");

    // Nothing sends the reader to the page they are on, or repeats the snippet.
    expect(item).not.toHaveTextContent("AI → AI agent");
    expect(item).not.toHaveTextContent("oneuptime/resource-ai-agent");
    expect(item).not.toHaveTextContent(RESOURCE_ID);

    // The instructions it points at are on the page, above it.
    const install: HTMLElement = screen.getByTestId("ai-agent-install");
    expect(
      install.compareDocumentPosition(item) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    fireEvent.click(
      within(steps[1]!).getByTestId("ai-agent-gap-turn-on-investigation"),
    );
    expect(await waitForOneUpdate()).toEqual({
      isAiInvestigationEnabled: true,
    });
    expect(updateRequests()[0]!["modelType"]).toBe(DatabaseServer);
    expect(await findTestId("ai-agent-action-notice")).toHaveTextContent(
      `AI may now investigate this database server with ${database.readOnlyCommandsPhrase}.`,
    );
  });

  test("a single gap is a single sentence, without a number", async () => {
    serve(
      makeStatus({
        isAiInvestigationEnabled: false,
        isInvestigationReady: false,
        gaps: [flaggedGap("investigation_disabled", true, false)],
      }),
    );
    openAgentPage();

    const item: HTMLElement = await findTestId("ai-agent-attention");
    expect(within(item).getAllByRole("listitem")).toHaveLength(1);
    expect(
      within(item).queryByTestId("ai-agent-gap-number"),
    ).not.toBeInTheDocument();
    expect(
      within(item).getByTestId("ai-agent-gap-investigation_disabled"),
    ).toHaveTextContent("Turn on AI investigation.");
  });

  test("fixes on and nothing installed: the headline names both", async () => {
    serve(
      makeStatus({
        agent: null,
        aiRemediationMode: ResourceAiRemediationMode.RequireApproval,
        isInvestigationReady: false,
        gaps: [flaggedGap("ai_agent_not_connected", true, true)],
      }),
    );
    openAgentPage();

    expect(await findTestId("ai-agent-attention-title")).toHaveTextContent(
      "OneUptime AI can't investigate this Docker host or run fixes on it",
    );
    expect(
      screen.getByTestId("ai-agent-gap-ai_agent_not_connected"),
    ).toHaveTextContent(
      "Install the Docker AI agent with the instructions above.",
    );
  });

  test("fixes on with a read-only agent: only fixes are blocked, and the steps are below", async () => {
    serve(
      makeStatus({
        aiRemediationMode: ResourceAiRemediationMode.RequireApproval,
        gaps: [flaggedGap("remediation_write_access_missing", false, true)],
      }),
    );
    openAgentPage();

    const item: HTMLElement = await findTestId("ai-agent-attention");
    expect(
      within(item).getByTestId("ai-agent-attention-title"),
    ).toHaveTextContent("OneUptime AI can't run fixes on this Docker host");
    expect(
      within(item).getByTestId("ai-agent-gap-remediation_write_access_missing"),
    ).toHaveTextContent(
      "Give the Docker AI agent write access with the steps below.",
    );
    // Investigation still works, so the agent card still says it is ready.
    expect(screen.getByTestId("ai-agent-ready")).toBeInTheDocument();
    const writeCommands: HTMLElement = screen.getByTestId(
      "ai-access-write-commands",
    );
    expect(
      item.compareDocumentPosition(writeCommands) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("an offline agent: bring it back, with the logs command above", async () => {
    serve(
      makeStatus({
        agent: makeAgent({ isOnline: false, lastAliveAt: minutesAgo(30) }),
        isInvestigationReady: false,
        gaps: [flaggedGap("ai_agent_offline", true, true)],
      }),
    );
    openAgentPage();

    const item: HTMLElement = await findTestId("ai-agent-attention");
    expect(
      within(item).getByTestId("ai-agent-attention-title"),
    ).toHaveTextContent("OneUptime AI can't investigate this Docker host");
    expect(item).toHaveTextContent(
      "Bring the Docker AI agent back online. Its logs say why it is offline (the command is above).",
    );
    expect(
      screen
        .getByTestId("ai-agent-logs-command")
        .compareDocumentPosition(item) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("a member gets the button they may use and is told who to ask for the rest, in the same item", async () => {
    serve(
      makeStatus({
        isAiInvestigationEnabled: false,
        isInvestigationReady: false,
        gaps: [
          flaggedGap("investigation_disabled", true, false),
          flaggedGap("llm_provider_missing", true, true),
        ],
      }),
    );
    openAgentPage();

    const item: HTMLElement = await findTestId("ai-agent-attention");
    const investigation: HTMLElement = within(item).getByTestId(
      "ai-agent-gap-investigation_disabled",
    );
    const provider: HTMLElement = within(item).getByTestId(
      "ai-agent-gap-llm_provider_missing",
    );
    expect(
      within(investigation).getByTestId("ai-agent-gap-turn-on-investigation"),
    ).toBeInTheDocument();
    expect(
      within(investigation).queryByTestId("ai-agent-gap-ask"),
    ).not.toBeInTheDocument();
    expect(within(provider).getByTestId("ai-agent-gap-ask")).toHaveTextContent(
      "Ask a project owner or admin.",
    );
    expect(
      within(provider).queryByText("Open LLM Providers"),
    ).not.toBeInTheDocument();
    expect(within(item).getAllByTestId("ai-agent-gap-ask")).toHaveLength(1);
  });

  test("the item goes away once its last gap is fixed", async () => {
    serve(
      makeStatus({
        isAiInvestigationEnabled: false,
        isInvestigationReady: false,
        gaps: [flaggedGap("investigation_disabled", true, false)],
      }),
    );
    openAgentPage();

    const button: HTMLElement = await findTestId(
      "ai-agent-gap-turn-on-investigation",
    );
    // What the server says once investigation is on.
    serve(makeStatus());
    fireEvent.click(button);

    await waitFor(
      () => {
        expect(
          screen.queryByTestId("ai-agent-attention"),
        ).not.toBeInTheDocument();
      },
      { timeout: WAIT_TIMEOUT },
    );
    expect(screen.queryByText(GAPS_CARD_TITLE)).not.toBeInTheDocument();
    expect(await findTestId("ai-agent-ready")).toBeInTheDocument();
  });

  test("an editor turns investigation on from its row", async () => {
    serve(
      makeStatus({
        isAiInvestigationEnabled: false,
        isInvestigationReady: false,
        gaps: [gap("investigation_disabled")],
      }),
    );
    openAgentPage();

    fireEvent.click(await findTestId("ai-agent-gap-turn-on-investigation"));

    expect(await waitForOneUpdate()).toEqual({
      isAiInvestigationEnabled: true,
    });
    expect(String(updateRequests()[0]!["id"])).toBe(RESOURCE_ID);
    expect(updateRequests()[0]!["modelType"]).toBe(DockerHost);
    expect(await findTestId("ai-agent-action-notice")).toHaveTextContent(
      "AI may now investigate this Docker host with read-only docker commands.",
    );
    await waitFor(
      () => {
        expect(postsTo(STATUS_ROUTE).length).toBeGreaterThanOrEqual(2);
      },
      { timeout: WAIT_TIMEOUT },
    );
  });

  test("a failed one-click fix is shown on the page", async () => {
    serve(
      makeStatus({
        isAiInvestigationEnabled: false,
        isInvestigationReady: false,
        gaps: [gap("investigation_disabled")],
      }),
    );
    updateByIdSpy.mockImplementation(async (): Promise<never> => {
      throw new HTTPErrorResponse(422, { error: "Not allowed." }, {});
    });
    openAgentPage();

    fireEvent.click(await findTestId("ai-agent-gap-turn-on-investigation"));

    expect(await findTestId("ai-agent-action-error")).toHaveTextContent(
      "Not allowed.",
    );
  });

  test("a reader is told who to ask instead of getting a button", async () => {
    grant(READER_PERMISSIONS);
    serve(
      makeStatus({
        isAiInvestigationEnabled: false,
        isInvestigationReady: false,
        gaps: [gap("investigation_disabled")],
      }),
    );
    openAgentPage();

    const row: HTMLElement = await findTestId(
      "ai-agent-gap-investigation_disabled",
    );
    expect(within(row).getByTestId("ai-agent-gap-ask")).toHaveTextContent(
      "Ask a project owner or admin.",
    );
    expect(
      screen.queryByTestId("ai-agent-gap-turn-on-investigation"),
    ).not.toBeInTheDocument();
  });

  test("project-level gaps link an admin to the page that fixes them", async () => {
    grant(ADMIN_PERMISSIONS);
    serve(
      makeStatus({
        isInvestigationReady: false,
        gaps: [
          gap("ai_disabled_for_project"),
          gap("llm_provider_missing"),
          gap("ai_balance_insufficient"),
        ],
      }),
    );
    openAgentPage();

    const expected: Array<[string, string, string]> = [
      ["ai_disabled_for_project", "Open AI Features", "settings/ai-features"],
      ["llm_provider_missing", "Open LLM Providers", "settings/llm-providers"],
      ["ai_balance_insufficient", "Open AI Credits", "settings/ai-credits"],
    ];
    for (const [code, linkText, path] of expected) {
      const row: HTMLElement = await findTestId(`ai-agent-gap-${code}`);
      expect(
        within(row).getByText(linkText).closest("a")?.getAttribute("href"),
      ).toBe(`/dashboard/${PROJECT_ID}/${path}`);
    }
  });

  test("project-level gaps tell a member who to ask", async () => {
    serve(
      makeStatus({
        isInvestigationReady: false,
        gaps: [gap("ai_disabled_for_project")],
      }),
    );
    openAgentPage();

    const row: HTMLElement = await findTestId(
      "ai-agent-gap-ai_disabled_for_project",
    );
    expect(row).toHaveTextContent("Ask a project owner or admin.");
    expect(within(row).queryByText("Open AI Features")).not.toBeInTheDocument();
  });

  /*
   * Enable AI is the project's only AI switch. The server no longer sends
   * auto_remediation_disabled_for_project (the "Enable auto-remediation"
   * switch was folded into it), but a server one release behind may while a
   * rollout is under way: an admin is still sent to AI Features, where
   * Enable AI is, and a member is told who to ask.
   */
  test("a retired project gap from an older server still links an admin to AI Features", async () => {
    grant(ADMIN_PERMISSIONS);
    serve(
      makeStatus({
        isInvestigationReady: false,
        gaps: [gap("auto_remediation_disabled_for_project")],
      }),
    );
    openAgentPage();

    const row: HTMLElement = await findTestId(
      "ai-agent-gap-auto_remediation_disabled_for_project",
    );
    expect(
      within(row)
        .getByText("Open AI Features")
        .closest("a")
        ?.getAttribute("href"),
    ).toBe(`/dashboard/${PROJECT_ID}/settings/ai-features`);
  });

  test("a retired project gap from an older server tells a member who to ask", async () => {
    serve(
      makeStatus({
        isInvestigationReady: false,
        gaps: [gap("auto_remediation_disabled_for_project")],
      }),
    );
    openAgentPage();

    const row: HTMLElement = await findTestId(
      "ai-agent-gap-auto_remediation_disabled_for_project",
    );
    expect(row).toHaveTextContent("Ask a project owner or admin.");
    expect(within(row).queryByText("Open AI Features")).not.toBeInTheDocument();
  });

  test("the not-installed gap has no extra action: the instructions are on the card", async () => {
    serve(notInstalledStatus());
    openAgentPage();

    const row: HTMLElement = await findTestId(
      "ai-agent-gap-ai_agent_not_connected",
    );
    expect(row).toHaveTextContent(
      "Install the Docker AI agent with the instructions above.",
    );
    expect(within(row).queryByRole("button")).not.toBeInTheDocument();
    expect(within(row).queryByRole("link")).not.toBeInTheDocument();
  });
});

describe("What AI may do", () => {
  test("one row for investigation and one for fixes, each with a badge and one plain sentence", async () => {
    openAgentPage();

    const card: HTMLElement = await settingsCard();
    expect(
      within(card)
        .getAllByRole("heading", { level: 3 })
        .map((heading: HTMLElement): string => {
          return heading.textContent || "";
        }),
    ).toEqual(["Investigation", "Fixes"]);

    expect(
      screen.getByTestId("ai-access-investigation-badge"),
    ).toHaveTextContent("On");
    expect(
      screen.getByTestId("ai-access-investigation-value"),
    ).toHaveTextContent(
      "AI may run read-only docker commands on this Docker host: ps, inspect, logs, stats, events. They never change anything.",
    );
    expect(screen.getByTestId("ai-access-fixes-badge")).toHaveTextContent(
      "Off",
    );
    expect(screen.getByTestId("ai-access-fixes-value")).toHaveTextContent(
      RESOURCE_REMEDIATION_MODE_SUMMARIES[ResourceAiRemediationMode.Disabled],
    );
    expect(
      screen.queryByTestId("ai-access-write-commands"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("ai-command-allowlist-in-effect"),
    ).not.toBeInTheDocument();
  });

  test("the card says what it is for, and when a change takes effect", async () => {
    openAgentPage();

    expect(
      within(await settingsCard()).getByTestId("card-description"),
    ).toHaveTextContent(
      "For incidents and alerts on this Docker host. Changes apply from the next one.",
    );
  });

  test("investigation off says what AI does not do, and what it still does", async () => {
    serve(
      makeStatus({
        isAiInvestigationEnabled: false,
        isInvestigationReady: false,
        gaps: [gap("investigation_disabled")],
      }),
    );
    openAgentPage();

    expect(await findTestId("ai-access-investigation-badge")).toHaveTextContent(
      "Off",
    );
    expect(
      screen.getByTestId("ai-access-investigation-value"),
    ).toHaveTextContent(getAiInvestigationOffSentence("Docker host"));
  });

  /*
   * The card used to read "No — AI investigates with OneUptime data only"
   * beside "Off — AI only investigates": with both off, one row said AI
   * investigates and the other that it only investigates. Now each row
   * speaks of its own setting only.
   */
  test("with both off, the two rows no longer contradict each other", async () => {
    serve(
      makeStatus({
        isAiInvestigationEnabled: false,
        isInvestigationReady: false,
        gaps: [gap("investigation_disabled")],
      }),
    );
    openAgentPage();

    const card: HTMLElement = await settingsCard();
    expect(
      screen.getByTestId("ai-access-investigation-badge"),
    ).toHaveTextContent("Off");
    expect(screen.getByTestId("ai-access-fixes-badge")).toHaveTextContent(
      "Off",
    );
    expect(screen.getByTestId("ai-access-fixes-value")).toHaveTextContent(
      "AI never proposes or runs a fix.",
    );
    expect(card).not.toHaveTextContent("only investigates");
    expect(card).not.toHaveTextContent("No — AI investigates");
    expect(card).not.toHaveTextContent("Yes — read-only");
  });

  test("a member on fixes Off is told who may turn them on, not to click Change", async () => {
    openAgentPage();

    expect(await findTestId("ai-access-fixes-off-hint")).toHaveTextContent(
      getAiFixesOffHint(false),
    );
    expect(
      screen.getByTestId("ai-access-fixes-off-hint"),
    ).not.toHaveTextContent("Click Change");
  });

  test("an admin on fixes Off is told to click Change and choose Ask for approval", async () => {
    grant(ADMIN_PERMISSIONS);
    openAgentPage();

    expect(await findTestId("ai-access-fixes-off-hint")).toHaveTextContent(
      "Want AI to propose fixes? Click Change and choose Ask for approval.",
    );
  });

  test("a reader on fixes Off is told who to ask", async () => {
    grant(READER_PERMISSIONS);
    openAgentPage();

    expect(await findTestId("ai-access-fixes-off-hint")).toHaveTextContent(
      "Ask a project owner or admin to choose Ask for approval.",
    );
  });

  test.each(Object.values(ResourceAiRemediationMode))(
    "fixes in %s: the badge names the mode in its tone, the sentence says what it does",
    async (mode: ResourceAiRemediationMode) => {
      serve(makeStatus({ aiRemediationMode: mode }));
      openAgentPage();

      const badge: HTMLElement = await findTestId("ai-access-fixes-badge");
      expect(badge).toHaveTextContent(
        RESOURCE_REMEDIATION_MODE_SHORT_NAMES[mode],
      );
      expect(badge).toHaveAttribute("data-tone", AI_FIXES_MODE_TONES[mode]);
      expect(screen.getByTestId("ai-access-fixes-value")).toHaveTextContent(
        RESOURCE_REMEDIATION_MODE_SUMMARIES[mode],
      );
      // The hint is for Off only.
      if (mode === ResourceAiRemediationMode.Disabled) {
        expect(
          screen.getByTestId("ai-access-fixes-off-hint"),
        ).toBeInTheDocument();
      } else {
        expect(
          screen.queryByTestId("ai-access-fixes-off-hint"),
        ).not.toBeInTheDocument();
      }
    },
  );

  test("fixes on with a read-only agent: the write switch, scoped first, and the disclosure", async () => {
    serve(
      makeStatus({
        aiRemediationMode: ResourceAiRemediationMode.RequireApproval,
        gaps: [gap("remediation_write_access_missing")],
      }),
    );
    openAgentPage();

    const section: HTMLElement = await findTestId("ai-access-write-commands");
    const commands: ReturnType<typeof getResourceAiAgentWriteAccessCommands> =
      getResourceAiAgentWriteAccessCommands(AiResourceType.DockerHost);
    expect(section).toHaveTextContent("Give the agent write access");
    expect(codeIn(screen.getByTestId("ai-access-write-scoped-env"))).toBe(
      commands.scopedEnv,
    );
    expect(codeIn(screen.getByTestId("ai-access-write-scoped-env"))).toBe(
      "ONEUPTIME_AI_ALLOW_WRITES=true\nONEUPTIME_AI_WRITE_TARGETS=web-*,api-*",
    );
    expect(codeIn(screen.getByTestId("ai-access-write-all-env"))).toBe(
      "ONEUPTIME_AI_ALLOW_WRITES=true",
    );
    expect(codeIn(screen.getByTestId("ai-access-write-restart-command"))).toBe(
      commands.restartCommand,
    );
    expect(
      codeIn(screen.getByTestId("ai-access-write-restart-command")),
    ).not.toContain("cd /opt/");
    const installerNote: HTMLElement = screen.getByTestId(
      "ai-access-write-installer-note",
    );
    const envIntro: HTMLElement = screen.getByTestId(
      "ai-access-write-env-intro",
    );
    expect(installerNote).toHaveTextContent(commands.installerNote!);
    expect(envIntro).toHaveTextContent(commands.envIntro);
    // install.sh, the usual way, before the Compose way.
    expect(
      installerNote.compareDocumentPosition(envIntro) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      installerNote.compareDocumentPosition(
        screen.getByTestId("ai-access-write-scoped-env"),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByTestId("ai-access-write-disclosure")).toHaveTextContent(
      getResourceAiAgentWriteDisclosure(AiResourceType.DockerHost),
    );
    expect(
      screen.queryByTestId("ai-access-fixes-off-hint"),
    ).not.toBeInTheDocument();
  });

  test("a database server has no targets to scope: just the switch", async () => {
    const database: ResourceAiAgentDescriptor = getResourceAiAgentDescriptor(
      AiResourceType.DatabaseServer,
    );
    serve(
      makeStatus({
        resourceType: AiResourceType.DatabaseServer,
        aiRemediationMode: ResourceAiRemediationMode.RequireApproval,
        agent: makeAgent({
          posture: makePosture({ resourceType: AiResourceType.DatabaseServer }),
        }),
      }),
    );
    openAgentPage(database);

    await findTestId("ai-access-write-commands");
    expect(
      screen.queryByTestId("ai-access-write-scoped-env"),
    ).not.toBeInTheDocument();
    expect(codeIn(screen.getByTestId("ai-access-write-all-env"))).toBe(
      "ONEUPTIME_AI_ALLOW_WRITES=true",
    );
    expect(
      screen.queryByTestId("ai-access-write-installer-note"),
    ).not.toBeInTheDocument();
  });

  test("an agent that already writes gets no instructions, and says where it may change", async () => {
    serve(
      makeStatus({
        aiRemediationMode: ResourceAiRemediationMode.RequireApproval,
        agent: makeAgent({
          posture: makePosture({
            allowWrites: true,
            writeTargets: ["web-*", "api"],
          }),
        }),
      }),
    );
    openAgentPage();

    expect(await findTestId("ai-agent-meta")).toHaveTextContent(
      "Can change: web-*, api",
    );
    expect(
      screen.queryByTestId("ai-access-write-commands"),
    ).not.toBeInTheDocument();
  });

  test("the allowlist in effect is listed in Automatic mode only", async () => {
    serve(
      makeStatus({
        aiRemediationMode: ResourceAiRemediationMode.Automatic,
        aiCommandAllowlist: ["docker stop web"],
      }),
    );
    openAgentPage();

    expect(
      await findTestId("ai-command-allowlist-in-effect"),
    ).toHaveTextContent("docker stop web");
    cleanup();

    serve(
      makeStatus({
        aiRemediationMode: ResourceAiRemediationMode.BypassApproval,
        aiCommandAllowlist: ["docker stop web"],
      }),
    );
    openAgentPage();
    expect(await findTestId("ai-access-fixes-badge")).toHaveTextContent(
      "Bypass approval",
    );
    expect(
      screen.queryByTestId("ai-command-allowlist-in-effect"),
    ).not.toBeInTheDocument();
  });

  test("the allowlist and the write-access steps sit in the Fixes row", async () => {
    serve(
      makeStatus({
        aiRemediationMode: ResourceAiRemediationMode.Automatic,
        aiCommandAllowlist: ["docker stop web", "docker restart api"],
      }),
    );
    openAgentPage();

    const fixes: HTMLElement = await findTestId("ai-access-fixes");
    const allowlist: HTMLElement = within(fixes).getByTestId(
      "ai-command-allowlist-in-effect",
    );
    expect(
      within(allowlist)
        .getAllByRole("listitem")
        .map((item: HTMLElement): string => {
          return item.textContent || "";
        }),
    ).toEqual(["docker stop web", "docker restart api"]);
    expect(
      within(fixes).getByTestId("ai-access-write-commands"),
    ).toHaveTextContent("Give the agent write access");
    expect(
      within(screen.getByTestId("ai-access-investigation")).queryByTestId(
        "ai-access-write-commands",
      ),
    ).not.toBeInTheDocument();
  });

  test("an empty allowlist in Automatic mode reads None", async () => {
    serve(
      makeStatus({ aiRemediationMode: ResourceAiRemediationMode.Automatic }),
    );
    openAgentPage();

    expect(
      await findTestId("ai-command-allowlist-in-effect"),
    ).toHaveTextContent("None — riskier fixes always wait for approval.");
  });

  test("the Change button is locked, with the reason, for a reader", async () => {
    grant(READER_PERMISSIONS);
    openAgentPage();

    const button: HTMLElement = await findTestId("ai-access-change-button");
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

/*
 * While the resource's AI agent sets investigation and fixes (its .env's
 * ONEUPTIME_AI_INVESTIGATION / ONEUPTIME_AI_FIXES, or its defaults), the
 * card says so and Change shows the .env lines for the option picked, and
 * the restart — nothing is saved here. The allowlist stays OneUptime's.
 */
describe("What AI may do, set by the agent", () => {
  // An agent new enough to report what it was set to.
  function reportingAgent(): ResourceAiAgentSummary {
    return makeAgent({
      posture: makePosture({
        aiSettings: {
          investigation: true,
          fixes: "RequireApproval",
          isConfigured: true,
        },
      }),
    });
  }

  function agentSetStatus(
    overrides: Partial<ResourceAiAccessStatus> = {},
  ): ResourceAiAccessStatus {
    return makeStatus({
      aiSettingsSource: "agent_configuration",
      aiRemediationMode: ResourceAiRemediationMode.RequireApproval,
      agent: reportingAgent(),
      gaps: [],
      ...overrides,
    });
  }

  async function openAgentSettingsDialog(): Promise<HTMLElement> {
    fireEvent.click(await findTestId("ai-access-change-button"));
    return await findTestId("agent-ai-settings-dialog");
  }

  function pickCard(dialog: HTMLElement, field: string, value: string): void {
    const card: HTMLElement = within(
      within(dialog).getByTestId(field),
    ).getByTestId(`card-select-option-${value}`);
    fireEvent.click(card);
    expect(card).toHaveAttribute("aria-checked", "true");
  }

  test("the card says the agent's configuration sets them, naming the agent", async () => {
    serve(agentSetStatus());
    openAgentPage();

    const line: HTMLElement = await findTestId("ai-access-set-by");
    expect(line).toHaveAttribute("data-set-by-agent", "true");
    expect(line).toHaveTextContent(
      RESOURCE_AI_SETTINGS_SET_BY_TEXT.agent_configuration.replace(
        "{{agent}}",
        DOCKER.agentName,
      ),
    );
  });

  test("Change shows the .env lines for the option picked, and the restart; nothing is saved", async () => {
    serve(agentSetStatus());
    openAgentPage();

    const dialog: HTMLElement = await openAgentSettingsDialog();
    expect(dialog).toHaveAttribute("data-source", "agent_configuration");
    expect(codeIn(within(dialog).getByTestId("agent-ai-settings-env"))).toBe(
      getResourceAiAgentSettingsEnv({
        investigation: true,
        fixes: "RequireApproval",
      }),
    );
    // The agent reads these settings already: a plain restart, no pull.
    expect(
      codeIn(within(dialog).getByTestId("agent-ai-settings-restart")),
    ).toBe(
      `${COMPOSE_DIRECTORY_COMMENT}\ndocker compose up -d oneuptime-docker-ai-agent`,
    );
    // A Docker host's collector is usually installed with install.sh.
    expect(
      within(dialog).getByTestId("agent-ai-settings-installer-note"),
    ).toHaveTextContent("install.sh");
    // Fixes on: what write access amounts to.
    expect(
      within(dialog).getByTestId("agent-ai-settings-write-disclosure"),
    ).toHaveTextContent(
      getResourceAiAgentWriteDisclosure(AiResourceType.DockerHost),
    );

    pickCard(dialog, "agent-ai-settings-fixes", "Disabled");
    pickCard(dialog, "agent-ai-settings-investigation", "off");
    expect(codeIn(within(dialog).getByTestId("agent-ai-settings-env"))).toBe(
      "ONEUPTIME_AI_INVESTIGATION=false\nONEUPTIME_AI_FIXES=off\nONEUPTIME_AI_ALLOW_WRITES=false",
    );
    expect(
      within(dialog).queryByTestId("agent-ai-settings-write-disclosure"),
    ).toBeNull();

    pickCard(dialog, "agent-ai-settings-fixes", "Automatic");
    expect(
      codeIn(within(dialog).getByTestId("agent-ai-settings-env")),
    ).toContain("ONEUPTIME_AI_FIXES=automatic\nONEUPTIME_AI_ALLOW_WRITES=true");

    expect(screen.queryByTestId("modal-footer-submit-button")).toBeNull();
    expect(updateByIdSpy).not.toHaveBeenCalled();
  });

  test("a reader may open the instructions too", async () => {
    grant(READER_PERMISSIONS);
    serve(agentSetStatus());
    openAgentPage();

    const change: HTMLElement = await findTestId("ai-access-change-button");
    expect(change).not.toBeDisabled();
    fireEvent.click(change);
    expect(await findTestId("agent-ai-settings-dialog")).toBeInTheDocument();
  });

  test("fixes off: the hint sends the reader to Change for the lines", async () => {
    serve(
      agentSetStatus({ aiRemediationMode: ResourceAiRemediationMode.Disabled }),
    );
    openAgentPage();

    expect(await findTestId("ai-access-fixes-off-hint")).toHaveTextContent(
      AI_FIXES_OFF_AGENT_SET_HINT,
    );
  });

  test("investigation off: the step points where the agent runs, and Show how opens the lines with investigation on", async () => {
    serve(
      agentSetStatus({
        isAiInvestigationEnabled: false,
        isInvestigationReady: false,
        gaps: [gap("investigation_disabled")],
      }),
    );
    openAgentPage();

    const step: HTMLElement = await findTestId(
      "ai-agent-gap-investigation_disabled",
    );
    expect(step).toHaveTextContent(
      RESOURCE_AGENT_SET_INVESTIGATION_STEP_TEXT.replace(
        "{{agent}}",
        DOCKER.agentName,
      ),
    );
    expect(
      screen.queryByTestId("ai-agent-gap-turn-on-investigation"),
    ).toBeNull();

    fireEvent.click(
      within(step).getByTestId("ai-agent-gap-show-investigation-command"),
    );
    const dialog: HTMLElement = await findTestId("agent-ai-settings-dialog");
    expect(
      codeIn(within(dialog).getByTestId("agent-ai-settings-env")),
    ).toContain("ONEUPTIME_AI_INVESTIGATION=true");
  });

  test("Automatic: the allowlist stays editable here, alone, and only it is sent", async () => {
    serve(
      agentSetStatus({
        aiRemediationMode: ResourceAiRemediationMode.Automatic,
        aiCommandAllowlist: ["docker restart web", "docker restart api"],
      }),
    );
    serveModel({
      aiRemediationMode: ResourceAiRemediationMode.Automatic,
      aiCommandAllowlist: ["docker restart web", "docker restart api"],
    });
    openAgentPage();

    fireEvent.click(await findTestId("ai-command-allowlist-in-effect-edit"));
    const dialog: HTMLElement = await findDialogTitled(
      "Edit the command allowlist",
    );
    await within(dialog).findByTestId(
      "ai-command-allowlist-field",
      {},
      { timeout: WAIT_TIMEOUT },
    );
    expect(within(dialog).queryByTestId("ai-investigation-field")).toBeNull();
    expect(
      within(dialog).queryByTestId("ai-remediation-mode-field"),
    ).toBeNull();

    await setAllowlistText(dialog, "docker restart web");
    saveChangeModal(dialog);

    expect(await waitForOneUpdate()).toEqual({
      aiCommandAllowlist: ["docker restart web"],
    });
  });

  test("negative control: chosen here, the line offers to move them to the agent, and Change edits", async () => {
    serve(makeStatus({ aiSettingsSource: "oneuptime" }));
    openAgentPage();

    const line: HTMLElement = await findTestId("ai-access-set-by");
    expect(line).toHaveAttribute("data-set-by-agent", "false");
    fireEvent.click(within(line).getByTestId("ai-access-set-by-action"));
    expect(await findTestId("agent-ai-settings-dialog")).toHaveAttribute(
      "data-source",
      "oneuptime",
    );
  });

  test("chosen here, with an agent older than the settings: Show how pulls the newer image as it restarts", async () => {
    // makeAgent's posture reports no settings: an older agent.
    serve(makeStatus({ aiSettingsSource: "oneuptime" }));
    openAgentPage();

    fireEvent.click(await findTestId("ai-access-set-by-action"));
    const dialog: HTMLElement = await findTestId("agent-ai-settings-dialog");
    const step: HTMLElement = within(dialog).getByTestId(
      "agent-ai-settings-step-restart",
    );
    expect(dialog).toHaveTextContent(RESOURCE_AI_SETTINGS_UPGRADE_STEP_TITLE);
    expect(codeIn(within(step).getByTestId("agent-ai-settings-restart"))).toBe(
      getResourceAiAgentUpgradeCommand(AiResourceType.DockerHost),
    );
    expect(
      within(dialog).getByTestId("agent-ai-settings-installer-note"),
    ).toHaveTextContent("it pulls the newer agent");
  });

  test("chosen here, with an agent that reports them: Show how only restarts it", async () => {
    serve(
      makeStatus({
        aiSettingsSource: "oneuptime",
        agent: makeAgent({
          posture: makePosture({
            aiSettings: {
              investigation: true,
              fixes: "Disabled",
              isConfigured: false,
            },
          }),
        }),
      }),
    );
    openAgentPage();

    fireEvent.click(await findTestId("ai-access-set-by-action"));
    const dialog: HTMLElement = await findTestId("agent-ai-settings-dialog");
    expect(dialog).not.toHaveTextContent(
      RESOURCE_AI_SETTINGS_UPGRADE_STEP_TITLE,
    );
    expect(
      codeIn(within(dialog).getByTestId("agent-ai-settings-restart")),
    ).not.toContain("pull");
  });

  test("negative control: no agent yet, no line", async () => {
    serve(notInstalledStatus());
    openAgentPage();

    await findTestId("ai-access-fixes");
    expect(screen.queryByTestId("ai-access-set-by")).toBeNull();
  });
});

describe("the Change modal: who may loosen", () => {
  test("reads the saved settings of this resource, and nothing else", async () => {
    openAgentPage();
    await openChangeModal();

    const request: JSONObject = getItemSpy.mock.calls[0]![0] as JSONObject;
    expect(request["modelType"]).toBe(DockerHost);
    expect(String(request["id"])).toBe(RESOURCE_ID);
    expect(request["select"]).toEqual({
      _id: true,
      isAiInvestigationEnabled: true,
      aiRemediationMode: true,
      aiCommandAllowlist: true,
    });
  });

  test("a member on an Ask-for-approval host is offered only Off and the current mode, and told why", async () => {
    openAgentPage();
    const dialog: HTMLElement = await openChangeModal();

    expect(
      within(dialog).getByTestId("resource-ai-access-admin-note"),
    ).toHaveTextContent("Edit Auto Remediation Rule");
    // Nothing saved to remove: no allowlist field.
    expect(
      within(dialog).queryByTestId("ai-command-allowlist-field"),
    ).not.toBeInTheDocument();

    // Every mode at or below the saved one, the saved one marked.
    expect(modeCardTitles(dialog)).toEqual([
      "Off",
      "Ask for approval (current)",
    ]);
    expect(
      modeCard(dialog, ResourceAiRemediationMode.RequireApproval),
    ).toHaveAttribute("aria-checked", "true");
  });

  test("a member on an Off host cannot turn fixes on", async () => {
    serveModel({ aiRemediationMode: ResourceAiRemediationMode.Disabled });
    openAgentPage();
    const dialog: HTMLElement = await openChangeModal();

    expect(modeCardTitles(dialog)).toEqual(["Off (current)"]);
  });

  test("an admin is offered every mode, and turns fixes on from Off", async () => {
    grant(ADMIN_PERMISSIONS);
    serveModel({ aiRemediationMode: ResourceAiRemediationMode.Disabled });
    openAgentPage();
    const dialog: HTMLElement = await openChangeModal();

    expect(
      within(dialog).queryByTestId("resource-ai-access-admin-note"),
    ).not.toBeInTheDocument();
    expect(modeCardTitles(dialog)).toEqual([
      "Off (current)",
      "Ask for approval",
      "Automatic",
      "Bypass approval",
    ]);
    pickMode(dialog, ResourceAiRemediationMode.RequireApproval);
    saveChangeModal(dialog);

    expect(await waitForOneUpdate()).toEqual({
      aiRemediationMode: ResourceAiRemediationMode.RequireApproval,
    });
    expect(updateRequests()[0]!["modelType"]).toBe(DockerHost);
  });

  test("a member turns investigation off, and only that is sent", async () => {
    serveModel({ aiRemediationMode: ResourceAiRemediationMode.Automatic });
    openAgentPage();
    const dialog: HTMLElement = await openChangeModal();

    await toggleSwitch(dialog, "ai-investigation-field", true);
    saveChangeModal(dialog);

    expect(await waitForOneUpdate()).toEqual({
      isAiInvestigationEnabled: false,
    });
  });

  test("a member on a Bypass-approval host may step down to Automatic, unconfirmed", async () => {
    serveModel({ aiRemediationMode: ResourceAiRemediationMode.BypassApproval });
    openAgentPage();
    const dialog: HTMLElement = await openChangeModal();

    pickMode(dialog, ResourceAiRemediationMode.Automatic);
    saveChangeModal(dialog);

    expect(await waitForOneUpdate()).toEqual({
      aiRemediationMode: ResourceAiRemediationMode.Automatic,
    });
    expect(
      screen.queryByText("Let riskier changes run without approval?"),
    ).not.toBeInTheDocument();
  });

  test("a member may remove an allowlist entry", async () => {
    serveModel({
      aiRemediationMode: ResourceAiRemediationMode.Automatic,
      aiCommandAllowlist: ["docker stop web", "docker stop api"],
    });
    openAgentPage();
    const dialog: HTMLElement = await openChangeModal();

    expect(
      within(dialog).getByTestId("resource-ai-access-admin-note"),
    ).toHaveTextContent("remove allowlist entries");
    await setAllowlistText(dialog, "docker stop web");
    saveChangeModal(dialog);

    expect(await waitForOneUpdate()).toEqual({
      aiCommandAllowlist: ["docker stop web"],
    });
  });

  test("a member who adds an entry is told it needs the admin set, and nothing is sent", async () => {
    serveModel({
      aiRemediationMode: ResourceAiRemediationMode.Automatic,
      aiCommandAllowlist: ["docker stop web"],
    });
    openAgentPage();
    const dialog: HTMLElement = await openChangeModal();

    await setAllowlistText(dialog, "docker stop web\ndocker stop api");
    saveChangeModal(dialog);

    expect(
      await within(dialog).findByText(
        /is not in the saved allowlist/,
        {},
        { timeout: WAIT_TIMEOUT },
      ),
    ).toHaveTextContent("Edit Auto Remediation Rule");
    expect(updateByIdSpy).not.toHaveBeenCalled();
  });

  test("the allowlist field is shown only while Automatic is chosen", async () => {
    grant(ADMIN_PERMISSIONS);
    serveModel({ aiRemediationMode: ResourceAiRemediationMode.Automatic });
    openAgentPage();
    const dialog: HTMLElement = await openChangeModal();

    expect(
      await within(dialog).findByTestId(
        "ai-command-allowlist-field",
        {},
        { timeout: WAIT_TIMEOUT },
      ),
    ).toHaveAttribute("placeholder", DOCKER.allowlistPlaceholder);

    pickMode(dialog, ResourceAiRemediationMode.RequireApproval);
    await waitFor(
      () => {
        expect(
          within(dialog).queryByTestId("ai-command-allowlist-field"),
        ).not.toBeInTheDocument();
      },
      { timeout: WAIT_TIMEOUT },
    );
  });

  test("an allowlist entry is checked with this resource type's policy", async () => {
    grant(ADMIN_PERMISSIONS);
    serveModel({ aiRemediationMode: ResourceAiRemediationMode.Automatic });
    openAgentPage();
    const dialog: HTMLElement = await openChangeModal();

    // A host command means nothing on a Docker host.
    await setAllowlistText(dialog, "docker stop web\nsystemctl stop nginx");
    saveChangeModal(dialog);

    expect(
      await within(dialog).findByText(
        /Entry 2: "systemctl stop nginx" does not start with a program the Docker AI agent runs/,
        {},
        { timeout: WAIT_TIMEOUT },
      ),
    ).toBeInTheDocument();
    expect(updateByIdSpy).not.toHaveBeenCalled();
  });

  test("a failed save stays in the modal with the server's reason", async () => {
    grant(ADMIN_PERMISSIONS);
    serveModel({ aiRemediationMode: ResourceAiRemediationMode.Disabled });
    updateByIdSpy.mockImplementation(async (): Promise<never> => {
      throw new HTTPErrorResponse(
        403,
        { error: "You need one of these permissions." },
        {},
      );
    });
    openAgentPage();
    const dialog: HTMLElement = await openChangeModal();

    pickMode(dialog, ResourceAiRemediationMode.RequireApproval);
    saveChangeModal(dialog);

    expect(await findTestId("ai-access-save-error")).toHaveTextContent(
      "You need one of these permissions.",
    );
    expect(screen.getByRole("dialog")).toBe(dialog);
  });

  test("the modal's read failing is said in the modal", async () => {
    getItemSpy.mockImplementation(async (): Promise<null> => {
      return null;
    });
    openAgentPage();
    fireEvent.click(await findTestId("ai-access-change-button"));

    expect(
      await findText(/Could not read this Docker host's AI settings/),
    ).toBeInTheDocument();
  });
});

describe("the Change modal: the mode cards", () => {
  test("one card per mode, each saying what it does, the saved one chosen", async () => {
    grant(ADMIN_PERMISSIONS);
    openAgentPage();
    const dialog: HTMLElement = await openChangeModal();

    const descriptions: Record<ResourceAiRemediationMode, string> =
      getResourceRemediationModeOptionDescriptions(DOCKER);
    expect(modeCards(dialog)).toHaveLength(4);
    for (const mode of Object.values(ResourceAiRemediationMode)) {
      const card: HTMLElement = modeCard(dialog, mode);
      expect(card).toHaveTextContent(descriptions[mode]);
      // Each card carries its mode's icon.
      expect(card.querySelector("svg")).not.toBeNull();
      expect(card).toHaveAttribute(
        "aria-checked",
        mode === ResourceAiRemediationMode.RequireApproval ? "true" : "false",
      );
    }
  });

  /*
   * The field's help used to be one paragraph of every mode and every
   * protection. Each card now says its own mode, and the field says what
   * the choice is about in one line.
   */
  test("the Fixes field explains itself in one line, not a paragraph", async () => {
    openAgentPage();
    const dialog: HTMLElement = await openChangeModal();

    expect(
      within(dialog).getByText(getAiFixesFieldDescription("Docker host")),
    ).toBeInTheDocument();
    expect(dialog).not.toHaveTextContent("Off: AI only investigates.");
    expect(dialog).not.toHaveTextContent(
      "In every mode, Bypass approval included:",
    );
    // The mode picker is cards, not a dropdown.
    expect(
      within(dialog).queryByRole("combobox", { name: /^Fixes/ }),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).getByRole("radiogroup", { name: /^Fixes/ }),
    ).toBeInTheDocument();
  });

  test("what stays protected in every mode is folded under the cards, every clause listed", async () => {
    openAgentPage();
    const dialog: HTMLElement = await openChangeModal();

    const protections: HTMLElement = within(dialog).getByTestId(
      "ai-access-protections",
    );
    expect(protections).not.toHaveAttribute("open");
    expect(protections).toHaveTextContent(AI_ACCESS_PROTECTIONS_TITLE);
    expect(
      Array.from(
        within(protections)
          .getByTestId("ai-access-protections-list")
          .querySelectorAll("li"),
      ).map((item: Element): string => {
        return item.textContent || "";
      }),
    ).toEqual(formatAiAccessProtections(getEveryModeProtections(DOCKER)));
    // Under the cards, not above them.
    expect(
      modeField(dialog).compareDocumentPosition(protections) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("a card chosen from the keyboard is saved like a clicked one", async () => {
    grant(ADMIN_PERMISSIONS);
    openAgentPage();
    const dialog: HTMLElement = await openChangeModal();

    fireEvent.keyDown(modeCard(dialog, ResourceAiRemediationMode.Disabled), {
      key: "Enter",
    });
    await waitFor(
      () => {
        expect(
          modeCard(dialog, ResourceAiRemediationMode.Disabled),
        ).toHaveAttribute("aria-checked", "true");
      },
      { timeout: WAIT_TIMEOUT },
    );
    saveChangeModal(dialog);

    expect(await waitForOneUpdate()).toEqual({
      aiRemediationMode: ResourceAiRemediationMode.Disabled,
    });
  });

  test("choosing a card and back again sends nothing", async () => {
    grant(ADMIN_PERMISSIONS);
    openAgentPage();
    const dialog: HTMLElement = await openChangeModal();

    pickMode(dialog, ResourceAiRemediationMode.Automatic);
    pickMode(dialog, ResourceAiRemediationMode.RequireApproval);
    saveChangeModal(dialog);

    await waitFor(
      () => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      },
      { timeout: WAIT_TIMEOUT },
    );
    expect(updateByIdSpy).not.toHaveBeenCalled();
  });

  test("a member's note says what they can change first, then what needs more", async () => {
    openAgentPage();
    const dialog: HTMLElement = await openChangeModal();

    const note: HTMLElement = within(dialog).getByTestId(
      "resource-ai-access-admin-note",
    );
    expect(note).toHaveTextContent(
      "You can turn investigation on or off, lower fixes and remove allowlist entries.",
    );
    expect(note).toHaveTextContent(
      "Turning fixes on or up, or adding allowlist entries, needs Project Owner, Project Admin or Edit Auto Remediation Rule.",
    );
  });

  test("the allowlist help is short, and leaves who may add entries to the note", async () => {
    serveModel({
      aiRemediationMode: ResourceAiRemediationMode.Automatic,
      aiCommandAllowlist: ["docker stop web"],
    });
    openAgentPage();
    const dialog: HTMLElement = await openChangeModal();

    await within(dialog).findByTestId(
      "ai-command-allowlist-field",
      {},
      { timeout: WAIT_TIMEOUT },
    );
    expect(
      within(dialog).getByText(
        /^One command per line, at most \d+\. A riskier fix that matches an entry runs without approval\./,
      ),
    ).toBeInTheDocument();
    expect(dialog).not.toHaveTextContent(
      "You can remove entries or clear the list; adding or changing one needs",
    );
  });
});

describe("the Change modal: confirmations", () => {
  test("Bypass approval is confirmed before it is saved", async () => {
    grant(ADMIN_PERMISSIONS);
    openAgentPage();
    const dialog: HTMLElement = await openChangeModal();

    pickMode(dialog, ResourceAiRemediationMode.BypassApproval);
    saveChangeModal(dialog);

    const confirm: HTMLElement = await findDialogTitled(
      "Turn on Bypass approval?",
    );
    expect(confirm).toHaveTextContent("on this Docker host on its own");
    expect(updateByIdSpy).not.toHaveBeenCalled();

    fireEvent.click(within(confirm).getByText("Confirm and save"));

    expect(await waitForOneUpdate()).toEqual({
      aiRemediationMode: ResourceAiRemediationMode.BypassApproval,
    });
  });

  test("a broad entry is confirmed, and backing out sends nothing", async () => {
    grant(ADMIN_PERMISSIONS);
    serveModel({ aiRemediationMode: ResourceAiRemediationMode.Automatic });
    openAgentPage();
    const dialog: HTMLElement = await openChangeModal();

    await setAllowlistText(dialog, "docker stop *");
    saveChangeModal(dialog);

    const confirm: HTMLElement = await findDialogTitled(
      "Let riskier changes run without approval?",
    );
    expect(confirm).toHaveTextContent(
      'The allowlist entry "docker stop *" uses a * for the object a change touches',
    );

    fireEvent.click(within(confirm).getByText("Cancel"));
    await waitFor(
      () => {
        expect(
          screen.queryByText("Let riskier changes run without approval?"),
        ).not.toBeInTheDocument();
      },
      { timeout: WAIT_TIMEOUT },
    );
    expect(updateByIdSpy).not.toHaveBeenCalled();
  });

  test("an entry that names its container saves without a question", async () => {
    grant(ADMIN_PERMISSIONS);
    serveModel({ aiRemediationMode: ResourceAiRemediationMode.Automatic });
    openAgentPage();
    const dialog: HTMLElement = await openChangeModal();

    await setAllowlistText(dialog, "docker stop web");
    saveChangeModal(dialog);

    expect(await waitForOneUpdate()).toEqual({
      aiCommandAllowlist: ["docker stop web"],
    });
  });

  test("nothing changed: the modal closes without a write", async () => {
    openAgentPage();
    const dialog: HTMLElement = await openChangeModal();

    saveChangeModal(dialog);

    await waitFor(
      () => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      },
      { timeout: WAIT_TIMEOUT },
    );
    expect(updateByIdSpy).not.toHaveBeenCalled();
  });
});

describe("Test connection", () => {
  test("runs the test for this resource and shows each command's result", async () => {
    serve(makeStatus(), {
      test: async (): Promise<HTTPResponse<JSONObject>> => {
        return new HTTPResponse<JSONObject>(
          200,
          {
            ok: false,
            message: "docker info failed.",
            results: [
              {
                command: "docker version",
                succeeded: true,
                exitCode: 0,
                output: "Server: 27.3.1",
                errorMessage: null,
              },
              {
                command: "docker info",
                succeeded: false,
                exitCode: 1,
                output: "",
                errorMessage: "permission denied",
              },
            ],
            status: makeStatus({
              agent: makeAgent({ agentVersion: "14.2.0" }),
            }) as unknown as JSONObject,
          },
          {},
        );
      },
    });
    openAgentPage();

    await pickAgentAction(TEST_ACTION_TEST_ID);

    const results: HTMLElement = await findTestId("ai-agent-test-results");
    expect(results).toHaveTextContent("The connection is not working yet");
    expect(results).toHaveTextContent("docker info failed.");
    const rows: Array<HTMLElement> = within(results).getAllByTestId(
      "ai-agent-test-result-row",
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("docker version");
    expect(rows[0]).toHaveTextContent("succeeded");
    expect(rows[0]).toHaveTextContent("Server: 27.3.1");
    expect(rows[1]).toHaveTextContent("failed (exit 1)");
    expect(rows[1]).toHaveTextContent("permission denied");
    expect(postsTo(TEST_ROUTE)[0]!["data"]).toEqual({
      resourceType: AiResourceType.DockerHost,
      resourceId: RESOURCE_ID,
    });
    // The status the test returned replaces the one on screen.
    await waitFor(
      () => {
        expect(screen.getByTestId("ai-agent-meta")).toHaveTextContent(
          "agent 14.2.0",
        );
      },
      { timeout: WAIT_TIMEOUT },
    );
  });

  test("a refused test says what it needs, not what the server says about settings", async () => {
    serve(makeStatus(), {
      test: async (): Promise<HTTPErrorResponse> => {
        // The server's NotAuthorizedException, which OneUptime sends as 422.
        return new HTTPErrorResponse(
          ExceptionCode.NotAuthorizedException,
          { error: "You cannot change this resource's AI access." },
          {},
        );
      },
    });
    openAgentPage();

    await pickAgentAction(TEST_ACTION_TEST_ID);

    const error: HTMLElement = await findTestId("ai-agent-test-error");
    expect(error).toHaveTextContent(
      "Testing the connection needs permission to edit this Docker host",
    );
    expect(error).toHaveTextContent(
      "Nothing on the Docker host or in its AI settings was changed.",
    );
  });

  test("another failure is shown as the server said it", async () => {
    serve(makeStatus(), {
      test: async (): Promise<HTTPErrorResponse> => {
        return new HTTPErrorResponse(
          429,
          { error: "An AI access test is already running." },
          {},
        );
      },
    });
    openAgentPage();

    await pickAgentAction(TEST_ACTION_TEST_ID);

    expect(await findTestId("ai-agent-test-error")).toHaveTextContent(
      "An AI access test is already running.",
    );
  });

  test("is locked for a reader, with the reason", async () => {
    grant(READER_PERMISSIONS);
    openAgentPage();

    const menu: HTMLElement = await openAgentActions();
    // Locked, not hidden - and nothing else is offered to a reader.
    expect(actionLabels(menu)).toEqual(["Test connection"]);
    const item: HTMLElement = within(menu).getByTestId(TEST_ACTION_TEST_ID);
    expect(item).toHaveAttribute("aria-disabled", "true");
    expect(item).toHaveAccessibleDescription(
      /Testing the connection needs permission to edit this Docker host/,
    );
    expect(
      screen.getByTestId("ai-agent-test-permission-note"),
    ).toHaveTextContent("Testing the connection needs permission to edit");

    fireEvent.click(item);
    expect(postsTo(TEST_ROUTE)).toHaveLength(0);
    expect(
      screen.queryByTestId("ai-agent-test-progress"),
    ).not.toBeInTheDocument();
  });

  test("is hidden while the permission snapshot has not landed - and so is the ⋯", async () => {
    grant([]);
    openAgentPage();

    await expectNoAgentActions();
    expect(
      screen.queryByTestId("ai-agent-test-permission-note"),
    ).not.toBeInTheDocument();
  });

  /*
   * The old button carried the test's spinner. The ⋯ closes as the test
   * starts, so the agent card says it is running, where the result then
   * appears, and the test is locked in the ⋯ until it is done.
   */
  test("runs once, said in the agent card while it runs, and the result replaces that", async () => {
    const held: { answer: (value: HTTPResponse<JSONObject>) => void } =
      holdTheTest();
    openAgentPage();

    await pickAgentAction(TEST_ACTION_TEST_ID);

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    const progress: HTMLElement = await findTestId("ai-agent-test-progress");
    expect(progress).toHaveAttribute("role", "status");
    expect(progress).toHaveTextContent("Testing the connection…");
    const agentCard: HTMLElement | null = (
      await findText("Docker AI agent")
    ).closest('[data-testid="card"]');
    expect(agentCard).toContainElement(progress);

    let menu: HTMLElement = await openAgentActions();
    expect(within(menu).getByTestId(TEST_ACTION_TEST_ID)).toBeDisabled();
    fireEvent.click(within(menu).getByTestId(TEST_ACTION_TEST_ID));
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(postsTo(TEST_ROUTE)).toHaveLength(1);

    await act(async () => {
      held.answer(
        new HTTPResponse<JSONObject>(
          200,
          { ok: true, message: "docker info worked.", results: [] },
          {},
        ),
      );
    });

    expect(await findTestId("ai-agent-test-results")).toHaveTextContent(
      "The connection works",
    );
    expect(
      screen.queryByTestId("ai-agent-test-progress"),
    ).not.toBeInTheDocument();
    menu = await openAgentActions();
    expect(within(menu).getByTestId(TEST_ACTION_TEST_ID)).not.toBeDisabled();
  });

  test("a refused test clears the running line and says why", async () => {
    let answer: (value: HTTPErrorResponse) => void = (): void => {
      // replaced below
    };
    serve(makeStatus(), {
      test: (): Promise<HTTPErrorResponse> => {
        return new Promise((resolve: (value: HTTPErrorResponse) => void) => {
          answer = resolve;
        });
      },
    });
    openAgentPage();

    await pickAgentAction(TEST_ACTION_TEST_ID);
    expect(await findTestId("ai-agent-test-progress")).toBeInTheDocument();

    await act(async () => {
      answer(
        new HTTPErrorResponse(
          429,
          { error: "An AI access test is already running." },
          {},
        ),
      );
    });

    expect(await findTestId("ai-agent-test-error")).toHaveTextContent(
      "An AI access test is already running.",
    );
    expect(
      screen.queryByTestId("ai-agent-test-progress"),
    ).not.toBeInTheDocument();
  });
});

describe("Reset agent", () => {
  test("is only offered to the admin set", async () => {
    openAgentPage();

    expect(await findText("Docker AI agent")).toBeInTheDocument();
    const menu: HTMLElement = await openAgentActions();
    expect(actionLabels(menu)).toEqual(["Test connection"]);
    expect(
      within(menu).queryByTestId(RESET_ACTION_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("backing out of the dialog resets nothing, and focus goes back to the ⋯", async () => {
    grant(ADMIN_PERMISSIONS);
    openAgentPage();

    await pickAgentAction(RESET_ACTION_TEST_ID);
    const confirm: HTMLElement = await findDialogTitled("Reset the AI agent?");
    fireEvent.click(within(confirm).getByText("Cancel"));

    await waitFor(
      () => {
        expect(
          screen.queryByText("Reset the AI agent?"),
        ).not.toBeInTheDocument();
      },
      { timeout: WAIT_TIMEOUT },
    );
    expect(postsTo(RESET_ROUTE)).toHaveLength(0);
    await waitFor(
      () => {
        expect(screen.getByTestId(ACTIONS_BUTTON_TEST_ID)).toHaveFocus();
      },
      { timeout: WAIT_TIMEOUT },
    );
  });

  test("an admin resets the agent after a confirmation", async () => {
    grant(ADMIN_PERMISSIONS);
    openAgentPage();

    await pickAgentAction(RESET_ACTION_TEST_ID);
    const confirm: HTMLElement = await findDialogTitled("Reset the AI agent?");
    expect(confirm).toHaveTextContent(
      "This revokes the Docker AI agent's key.",
    );
    expect(postsTo(RESET_ROUTE)).toHaveLength(0);

    fireEvent.click(within(confirm).getByText("Reset agent"));

    expect(await findTestId("ai-agent-action-notice")).toHaveTextContent(
      "The Docker AI agent was reset. It reconnects on its own within a few minutes.",
    );
    expect(postsTo(RESET_ROUTE)).toHaveLength(1);
    expect(postsTo(RESET_ROUTE)[0]!["data"]).toEqual({
      resourceType: AiResourceType.DockerHost,
      resourceId: RESOURCE_ID,
    });
  });

  test("a refused reset stays in its dialog with the reason", async () => {
    grant(ADMIN_PERMISSIONS);
    serve(makeStatus(), {
      reset: async (): Promise<HTTPErrorResponse> => {
        return new HTTPErrorResponse(403, { error: "Not yours to reset." }, {});
      },
    });
    openAgentPage();

    await pickAgentAction(RESET_ACTION_TEST_ID);
    const confirm: HTMLElement = await findDialogTitled("Reset the AI agent?");
    fireEvent.click(within(confirm).getByText("Reset agent"));

    expect(
      await within(confirm).findByText(
        "Not yours to reset.",
        {},
        { timeout: WAIT_TIMEOUT },
      ),
    ).toBeInTheDocument();
  });

  test("nothing to reset before an agent registered", async () => {
    grant(ADMIN_PERMISSIONS);
    serve(notInstalledStatus());
    openAgentPage();

    expect(await findTestId("ai-agent-status")).toHaveTextContent(
      "Not installed",
    );
    // Nor anything to test: no ⋯ at all.
    await expectNoAgentActions();
  });

  test("is offered for an offline agent too", async () => {
    grant(ADMIN_PERMISSIONS);
    serve(
      makeStatus({
        agent: makeAgent({ isOnline: false, lastAliveAt: minutesAgo(12) }),
        isInvestigationReady: false,
      }),
    );
    openAgentPage();

    expect(await findTestId("ai-agent-status")).toHaveTextContent("Offline");
    const menu: HTMLElement = await openAgentActions();
    expect(actionLabels(menu)).toEqual(["Test connection", "Reset agent"]);
    expect(within(menu).getByTestId(RESET_ACTION_TEST_ID)).toHaveAttribute(
      "aria-disabled",
      "false",
    );
  });
});

/*
 * "We can have both of these buttons, like "Test Connection" and "Reset
 * Agent," in a more button style with three dots." The card's header keeps
 * the agent's status in sight and puts its actions in one ⋯ beside it.
 */
describe("the agent card's ⋯", () => {
  test("the header shows the status and one ⋯ - no row of buttons", async () => {
    grant(ADMIN_PERMISSIONS);
    openAgentPage();

    const header: HTMLElement = await agentCardHeader();
    const status: HTMLElement = within(header).getByTestId("ai-agent-status");
    const trigger: HTMLElement = within(header).getByRole("button", {
      name: "AI agent actions",
    });

    expect(status).toHaveTextContent("Connected");
    expect(within(header).getAllByRole("button")).toEqual([trigger]);
    expect(trigger).toHaveAttribute("data-testid", ACTIONS_BUTTON_TEST_ID);
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger.textContent).toBe("");
    expect(
      status.compareDocumentPosition(trigger) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(within(header).queryByText("Test connection")).toBeNull();
    expect(within(header).queryByText("Reset agent")).toBeNull();
  });

  test("never offers a Kubernetes cluster's switch to the AI agent", async () => {
    grant(ADMIN_PERMISSIONS);
    openAgentPage();

    const menu: HTMLElement = await openAgentActions();

    expect(actionLabels(menu)).toEqual(["Test connection", "Reset agent"]);
    expect(
      within(menu).queryByTestId("ai-agent-switch-button"),
    ).not.toBeInTheDocument();
  });

  test("works from the keyboard: the arrows reach Reset agent, Enter asks first", async () => {
    grant(ADMIN_PERMISSIONS);
    openAgentPage();

    const menu: HTMLElement = await openAgentActions();
    await waitFor(
      () => {
        expect(within(menu).getByTestId(TEST_ACTION_TEST_ID)).toHaveFocus();
      },
      { timeout: WAIT_TIMEOUT },
    );
    fireEvent.keyDown(within(menu).getByTestId(TEST_ACTION_TEST_ID), {
      key: "End",
    });
    expect(within(menu).getByTestId(RESET_ACTION_TEST_ID)).toHaveFocus();
    fireEvent.keyDown(within(menu).getByTestId(RESET_ACTION_TEST_ID), {
      key: "Enter",
    });

    const confirm: HTMLElement = await findDialogTitled("Reset the AI agent?");
    expect(confirm).toHaveTextContent(
      "This revokes the Docker AI agent's key.",
    );
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(postsTo(RESET_ROUTE)).toHaveLength(0);
  });

  test("Escape closes it, picks nothing and hands focus back", async () => {
    grant(ADMIN_PERMISSIONS);
    openAgentPage();

    const menu: HTMLElement = await openAgentActions();
    fireEvent.keyDown(menu, { key: "Escape" });

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByTestId(ACTIONS_BUTTON_TEST_ID)).toHaveFocus();
    expect(postsTo(TEST_ROUTE)).toHaveLength(0);
    expect(postsTo(RESET_ROUTE)).toHaveLength(0);
  });

  test("appears once an agent registers while the page is open", async () => {
    jest.useFakeTimers();
    grant(ADMIN_PERMISSIONS);
    postSpy
      .mockResolvedValueOnce(statusResponse(notInstalledStatus()))
      .mockResolvedValue(statusResponse(makeStatus()));
    openAgentPage();

    await expectNoAgentActions();

    await act(async () => {
      jest.advanceTimersByTime(RESOURCE_AI_AGENT_STATUS_POLL_INTERVAL_MS);
    });

    const menu: HTMLElement = await openAgentActions();
    expect(actionLabels(menu)).toEqual(["Test connection", "Reset agent"]);
  });
});

describe("every resource type", () => {
  test.each(ALL_AI_RESOURCE_TYPES)(
    "%s: the page asks about its own type and names its own agent",
    async (type: AiResourceType) => {
      const descriptor: ResourceAiAgentDescriptor =
        getResourceAiAgentDescriptor(type);
      serve({
        ...notInstalledStatus(),
        resourceType: type,
      });
      openAgentPage(descriptor);

      expect(await findText(descriptor.agentName)).toBeInTheDocument();
      expect(screen.getByTestId("ai-agent-page-heading")).toHaveTextContent(
        getResourceAiAgentPageSubtitle(descriptor),
      );
      expect(postsTo(STATUS_ROUTE)[0]!["data"]).toEqual({
        resourceType: type,
        resourceId: RESOURCE_ID,
      });
      expect(codeIn(await findTestId("ai-agent-install-command"))).toContain(
        `${getResourceAiAgentServiceName(type)}:`,
      );
      expect(screen.getByTestId("ai-agent-attention-title")).toHaveTextContent(
        `OneUptime AI can't investigate this ${descriptor.noun}`,
      );
      expect(
        screen.getByTestId("ai-agent-gap-ai_agent_not_connected"),
      ).toHaveTextContent(
        `Install the ${descriptor.agentName} with the instructions above.`,
      );
    },
  );

  test.each(ALL_AI_RESOURCE_TYPES)(
    "%s: the install instructions say AI investigations are on by default, in its own words",
    async (type: AiResourceType) => {
      const descriptor: ResourceAiAgentDescriptor =
        getResourceAiAgentDescriptor(type);
      serve({
        ...notInstalledStatus(),
        resourceType: type,
      });
      openAgentPage(descriptor);

      const line: HTMLElement = await findTestId(
        "ai-agent-install-investigation",
      );

      expect(line).toHaveTextContent(
        `AI investigations are on by default: once the ${descriptor.agentName} connects, OneUptime AI runs ${descriptor.readOnlyCommandsPhrase} on this ${descriptor.noun} whenever it investigates an incident or alert here. Fixes stay off until you allow them.`,
      );
    },
  );

  test.each(ALL_AI_RESOURCE_TYPES)(
    "%s: the agent card keeps its status in sight and its actions in one ⋯",
    async (type: AiResourceType) => {
      const descriptor: ResourceAiAgentDescriptor =
        getResourceAiAgentDescriptor(type);
      grant(ADMIN_PERMISSIONS);
      serve(makeStatus({ resourceType: type }));
      openAgentPage(descriptor);

      const header: HTMLElement = await agentCardHeader(descriptor);
      const trigger: HTMLElement = within(header).getByRole("button", {
        name: "AI agent actions",
      });

      expect(within(header).getByTestId("ai-agent-status")).toHaveTextContent(
        "Connected",
      );
      expect(within(header).getAllByRole("button")).toEqual([trigger]);

      const menu: HTMLElement = await openAgentActions();
      expect(actionLabels(menu)).toEqual(["Test connection", "Reset agent"]);
      for (const testId of [TEST_ACTION_TEST_ID, RESET_ACTION_TEST_ID]) {
        expect(within(menu).getByTestId(testId)).toHaveAttribute(
          "aria-disabled",
          "false",
        );
      }
    },
  );

  test.each(ALL_AI_RESOURCE_TYPES)(
    "%s: a member gets the test alone; a reader gets it locked, with this type's reason",
    async (type: AiResourceType) => {
      const descriptor: ResourceAiAgentDescriptor =
        getResourceAiAgentDescriptor(type);
      serve(makeStatus({ resourceType: type }));
      openAgentPage(descriptor);

      let menu: HTMLElement = await openAgentActions();
      expect(actionLabels(menu)).toEqual(["Test connection"]);
      expect(within(menu).getByTestId(TEST_ACTION_TEST_ID)).toHaveAttribute(
        "aria-disabled",
        "false",
      );
      cleanup();

      grant(READER_PERMISSIONS);
      openAgentPage(descriptor);

      menu = await openAgentActions();
      expect(actionLabels(menu)).toEqual(["Test connection"]);
      const item: HTMLElement = within(menu).getByTestId(TEST_ACTION_TEST_ID);
      expect(item).toHaveAttribute("aria-disabled", "true");
      expect(item).toHaveAccessibleDescription(
        getResourceAccessTestPermissionRequirement(descriptor),
      );
      fireEvent.click(item);
      expect(postsTo(TEST_ROUTE)).toHaveLength(0);
    },
  );

  test.each(ALL_AI_RESOURCE_TYPES)(
    "%s: no ⋯ before an agent registers, even for an admin",
    async (type: AiResourceType) => {
      const descriptor: ResourceAiAgentDescriptor =
        getResourceAiAgentDescriptor(type);
      grant(ADMIN_PERMISSIONS);
      serve({ ...notInstalledStatus(), resourceType: type });
      openAgentPage(descriptor);

      await expectNoAgentActions();
      expect(
        within(await agentCardHeader(descriptor)).getByTestId(
          "ai-agent-status",
        ),
      ).toHaveTextContent("Not installed");
    },
  );

  test.each(ALL_AI_RESOURCE_TYPES)(
    "%s: the ⋯ tests this resource, and the card says so while it runs",
    async (type: AiResourceType) => {
      const descriptor: ResourceAiAgentDescriptor =
        getResourceAiAgentDescriptor(type);
      let answer: (value: HTTPResponse<JSONObject>) => void = (): void => {
        // replaced below
      };
      serve(makeStatus({ resourceType: type }), {
        test: (): Promise<HTTPResponse<JSONObject>> => {
          return new Promise(
            (resolve: (value: HTTPResponse<JSONObject>) => void) => {
              answer = resolve;
            },
          );
        },
      });
      openAgentPage(descriptor);

      await pickAgentAction(TEST_ACTION_TEST_ID);

      expect(await findTestId("ai-agent-test-progress")).toHaveTextContent(
        "Testing the connection…",
      );
      expect(postsTo(TEST_ROUTE)).toHaveLength(1);
      expect(postsTo(TEST_ROUTE)[0]!["data"]).toEqual({
        resourceType: type,
        resourceId: RESOURCE_ID,
      });

      await act(async () => {
        answer(
          new HTTPResponse<JSONObject>(
            200,
            {
              ok: true,
              message: `${descriptor.agentName} works.`,
              results: [],
            },
            {},
          ),
        );
      });

      expect(await findTestId("ai-agent-test-results")).toHaveTextContent(
        `${descriptor.agentName} works.`,
      );
      expect(
        screen.queryByTestId("ai-agent-test-progress"),
      ).not.toBeInTheDocument();
    },
  );

  test.each(ALL_AI_RESOURCE_TYPES)(
    "%s: Reset agent from the ⋯ asks first, then resets this resource's agent",
    async (type: AiResourceType) => {
      const descriptor: ResourceAiAgentDescriptor =
        getResourceAiAgentDescriptor(type);
      grant(ADMIN_PERMISSIONS);
      serve(makeStatus({ resourceType: type }));
      openAgentPage(descriptor);

      await pickAgentAction(RESET_ACTION_TEST_ID);
      const confirm: HTMLElement = await findDialogTitled(
        "Reset the AI agent?",
      );
      expect(confirm).toHaveTextContent(
        `This revokes the ${descriptor.agentName}'s key.`,
      );
      expect(postsTo(RESET_ROUTE)).toHaveLength(0);

      fireEvent.click(within(confirm).getByText("Reset agent"));

      expect(await findTestId("ai-agent-action-notice")).toHaveTextContent(
        `The ${descriptor.agentName} was reset.`,
      );
      expect(postsTo(RESET_ROUTE)).toHaveLength(1);
      expect(postsTo(RESET_ROUTE)[0]!["data"]).toEqual({
        resourceType: type,
        resourceId: RESOURCE_ID,
      });
    },
  );

  test.each(ALL_AI_RESOURCE_TYPES)(
    '%s: "What AI may do" speaks of its own type',
    async (type: AiResourceType) => {
      const descriptor: ResourceAiAgentDescriptor =
        getResourceAiAgentDescriptor(type);
      serve(makeStatus({ resourceType: type }));
      openAgentPage(descriptor);

      expect(
        within(await settingsCard()).getByTestId("card-description"),
      ).toHaveTextContent(getAiAccessCardDescription(descriptor.noun));
      expect(
        screen.getByTestId("ai-access-investigation-value"),
      ).toHaveTextContent(getResourceInvestigationOnSentence(descriptor));
    },
  );

  test.each(ALL_AI_RESOURCE_TYPES)(
    "%s: the Change modal's mode cards name its own riskier changes",
    async (type: AiResourceType) => {
      const descriptor: ResourceAiAgentDescriptor =
        getResourceAiAgentDescriptor(type);
      grant(ADMIN_PERMISSIONS);
      serve(makeStatus({ resourceType: type }));
      openAgentPage(descriptor);
      const dialog: HTMLElement = await openChangeModal(descriptor);

      const descriptions: Record<ResourceAiRemediationMode, string> =
        getResourceRemediationModeOptionDescriptions(descriptor);
      for (const mode of Object.values(ResourceAiRemediationMode)) {
        expect(modeCard(dialog, mode)).toHaveTextContent(descriptions[mode]);
      }
      expect(
        within(dialog).getByText(getAiFixesFieldDescription(descriptor.noun)),
      ).toBeInTheDocument();
    },
  );
});
