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
import {
  MemoryRouter,
  Route as PageRoute,
  Routes,
  useLocation,
} from "react-router-dom";
import KubernetesClusterAiAgent, {
  KubernetesClusterViewAiRedirect,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/AI/Agent";
import {
  AI_AGENT_GONE_TEXT,
  AI_AGENT_PAGE_SUBTITLE,
  AI_AGENT_PAGE_TITLE,
  AI_AGENT_READY_TEXT,
  AI_AGENT_SIGNED_OFF_TEXT,
  AI_AGENT_SILENT_TEXT,
  AI_AGENT_STATUS_POLL_INTERVAL_MS,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesAiAgentStatus";
import {
  getAiAgentHelmCommands,
  getAiAgentWriteDisclosure,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesAiAccessSetup";
import {
  INVESTIGATION_ON_SENTENCE,
  KUBECTL_ALLOWLIST_FIELD_DESCRIPTION,
  REMEDIATION_MODE_OPTION_DESCRIPTIONS,
  REMEDIATION_MODE_SHORT_NAMES,
  REMEDIATION_MODE_SUMMARIES,
  getEveryModeProtections,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesAiAccessSettings";
import {
  AI_ACCESS_PROTECTIONS_TITLE,
  AI_FIXES_MODE_TONES,
  formatAiAccessProtections,
  getAiFixesFieldDescription,
  getAiFixesOffHint,
  getAiInvestigationOffSentence,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AiAccess/AiAccessModes";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import Project from "../../../Models/DatabaseModels/Project";
import RunbookCredential from "../../../Models/DatabaseModels/RunbookCredential";
import Runner from "../../../Models/DatabaseModels/Runner";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../Types/JSON";
import {
  KubernetesAiAccessGap,
  KubernetesAiAccessGapCode,
  KubernetesAiAgentSummary,
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
  KUBERNETES_AI_AGENT_DISPLAY_NAME,
} from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import RunbookCredentialType from "../../../Types/Runbook/RunbookCredentialType";
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
 * The cluster's AI agent page (AI → Agent) renders for real on its real
 * route, with the status, test and reset-agent routes, the model API and
 * the permission snapshot stubbed. It is three cards at most: the
 * "Kubernetes AI agent" card in each of its states (connected, offline,
 * not installed, the previous in-cluster Runner, an advanced Runner),
 * "Needs attention" only when the server has gaps — as ONE item: a
 * headline and a short step per gap — and "What AI may do" (one row for
 * investigation, one for fixes, each with a badge and one plain sentence)
 * with its Change modal — whose loosening rules, confirmations and
 * advanced-binding pickers carry over from the old AI page, with Off ->
 * enabled now needing the admin set.
 */

// Real components fetch; give the waits room on a loaded CI box.
const WAIT_TIMEOUT: number = 20000;

const CLUSTER_ID: ObjectID = new ObjectID(
  "44444444-0000-4000-8000-000000000004",
);
const AGENT_ID: string = "99999999-0000-4000-8000-000000000009";
const LEGACY_RUNNER_ID: string = "55555555-0000-4000-8000-000000000005";
const HOST_RUNNER_ID: string = "55555555-0000-4000-8000-00000000000f";
const DISABLED_RUNNER_ID: string = "55555555-0000-4000-8000-000000000010";
const CREDENTIAL_ID: string = "77777777-0000-4000-8000-000000000007";
const STAGING_CREDENTIAL_ID: string = "77777777-0000-4000-8000-000000000009";
const AGENT_PAGE_PATH: string = `/dashboard/${PROJECT_ID}/kubernetes/${CLUSTER_ID.toString()}/ai/agent`;
const OLD_AI_PAGE_PATH: string = `/dashboard/${PROJECT_ID}/kubernetes/${CLUSTER_ID.toString()}/ai`;

const AGENT_CARD_TITLE: string = "Kubernetes AI agent";
const SETTINGS_CARD_TITLE: string = "What AI may do";
const GAPS_CARD_TITLE: string = "Needs attention";

const STATUS_ROUTE: string = "/kubernetes-cluster/ai-access/status";
const TEST_ROUTE: string = "/kubernetes-cluster/ai-access/test";
const RESET_ROUTE: string = "/kubernetes-cluster/ai-access/reset-agent";

const BASE_PERMISSIONS: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
];

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
  Permission.ReadKubernetesCluster,
];

const SET_IMAGE_PATTERN: string = "kubectl set image deployment/web * -n web";
const PATCH_PATTERN: string = "kubectl patch deployment/web -n web -p *";
const BROAD_PATTERN: string = "kubectl delete deployment * -n *";

function makeAgent(
  overrides: Partial<KubernetesAiAgentSummary> = {},
): KubernetesAiAgentSummary {
  return {
    id: AGENT_ID,
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

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

/*
 * The agent offline the three ways the server's isOnline rule allows:
 * heartbeats stopped (still "connected", last seen past the alive window),
 * signed off or reset moments ago (a helm upgrade, "Reset agent"), and
 * signed off long ago without coming back.
 */
function silentAgent(): KubernetesAiAgentSummary {
  return makeAgent({ isOnline: false, lastAliveAt: minutesAgo(12) });
}

function signedOffAgent(): KubernetesAiAgentSummary {
  return makeAgent({
    isOnline: false,
    connectionStatus: "disconnected",
    lastAliveAt: new Date().toISOString(),
  });
}

function goneAgent(): KubernetesAiAgentSummary {
  return makeAgent({
    isOnline: false,
    connectionStatus: "disconnected",
    lastAliveAt: minutesAgo(45),
  });
}

// The resolved target is the cluster's Kubernetes AI agent.
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
    automaticInvestigation: { incidents: true, alerts: true },
    kubectlAllowlist: [],
    isInvestigationEnabled: true,
    isInvestigationReady: true,
    remediationMode: KubernetesAiRemediationMode.Disabled,
    isRemediationReady: false,
    gaps: [gap("remediation_disabled", "remediation")],
    evaluatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function notInstalledStatus(
  overrides: Partial<KubernetesClusterAiAccessStatus> = {},
): KubernetesClusterAiAccessStatus {
  return makeStatus({
    runner: null,
    aiAgent: null,
    accessMethod: "none",
    isInvestigationReady: false,
    gaps: [gap("ai_agent_not_connected")],
    ...overrides,
  });
}

function legacyStatus(
  overrides: Partial<KubernetesClusterAiAccessStatus> = {},
): KubernetesClusterAiAccessStatus {
  return makeStatus({
    runner: {
      id: LEGACY_RUNNER_ID,
      name: "kubernetes-agent/prod-east",
      isOnline: true,
      lastAliveAt: new Date().toISOString(),
      canRunAiCommands: true,
      posture: {
        clusterIdentifier: "prod-east",
        inCluster: true,
        allowWrites: false,
        kubectlVersion: "v1.30.0",
      },
    },
    aiAgent: null,
    ...overrides,
  });
}

function advancedStatus(
  overrides: Partial<KubernetesClusterAiAccessStatus> = {},
): KubernetesClusterAiAccessStatus {
  return makeStatus({
    runner: {
      id: HOST_RUNNER_ID,
      name: "bash-runner",
      kind: "runner",
      isOnline: true,
      lastAliveAt: new Date().toISOString(),
      canRunAiCommands: true,
      posture: { inCluster: false, kubectlVersion: "v1.29.1" },
    },
    accessMethod: "credential",
    credentialId: CREDENTIAL_ID,
    credentialName: "prod-east token",
    ...overrides,
  });
}

function gap(
  code: KubernetesAiAccessGapCode,
  blocks: KubernetesAiAccessGap["blocks"] = "both",
): KubernetesAiAccessGap {
  return {
    code,
    title: `Title of ${code}`,
    description: `Description of ${code}`,
    nextStep: `Next step for ${code}`,
    blocks,
  };
}

function statusResponse(
  status: KubernetesClusterAiAccessStatus,
): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(200, status as unknown as JSONObject, {});
}

type ClusterOverrides = {
  [Key in keyof KubernetesCluster]?: KubernetesCluster[Key] | unknown;
};

// The saved settings the Change modal reads: reached through the agent.
function makeCluster(overrides: ClusterOverrides = {}): KubernetesCluster {
  return Object.assign(
    new KubernetesCluster(),
    {
      _id: CLUSTER_ID.toString(),
      isAiInvestigationEnabled: true,
      aiRemediationMode: KubernetesAiRemediationMode.RequireApproval,
      aiKubectlCommandAllowlist: [],
    },
    overrides,
  );
}

// The cluster bound to the host Runner (outside the cluster), with a credential.
function hostRunnerBinding(withCredential: boolean = true): ClusterOverrides {
  return {
    aiAccessRunner: Object.assign(new Runner(), {
      _id: HOST_RUNNER_ID,
      name: "bash-runner",
    }),
    ...(withCredential
      ? {
          aiAccessCredential: Object.assign(new RunbookCredential(), {
            _id: CREDENTIAL_ID,
            name: "prod-east token",
          }),
        }
      : {}),
  };
}

function agentHostInfo(clusterIdentifier: string): JSONObject {
  return {
    kubernetes: { inCluster: true, allowWrites: false, clusterIdentifier },
  };
}

/*
 * Every kind of Runner a project holds: this cluster's previous agent
 * Runner, another cluster's, a host Runner that runs AI commands and one
 * that does not. Only the host Runner can be picked for an advanced
 * binding.
 */
function makeProjectRunners(): Array<Runner> {
  return [
    Object.assign(new Runner(), {
      _id: LEGACY_RUNNER_ID,
      name: "kubernetes-agent/prod-east",
      canRunAiCommands: true,
      hostInfo: agentHostInfo("prod-east"),
    }),
    Object.assign(new Runner(), {
      _id: "55555555-0000-4000-8000-00000000000e",
      name: "kubernetes-agent/prod-eu",
      canRunAiCommands: true,
      hostInfo: agentHostInfo("prod-eu"),
    }),
    Object.assign(new Runner(), {
      _id: HOST_RUNNER_ID,
      name: "bash-runner",
      canRunAiCommands: true,
    }),
    Object.assign(new Runner(), {
      _id: DISABLED_RUNNER_ID,
      name: "ops-runner",
      canRunAiCommands: false,
    }),
  ];
}

function makeProjectCredentials(): Array<RunbookCredential> {
  return [
    Object.assign(new RunbookCredential(), {
      _id: CREDENTIAL_ID,
      name: "prod-east token",
      credentialType: RunbookCredentialType.Kubernetes,
      runners: [Object.assign(new Runner(), { _id: HOST_RUNNER_ID })],
    }),
    Object.assign(new RunbookCredential(), {
      _id: STAGING_CREDENTIAL_ID,
      name: "staging token",
      credentialType: RunbookCredentialType.Kubernetes,
      runners: [Object.assign(new Runner(), { _id: DISABLED_RUNNER_ID })],
    }),
  ];
}

interface ListRequest {
  modelType?: unknown;
  query?: Record<string, unknown> | undefined;
  select?: Record<string, unknown> | undefined;
}

let postSpy: ReturnType<typeof jest.spyOn>;
let getListSpy: ReturnType<typeof jest.spyOn>;
let getItemSpy: ReturnType<typeof jest.spyOn>;
let updateByIdSpy: ReturnType<typeof jest.spyOn>;

type RouteAnswer = () => Promise<HTTPResponse<JSONObject> | HTTPErrorResponse>;

/*
 * Answers the status route with `status`, and the test and reset routes
 * with their handlers (a plain 200 by default).
 */
function serve(
  status: KubernetesClusterAiAccessStatus,
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
          : new HTTPResponse<JSONObject>(200, {}, {});
      }
      return statusResponse(status);
    },
  );
}

/*
 * A status request that fails the way a transient 502 or a dropped
 * connection does — thrown from inside the async body, so zone.js does not
 * report a pre-built rejected promise as unhandled.
 */
async function failStatusRequest(): Promise<HTTPResponse<JSONObject>> {
  throw new Error("Network Error");
}

function listRequestsFor(modelType: unknown): Array<ListRequest> {
  return getListSpy.mock.calls
    .map((call: Array<unknown>): ListRequest => {
      return (call[0] || {}) as ListRequest;
    })
    .filter((request: ListRequest): boolean => {
      return request.modelType === modelType;
    });
}

// The requests the page sent to one of its custom routes.
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

function openAgentPage(): void {
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

async function openChangeModal(): Promise<HTMLElement> {
  fireEvent.click(await findTestId("ai-access-change-button"));
  const dialog: HTMLElement = await screen.findByRole(
    "dialog",
    {},
    { timeout: WAIT_TIMEOUT },
  );
  // The form is on screen once its first field label is.
  await within(dialog).findByText(
    "Investigate with kubectl",
    {},
    { timeout: WAIT_TIMEOUT },
  );
  return dialog;
}

function serveCluster(overrides: ClusterOverrides = {}): void {
  getItemSpy.mockImplementation(async (): Promise<KubernetesCluster> => {
    return makeCluster(overrides);
  });
}

// The open react-select menu's options (not native <option>s).
function menuOptions(): Array<HTMLElement> {
  return screen
    .queryAllByRole("option")
    .filter((option: HTMLElement): boolean => {
      return option.tagName !== "OPTION";
    });
}

async function openDropdown(
  dialog: HTMLElement,
  name: RegExp,
): Promise<Array<string>> {
  const combobox: HTMLElement = within(dialog).getByRole("combobox", {
    name,
  });
  fireEvent.keyDown(combobox, { key: "ArrowDown", code: "ArrowDown" });
  await waitFor(
    () => {
      expect(menuOptions().length).toBeGreaterThan(0);
    },
    { timeout: WAIT_TIMEOUT },
  );
  return menuOptions().map((option: HTMLElement): string => {
    return option.textContent || "";
  });
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
  mode: KubernetesAiRemediationMode,
): HTMLElement {
  return within(modeField(dialog)).getByTestId(`card-select-option-${mode}`);
}

function pickMode(
  dialog: HTMLElement,
  mode: KubernetesAiRemediationMode,
): void {
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

/*
 * Clicks a switch once the form has been seeded with the saved value. The
 * Toggle picks up its value in an effect after its first paint, so a click
 * in that instant would toggle the unseeded default.
 */
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
    "kubectl-allowlist-field",
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

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  grant(MEMBER_PERMISSIONS);

  postSpy = jest.spyOn(API, "post");
  serve(makeStatus());

  getListSpy = jest.spyOn(ModelAPI, "getList");
  getListSpy.mockImplementation(
    async (args: unknown): Promise<ListResult<Runner>> => {
      const request: ListRequest = args as ListRequest;
      const data: Array<unknown> =
        request.modelType === Runner
          ? makeProjectRunners()
          : request.modelType === RunbookCredential
            ? makeProjectCredentials()
            : [];
      return {
        data: data as Array<Runner>,
        count: data.length,
        skip: 0,
        limit: 10,
      };
    },
  );

  getItemSpy = jest.spyOn(ModelAPI, "getItem");
  serveCluster();
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

describe("the Kubernetes AI agent card", () => {
  test("a connected agent: pill, sentence, meta line and the ready line", async () => {
    openAgentPage();

    expect(await findText(AGENT_CARD_TITLE)).toBeInTheDocument();
    expect(await findTestId("ai-agent-status")).toHaveTextContent("Connected");
    expect(screen.getByTestId("ai-agent-sentence")).toHaveTextContent(
      "The AI agent is running in this cluster.",
    );
    expect(screen.getByTestId("ai-agent-meta")).toHaveTextContent(
      "agent v14.1.0 · kubectl v1.31.2 · Read-only",
    );
    expect(screen.getByTestId("ai-agent-meta")).toHaveTextContent(
      /^last seen /,
    );
    expect(screen.getByTestId("ai-agent-ready")).toHaveTextContent(
      AI_AGENT_READY_TEXT,
    );
    // Nothing to install, no logs to read.
    expect(
      screen.queryByTestId("ai-agent-install-command"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("ai-agent-logs-command"),
    ).not.toBeInTheDocument();
  });

  /*
   * The whole body of a not-installed card is one sentence and ONE
   * command, always with aiAgent.enabled=true — no decision in front of a
   * first-time user, and nothing to test yet.
   */
  test("not installed: the one install command and nothing to test", async () => {
    serve(notInstalledStatus());
    openAgentPage();

    expect(await findTestId("ai-agent-status")).toHaveTextContent(
      "Not installed",
    );
    expect(screen.getByTestId("ai-agent-sentence")).toHaveTextContent(
      "Install the AI agent — it runs in your cluster, read-only, using your Kubernetes agent's key. This page updates within a minute.",
    );
    expect(codeIn(screen.getByTestId("ai-agent-install-command"))).toBe(
      getAiAgentHelmCommands().install,
    );
    expect(
      screen.getByText(
        "Installed under another release or namespace? Use yours.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("ai-agent-test-button"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("ai-agent-ready")).not.toBeInTheDocument();
    expect(screen.queryByTestId("ai-agent-meta")).not.toBeInTheDocument();
    // No agent row: nothing to reset, even for an admin.
    expect(
      screen.queryByTestId("ai-agent-reset-button"),
    ).not.toBeInTheDocument();
  });

  test("offline: the logs command for the namespace the agent reported", async () => {
    serve(makeStatus({}, silentAgent()));
    openAgentPage();

    expect(await findTestId("ai-agent-status")).toHaveTextContent("Offline");
    expect(screen.getByTestId("ai-agent-sentence")).toHaveTextContent(
      "The AI agent has not checked in for over 5 minutes. Check its pod:",
    );
    expect(screen.getByTestId("ai-agent-sentence")).toHaveTextContent(
      AI_AGENT_SILENT_TEXT,
    );
    expect(codeIn(screen.getByTestId("ai-agent-logs-command"))).toBe(
      "kubectl logs -n monitoring -l component=ai-agent --tail=100",
    );
  });

  /*
   * A pod stopped by a helm upgrade signs off, and it is back within a few
   * minutes. The card used to say "has not checked in for over 5 minutes"
   * above a meta line reading "last seen a few seconds ago".
   */
  test("offline right after a sign-off: says it reconnects, never five silent minutes", async () => {
    serve(makeStatus({}, signedOffAgent()));
    openAgentPage();

    expect(await findTestId("ai-agent-status")).toHaveTextContent("Offline");
    const sentence: HTMLElement = screen.getByTestId("ai-agent-sentence");
    expect(sentence).toHaveTextContent(
      "The AI agent signed off or was reset. It reconnects on its own within a few minutes. If it does not, check its pod:",
    );
    expect(sentence).toHaveTextContent(AI_AGENT_SIGNED_OFF_TEXT);
    expect(sentence).not.toHaveTextContent("has not checked in");
    expect(screen.getByTestId("ai-agent-meta")).toHaveTextContent(
      /^last seen /,
    );
    // Still the pod to look at if it does not come back.
    expect(codeIn(screen.getByTestId("ai-agent-logs-command"))).toBe(
      "kubectl logs -n monitoring -l component=ai-agent --tail=100",
    );
  });

  test("offline long after a sign-off: says it has not come back", async () => {
    serve(makeStatus({}, goneAgent()));
    openAgentPage();

    expect(await findTestId("ai-agent-status")).toHaveTextContent("Offline");
    expect(screen.getByTestId("ai-agent-sentence")).toHaveTextContent(
      AI_AGENT_GONE_TEXT,
    );
    expect(screen.getByTestId("ai-agent-sentence")).toHaveTextContent(
      "The AI agent disconnected and has not come back. Check its pod:",
    );
    expect(screen.getByTestId("ai-agent-logs-command")).toBeInTheDocument();
  });

  /*
   * Every 14.0.x install sits here between the server upgrade and the
   * chart upgrade: it works today, and the same single command moves it
   * to the AI agent.
   */
  test("the previous in-cluster Runner: works today, one command to upgrade", async () => {
    serve(legacyStatus());
    openAgentPage();

    expect(await findTestId("ai-agent-status")).toHaveTextContent(
      "Connected through the previous in-cluster Runner",
    );
    expect(screen.getByTestId("ai-agent-sentence")).toHaveTextContent(
      "Works today. Upgrade the Kubernetes agent chart to switch to the new AI agent — your settings carry over.",
    );
    expect(codeIn(screen.getByTestId("ai-agent-install-command"))).toBe(
      getAiAgentHelmCommands().install,
    );
    // The connection can still be tested through it.
    expect(screen.getByTestId("ai-agent-test-button")).not.toBeDisabled();
    expect(
      screen.queryByTestId("ai-agent-switch-button"),
    ).not.toBeInTheDocument();
  });

  test("the previous in-cluster Runner offline: not said to work today, same command", async () => {
    serve(
      legacyStatus({
        runner: {
          ...legacyStatus().runner!,
          isOnline: false,
          lastAliveAt: minutesAgo(20),
        },
      }),
    );
    openAgentPage();

    expect(await findTestId("ai-agent-status")).toHaveTextContent("Offline");
    const sentence: HTMLElement = screen.getByTestId("ai-agent-sentence");
    expect(sentence).toHaveTextContent(
      "The previous in-cluster Runner is offline. Upgrade the Kubernetes agent chart to switch to the new AI agent — your settings carry over.",
    );
    expect(sentence).not.toHaveTextContent("Works today");
    expect(codeIn(screen.getByTestId("ai-agent-install-command"))).toBe(
      getAiAgentHelmCommands().install,
    );
  });

  test("an advanced Runner is display-only for a member", async () => {
    serve(advancedStatus());
    openAgentPage();

    expect(await findTestId("ai-agent-status")).toHaveTextContent(
      "Connected through Runner bash-runner (advanced)",
    );
    expect(screen.getByTestId("ai-agent-sentence")).toHaveTextContent(
      'Reached through Runner "bash-runner" with credential "prod-east token".',
    );
    expect(
      screen.queryByTestId("ai-agent-switch-button"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("ai-agent-install-command"),
    ).not.toBeInTheDocument();
  });

  test("warns when another agent tried to register for the cluster", async () => {
    serve(
      makeStatus(
        {},
        makeAgent({
          lastRefusedRegistrationAt: new Date().toISOString(),
          lastRefusedRegistrationReason: "previous_instance_online",
        }),
      ),
    );
    openAgentPage();

    expect(await findTestId("ai-agent-refused-registration")).toHaveTextContent(
      "Another agent tried to register for this cluster at",
    );
  });

  test("an older server's status without the agent field still renders", async () => {
    const older: Partial<KubernetesClusterAiAccessStatus> = legacyStatus();
    delete older.aiAgent;
    delete older.automaticInvestigation;
    serve(older as KubernetesClusterAiAccessStatus);
    openAgentPage();

    expect(await findTestId("ai-agent-status")).toHaveTextContent(
      "Connected through the previous in-cluster Runner",
    );
    expect(
      screen.queryByTestId("ai-access-automatic-investigation"),
    ).not.toBeInTheDocument();
  });
});

/*
 * Both AI pages open with the same heading: a title and one line saying
 * what the page is for (the AI Insights page's is "AI Insights").
 */
describe("the page heading", () => {
  test("names the page and what it is for", async () => {
    openAgentPage();

    const heading: HTMLElement = await screen.findByRole(
      "heading",
      { level: 2, name: AI_AGENT_PAGE_TITLE },
      { timeout: WAIT_TIMEOUT },
    );
    expect(heading).toHaveTextContent("AI agent");
    expect(screen.getByTestId("ai-agent-page-heading")).toHaveTextContent(
      "Whether OneUptime AI can reach this cluster, and what it may do there.",
    );
    expect(screen.getByTestId("ai-agent-page-heading")).toHaveTextContent(
      AI_AGENT_PAGE_SUBTITLE,
    );
    // Above the first card.
    await findText(AGENT_CARD_TITLE);
    expect(
      screen
        .getByTestId("ai-agent-page-heading")
        .compareDocumentPosition(screen.getByText(AGENT_CARD_TITLE)) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("is shown while the status loads", async () => {
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
      AI_AGENT_PAGE_TITLE,
    );
    expect(screen.queryByText(AGENT_CARD_TITLE)).not.toBeInTheDocument();

    await act(async () => {
      answer(statusResponse(makeStatus()));
    });
    expect(await findText(AGENT_CARD_TITLE)).toBeInTheDocument();
    expect(screen.getAllByTestId("ai-agent-page-heading")).toHaveLength(1);
  });

  test("stays above the error when the first load fails", async () => {
    postSpy.mockImplementation(failStatusRequest);
    openAgentPage();

    expect(await findText("Network Error")).toBeInTheDocument();
    expect(screen.getByTestId("ai-agent-page-heading")).toHaveTextContent(
      AI_AGENT_PAGE_TITLE,
    );
  });
});

describe("status polling", () => {
  /*
   * The page read its cluster id as a fresh ObjectID on every render, so
   * the memoized fetch was recreated each render and the load effect re-ran
   * after every answer: an unbounded loop of status requests.
   */
  test("requests the status once on load, not once per render", async () => {
    openAgentPage();

    expect(await findText(AGENT_CARD_TITLE)).toBeInTheDocument();
    expect(await findText(SETTINGS_CARD_TITLE)).toBeInTheDocument();

    expect(postsTo(STATUS_ROUTE)).toHaveLength(1);
    expect(postsTo(STATUS_ROUTE)[0]!["data"]).toEqual({
      clusterId: CLUSTER_ID.toString(),
    });
  });

  test("shows the error page only when the first load fails", async () => {
    postSpy.mockImplementation(failStatusRequest);
    openAgentPage();

    expect(await findText("Network Error")).toBeInTheDocument();
    expect(screen.queryByText(AGENT_CARD_TITLE)).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("ai-access-refresh-warning"),
    ).not.toBeInTheDocument();
  });

  test("keeps the last good status and warns inline when a background poll fails", async () => {
    jest.useFakeTimers();
    postSpy
      .mockResolvedValueOnce(statusResponse(makeStatus()))
      .mockImplementationOnce(failStatusRequest)
      .mockResolvedValue(statusResponse(makeStatus()));

    openAgentPage();
    expect(await findText(AGENT_CARD_TITLE)).toBeInTheDocument();

    await act(async () => {
      jest.advanceTimersByTime(AI_AGENT_STATUS_POLL_INTERVAL_MS);
    });

    const warning: HTMLElement = await findTestId("ai-access-refresh-warning");
    expect(warning).toHaveTextContent("Could not refresh the AI agent status");
    expect(warning).toHaveTextContent("Network Error");
    expect(warning).toHaveTextContent("Showing the last status from");
    expect(screen.getByText(AGENT_CARD_TITLE)).toBeInTheDocument();
    expect(screen.getByTestId("ai-agent-status")).toHaveTextContent(
      "Connected",
    );
    expect(postSpy).toHaveBeenCalledTimes(2);

    await act(async () => {
      jest.advanceTimersByTime(AI_AGENT_STATUS_POLL_INTERVAL_MS);
    });

    await waitFor(
      () => {
        expect(
          screen.queryByTestId("ai-access-refresh-warning"),
        ).not.toBeInTheDocument();
      },
      { timeout: WAIT_TIMEOUT },
    );
    expect(postSpy).toHaveBeenCalledTimes(3);
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
      jest.advanceTimersByTime(AI_AGENT_STATUS_POLL_INTERVAL_MS);
    });

    await waitFor(
      () => {
        expect(screen.getByTestId("ai-agent-status")).toHaveTextContent(
          "Connected",
        );
      },
      { timeout: WAIT_TIMEOUT },
    );
  });

  test("keeps an open Change modal through a failed poll and its recovery", async () => {
    jest.useFakeTimers();
    postSpy
      .mockResolvedValueOnce(statusResponse(makeStatus()))
      .mockImplementation(failStatusRequest);

    openAgentPage();
    const dialog: HTMLElement = await openChangeModal();

    await act(async () => {
      jest.advanceTimersByTime(AI_AGENT_STATUS_POLL_INTERVAL_MS);
    });

    expect(await findTestId("ai-access-refresh-warning")).toHaveTextContent(
      "Network Error",
    );
    expect(screen.getByRole("dialog")).toBe(dialog);

    serve(makeStatus());
    await act(async () => {
      jest.advanceTimersByTime(AI_AGENT_STATUS_POLL_INTERVAL_MS);
    });

    await waitFor(
      () => {
        expect(
          screen.queryByTestId("ai-access-refresh-warning"),
        ).not.toBeInTheDocument();
      },
      { timeout: WAIT_TIMEOUT },
    );
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(
      within(dialog).getByText("Investigate with kubectl"),
    ).toBeInTheDocument();
  });

  test("keeps the page when a poll returns a status it cannot read", async () => {
    jest.useFakeTimers();
    postSpy
      .mockResolvedValueOnce(statusResponse(makeStatus()))
      .mockResolvedValue(
        new HTTPResponse<JSONObject>(200, { unexpected: true }, {}),
      );

    openAgentPage();
    expect(await findText(AGENT_CARD_TITLE)).toBeInTheDocument();

    await act(async () => {
      jest.advanceTimersByTime(AI_AGENT_STATUS_POLL_INTERVAL_MS);
    });

    expect(await findTestId("ai-access-refresh-warning")).toHaveTextContent(
      "cannot read",
    );
    expect(screen.getByText(AGENT_CARD_TITLE)).toBeInTheDocument();
  });
});

describe("Needs attention", () => {
  /*
   * A default install — agent connected, Fixes off — has one server gap,
   * remediation_disabled. That is a choice, shown in "What AI may do", so
   * the page has no "Needs attention" card and reads Ready.
   */
  test("is not shown when the only gap is the fixes-off choice", async () => {
    openAgentPage();

    expect(await findText(SETTINGS_CARD_TITLE)).toBeInTheDocument();
    expect(screen.queryByText(GAPS_CARD_TITLE)).not.toBeInTheDocument();
    expect(screen.getByTestId("ai-agent-ready")).toBeInTheDocument();
  });

  test("merges every server gap into one item: a headline, then a numbered step each", async () => {
    serve(
      makeStatus({
        isInvestigationReady: false,
        gaps: [
          gap("ai_balance_insufficient"),
          gap("remediation_disabled", "remediation"),
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
    ).toHaveTextContent("OneUptime AI can't investigate this cluster");

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
    // Not ready: no ready line either.
    expect(screen.queryByTestId("ai-agent-ready")).not.toBeInTheDocument();
  });

  test("a new cluster: what is wrong in one line, and the two steps that fix it", async () => {
    serve(
      notInstalledStatus({
        isInvestigationEnabled: false,
        // The server's own words, written for every surface that shows them.
        gaps: [
          {
            code: "ai_agent_not_connected",
            title: "The Kubernetes AI agent is not connected",
            description:
              "OneUptime AI runs kubectl on this cluster through the Kubernetes AI agent, and no agent has connected for this cluster yet.",
            nextStep: `Install the Kubernetes AI agent (use your own release name and namespace if they differ):\n\n${getAiAgentHelmCommands().install}\n\nAlready installed? Check its logs: kubectl logs -n <namespace> -l component=ai-agent --tail=100`,
            blocks: "both",
          },
          {
            code: "investigation_disabled",
            title: "AI investigation is turned off for this cluster",
            description:
              "OneUptime AI will investigate incidents and alerts on this cluster with OneUptime data only — it will not run kubectl.",
            nextStep:
              'Turn on "Investigate with kubectl" on the cluster\'s AI agent page (AI → Agent).',
            blocks: "investigation",
          },
          {
            code: "remediation_disabled",
            title: "AI fixes are turned off for this cluster",
            description:
              "OneUptime AI will diagnose but never propose or apply a fix on this cluster.",
            nextStep:
              'Set "Fixes" to "Ask for approval", "Automatic" or "Bypass approval" on the cluster\'s AI agent page (AI → Agent).',
            blocks: "remediation",
          },
        ],
      }),
    );
    openAgentPage();

    const item: HTMLElement = await findTestId("ai-agent-attention");
    expect(
      within(item).getByTestId("ai-agent-attention-title"),
    ).toHaveTextContent("OneUptime AI can't investigate this cluster");
    const steps: Array<HTMLElement> = within(item).getAllByRole("listitem");
    expect(steps).toHaveLength(2);
    expect(steps[0]).toHaveTextContent(
      "Install the Kubernetes AI agent with the command above.",
    );
    expect(within(steps[0]!).queryByRole("button")).not.toBeInTheDocument();
    expect(within(steps[0]!).queryByRole("link")).not.toBeInTheDocument();
    expect(steps[1]).toHaveTextContent(
      "Turn on AI investigation with kubectl.",
    );

    // Nothing sends the reader to the page they are on, or repeats a command.
    expect(item).not.toHaveTextContent("AI → Agent");
    expect(item).not.toHaveTextContent("AI agent page");
    expect(item).not.toHaveTextContent("helm");
    expect(item).not.toHaveTextContent("kubectl logs");

    // The command it points at is on the page, above it.
    const install: HTMLElement = screen.getByTestId("ai-agent-install-command");
    expect(codeIn(install)).toBe(getAiAgentHelmCommands().install);
    expect(
      install.compareDocumentPosition(item) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    fireEvent.click(
      within(steps[1]!).getByTestId("ai-agent-gap-turn-on-investigation"),
    );
    expect(await waitForOneUpdate()).toEqual({
      isAiInvestigationEnabled: true,
    });
    expect(await findTestId("ai-agent-action-notice")).toHaveTextContent(
      "AI may now investigate this cluster with kubectl.",
    );
  });

  test("a single gap is a single sentence, without a number", async () => {
    serve(
      makeStatus({
        isInvestigationEnabled: false,
        isInvestigationReady: false,
        gaps: [gap("investigation_disabled", "investigation")],
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
    ).toHaveTextContent("Turn on AI investigation with kubectl.");
  });

  test("fixes on and nothing installed: the headline names both", async () => {
    serve(
      notInstalledStatus({
        remediationMode: KubernetesAiRemediationMode.RequireApproval,
      }),
    );
    openAgentPage();

    expect(await findTestId("ai-agent-attention-title")).toHaveTextContent(
      "OneUptime AI can't investigate this cluster or run fixes on it",
    );
    expect(
      screen.getByTestId("ai-agent-gap-ai_agent_not_connected"),
    ).toHaveTextContent(
      "Install the Kubernetes AI agent with the command above.",
    );
  });

  test("fixes on with a read-only agent: only fixes are blocked, and the commands are below", async () => {
    serve(
      makeStatus({
        remediationMode: KubernetesAiRemediationMode.RequireApproval,
        gaps: [gap("remediation_write_access_missing", "remediation")],
      }),
    );
    openAgentPage();

    const item: HTMLElement = await findTestId("ai-agent-attention");
    expect(
      within(item).getByTestId("ai-agent-attention-title"),
    ).toHaveTextContent("OneUptime AI can't run fixes on this cluster");
    const step: HTMLElement = within(item).getByTestId(
      "ai-agent-gap-remediation_write_access_missing",
    );
    expect(step).toHaveTextContent(
      "Give the Kubernetes AI agent write access with the commands below.",
    );
    expect(within(step).queryByRole("button")).not.toBeInTheDocument();
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
      makeStatus(
        {
          isInvestigationReady: false,
          gaps: [gap("ai_agent_offline")],
        },
        silentAgent(),
      ),
    );
    openAgentPage();

    const item: HTMLElement = await findTestId("ai-agent-attention");
    expect(
      within(item).getByTestId("ai-agent-attention-title"),
    ).toHaveTextContent("OneUptime AI can't investigate this cluster");
    expect(item).toHaveTextContent(
      "Bring the Kubernetes AI agent back online. Its logs say why it is offline (the command is above).",
    );
    expect(
      screen
        .getByTestId("ai-agent-logs-command")
        .compareDocumentPosition(item) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("an agent that just signed off: wait for it, as the card says", async () => {
    serve(
      makeStatus(
        {
          isInvestigationReady: false,
          gaps: [gap("ai_agent_offline")],
        },
        signedOffAgent(),
      ),
    );
    openAgentPage();

    expect(await findTestId("ai-agent-gap-ai_agent_offline")).toHaveTextContent(
      "Wait a few minutes for the Kubernetes AI agent to reconnect. If it does not, its logs say why (the command is above).",
    );
    expect(screen.getByTestId("ai-agent-sentence")).toHaveTextContent(
      AI_AGENT_SIGNED_OFF_TEXT,
    );
  });

  test("the previous in-cluster Runner offline: upgrade with the command above", async () => {
    serve(
      legacyStatus({
        runner: {
          ...legacyStatus().runner!,
          isOnline: false,
          lastAliveAt: minutesAgo(20),
        },
        isInvestigationReady: false,
        gaps: [gap("runner_offline")],
      }),
    );
    openAgentPage();

    const item: HTMLElement = await findTestId("ai-agent-attention");
    const step: HTMLElement = within(item).getByTestId(
      "ai-agent-gap-runner_offline",
    );
    expect(step).toHaveTextContent(
      "Upgrade the Kubernetes agent chart with the command above. The Kubernetes AI agent replaces the previous in-cluster Runner.",
    );
    // Nothing to fix on a Runner that is being replaced.
    expect(within(step).queryByRole("link")).not.toBeInTheDocument();
    expect(within(step).queryByRole("button")).not.toBeInTheDocument();
    expect(
      screen
        .getByTestId("ai-agent-install-command")
        .compareDocumentPosition(item) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("a member gets the button they may use and is told who to ask for the rest, in the same item", async () => {
    serve(
      makeStatus({
        isInvestigationEnabled: false,
        isInvestigationReady: false,
        gaps: [
          gap("investigation_disabled", "investigation"),
          gap("llm_provider_missing"),
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
        isInvestigationEnabled: false,
        isInvestigationReady: false,
        gaps: [gap("investigation_disabled", "investigation")],
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

  test("a cluster editor turns investigation on from its row", async () => {
    serve(
      makeStatus({
        isInvestigationEnabled: false,
        isInvestigationReady: false,
        gaps: [gap("investigation_disabled", "investigation")],
      }),
    );
    openAgentPage();

    fireEvent.click(await findTestId("ai-agent-gap-turn-on-investigation"));

    expect(await waitForOneUpdate()).toEqual({
      isAiInvestigationEnabled: true,
    });
    expect(String(updateRequests()[0]!["id"])).toBe(CLUSTER_ID.toString());
    expect(updateRequests()[0]!["modelType"]).toBe(KubernetesCluster);
    expect(await findTestId("ai-agent-action-notice")).toHaveTextContent(
      "AI may now investigate this cluster with kubectl.",
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
        isInvestigationEnabled: false,
        isInvestigationReady: false,
        gaps: [gap("investigation_disabled", "investigation")],
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
        isInvestigationEnabled: false,
        isInvestigationReady: false,
        gaps: [gap("investigation_disabled", "investigation")],
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

  /*
   * Project switches live on their settings pages — never an inline
   * kill-switch here. An owner or admin gets a link; everyone else is told
   * who to ask.
   */
  test("project-level gaps link an admin to the page that fixes them", async () => {
    grant(ADMIN_PERMISSIONS);
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
    openAgentPage();

    const expected: Array<[string, string, string]> = [
      ["project_ai_disabled", "Open AI Features", "settings/ai-features"],
      ["llm_provider_missing", "Open LLM Providers", "settings/llm-providers"],
      ["ai_balance_insufficient", "Open AI Credits", "settings/ai-credits"],
    ];
    for (const [code, linkText, path] of expected) {
      const row: HTMLElement = await findTestId(`ai-agent-gap-${code}`);
      const link: HTMLElement = within(row).getByText(linkText);
      expect(link.closest("a")?.getAttribute("href")).toBe(
        `/dashboard/${PROJECT_ID}/${path}`,
      );
    }
    // No switch on this page flips a project setting.
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  test("project-level gaps tell a member who to ask", async () => {
    serve(
      makeStatus({
        isInvestigationReady: false,
        gaps: [gap("project_ai_disabled")],
      }),
    );
    openAgentPage();

    const row: HTMLElement = await findTestId(
      "ai-agent-gap-project_ai_disabled",
    );
    expect(row).toHaveTextContent("Ask a project owner or admin.");
    expect(within(row).queryByText("Open AI Features")).not.toBeInTheDocument();
  });

  /*
   * Enable AI is the project's only AI switch. The server no longer sends
   * the two gaps of the switches folded into it, but a server one release
   * behind may, while a rollout is under way: the page still sends an admin
   * to AI Features for them, where Enable AI is, and tells a member who to
   * ask.
   */
  const RETIRED_PROJECT_GAP_CODES: Array<KubernetesAiAccessGapCode> = [
    "project_auto_remediation_disabled",
    "project_ai_command_execution_disabled",
  ];

  test.each(RETIRED_PROJECT_GAP_CODES)(
    "a retired project gap from an older server (%s) still links an admin to AI Features",
    async (code: KubernetesAiAccessGapCode) => {
      grant(ADMIN_PERMISSIONS);
      serve(
        makeStatus({
          isInvestigationReady: false,
          gaps: [gap(code, "remediation")],
        }),
      );
      openAgentPage();

      const row: HTMLElement = await findTestId(`ai-agent-gap-${code}`);
      expect(
        within(row)
          .getByText("Open AI Features")
          .closest("a")
          ?.getAttribute("href"),
      ).toBe(`/dashboard/${PROJECT_ID}/settings/ai-features`);
    },
  );

  test.each(RETIRED_PROJECT_GAP_CODES)(
    "a retired project gap from an older server (%s) tells a member who to ask",
    async (code: KubernetesAiAccessGapCode) => {
      serve(
        makeStatus({
          isInvestigationReady: false,
          gaps: [gap(code, "remediation")],
        }),
      );
      openAgentPage();

      const row: HTMLElement = await findTestId(`ai-agent-gap-${code}`);
      expect(row).toHaveTextContent("Ask a project owner or admin.");
      expect(
        within(row).queryByText("Open AI Features"),
      ).not.toBeInTheDocument();
    },
  );

  test("a failed access check offers the connection test", async () => {
    serve(
      makeStatus({
        gaps: [gap("last_access_check_failed", "both")],
        isInvestigationReady: false,
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
    openAgentPage();

    const row: HTMLElement = await findTestId(
      "ai-agent-gap-last_access_check_failed",
    );
    expect(row).toHaveTextContent("Test the connection again.");
    fireEvent.click(within(row).getByTestId("ai-agent-gap-test-connection"));

    await waitFor(
      () => {
        expect(postsTo(TEST_ROUTE)).toHaveLength(1);
      },
      { timeout: WAIT_TIMEOUT },
    );
    expect(await findText("The connection works")).toBeInTheDocument();
  });

  test("an advanced Runner's gap links to the Runner", async () => {
    serve(
      advancedStatus({
        runner: { ...advancedStatus().runner!, isOnline: false },
        isInvestigationReady: false,
        gaps: [gap("runner_offline")],
      }),
    );
    openAgentPage();

    const row: HTMLElement = await findTestId("ai-agent-gap-runner_offline");
    expect(row).toHaveTextContent(
      "Start the Runner and make sure it can reach your OneUptime URL.",
    );
    expect(
      within(row).getByText("View Runner").closest("a")?.getAttribute("href"),
    ).toBe(`/dashboard/${PROJECT_ID}/settings/runners/${HOST_RUNNER_ID}`);
  });

  test("an advanced Runner without a credential: choose one or clear it, with Change below", async () => {
    serve(
      advancedStatus({
        accessMethod: "none",
        credentialId: undefined,
        credentialName: undefined,
        isInvestigationReady: false,
        gaps: [gap("credential_missing")],
      }),
    );
    openAgentPage();

    const item: HTMLElement = await findTestId("ai-agent-attention");
    expect(
      within(item).getByTestId("ai-agent-gap-credential_missing"),
    ).toHaveTextContent(
      "With Change below, choose a Kubernetes credential the Runner may use, or clear the Runner to use the Kubernetes AI agent.",
    );
    expect(
      item.compareDocumentPosition(
        screen.getByTestId("ai-access-change-button"),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("the not-installed gap has no extra action: the command is on the card", async () => {
    serve(notInstalledStatus());
    openAgentPage();

    const row: HTMLElement = await findTestId(
      "ai-agent-gap-ai_agent_not_connected",
    );
    expect(row).toHaveTextContent(
      "Install the Kubernetes AI agent with the command above.",
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
    expect(within(card).getByTestId("card-description")).toHaveTextContent(
      "For incidents and alerts on this cluster. Changes apply from the next one.",
    );

    expect(
      screen.getByTestId("ai-access-investigation-badge"),
    ).toHaveTextContent("On");
    expect(
      screen.getByTestId("ai-access-investigation-value"),
    ).toHaveTextContent(INVESTIGATION_ON_SENTENCE);
    expect(screen.getByTestId("ai-access-fixes-badge")).toHaveTextContent(
      "Off",
    );
    expect(screen.getByTestId("ai-access-fixes-value")).toHaveTextContent(
      REMEDIATION_MODE_SUMMARIES[KubernetesAiRemediationMode.Disabled],
    );
    // A member may not turn fixes on: told who may.
    expect(screen.getByTestId("ai-access-fixes-off-hint")).toHaveTextContent(
      getAiFixesOffHint(false),
    );
    // Off: no write commands, no allowlist.
    expect(
      screen.queryByTestId("ai-access-write-commands"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("kubectl-allowlist-in-effect"),
    ).not.toBeInTheDocument();
  });

  test("investigation off says so", async () => {
    serve(
      makeStatus({
        isInvestigationEnabled: false,
        isInvestigationReady: false,
      }),
    );
    openAgentPage();

    expect(await findTestId("ai-access-investigation-badge")).toHaveTextContent(
      "Off",
    );
    expect(
      screen.getByTestId("ai-access-investigation-value"),
    ).toHaveTextContent(getAiInvestigationOffSentence("cluster"));
    const card: HTMLElement = await settingsCard();
    expect(card).not.toHaveTextContent("only investigates");
    expect(card).not.toHaveTextContent("No — AI investigates");
  });

  test("an admin on fixes Off is told to click Change and choose Ask for approval", async () => {
    grant(ADMIN_PERMISSIONS);
    openAgentPage();

    expect(await findTestId("ai-access-fixes-off-hint")).toHaveTextContent(
      "Want AI to propose fixes? Click Change and choose Ask for approval.",
    );
  });

  test.each(Object.values(KubernetesAiRemediationMode))(
    "fixes in %s: the badge names the mode in its tone, the sentence says what it does",
    async (mode: KubernetesAiRemediationMode) => {
      serve(makeStatus({ remediationMode: mode }));
      openAgentPage();

      const badge: HTMLElement = await findTestId("ai-access-fixes-badge");
      expect(badge).toHaveTextContent(REMEDIATION_MODE_SHORT_NAMES[mode]);
      expect(badge).toHaveAttribute("data-tone", AI_FIXES_MODE_TONES[mode]);
      expect(screen.getByTestId("ai-access-fixes-value")).toHaveTextContent(
        REMEDIATION_MODE_SUMMARIES[mode],
      );
    },
  );

  test("the write-access command and the credential note sit in the Fixes row", async () => {
    serve(
      makeStatus({
        remediationMode: KubernetesAiRemediationMode.RequireApproval,
      }),
    );
    openAgentPage();

    const fixes: HTMLElement = await findTestId("ai-access-fixes");
    expect(
      within(fixes).getByTestId("ai-access-write-commands"),
    ).toHaveTextContent("Give the agent write access");
    cleanup();

    serve(
      advancedStatus({
        remediationMode: KubernetesAiRemediationMode.Automatic,
      }),
    );
    openAgentPage();
    expect(
      within(await findTestId("ai-access-fixes")).getByTestId(
        "ai-access-credential-rbac-note",
      ),
    ).toBeInTheDocument();
  });

  test("the project's automatic-investigation line sits in the Investigation row", async () => {
    openAgentPage();

    expect(
      within(await findTestId("ai-access-investigation")).getByTestId(
        "ai-access-automatic-investigation",
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("ai-access-fixes")).queryByTestId(
        "ai-access-automatic-investigation",
      ),
    ).not.toBeInTheDocument();
  });

  /*
   * The write-access command appears only once fixes are on and the agent
   * is read-only — never on a default install.
   */
  test("fixes on with a read-only agent: the scoped command, the cluster-wide one and the disclosure", async () => {
    serve(
      makeStatus({
        remediationMode: KubernetesAiRemediationMode.RequireApproval,
        gaps: [gap("remediation_write_access_missing", "remediation")],
      }),
    );
    openAgentPage();

    const section: HTMLElement = await findTestId("ai-access-write-commands");
    expect(section).toHaveTextContent("Give the agent write access");
    expect(
      codeIn(screen.getByTestId("ai-access-helm-remediation-scoped-command")),
    ).toBe(getAiAgentHelmCommands().enableRemediationScoped);
    expect(
      codeIn(screen.getByTestId("ai-access-helm-remediation-command")),
    ).toBe(getAiAgentHelmCommands().enableRemediation);
    expect(screen.getByTestId("ai-access-write-disclosure")).toHaveTextContent(
      getAiAgentWriteDisclosure(),
    );
    expect(
      screen.queryByTestId("ai-access-fixes-off-hint"),
    ).not.toBeInTheDocument();
  });

  test("an agent that already writes gets no command, and says where it may change", async () => {
    serve(
      makeStatus(
        { remediationMode: KubernetesAiRemediationMode.RequireApproval },
        makeAgent({
          posture: {
            inCluster: true,
            allowWrites: true,
            writeNamespaces: ["web", "api"],
            allowNodeOperations: false,
            kubectlVersion: "v1.31.2",
          },
        }),
      ),
    );
    openAgentPage();

    expect(await findTestId("ai-agent-meta")).toHaveTextContent(
      "Can change: web, api · node operations off",
    );
    expect(
      screen.queryByTestId("ai-access-write-commands"),
    ).not.toBeInTheDocument();
  });

  test("an advanced Runner is bounded by its credential, not the chart", async () => {
    serve(
      advancedStatus({
        remediationMode: KubernetesAiRemediationMode.Automatic,
      }),
    );
    openAgentPage();

    expect(
      await findTestId("ai-access-credential-rbac-note"),
    ).toHaveTextContent("limited by the Runner's credential");
    expect(
      screen.queryByTestId("ai-access-write-commands"),
    ).not.toBeInTheDocument();
  });

  test("the allowlist in effect is listed in Automatic mode only", async () => {
    serve(
      makeStatus({
        remediationMode: KubernetesAiRemediationMode.Automatic,
        kubectlAllowlist: [SET_IMAGE_PATTERN],
      }),
    );
    openAgentPage();

    expect(await findTestId("kubectl-allowlist-in-effect")).toHaveTextContent(
      SET_IMAGE_PATTERN,
    );
    cleanup();

    serve(
      makeStatus({
        remediationMode: KubernetesAiRemediationMode.BypassApproval,
        kubectlAllowlist: [SET_IMAGE_PATTERN],
      }),
    );
    openAgentPage();
    expect(await findTestId("ai-access-fixes-badge")).toHaveTextContent(
      "Bypass approval",
    );
    expect(
      screen.queryByTestId("kubectl-allowlist-in-effect"),
    ).not.toBeInTheDocument();
  });

  test("an empty allowlist in Automatic mode reads None", async () => {
    serve(
      makeStatus({ remediationMode: KubernetesAiRemediationMode.Automatic }),
    );
    openAgentPage();

    expect(await findTestId("kubectl-allowlist-in-effect")).toHaveTextContent(
      "None — riskier fixes always wait for approval.",
    );
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

describe("automatic investigation footer", () => {
  test("reads On for both and offers nothing more", async () => {
    grant(ADMIN_PERMISSIONS);
    openAgentPage();

    const footer: HTMLElement = await findTestId(
      "ai-access-automatic-investigation",
    );
    expect(footer).toHaveTextContent(
      "Automatic investigation for new incidents in this project: On · alerts: On",
    );
    expect(
      within(footer).queryByTestId("ai-access-automatic-investigation-turn-on"),
    ).not.toBeInTheDocument();
  });

  /*
   * The opt-in is project-wide. It is never flipped inline: an owner or
   * admin confirms, told it applies to every incident in the project and
   * where its limits live.
   */
  test("an admin turns it on after a confirmation that says it is project-wide", async () => {
    grant(ADMIN_PERMISSIONS);
    serve(
      makeStatus({
        automaticInvestigation: { incidents: false, alerts: false },
      }),
    );
    openAgentPage();

    expect(
      await findTestId("ai-access-automatic-investigation"),
    ).toHaveTextContent(
      "Automatic investigation for new incidents in this project: Off · alerts: Off",
    );
    fireEvent.click(
      screen.getByTestId("ai-access-automatic-investigation-turn-on"),
    );

    const confirm: HTMLElement = await findDialogTitled(
      "Turn on automatic investigation?",
    );
    expect(confirm).toHaveTextContent(
      "This applies to every new incident and alert in Acme, not just this cluster. Limits live under Incidents → Settings → AI.",
    );
    expect(
      within(confirm)
        .getByText("Open settings")
        .closest("a")
        ?.getAttribute("href"),
    ).toBe(`/dashboard/${PROJECT_ID}/incidents/settings/ai`);
    expect(updateByIdSpy).not.toHaveBeenCalled();

    fireEvent.click(within(confirm).getByText("Turn on"));

    expect(await waitForOneUpdate()).toEqual({
      enableAutomaticIncidentInvestigation: true,
      enableAutomaticAlertInvestigation: true,
    });
    expect(updateRequests()[0]!["modelType"]).toBe(Project);
    expect(String(updateRequests()[0]!["id"])).toBe(PROJECT_ID);
    expect(await findTestId("ai-agent-action-notice")).toHaveTextContent(
      "Automatic investigation is on for this project.",
    );
  });

  test("turning it on writes only the flag that is off", async () => {
    grant(ADMIN_PERMISSIONS);
    serve(
      makeStatus({
        automaticInvestigation: { incidents: true, alerts: false },
      }),
    );
    openAgentPage();

    fireEvent.click(
      await findTestId("ai-access-automatic-investigation-turn-on"),
    );
    const confirm: HTMLElement = await findDialogTitled(
      "Turn on automatic investigation?",
    );
    expect(confirm).toHaveTextContent("every new alert in Acme");
    fireEvent.click(within(confirm).getByText("Turn on"));

    expect(await waitForOneUpdate()).toEqual({
      enableAutomaticAlertInvestigation: true,
    });
  });

  test("a refused opt-in stays in its dialog with the reason", async () => {
    grant(ADMIN_PERMISSIONS);
    serve(
      makeStatus({
        automaticInvestigation: { incidents: false, alerts: true },
      }),
    );
    updateByIdSpy.mockImplementation(async (): Promise<never> => {
      throw new HTTPErrorResponse(
        422,
        { error: "You do not have permission to update this project." },
        {},
      );
    });
    openAgentPage();

    fireEvent.click(
      await findTestId("ai-access-automatic-investigation-turn-on"),
    );
    const confirm: HTMLElement = await findDialogTitled(
      "Turn on automatic investigation?",
    );
    fireEvent.click(within(confirm).getByText("Turn on"));

    expect(
      await within(confirm).findByText(
        "You do not have permission to update this project.",
        {},
        { timeout: WAIT_TIMEOUT },
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Turn on automatic investigation?"),
    ).toBeInTheDocument();
  });

  test("a member is told who to ask", async () => {
    serve(
      makeStatus({
        automaticInvestigation: { incidents: false, alerts: false },
      }),
    );
    openAgentPage();

    expect(
      await findTestId("ai-access-automatic-investigation-ask"),
    ).toHaveTextContent("Ask a project owner or admin.");
    expect(
      screen.queryByTestId("ai-access-automatic-investigation-turn-on"),
    ).not.toBeInTheDocument();
  });
});

describe("the Change modal: the mode cards", () => {
  test("one card per mode, each saying what it does, the saved one chosen", async () => {
    grant(ADMIN_PERMISSIONS);
    openAgentPage();
    const dialog: HTMLElement = await openChangeModal();

    expect(modeCards(dialog)).toHaveLength(4);
    for (const mode of Object.values(KubernetesAiRemediationMode)) {
      const card: HTMLElement = modeCard(dialog, mode);
      expect(card).toHaveTextContent(
        REMEDIATION_MODE_OPTION_DESCRIPTIONS[mode],
      );
      expect(card).toHaveAttribute(
        "aria-checked",
        mode === KubernetesAiRemediationMode.RequireApproval ? "true" : "false",
      );
    }
    expect(
      within(dialog).getByText(getAiFixesFieldDescription("cluster")),
    ).toBeInTheDocument();
    expect(dialog).not.toHaveTextContent("Off: AI only investigates.");
    expect(
      within(dialog).queryByRole("combobox", { name: /^Fixes/ }),
    ).not.toBeInTheDocument();
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
    ).toEqual(formatAiAccessProtections(getEveryModeProtections()));
  });

  test("a member's note says what they can change first, then what needs more", async () => {
    openAgentPage();
    const dialog: HTMLElement = await openChangeModal();

    const note: HTMLElement = within(dialog).getByTestId(
      "kubernetes-ai-access-admin-note",
    );
    expect(note).toHaveTextContent(
      "You can turn investigation on or off, lower fixes and remove allowlist patterns.",
    );
    expect(note).toHaveTextContent(
      "Turning fixes on or up, adding allowlist patterns, or choosing a Runner needs Project Owner, Project Admin or Edit Auto Remediation Rule.",
    );
  });

  test("the kubectl allowlist help is the short one, without the permission rules", async () => {
    grant(ADMIN_PERMISSIONS);
    serveCluster({ aiRemediationMode: KubernetesAiRemediationMode.Automatic });
    openAgentPage();
    const dialog: HTMLElement = await openChangeModal();

    await within(dialog).findByTestId(
      "kubectl-allowlist-field",
      {},
      { timeout: WAIT_TIMEOUT },
    );
    expect(
      within(dialog).getByText(KUBECTL_ALLOWLIST_FIELD_DESCRIPTION),
    ).toBeInTheDocument();
  });

  test("a card chosen from the keyboard is saved like a clicked one", async () => {
    grant(ADMIN_PERMISSIONS);
    openAgentPage();
    const dialog: HTMLElement = await openChangeModal();

    fireEvent.keyDown(modeCard(dialog, KubernetesAiRemediationMode.Disabled), {
      key: " ",
    });
    await waitFor(
      () => {
        expect(
          modeCard(dialog, KubernetesAiRemediationMode.Disabled),
        ).toHaveAttribute("aria-checked", "true");
      },
      { timeout: WAIT_TIMEOUT },
    );
    saveChangeModal(dialog);

    expect(await waitForOneUpdate()).toEqual({
      aiRemediationMode: KubernetesAiRemediationMode.Disabled,
    });
  });
});

describe("the Change modal: who may loosen", () => {
  test("a member on an Ask-for-approval cluster is offered only Off and the current mode, and told why", async () => {
    openAgentPage();
    const dialog: HTMLElement = await openChangeModal();

    expect(
      within(dialog).getByTestId("kubernetes-ai-access-admin-note"),
    ).toHaveTextContent("Edit Auto Remediation Rule");
    // Nothing saved to remove: no allowlist field; no Runner either.
    expect(
      within(dialog).queryByTestId("kubectl-allowlist-field"),
    ).not.toBeInTheDocument();
    expect(within(dialog).queryByText("Runner")).not.toBeInTheDocument();

    expect(modeCardTitles(dialog)).toEqual([
      "Off",
      "Ask for approval (current)",
    ]);
    expect(listRequestsFor(Runner)).toHaveLength(0);
    expect(listRequestsFor(RunbookCredential)).toHaveLength(0);
  });

  /*
   * Regression (§11): Off -> Ask for approval used to be open to every
   * cluster editor. Turning fixes on at all now needs the admin set.
   */
  test("a member on an Off cluster cannot turn fixes on", async () => {
    serveCluster({ aiRemediationMode: KubernetesAiRemediationMode.Disabled });
    openAgentPage();
    const dialog: HTMLElement = await openChangeModal();

    expect(modeCardTitles(dialog)).toEqual(["Off (current)"]);
  });

  test("an admin is offered every mode", async () => {
    grant(ADMIN_PERMISSIONS);
    openAgentPage();
    const dialog: HTMLElement = await openChangeModal();

    expect(
      within(dialog).queryByTestId("kubernetes-ai-access-admin-note"),
    ).not.toBeInTheDocument();
    expect(modeCardTitles(dialog)).toEqual([
      "Off",
      "Ask for approval (current)",
      "Automatic",
      "Bypass approval",
    ]);
  });

  test("an admin turns fixes on from Off", async () => {
    grant(ADMIN_PERMISSIONS);
    serveCluster({ aiRemediationMode: KubernetesAiRemediationMode.Disabled });
    openAgentPage();
    const dialog: HTMLElement = await openChangeModal();

    pickMode(dialog, KubernetesAiRemediationMode.RequireApproval);
    saveChangeModal(dialog);

    expect(await waitForOneUpdate()).toEqual({
      aiRemediationMode: KubernetesAiRemediationMode.RequireApproval,
    });
  });

  test("a member on a Bypass-approval cluster may step down to Automatic", async () => {
    serveCluster({
      aiRemediationMode: KubernetesAiRemediationMode.BypassApproval,
    });
    openAgentPage();
    const dialog: HTMLElement = await openChangeModal();

    expect(modeCardTitles(dialog)).toEqual([
      "Off",
      "Ask for approval",
      "Automatic",
      "Bypass approval (current)",
    ]);

    pickMode(dialog, KubernetesAiRemediationMode.Automatic);
    saveChangeModal(dialog);

    expect(await waitForOneUpdate()).toEqual({
      aiRemediationMode: KubernetesAiRemediationMode.Automatic,
    });
    // A step down is not a new risk: no confirmation either.
    expect(
      screen.queryByText("Let riskier changes run without approval?"),
    ).not.toBeInTheDocument();
  });

  test("a member may remove an allowlist pattern", async () => {
    serveCluster({
      aiRemediationMode: KubernetesAiRemediationMode.Automatic,
      aiKubectlCommandAllowlist: [SET_IMAGE_PATTERN, PATCH_PATTERN],
    });
    openAgentPage();
    const dialog: HTMLElement = await openChangeModal();

    expect(
      within(dialog).getByTestId("kubernetes-ai-access-admin-note"),
    ).toHaveTextContent("remove allowlist patterns");
    await setAllowlistText(dialog, SET_IMAGE_PATTERN);
    saveChangeModal(dialog);

    expect(await waitForOneUpdate()).toEqual({
      aiKubectlCommandAllowlist: [SET_IMAGE_PATTERN],
    });
  });

  test("a member who adds a pattern is told it needs the admin set, and nothing is sent", async () => {
    serveCluster({
      aiRemediationMode: KubernetesAiRemediationMode.Automatic,
      aiKubectlCommandAllowlist: [SET_IMAGE_PATTERN],
    });
    openAgentPage();
    const dialog: HTMLElement = await openChangeModal();

    await setAllowlistText(
      dialog,
      `${SET_IMAGE_PATTERN}\nkubectl set image deployment/web * -n prod`,
    );
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
    serveCluster({ aiRemediationMode: KubernetesAiRemediationMode.Automatic });
    openAgentPage();
    const dialog: HTMLElement = await openChangeModal();

    expect(
      await within(dialog).findByTestId(
        "kubectl-allowlist-field",
        {},
        { timeout: WAIT_TIMEOUT },
      ),
    ).toBeInTheDocument();

    pickMode(dialog, KubernetesAiRemediationMode.RequireApproval);
    await waitFor(
      () => {
        expect(
          within(dialog).queryByTestId("kubectl-allowlist-field"),
        ).not.toBeInTheDocument();
      },
      { timeout: WAIT_TIMEOUT },
    );
  });

  test("a member who only switches investigation off sends only that", async () => {
    serveCluster({
      aiRemediationMode: KubernetesAiRemediationMode.Automatic,
      aiKubectlCommandAllowlist: [SET_IMAGE_PATTERN],
    });
    openAgentPage();
    const dialog: HTMLElement = await openChangeModal();

    await toggleSwitch(dialog, "ai-investigation-field", true);
    saveChangeModal(dialog);

    expect(await waitForOneUpdate()).toEqual({
      isAiInvestigationEnabled: false,
    });
    const request: JSONObject = updateRequests()[0]!;
    expect(String(request["id"])).toBe(CLUSTER_ID.toString());
    expect(request["modelType"]).toBe(KubernetesCluster);

    // Saved: the modal closes and the status is read again.
    await waitFor(
      () => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      },
      { timeout: WAIT_TIMEOUT },
    );
    await waitFor(
      () => {
        expect(postsTo(STATUS_ROUTE).length).toBeGreaterThanOrEqual(2);
      },
      { timeout: WAIT_TIMEOUT },
    );
  });

  test("an untouched form saves nothing", async () => {
    grant(ADMIN_PERMISSIONS);
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

  test("a server refusal is shown and the modal stays open", async () => {
    updateByIdSpy.mockImplementation(async (): Promise<never> => {
      throw new HTTPErrorResponse(
        422,
        { error: "You do not have permission to change fixes." },
        {},
      );
    });
    openAgentPage();
    const dialog: HTMLElement = await openChangeModal();

    await toggleSwitch(dialog, "ai-investigation-field", true);
    saveChangeModal(dialog);

    expect(await findTestId("ai-access-save-error")).toHaveTextContent(
      "You do not have permission to change fixes.",
    );
    expect(screen.getByRole("dialog")).toBe(dialog);
  });
});

describe("the Change modal: confirmations", () => {
  test("Bypass approval is saved only after a confirmation that names what it unlocks", async () => {
    grant(ADMIN_PERMISSIONS);
    openAgentPage();
    const dialog: HTMLElement = await openChangeModal();

    pickMode(dialog, KubernetesAiRemediationMode.BypassApproval);
    saveChangeModal(dialog);

    const confirm: HTMLElement = await findDialogTitled(
      "Turn on Bypass approval?",
    );
    expect(confirm).toHaveTextContent("set image");
    expect(confirm).toHaveTextContent("drain");
    expect(confirm).toHaveTextContent("kube-system");
    expect(updateByIdSpy).not.toHaveBeenCalled();

    fireEvent.click(within(confirm).getByText("Confirm and save"));

    expect(await waitForOneUpdate()).toEqual({
      aiRemediationMode: KubernetesAiRemediationMode.BypassApproval,
    });
  });

  test("cancelling a confirmation saves nothing and keeps the form", async () => {
    grant(ADMIN_PERMISSIONS);
    serveCluster({ aiRemediationMode: KubernetesAiRemediationMode.Automatic });
    openAgentPage();
    const dialog: HTMLElement = await openChangeModal();

    await setAllowlistText(dialog, BROAD_PATTERN);
    saveChangeModal(dialog);

    const confirm: HTMLElement = await findDialogTitled(
      "Let riskier changes run without approval?",
    );
    expect(confirm).toHaveTextContent(`"${BROAD_PATTERN}"`);
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
    expect(screen.getByRole("dialog")).toBe(dialog);
  });

  test("a broad allowlist is saved after confirmation, one pattern per line", async () => {
    grant(ADMIN_PERMISSIONS);
    serveCluster({ aiRemediationMode: KubernetesAiRemediationMode.Automatic });
    openAgentPage();
    const dialog: HTMLElement = await openChangeModal();

    await setAllowlistText(
      dialog,
      `${SET_IMAGE_PATTERN}\n\n${BROAD_PATTERN}\n`,
    );
    saveChangeModal(dialog);

    const confirm: HTMLElement = await findDialogTitled(
      "Let riskier changes run without approval?",
    );
    fireEvent.click(within(confirm).getByText("Confirm and save"));

    expect(await waitForOneUpdate()).toEqual({
      aiKubectlCommandAllowlist: [SET_IMAGE_PATTERN, BROAD_PATTERN],
    });
  });

  test("an allowlist pattern the matcher cannot use is refused in the form", async () => {
    grant(ADMIN_PERMISSIONS);
    serveCluster({ aiRemediationMode: KubernetesAiRemediationMode.Automatic });
    openAgentPage();
    const dialog: HTMLElement = await openChangeModal();

    await setAllowlistText(dialog, `${SET_IMAGE_PATTERN}\nkubectl`);
    saveChangeModal(dialog);

    expect(
      await within(dialog).findByText(
        /^Pattern 2: /,
        {},
        { timeout: WAIT_TIMEOUT },
      ),
    ).toBeInTheDocument();
    expect(updateByIdSpy).not.toHaveBeenCalled();
  });

  test("explains how patterns match", async () => {
    grant(ADMIN_PERMISSIONS);
    serveCluster({ aiRemediationMode: KubernetesAiRemediationMode.Automatic });
    openAgentPage();
    const dialog: HTMLElement = await openChangeModal();

    const description: HTMLElement = await within(dialog).findByText(
      /\* matches exactly one word/,
      {},
      { timeout: WAIT_TIMEOUT },
    );
    expect(description).toHaveTextContent("flags must be written out");
    expect(description).toHaveTextContent('a leading "kubectl" is optional');
  });

  /*
   * The help no longer lists every rule up front. A rule is explained
   * where it bites: by the pattern's own validation error, before anything
   * is sent.
   */
  test("a pattern with * for the verb is explained when it is saved, and nothing is sent", async () => {
    grant(ADMIN_PERMISSIONS);
    serveCluster({ aiRemediationMode: KubernetesAiRemediationMode.Automatic });
    openAgentPage();
    const dialog: HTMLElement = await openChangeModal();

    await setAllowlistText(dialog, "kubectl * deployment/web -n web");
    saveChangeModal(dialog);

    expect(
      await within(dialog).findByText(
        /has a \* where the kubectl verb goes\. .* so write the verb out/,
        {},
        { timeout: WAIT_TIMEOUT },
      ),
    ).toBeInTheDocument();
    expect(updateByIdSpy).not.toHaveBeenCalled();
  });
});

/*
 * The Runner and credential pickers exist only for a cluster already bound
 * to a Runner outside the chart. Every other cluster is reached through its
 * Kubernetes AI agent: nothing is listed, not even for an admin.
 */
describe("the Change modal: advanced Runner bindings", () => {
  test("a cluster on its AI agent never lists Runners or credentials, even for an admin", async () => {
    grant(ADMIN_PERMISSIONS);
    openAgentPage();
    const dialog: HTMLElement = await openChangeModal();

    expect(within(dialog).queryByText("Runner")).not.toBeInTheDocument();
    expect(
      within(dialog).queryByText("Kubernetes credential"),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).queryByTestId("ai-access-clear-runner-field"),
    ).not.toBeInTheDocument();
    expect(listRequestsFor(Runner)).toHaveLength(0);
    expect(listRequestsFor(RunbookCredential)).toHaveLength(0);
  });

  test("an admin gets the pickers: Runners outside the chart only, credentials that follow the Runner", async () => {
    grant(ADMIN_PERMISSIONS);
    serve(advancedStatus());
    serveCluster(hostRunnerBinding());
    openAgentPage();
    const dialog: HTMLElement = await openChangeModal();

    await within(dialog).findByText("Runner", {}, { timeout: WAIT_TIMEOUT });
    expect(await openDropdown(dialog, /^Runner/)).toEqual(["bash-runner"]);
    fireEvent.keyDown(
      within(dialog).getByRole("combobox", { name: /^Runner/ }),
      {
        key: "Escape",
        code: "Escape",
      },
    );

    expect(await openDropdown(dialog, /^Kubernetes credential/)).toEqual([
      "prod-east token",
    ]);
    const credentialRequest: ListRequest =
      listRequestsFor(RunbookCredential)[0]!;
    expect(credentialRequest.query).toEqual({
      credentialType: RunbookCredentialType.Kubernetes,
    });
  });

  /*
   * Regression (§11): unbinding an advanced Runner on a cluster that has
   * an AI agent moves AI to the agent (possibly broader RBAC), so a
   * cluster editor without the admin set is no longer offered the switch.
   */
  test("a member may not unbind an advanced Runner once the cluster has an AI agent", async () => {
    serve(advancedStatus());
    serveCluster(hostRunnerBinding());
    openAgentPage();
    const dialog: HTMLElement = await openChangeModal();

    expect(
      within(dialog).queryByTestId("ai-access-clear-runner-field"),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).queryByTestId("ai-access-clear-credential-field"),
    ).not.toBeInTheDocument();
    expect(listRequestsFor(Runner)).toHaveLength(0);
  });

  test("without an AI agent a member may still unbind, which only takes access away", async () => {
    serve(advancedStatus({ aiAgent: null }));
    serveCluster(hostRunnerBinding());
    openAgentPage();
    const dialog: HTMLElement = await openChangeModal();

    expect(
      within(dialog).getByText(/Bound now: bash-runner/),
    ).toBeInTheDocument();
    await toggleSwitch(dialog, "ai-access-clear-runner-field", false);
    await toggleSwitch(dialog, "ai-access-clear-credential-field", false);
    saveChangeModal(dialog);

    expect(await waitForOneUpdate()).toEqual({
      aiAccessRunnerId: null,
      aiAccessCredentialId: null,
    });
  });

  test("an admin who may not read Runners gets the unbind switch, told why", async () => {
    grant([
      ...BASE_PERMISSIONS,
      Permission.EditKubernetesCluster,
      Permission.ReadKubernetesCluster,
      Permission.EditAutoRemediationRule,
    ]);
    serve(advancedStatus());
    serveCluster(hostRunnerBinding(false));
    openAgentPage();
    const dialog: HTMLElement = await openChangeModal();

    expect(
      within(dialog).getByTestId("kubernetes-runner-picker-permission-note"),
    ).toHaveTextContent("Read Runbook Agent");
    expect(
      within(dialog).getByTestId("ai-access-clear-runner-field"),
    ).toBeInTheDocument();
    expect(listRequestsFor(Runner)).toHaveLength(0);
  });

  test("one picker's failed list leaves the other picker and the form working", async () => {
    grant(ADMIN_PERMISSIONS);
    serve(advancedStatus());
    serveCluster(hostRunnerBinding());
    const listImplementation: (args: unknown) => Promise<unknown> =
      getListSpy.getMockImplementation() as (args: unknown) => Promise<unknown>;
    getListSpy.mockImplementation(async (args: unknown): Promise<unknown> => {
      if ((args as ListRequest).modelType === Runner) {
        throw new Error("You do not have permissions to read Runner.");
      }
      return await listImplementation(args);
    });
    openAgentPage();
    const dialog: HTMLElement = await openChangeModal();

    expect(
      await within(dialog).findByText(
        "Kubernetes credential",
        {},
        { timeout: WAIT_TIMEOUT },
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(/The Runner list could not be loaded/),
    ).toBeInTheDocument();
  });
});

describe("Switch to the AI agent", () => {
  test("an admin moves an advanced binding to the online agent after confirming", async () => {
    grant(ADMIN_PERMISSIONS);
    serve(advancedStatus());
    openAgentPage();

    fireEvent.click(await findTestId("ai-agent-switch-button"));
    const confirm: HTMLElement = await findDialogTitled(
      "Switch to the AI agent?",
    );
    expect(confirm).toHaveTextContent(
      'AI stops using Runner "bash-runner" and credential "prod-east token"',
    );
    expect(confirm).toHaveTextContent("(Read-only)");
    expect(updateByIdSpy).not.toHaveBeenCalled();

    fireEvent.click(within(confirm).getByText("Switch"));

    expect(await waitForOneUpdate()).toEqual({
      aiAccessRunnerId: null,
      aiAccessCredentialId: null,
    });
    expect(await findTestId("ai-agent-action-notice")).toHaveTextContent(
      "AI now reaches this cluster through its AI agent.",
    );
  });

  test("is not offered while the agent is offline, or to a member", async () => {
    grant(ADMIN_PERMISSIONS);
    serve(advancedStatus({ aiAgent: silentAgent() }));
    openAgentPage();
    await findTestId("ai-agent-status");
    expect(
      screen.queryByTestId("ai-agent-switch-button"),
    ).not.toBeInTheDocument();
    cleanup();

    grant(MEMBER_PERMISSIONS);
    serve(advancedStatus());
    openAgentPage();
    await findTestId("ai-agent-status");
    expect(
      screen.queryByTestId("ai-agent-switch-button"),
    ).not.toBeInTheDocument();
  });
});

describe("Reset agent", () => {
  test("an admin resets the agent after confirming, and the page says what happens next", async () => {
    grant(ADMIN_PERMISSIONS);
    openAgentPage();

    fireEvent.click(await findTestId("ai-agent-reset-button"));
    const confirm: HTMLElement = await findDialogTitled("Reset the AI agent?");
    expect(confirm).toHaveTextContent("revokes the agent's key");
    expect(postsTo(RESET_ROUTE)).toHaveLength(0);

    fireEvent.click(within(confirm).getByText("Reset agent"));

    await waitFor(
      () => {
        expect(postsTo(RESET_ROUTE)).toHaveLength(1);
      },
      { timeout: WAIT_TIMEOUT },
    );
    expect(postsTo(RESET_ROUTE)[0]!["data"]).toEqual({
      clusterId: CLUSTER_ID.toString(),
    });
    expect(await findTestId("ai-agent-action-notice")).toHaveTextContent(
      "The AI agent was reset. It reconnects on its own within a few minutes.",
    );
    await waitFor(
      () => {
        expect(postsTo(STATUS_ROUTE).length).toBeGreaterThanOrEqual(2);
      },
      { timeout: WAIT_TIMEOUT },
    );
  });

  /*
   * The reset marks the agent disconnected at once, so the next status
   * reads Offline while its last heartbeat is seconds old. The card says it
   * was reset and comes back, not that it went quiet five minutes ago.
   */
  test("after a reset the card says the agent reconnects, not that it went quiet", async () => {
    grant(ADMIN_PERMISSIONS);
    serve(makeStatus(), {
      reset: async (): Promise<HTTPResponse<JSONObject>> => {
        serve(makeStatus({}, signedOffAgent()));
        return new HTTPResponse<JSONObject>(200, {}, {});
      },
    });
    openAgentPage();

    fireEvent.click(await findTestId("ai-agent-reset-button"));
    const confirm: HTMLElement = await findDialogTitled("Reset the AI agent?");
    fireEvent.click(within(confirm).getByText("Reset agent"));

    await waitFor(
      () => {
        expect(screen.getByTestId("ai-agent-status")).toHaveTextContent(
          "Offline",
        );
      },
      { timeout: WAIT_TIMEOUT },
    );
    expect(screen.getByTestId("ai-agent-sentence")).toHaveTextContent(
      AI_AGENT_SIGNED_OFF_TEXT,
    );
    expect(screen.getByTestId("ai-agent-sentence")).not.toHaveTextContent(
      "has not checked in",
    );
    expect(screen.getByTestId("ai-agent-meta")).toHaveTextContent(
      /^last seen /,
    );
  });

  test("a refused reset stays in its dialog with the server's reason", async () => {
    grant(ADMIN_PERMISSIONS);
    serve(makeStatus(), {
      reset: async (): Promise<HTTPErrorResponse> => {
        return new HTTPErrorResponse(
          422,
          { error: "You do not have permission to reset the agent." },
          {},
        );
      },
    });
    openAgentPage();

    fireEvent.click(await findTestId("ai-agent-reset-button"));
    const confirm: HTMLElement = await findDialogTitled("Reset the AI agent?");
    fireEvent.click(within(confirm).getByText("Reset agent"));

    expect(
      await within(confirm).findByText(
        "You do not have permission to reset the agent.",
        {},
        { timeout: WAIT_TIMEOUT },
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("ai-agent-action-notice"),
    ).not.toBeInTheDocument();
  });

  test("is offered to an admin of an offline agent, never to a member", async () => {
    grant(ADMIN_PERMISSIONS);
    serve(makeStatus({}, silentAgent()));
    openAgentPage();
    expect(await findTestId("ai-agent-reset-button")).toBeInTheDocument();
    cleanup();

    grant(MEMBER_PERMISSIONS);
    serve(makeStatus());
    openAgentPage();
    await findTestId("ai-agent-status");
    expect(
      screen.queryByTestId("ai-agent-reset-button"),
    ).not.toBeInTheDocument();
  });
});

describe("Test connection", () => {
  test("is locked, with the reason, for a user who may only read the cluster", async () => {
    grant(READER_PERMISSIONS);
    openAgentPage();

    const button: HTMLElement = await findTestId("ai-agent-test-button");
    expect(button).toBeDisabled();
    expect(
      screen.getByTestId("ai-agent-test-permission-note"),
    ).toHaveTextContent(
      /Testing the connection needs permission to edit this cluster/,
    );
    expect(
      screen.getByTestId("ai-agent-test-permission-note"),
    ).toHaveTextContent("Edit Kubernetes Cluster");

    fireEvent.click(button);
    expect(postsTo(TEST_ROUTE)).toHaveLength(0);
  });

  test("is hidden while the permission snapshot has not landed", async () => {
    grant([]);
    openAgentPage();

    await findText(AGENT_CARD_TITLE);
    expect(
      screen.queryByTestId("ai-agent-test-button"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("ai-agent-test-permission-note"),
    ).not.toBeInTheDocument();
  });

  test("runs once for a member and shows every command's result inline", async () => {
    let answer: (value: HTTPResponse<JSONObject>) => void = (): void => {
      // replaced below
    };
    serve(makeStatus(), {
      test: (): Promise<HTTPResponse<JSONObject>> => {
        return new Promise(
          (resolve: (value: HTTPResponse<JSONObject>) => void) => {
            answer = resolve;
          },
        );
      },
    });
    openAgentPage();

    const button: HTMLElement = await findTestId("ai-agent-test-button");
    expect(button).not.toBeDisabled();

    fireEvent.click(button);
    fireEvent.click(button);

    await waitFor(
      () => {
        expect(screen.getByTestId("ai-agent-test-button")).toBeDisabled();
      },
      { timeout: WAIT_TIMEOUT },
    );
    expect(postsTo(TEST_ROUTE)).toHaveLength(1);
    expect(postsTo(TEST_ROUTE)[0]!["data"]).toEqual({
      clusterId: CLUSTER_ID.toString(),
    });

    await act(async () => {
      answer(
        new HTTPResponse<JSONObject>(
          200,
          {
            ok: true,
            message: "OneUptime AI can run kubectl on prod-east.",
            results: [
              {
                command: "kubectl version",
                succeeded: true,
                exitCode: 0,
                output: "Server Version: v1.31.0",
                errorMessage: null,
              },
              {
                command: "kubectl auth can-i --list",
                succeeded: true,
                exitCode: 0,
                output: "pods  []  []  [get list watch]",
                errorMessage: null,
              },
            ],
            status: makeStatus({
              lastVerifiedAt: "2026-09-22T10:05:00.000Z",
            }) as unknown as JSONObject,
          },
          {},
        ),
      );
    });

    const results: HTMLElement = await findTestId("ai-agent-test-results");
    expect(results).toHaveTextContent("The connection works");
    expect(results).toHaveTextContent(
      "OneUptime AI can run kubectl on prod-east.",
    );
    expect(within(results).getAllByText("succeeded")).toHaveLength(2);
    expect(results).toHaveTextContent("Server Version: v1.31.0");
    expect(results).toHaveTextContent("kubectl auth can-i --list");
    expect(screen.getByTestId("ai-agent-test-button")).not.toBeDisabled();
  });

  test("shows a failed command with its exit code", async () => {
    serve(makeStatus(), {
      test: async (): Promise<HTTPResponse<JSONObject>> => {
        return new HTTPResponse<JSONObject>(
          200,
          {
            ok: false,
            message: "kubectl could not run successfully.",
            results: [
              {
                command: "kubectl version",
                succeeded: false,
                exitCode: 1,
                output: "",
                errorMessage:
                  "dial tcp 127.0.0.1:8080: connect: connection refused",
              },
            ],
          },
          {},
        );
      },
    });
    openAgentPage();

    fireEvent.click(await findTestId("ai-agent-test-button"));

    expect(
      await findText("The connection is not working yet"),
    ).toBeInTheDocument();
    expect(screen.getByText("failed (exit 1)")).toBeInTheDocument();
    expect(
      screen.getByText("dial tcp 127.0.0.1:8080: connect: connection refused"),
    ).toBeInTheDocument();
  });

  test("shows an error the server returns", async () => {
    serve(makeStatus(), {
      test: async (): Promise<HTTPErrorResponse> => {
        return new HTTPErrorResponse(
          400,
          { error: "Kubernetes cluster not found." },
          {},
        );
      },
    });
    openAgentPage();

    fireEvent.click(await findTestId("ai-agent-test-button"));

    const error: HTMLElement = await findTestId("ai-agent-test-error");
    expect(error).toHaveTextContent("The test could not run");
    expect(error).toHaveTextContent("Kubernetes cluster not found.");
  });

  test("a permission refusal talks about testing, not changing settings", async () => {
    serve(makeStatus(), {
      test: async (): Promise<HTTPErrorResponse> => {
        return new HTTPErrorResponse(
          422,
          {
            error:
              "You do not have permission to change this cluster's AI access.",
          },
          {},
        );
      },
    });
    openAgentPage();

    fireEvent.click(await findTestId("ai-agent-test-button"));

    const error: HTMLElement = await findTestId("ai-agent-test-error");
    expect(error).toHaveTextContent(
      "Testing the connection needs permission to edit this cluster",
    );
    expect(error).toHaveTextContent("Nothing on the cluster");
    expect(error).not.toHaveTextContent("change this cluster's AI access");
  });
});

describe("the old AI page route", () => {
  function CurrentPath(): React.ReactElement {
    const location: ReturnType<typeof useLocation> = useLocation();
    return <p data-testid="current-path">{location.pathname}</p>;
  }

  test("sends /ai to the AI agent page", async () => {
    goTo(OLD_AI_PAGE_PATH);
    render(
      <MemoryRouter initialEntries={[OLD_AI_PAGE_PATH]}>
        <Routes>
          <PageRoute
            path={String(RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_AI])}
            element={<KubernetesClusterViewAiRedirect />}
          />
          <PageRoute
            path={String(RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_AI_AGENT])}
            element={<CurrentPath />}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(await findTestId("current-path")).toHaveTextContent(AGENT_PAGE_PATH);
  });
});
