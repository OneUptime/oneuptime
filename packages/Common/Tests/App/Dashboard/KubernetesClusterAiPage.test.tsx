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
import KubernetesClusterAI, {
  AI_ACCESS_STATUS_POLL_INTERVAL_MS,
  KUBERNETES_AGENT_HELM_NAMESPACE,
  KUBERNETES_AGENT_HELM_RELEASE,
  REMEDIATION_MODE_LABELS,
  canPickKubernetesCredential,
  getAiAccessHelmCommands,
  getKubernetesCredentialPermissionTitles,
  getRemediationModeFieldDescription,
  parseStatus,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/AI";
import { getKubernetesInstallationMarkdown } from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/DocumentationMarkdown";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import RunbookCredential from "../../../Models/DatabaseModels/RunbookCredential";
import Runner from "../../../Models/DatabaseModels/Runner";
import RunnerJob from "../../../Models/DatabaseModels/RunnerJob";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../Types/JSON";
import {
  KubernetesAiAccessGap,
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
} from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import RunbookCredentialType from "../../../Types/Runbook/RunbookCredentialType";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import RunnerJobOrigin from "../../../Types/Runbook/RunnerJobOrigin";
import RunnerJobStatus from "../../../Types/Runbook/RunnerJobStatus";
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
 * The cluster's AI page renders for real on its real route, with the
 * status endpoint, the model API and the permission snapshot stubbed. The
 * page is one screen made of pieces that each failed in review in a
 * different way: the summary tile read a status field that does not exist,
 * a background poll wiped the whole page, the commands table asked for the
 * wrong columns (and lacked the ones ModelTable requires), the edit modal
 * loaded Runner and credential lists its users were not allowed to read
 * and let any cluster editor switch on unattended fixes, the helm command
 * named another release, and the test button and the command history
 * failed for roles that may open the page.
 */

// Real components fetch; give the waits room on a loaded CI box.
const WAIT_TIMEOUT: number = 20000;

const CLUSTER_ID: ObjectID = new ObjectID(
  "44444444-0000-4000-8000-000000000004",
);
const RUNNER_ID: string = "55555555-0000-4000-8000-000000000005";
const RUN_ID: string = "66666666-0000-4000-8000-000000000006";
const CREDENTIAL_ID: string = "77777777-0000-4000-8000-000000000007";
const AI_PAGE_PATH: string = `/dashboard/${PROJECT_ID}/kubernetes/${CLUSTER_ID.toString()}/ai`;

const INVESTIGATION_ON_TEXT: string =
  "AI runs read-only kubectl (get, describe, logs, events, top) while investigating.";
const INVESTIGATION_OFF_TEXT: string =
  "Off — AI investigates with OneUptime data only.";
const STATUS_CARD_TITLE: string = "OneUptime AI access to this cluster";
const SETTINGS_CARD_TITLE: string = "AI access settings";

const BASE_PERMISSIONS: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
];

const MEMBER_PERMISSIONS: Array<Permission> = [
  ...BASE_PERMISSIONS,
  Permission.ProjectMember,
];

// May loosen AI access (unattended modes, allowlist, bindings) and read everything.
const ADMIN_PERMISSIONS: Array<Permission> = [
  ...BASE_PERMISSIONS,
  Permission.ProjectAdmin,
];

const SET_IMAGE_PATTERN: string = "kubectl set image deployment/web * -n web";
const PATCH_PATTERN: string = "kubectl patch deployment/web -n web -p *";
const OTHER_CLUSTER_RUNNER_ID: string = "55555555-0000-4000-8000-00000000000e";
const HOST_RUNNER_ID: string = "55555555-0000-4000-8000-00000000000f";
const DISABLED_RUNNER_ID: string = "55555555-0000-4000-8000-000000000010";
const SSH_CREDENTIAL_ID: string = "77777777-0000-4000-8000-000000000008";
const STAGING_CREDENTIAL_ID: string = "77777777-0000-4000-8000-000000000009";

function makeStatus(
  overrides: Partial<KubernetesClusterAiAccessStatus> = {},
): KubernetesClusterAiAccessStatus {
  return {
    clusterId: CLUSTER_ID.toString(),
    clusterName: "prod-east",
    clusterIdentifier: "prod-east",
    runner: {
      id: RUNNER_ID,
      name: "kubernetes-agent/prod-east",
      isOnline: true,
      lastAliveAt: "2026-09-22T10:00:00.000Z",
      canRunAiCommands: true,
      posture: {
        inCluster: true,
        allowWrites: false,
        kubectlVersion: "v1.31.0",
      },
    },
    accessMethod: "in_cluster",
    kubectlAllowlist: [],
    isInvestigationEnabled: true,
    isInvestigationReady: true,
    remediationMode: KubernetesAiRemediationMode.RequireApproval,
    isRemediationReady: true,
    gaps: [],
    evaluatedAt: "2026-09-22T10:00:30.000Z",
    ...overrides,
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

function makeCluster(overrides: ClusterOverrides = {}): KubernetesCluster {
  const runner: Runner = Object.assign(new Runner(), {
    _id: RUNNER_ID,
    name: "kubernetes-agent/prod-east",
  });
  return Object.assign(
    new KubernetesCluster(),
    {
      _id: CLUSTER_ID.toString(),
      isAiInvestigationEnabled: true,
      aiRemediationMode: KubernetesAiRemediationMode.RequireApproval,
      aiKubectlCommandAllowlist: [],
      aiAccessRunner: runner,
    },
    overrides,
  );
}

// The posture an in-cluster agent Runner reports for the cluster it runs in.
function agentHostInfo(clusterIdentifier: string): JSONObject {
  return {
    kubernetes: { inCluster: true, allowWrites: false, clusterIdentifier },
  };
}

/*
 * Every kind of Runner a project holds: this cluster's agent, another
 * cluster's agent, a host Runner that runs AI commands, and one that does
 * not. Only the first and third can serve this cluster. The agents report
 * the cluster they run in, which is how the picker tells them apart.
 */
function makeProjectRunners(): Array<Runner> {
  return [
    Object.assign(new Runner(), {
      _id: RUNNER_ID,
      name: "kubernetes-agent/prod-east",
      canRunAiCommands: true,
      hostInfo: agentHostInfo("prod-east"),
    }),
    Object.assign(new Runner(), {
      _id: OTHER_CLUSTER_RUNNER_ID,
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

function assignedTo(...runnerIds: Array<string>): Array<Runner> {
  return runnerIds.map((runnerId: string): Runner => {
    return Object.assign(new Runner(), { _id: runnerId });
  });
}

/*
 * A Kubernetes credential assigned to the host Runner, one assigned to a
 * Runner that is not listed, and an SSH key.
 */
function makeProjectCredentials(): Array<RunbookCredential> {
  return [
    Object.assign(new RunbookCredential(), {
      _id: CREDENTIAL_ID,
      name: "prod-east token",
      credentialType: RunbookCredentialType.Kubernetes,
      runners: assignedTo(HOST_RUNNER_ID),
    }),
    Object.assign(new RunbookCredential(), {
      _id: STAGING_CREDENTIAL_ID,
      name: "staging token",
      credentialType: RunbookCredentialType.Kubernetes,
      runners: assignedTo(DISABLED_RUNNER_ID),
    }),
    Object.assign(new RunbookCredential(), {
      _id: SSH_CREDENTIAL_ID,
      name: "bastion ssh key",
      credentialType: RunbookCredentialType.SSH,
      runners: assignedTo(HOST_RUNNER_ID),
    }),
  ];
}

// The cluster bound to the host Runner (outside the cluster).
function hostRunnerBinding(): ClusterOverrides {
  return {
    aiAccessRunner: Object.assign(new Runner(), {
      _id: HOST_RUNNER_ID,
      name: "bash-runner",
    }),
  };
}

type JobOverrides = {
  [Key in keyof RunnerJob]?: RunnerJob[Key] | undefined;
};

function makeJob(id: string, overrides: JobOverrides = {}): RunnerJob {
  return Object.assign(
    new RunnerJob(),
    {
      _id: id,
      createdAt: new Date("2026-09-22T09:59:00Z"),
      origin: RunnerJobOrigin.AiInvestigation,
      stepType: RunbookStepType.Kubectl,
      status: RunnerJobStatus.Succeeded,
      payload: { displayCommand: `kubectl get pods -n web-${id}` },
      exitCode: 0,
    },
    overrides,
  );
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
let jobs: Array<RunnerJob> = [];

function serveStatus(status: KubernetesClusterAiAccessStatus): void {
  postSpy.mockImplementation(async (): Promise<HTTPResponse<JSONObject>> => {
    return statusResponse(status);
  });
}

/*
 * A status request that fails the way a transient 502 or a dropped
 * connection does. Thrown from inside the async body rather than returned
 * as a pre-built rejected promise: zone.js (pulled in by the telemetry util
 * the page imports) reports the latter as an unhandled rejection in the
 * microtask between construction and the await that catches it, which
 * fills a passing run with alarming console noise.
 */
async function failStatusRequest(): Promise<HTTPResponse<JSONObject>> {
  throw new Error("Network Error");
}

function listRequests(): Array<ListRequest> {
  return getListSpy.mock.calls.map((call: Array<unknown>): ListRequest => {
    return (call[0] || {}) as ListRequest;
  });
}

function jobListRequest(): ListRequest | undefined {
  return listRequests().find((request: ListRequest): boolean => {
    return request.modelType === RunnerJob;
  });
}

function listRequestsFor(modelType: unknown): Array<ListRequest> {
  return listRequests().filter((request: ListRequest): boolean => {
    return request.modelType === modelType;
  });
}

// The requests the page sent to one of its two custom routes.
function postsTo(route: string): Array<JSONObject> {
  return postSpy.mock.calls
    .map((call: Array<unknown>): JSONObject => {
      return (call[0] || {}) as JSONObject;
    })
    .filter((request: JSONObject): boolean => {
      return String(request["url"]).endsWith(route);
    });
}

// Answers the status route with `status` and the test route with `test`.
function serveStatusAndTest(
  status: KubernetesClusterAiAccessStatus,
  test: () => Promise<HTTPResponse<JSONObject> | HTTPErrorResponse>,
): void {
  postSpy.mockImplementation(
    async (
      request: unknown,
    ): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
      const url: string = String((request as JSONObject)["url"]);
      if (url.endsWith("/kubernetes-cluster/ai-access/test")) {
        return await test();
      }
      return statusResponse(status);
    },
  );
}

function updateRequests(): Array<JSONObject> {
  return updateByIdSpy.mock.calls.map((call: Array<unknown>): JSONObject => {
    return (call[0] || {}) as JSONObject;
  });
}

function textOf(testId: string): string {
  return screen.getByTestId(testId).textContent || "";
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

function openAiPage(): void {
  goTo(AI_PAGE_PATH);

  render(
    <MemoryRouter initialEntries={[AI_PAGE_PATH]}>
      <Routes>
        <PageRoute
          path={String(RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_AI])}
          element={
            <KubernetesClusterAI
              pageRoute={RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_AI] as Route}
              currentProject={null}
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

async function openEditModal(): Promise<HTMLElement> {
  await findText(SETTINGS_CARD_TITLE);
  fireEvent.click(await findText("Edit AI access"));
  const dialog: HTMLElement = await screen.findByRole(
    "dialog",
    {},
    { timeout: WAIT_TIMEOUT },
  );
  // The form is on screen once its first field label is.
  await within(dialog).findByText(
    "Let AI investigate with kubectl",
    {},
    { timeout: WAIT_TIMEOUT },
  );
  return dialog;
}

// Serves the settings the edit modal reads when it opens.
function serveCluster(overrides: ClusterOverrides = {}): void {
  getItemSpy.mockImplementation(async (): Promise<KubernetesCluster> => {
    return makeCluster(overrides);
  });
}

/*
 * The open react-select menu's options. Native <option>s — the commands
 * table's page-size picker — also have the option role and are left out.
 */
function menuOptions(): Array<HTMLElement> {
  return screen
    .queryAllByRole("option")
    .filter((option: HTMLElement): boolean => {
      return option.tagName !== "OPTION";
    });
}

// Opens a react-select dropdown in the dialog and returns its option texts.
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

async function pickOption(
  dialog: HTMLElement,
  name: RegExp,
  optionText: string,
): Promise<void> {
  await openDropdown(dialog, name);
  const option: HTMLElement | undefined = menuOptions().find(
    (candidate: HTMLElement): boolean => {
      return candidate.textContent === optionText;
    },
  );
  if (!option) {
    throw new Error(`No option "${optionText}" in the ${name} dropdown.`);
  }
  fireEvent.click(option);
}

/*
 * Clicks the investigation switch once the form has been seeded with the
 * saved value. The Toggle picks up its value in an effect after its first
 * paint, so a click in that instant would toggle the unseeded default.
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

/*
 * By its test id: the modal can also hold "Unbind the Runner" and "Unbind
 * the Kubernetes credential" switches.
 */
async function toggleInvestigation(
  dialog: HTMLElement,
  from: boolean,
): Promise<void> {
  await toggleSwitch(dialog, "ai-investigation-field", from);
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

function saveEditModal(dialog: HTMLElement): void {
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
  serveStatus(makeStatus());

  jobs = [];
  getListSpy = jest.spyOn(ModelAPI, "getList");
  getListSpy.mockImplementation(
    async (args: unknown): Promise<ListResult<RunnerJob>> => {
      const request: ListRequest = args as ListRequest;
      if (request.modelType === RunnerJob) {
        return { data: jobs, count: jobs.length, skip: 0, limit: 10 };
      }
      if (request.modelType === RunbookCredential) {
        const credentials: Array<RunbookCredential> = makeProjectCredentials();
        return {
          data: credentials as unknown as Array<RunnerJob>,
          count: credentials.length,
          skip: 0,
          limit: 10,
        };
      }
      if (request.modelType === Runner) {
        const runners: Array<Runner> = makeProjectRunners();
        return {
          data: runners as unknown as Array<RunnerJob>,
          count: runners.length,
          skip: 0,
          limit: 10,
        };
      }
      return { data: [], count: 0, skip: 0, limit: 10 };
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

describe("parseStatus", () => {
  test("accepts the status shape the API returns and nothing looser", () => {
    expect(parseStatus(makeStatus())).toEqual(makeStatus());
    expect(parseStatus(null)).toBeNull();
    expect(parseStatus("ready")).toBeNull();
    expect(parseStatus([makeStatus()])).toBeNull();
    expect(parseStatus({ ...makeStatus(), clusterId: 7 })).toBeNull();
    expect(parseStatus({ ...makeStatus(), gaps: null })).toBeNull();
  });
});

describe("remediation mode labels", () => {
  test("give every mode its own plain-words label", () => {
    const modes: Array<KubernetesAiRemediationMode> = Object.values(
      KubernetesAiRemediationMode,
    );
    const labels: Array<string> = modes.map(
      (mode: KubernetesAiRemediationMode): string => {
        return REMEDIATION_MODE_LABELS[mode];
      },
    );

    expect(modes.length).toBeGreaterThanOrEqual(4);
    for (const label of labels) {
      expect(typeof label).toBe("string");
      expect(label.trim().length).toBeGreaterThan(0);
    }
    expect(new Set(labels).size).toBe(labels.length);
    // Both unattended modes say fixes run on their own.
    expect(
      REMEDIATION_MODE_LABELS[KubernetesAiRemediationMode.Automatic],
    ).toMatch(/run on their own/);
    expect(
      REMEDIATION_MODE_LABELS[KubernetesAiRemediationMode.BypassApproval],
    ).toMatch(/runs on its own/);
    expect(
      REMEDIATION_MODE_LABELS[KubernetesAiRemediationMode.Disabled],
    ).toMatch(/Off/);
  });

  /*
   * The copy must match the canonical description on
   * KubernetesAiRemediationMode (and what RemediationExecutionRunner does):
   * an Automatic round that could only find riskier fixes ends by proposing
   * them for one-click approval. The page said they were "left for you"
   * and that "only a follow-up round" proposed them. This pin replaces the
   * old one, which required "left for you".
   */
  test("Automatic says a riskier fix is proposed for one-click approval", () => {
    const label: string =
      REMEDIATION_MODE_LABELS[KubernetesAiRemediationMode.Automatic];
    expect(label).toMatch(/one-click approval/);
    expect(label).not.toMatch(/left for you/);

    const description: string = getRemediationModeFieldDescription();
    expect(description).toMatch(
      /when the round could only find riskier fixes, it ends by proposing exactly those for one-click approval/,
    );
    expect(description).not.toMatch(/only a follow-up round/);
    expect(description).not.toMatch(
      /leaves the exact command in its recommendations/,
    );
    // A named Job is not recreated by anything: deleting one is riskier.
    expect(description).not.toMatch(/delete a named pod or job/);
    expect(description).toContain("delete a named pod");
  });

  /*
   * Bypass approval does ask in a few places: protected namespaces, node
   * drains and taints, and a tripped circuit breaker. "Nobody is asked"
   * was false.
   */
  test("Bypass approval names what still asks a human", () => {
    const label: string =
      REMEDIATION_MODE_LABELS[KubernetesAiRemediationMode.BypassApproval];
    expect(label).not.toMatch(/nobody is asked/);
    for (const exception of [
      "protected namespaces",
      "drain",
      "circuit breaker",
    ]) {
      expect(label).toContain(exception);
    }

    const description: string = getRemediationModeFieldDescription();
    expect(description).not.toMatch(/nobody is ever asked/);
    for (const namespace of ["kube-system", "kube-public", "kube-node-lease"]) {
      expect(description).toContain(namespace);
    }
    expect(description).toMatch(/a node drain and a taint always need a human/);
    expect(description).toMatch(/circuit breaker/);
    expect(description).toMatch(/never changes its own namespace/);
  });
});

describe("credential picker permission", () => {
  test("is offered only to users who may read Runner credentials", () => {
    expect(canPickKubernetesCredential()).toBe(false);

    grant([...MEMBER_PERMISSIONS, Permission.ReadRunbookCredential]);
    expect(canPickKubernetesCredential()).toBe(true);

    grant([Permission.Public, Permission.User, Permission.ProjectAdmin]);
    expect(canPickKubernetesCredential()).toBe(true);
  });

  test("is always offered to a master admin", () => {
    jest.spyOn(User, "isMasterAdmin").mockReturnValue(true);
    expect(canPickKubernetesCredential()).toBe(true);
  });

  test("is withheld while the permission snapshot has not landed", () => {
    grant([]);
    expect(canPickKubernetesCredential()).toBe(false);
  });

  test("names the permissions that would unlock it", () => {
    const titles: Array<string> = getKubernetesCredentialPermissionTitles();
    expect(titles.length).toBeGreaterThan(0);
    expect(titles.join(", ")).toMatch(/Runbook Credential/);
  });
});

describe("Kubernetes cluster AI page", () => {
  describe("investigation tile", () => {
    test("says investigation is on when the status says it is", async () => {
      serveStatus(makeStatus({ isInvestigationEnabled: true }));
      openAiPage();

      expect(await findText(INVESTIGATION_ON_TEXT)).toBeInTheDocument();
      expect(
        screen.queryByText(INVESTIGATION_OFF_TEXT),
      ).not.toBeInTheDocument();
      expect(screen.getByText("Investigation: ready")).toBeInTheDocument();
    });

    test("says investigation is off when the status says it is", async () => {
      serveStatus(
        makeStatus({
          isInvestigationEnabled: false,
          isInvestigationReady: false,
        }),
      );
      openAiPage();

      expect(await findText(INVESTIGATION_OFF_TEXT)).toBeInTheDocument();
      expect(screen.queryByText(INVESTIGATION_ON_TEXT)).not.toBeInTheDocument();
      expect(screen.getByText("Investigation: off")).toBeInTheDocument();
    });

    test("shows the remediation mode in the same words as the settings dropdown", async () => {
      serveStatus(
        makeStatus({
          remediationMode: KubernetesAiRemediationMode.BypassApproval,
        }),
      );
      openAiPage();

      expect(
        await findText("Remediation: bypass approval"),
      ).toBeInTheDocument();
      expect(
        screen.getAllByText(
          REMEDIATION_MODE_LABELS[KubernetesAiRemediationMode.BypassApproval],
        ).length,
      ).toBeGreaterThan(0);
    });
  });

  describe("status polling", () => {
    /*
     * The page read its cluster id as a fresh ObjectID on every render, so
     * the memoized fetch was recreated each render and the load effect
     * re-ran after every answer: an unbounded loop of status requests.
     */
    test("requests the status once on load, not once per render", async () => {
      openAiPage();

      expect(await findText(STATUS_CARD_TITLE)).toBeInTheDocument();
      expect(await findText(SETTINGS_CARD_TITLE)).toBeInTheDocument();
      await findText(
        "OneUptime AI has not run any kubectl commands on this cluster yet.",
      );

      expect(postSpy).toHaveBeenCalledTimes(1);
    });

    test("shows the error page only when the first load fails", async () => {
      postSpy.mockImplementation(failStatusRequest);
      openAiPage();

      expect(await findText("Network Error")).toBeInTheDocument();
      expect(screen.queryByText(STATUS_CARD_TITLE)).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("ai-access-refresh-warning"),
      ).not.toBeInTheDocument();
    });

    /*
     * The finding: an operator mid-edit lost the modal and the whole page to
     * a transient 502 on the 30 s poll. The last good status must stay on
     * screen, with a warning that says so, until a later poll succeeds.
     */
    test("keeps the last good status and warns inline when a background poll fails", async () => {
      jest.useFakeTimers();
      postSpy
        .mockResolvedValueOnce(statusResponse(makeStatus()))
        .mockImplementationOnce(failStatusRequest)
        .mockResolvedValue(statusResponse(makeStatus()));

      openAiPage();
      expect(await findText(STATUS_CARD_TITLE)).toBeInTheDocument();
      expect(await findText(SETTINGS_CARD_TITLE)).toBeInTheDocument();

      await act(async () => {
        jest.advanceTimersByTime(AI_ACCESS_STATUS_POLL_INTERVAL_MS);
      });

      const warning: HTMLElement = await screen.findByTestId(
        "ai-access-refresh-warning",
        {},
        { timeout: WAIT_TIMEOUT },
      );
      expect(warning).toHaveTextContent(
        "Could not refresh the AI access status",
      );
      expect(warning).toHaveTextContent("Network Error");
      expect(warning).toHaveTextContent("Showing the last status from");
      expect(screen.getByText(STATUS_CARD_TITLE)).toBeInTheDocument();
      expect(screen.getByText(SETTINGS_CARD_TITLE)).toBeInTheDocument();
      expect(screen.getByText(INVESTIGATION_ON_TEXT)).toBeInTheDocument();
      expect(postSpy).toHaveBeenCalledTimes(2);

      await act(async () => {
        jest.advanceTimersByTime(AI_ACCESS_STATUS_POLL_INTERVAL_MS);
      });

      await waitFor(
        () => {
          expect(
            screen.queryByTestId("ai-access-refresh-warning"),
          ).not.toBeInTheDocument();
        },
        { timeout: WAIT_TIMEOUT },
      );
      expect(screen.getByText(STATUS_CARD_TITLE)).toBeInTheDocument();
      expect(postSpy).toHaveBeenCalledTimes(3);
    });

    /*
     * The exact scene from the review: the operator is inside "Edit AI
     * access" when a poll fails. The modal must stay open through the
     * failure and through the recovery that follows.
     */
    test("keeps an open edit modal through a failed poll and its recovery", async () => {
      jest.useFakeTimers();
      // Every poll after the first load fails until the test says otherwise.
      postSpy
        .mockResolvedValueOnce(statusResponse(makeStatus()))
        .mockImplementation(failStatusRequest);

      openAiPage();
      const dialog: HTMLElement = await openEditModal();

      await act(async () => {
        jest.advanceTimersByTime(AI_ACCESS_STATUS_POLL_INTERVAL_MS);
      });

      const warning: HTMLElement = await screen.findByTestId(
        "ai-access-refresh-warning",
        {},
        { timeout: WAIT_TIMEOUT },
      );
      expect(warning).toHaveTextContent("Network Error");
      expect(screen.getByRole("dialog")).toBe(dialog);
      expect(
        within(dialog).getByText("Let AI investigate with kubectl"),
      ).toBeInTheDocument();
      expect(screen.getByText(SETTINGS_CARD_TITLE)).toBeInTheDocument();

      serveStatus(makeStatus());
      await act(async () => {
        jest.advanceTimersByTime(AI_ACCESS_STATUS_POLL_INTERVAL_MS);
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
        within(dialog).getByText("Let AI investigate with kubectl"),
      ).toBeInTheDocument();
    });

    test("keeps the page when a poll returns a status it cannot read", async () => {
      jest.useFakeTimers();
      postSpy
        .mockResolvedValueOnce(statusResponse(makeStatus()))
        .mockResolvedValue(
          new HTTPResponse<JSONObject>(200, { unexpected: true }, {}),
        );

      openAiPage();
      expect(await findText(STATUS_CARD_TITLE)).toBeInTheDocument();

      await act(async () => {
        jest.advanceTimersByTime(AI_ACCESS_STATUS_POLL_INTERVAL_MS);
      });

      expect(
        await screen.findByTestId(
          "ai-access-refresh-warning",
          {},
          { timeout: WAIT_TIMEOUT },
        ),
      ).toBeInTheDocument();
      expect(screen.getByText(STATUS_CARD_TITLE)).toBeInTheDocument();
    });
  });

  describe("commands table", () => {
    test("asks for every column its cells read and labels rows from them", async () => {
      jobs = [
        makeJob("investigation", { aiRunId: new ObjectID(RUN_ID) }),
        makeJob("access-test"),
        makeJob("failed", {
          aiRunId: new ObjectID(RUN_ID),
          status: RunnerJobStatus.Failed,
          exitCode: 1,
          errorMessage: "pods is forbidden: User cannot list resource",
        }),
      ];
      openAiPage();

      expect(
        await findText("kubectl get pods -n web-investigation"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("kubectl get pods -n web-access-test"),
      ).toBeInTheDocument();

      // Whole-cell matches only: the card description also says "(read-only)".
      const whyCells: Array<string> = screen
        .getAllByText(/^(Investigation|Access test) \(read-only\)$/)
        .map((cell: HTMLElement): string => {
          return cell.textContent || "";
        });
      expect(whyCells).toEqual([
        "Investigation (read-only)",
        "Access test (read-only)",
        "Investigation (read-only)",
      ]);

      expect(screen.getByText("Failed (exit 1)")).toBeInTheDocument();
      expect(screen.getAllByText("Succeeded (exit 0)").length).toBe(2);
      expect(
        screen.getByText("pods is forbidden: User cannot list resource"),
      ).toBeInTheDocument();

      const request: ListRequest | undefined = jobListRequest();
      expect(request?.select).toEqual(
        expect.objectContaining({
          createdAt: true,
          payload: true,
          origin: true,
          status: true,
          aiRunId: true,
          exitCode: true,
          errorMessage: true,
        }),
      );
      expect(request?.select).not.toHaveProperty("output");
      expect(request?.query).toEqual(
        expect.objectContaining({
          stepType: RunbookStepType.Kubectl,
        }),
      );
      expect(String(request?.query?.["kubernetesClusterId"])).toBe(
        CLUSTER_ID.toString(),
      );
    });

    test("labels a remediation command and tells the empty state apart", async () => {
      jobs = [
        makeJob("fix", {
          origin: RunnerJobOrigin.AiRemediation,
          aiRunId: new ObjectID(RUN_ID),
          payload: {
            displayCommand: "kubectl rollout restart deployment/web -n web",
          },
        }),
      ];
      openAiPage();

      const commandCell: HTMLElement = await findText(
        "kubectl rollout restart deployment/web -n web",
      );
      // Scoped to the row: the summary tile above is also headed "Remediation".
      const row: HTMLElement | null = commandCell.closest("tr");
      expect(row).not.toBeNull();
      expect(
        within(row as HTMLElement).getByText("Remediation"),
      ).toBeInTheDocument();
      expect(
        within(row as HTMLElement).queryByText(
          /^(Investigation|Access test) \(read-only\)$/,
        ),
      ).not.toBeInTheDocument();
    });

    test("renders the empty state without crashing when nothing ran yet", async () => {
      openAiPage();

      expect(
        await findText(
          "OneUptime AI has not run any kubectl commands on this cluster yet.",
        ),
      ).toBeInTheDocument();
    });
  });

  /*
   * Binding a Runner or a credential, the higher unattended modes and new
   * allowlist patterns need KUBERNETES_AI_ACCESS_ADMIN_PERMISSIONS (the
   * server refuses them otherwise). The pickers are exercised with a user
   * who holds the admin set; the tightening a member may do is below.
   */
  describe("edit modal pickers", () => {
    test("omits the credential picker for an admin-set holder who may not read Runner credentials", async () => {
      grant([...MEMBER_PERMISSIONS, Permission.EditAutoRemediationRule]);
      openAiPage();

      expect(
        await screen.findByTestId(
          "kubernetes-credential-permission-note",
          {},
          { timeout: WAIT_TIMEOUT },
        ),
      ).toHaveTextContent("Runbook Credential");

      const dialog: HTMLElement = await openEditModal();

      expect(
        await within(dialog).findByText(
          "Runner",
          {},
          { timeout: WAIT_TIMEOUT },
        ),
      ).toBeInTheDocument();
      expect(
        within(dialog).queryByText("Kubernetes credential"),
      ).not.toBeInTheDocument();
      expect(
        within(dialog).getByTestId(
          "kubernetes-credential-picker-permission-note",
        ),
      ).toHaveTextContent("Read Runbook Credential");
      expect(
        within(dialog).queryByText(/do not have permission/i),
      ).not.toBeInTheDocument();

      expect(listRequestsFor(Runner).length).toBeGreaterThan(0);
      expect(listRequestsFor(RunbookCredential)).toHaveLength(0);
    });

    /*
     * The finding (dashboard-ai-page-7): the picker offered every
     * Kubernetes credential, whatever Runner it was assigned to.
     */
    test("offers an admin only the Kubernetes credentials assigned to the chosen Runner", async () => {
      grant(ADMIN_PERMISSIONS);
      serveCluster(hostRunnerBinding());
      openAiPage();

      await findText(SETTINGS_CARD_TITLE);
      expect(
        screen.queryByTestId("kubernetes-credential-permission-note"),
      ).not.toBeInTheDocument();

      const dialog: HTMLElement = await openEditModal();

      expect(
        await within(dialog).findByText(
          "Kubernetes credential",
          {},
          { timeout: WAIT_TIMEOUT },
        ),
      ).toBeInTheDocument();

      const requests: Array<ListRequest> = listRequestsFor(RunbookCredential);
      expect(requests).toHaveLength(1);
      expect(requests[0]!.query).toEqual({
        credentialType: RunbookCredentialType.Kubernetes,
      });
      // The assignments are read so the options can follow the Runner.
      expect(requests[0]!.select).toEqual(
        expect.objectContaining({ runners: { _id: true } }),
      );

      const options: Array<string> = await openDropdown(
        dialog,
        /^Kubernetes credential/,
      );
      expect(options).toEqual(["prod-east token"]);
      expect(
        within(dialog).getByText(/assigned to "bash-runner" are listed/),
      ).toBeInTheDocument();
    });

    test("offers no credential for this cluster's in-cluster Runner, and says why", async () => {
      grant(ADMIN_PERMISSIONS);
      openAiPage();
      const dialog: HTMLElement = await openEditModal();

      expect(
        await within(dialog).findByText(
          /No credential can be chosen: "kubernetes-agent\/prod-east" is an in-cluster Runner/,
          {},
          { timeout: WAIT_TIMEOUT },
        ),
      ).toBeInTheDocument();

      // Choosing the host Runner brings its credentials back.
      await pickOption(dialog, /^Runner/, "bash-runner");
      expect(
        await within(dialog).findByText(
          /assigned to "bash-runner" are listed/,
          {},
          { timeout: WAIT_TIMEOUT },
        ),
      ).toBeInTheDocument();
      const options: Array<string> = await openDropdown(
        dialog,
        /^Kubernetes credential/,
      );
      expect(options).toEqual(["prod-east token"]);
    });

    test("refuses to save this cluster's in-cluster Runner together with a credential", async () => {
      grant(ADMIN_PERMISSIONS);
      serveCluster({
        ...hostRunnerBinding(),
        aiAccessCredential: Object.assign(new RunbookCredential(), {
          _id: CREDENTIAL_ID,
          name: "prod-east token",
        }),
      });
      openAiPage();
      const dialog: HTMLElement = await openEditModal();
      await within(dialog).findByText("Runner", {}, { timeout: WAIT_TIMEOUT });

      await pickOption(
        dialog,
        /^Runner/,
        "kubernetes-agent/prod-east (in-cluster Runner for this cluster)",
      );
      saveEditModal(dialog);

      const error: HTMLElement = await screen.findByTestId(
        "ai-access-save-error",
        {},
        { timeout: WAIT_TIMEOUT },
      );
      expect(error).toHaveTextContent("is an in-cluster Runner");
      expect(error).toHaveTextContent("Clear the Kubernetes credential");
      expect(updateByIdSpy).not.toHaveBeenCalled();
    });

    /*
     * The finding: the Runner picker listed every project Runner — another
     * cluster's in-cluster agent (which can only reach its own cluster, and
     * which this cluster's own agent then never takes the binding back
     * from) and Runners with AI commands off.
     */
    test("offers only Runners that can serve this cluster", async () => {
      grant(ADMIN_PERMISSIONS);
      openAiPage();
      const dialog: HTMLElement = await openEditModal();
      await within(dialog).findByText("Runner", {}, { timeout: WAIT_TIMEOUT });

      const request: ListRequest = listRequestsFor(Runner)[0]!;
      expect(request.select).toEqual(
        expect.objectContaining({
          name: true,
          canRunAiCommands: true,
          // The posture tells this cluster's agent from another's.
          hostInfo: true,
        }),
      );

      const options: Array<string> = await openDropdown(dialog, /^Runner/);
      expect(options).toEqual([
        "kubernetes-agent/prod-east (in-cluster Runner for this cluster)",
        "bash-runner",
      ]);
    });

    /*
     * The finding (dashboard-ai-page-2): for a cluster identifier long
     * enough that the server shortens the Runner name with a hash, the
     * picker hid this cluster's own Runner.
     */
    test("offers this cluster's in-cluster Runner when the server shortened its name", async () => {
      const longIdentifier: string =
        "arn:aws:eks:ap-southeast-2:123456789012:cluster/payments-platform-production-blue-green";
      const shortenedName: string = `kubernetes-agent/${longIdentifier.slice(0, 74)}-fe7fc1b3`;
      grant(ADMIN_PERMISSIONS);
      serveStatus(makeStatus({ clusterIdentifier: longIdentifier }));
      getListSpy.mockImplementation(async (args: unknown): Promise<unknown> => {
        const request: ListRequest = args as ListRequest;
        const data: Array<unknown> =
          request.modelType === Runner
            ? [
                Object.assign(new Runner(), {
                  _id: RUNNER_ID,
                  name: shortenedName,
                  canRunAiCommands: true,
                  hostInfo: agentHostInfo(longIdentifier),
                }),
              ]
            : [];
        return { data, count: data.length, skip: 0, limit: 10 };
      });
      serveCluster({
        aiAccessRunner: Object.assign(new Runner(), {
          _id: RUNNER_ID,
          name: shortenedName,
        }),
      });
      openAiPage();
      const dialog: HTMLElement = await openEditModal();
      await within(dialog).findByText("Runner", {}, { timeout: WAIT_TIMEOUT });

      const options: Array<string> = await openDropdown(dialog, /^Runner/);
      expect(options).toEqual([
        `${shortenedName} (in-cluster Runner for this cluster)`,
      ]);
    });

    test("keeps a Runner bound by mistake visible, saying why it cannot serve the cluster", async () => {
      grant(ADMIN_PERMISSIONS);
      serveCluster({
        aiAccessRunner: Object.assign(new Runner(), {
          _id: OTHER_CLUSTER_RUNNER_ID,
          name: "kubernetes-agent/prod-eu",
        }),
      });
      openAiPage();
      const dialog: HTMLElement = await openEditModal();
      await within(dialog).findByText("Runner", {}, { timeout: WAIT_TIMEOUT });

      const options: Array<string> = await openDropdown(dialog, /^Runner/);
      expect(options).toContain(
        "kubernetes-agent/prod-eu (currently bound — runs inside another cluster and can only reach that cluster)",
      );
      expect(options).not.toContain("ops-runner");
    });

    /*
     * The finding: SettingsAdmin, SettingsMember and EditKubernetesCluster
     * may edit the cluster but not read Runners, and the modal's Runner
     * list request failed the whole form with a permission error.
     */
    test("never requests Runners or credentials for a Settings admin, and explains why", async () => {
      grant([...BASE_PERMISSIONS, Permission.SettingsAdmin]);
      openAiPage();

      expect(
        await screen.findByTestId(
          "kubernetes-runner-permission-note",
          {},
          { timeout: WAIT_TIMEOUT },
        ),
      ).toHaveTextContent("Read Runbook Agent");

      const dialog: HTMLElement = await openEditModal();

      expect(within(dialog).queryByText("Runner")).not.toBeInTheDocument();
      expect(
        within(dialog).queryByText("Kubernetes credential"),
      ).not.toBeInTheDocument();
      expect(
        within(dialog).queryByText(/do not have permission/i),
      ).not.toBeInTheDocument();
      expect(within(dialog).getByText("AI remediation")).toBeInTheDocument();
      expect(
        within(dialog).getByTestId("ai-investigation-field"),
      ).toBeInTheDocument();
      expect(
        within(dialog).getByTestId("kubernetes-ai-access-admin-note"),
      ).toBeInTheDocument();

      expect(listRequestsFor(Runner)).toHaveLength(0);
      expect(listRequestsFor(RunbookCredential)).toHaveLength(0);
    });

    test("an admin-set holder who may read credentials but not Runners gets the credential picker, and may unbind the Runner", async () => {
      grant([
        ...BASE_PERMISSIONS,
        Permission.EditKubernetesCluster,
        Permission.ReadKubernetesCluster,
        Permission.EditAutoRemediationRule,
        Permission.ReadRunbookCredential,
      ]);
      openAiPage();
      const dialog: HTMLElement = await openEditModal();

      expect(
        await within(dialog).findByText(
          "Kubernetes credential",
          {},
          { timeout: WAIT_TIMEOUT },
        ),
      ).toBeInTheDocument();
      expect(within(dialog).queryByText("Runner")).not.toBeInTheDocument();
      expect(
        within(dialog).getByTestId("kubernetes-runner-picker-permission-note"),
      ).toHaveTextContent("Read Runbook Agent");
      expect(
        within(dialog).getByTestId("ai-access-clear-runner-field"),
      ).toBeInTheDocument();
      expect(listRequestsFor(RunbookCredential)).toHaveLength(1);
      expect(listRequestsFor(Runner)).toHaveLength(0);
    });

    test("one picker's failed list leaves the other picker and the form working", async () => {
      grant(ADMIN_PERMISSIONS);
      const listImplementation: (args: unknown) => Promise<unknown> =
        getListSpy.getMockImplementation() as (
          args: unknown,
        ) => Promise<unknown>;
      getListSpy.mockImplementation(async (args: unknown): Promise<unknown> => {
        if ((args as ListRequest).modelType === Runner) {
          throw new Error("You do not have permissions to read Runner.");
        }
        return await listImplementation(args);
      });
      openAiPage();
      const dialog: HTMLElement = await openEditModal();

      expect(
        await within(dialog).findByText(
          "Kubernetes credential",
          {},
          { timeout: WAIT_TIMEOUT },
        ),
      ).toBeInTheDocument();
      expect(within(dialog).queryByText("Runner")).not.toBeInTheDocument();
      expect(
        within(dialog).getByText(/The Runner list could not be loaded/),
      ).toBeInTheDocument();
    });
  });

  /*
   * The finding: every cluster editor — SettingsMember, SettingsAdmin,
   * EditKubernetesCluster, ProjectMember — could switch a cluster to
   * Bypass approval, or Automatic with a "kubectl *" allowlist, and so
   * remove an approval they could not give. The server refuses those
   * writes without KUBERNETES_AI_ACCESS_ADMIN_PERMISSIONS; the page must
   * not offer them, and must not re-send them unchanged either.
   */
  describe("who may loosen AI access", () => {
    test("a member is offered only Off and Ask for approval on an Ask-for-approval cluster, and told why", async () => {
      openAiPage();

      expect(
        await screen.findByTestId(
          "kubernetes-ai-access-admin-note",
          {},
          { timeout: WAIT_TIMEOUT },
        ),
      ).toHaveTextContent("Edit Auto Remediation Rule");

      const dialog: HTMLElement = await openEditModal();

      expect(
        within(dialog).getByTestId("kubernetes-ai-access-admin-note"),
      ).toHaveTextContent("Project Admin");
      // Nothing saved to remove: no allowlist field.
      expect(
        within(dialog).queryByText("kubectl allowlist (Automatic mode)"),
      ).not.toBeInTheDocument();
      expect(within(dialog).queryByText("Runner")).not.toBeInTheDocument();

      const options: Array<string> = await openDropdown(
        dialog,
        /^AI remediation/,
      );
      expect(options).toEqual([
        REMEDIATION_MODE_LABELS[KubernetesAiRemediationMode.Disabled],
        REMEDIATION_MODE_LABELS[KubernetesAiRemediationMode.RequireApproval],
      ]);
      expect(listRequestsFor(Runner)).toHaveLength(0);
      expect(listRequestsFor(RunbookCredential)).toHaveLength(0);
    });

    test("an admin is offered every mode and the allowlist", async () => {
      grant(ADMIN_PERMISSIONS);
      openAiPage();
      await findText(SETTINGS_CARD_TITLE);
      expect(
        screen.queryByTestId("kubernetes-ai-access-admin-note"),
      ).not.toBeInTheDocument();

      const dialog: HTMLElement = await openEditModal();
      expect(
        await within(dialog).findByText(
          "kubectl allowlist (Automatic mode)",
          {},
          { timeout: WAIT_TIMEOUT },
        ),
      ).toBeInTheDocument();

      const options: Array<string> = await openDropdown(
        dialog,
        /^AI remediation/,
      );
      expect(options).toEqual(
        Object.values(KubernetesAiRemediationMode).map(
          (mode: KubernetesAiRemediationMode): string => {
            return REMEDIATION_MODE_LABELS[mode];
          },
        ),
      );
    });

    test("a member on an Automatic cluster sees the current mode but no higher one", async () => {
      serveCluster({
        aiRemediationMode: KubernetesAiRemediationMode.Automatic,
      });
      openAiPage();
      const dialog: HTMLElement = await openEditModal();

      const options: Array<string> = await openDropdown(
        dialog,
        /^AI remediation/,
      );
      expect(options).toEqual([
        REMEDIATION_MODE_LABELS[KubernetesAiRemediationMode.Disabled],
        REMEDIATION_MODE_LABELS[KubernetesAiRemediationMode.RequireApproval],
        `${REMEDIATION_MODE_LABELS[KubernetesAiRemediationMode.Automatic]} (current)`,
      ]);
    });

    /*
     * The finding (dashboard-ai-page-4, XP-7): Bypass approval -> Automatic
     * is a tightening the server accepts from every cluster editor, and the
     * page hid Automatic from them.
     */
    test("a member on a Bypass-approval cluster may step down to Automatic", async () => {
      serveCluster({
        aiRemediationMode: KubernetesAiRemediationMode.BypassApproval,
      });
      openAiPage();
      const dialog: HTMLElement = await openEditModal();

      const options: Array<string> = await openDropdown(
        dialog,
        /^AI remediation/,
      );
      expect(options).toEqual([
        REMEDIATION_MODE_LABELS[KubernetesAiRemediationMode.Disabled],
        REMEDIATION_MODE_LABELS[KubernetesAiRemediationMode.RequireApproval],
        REMEDIATION_MODE_LABELS[KubernetesAiRemediationMode.Automatic],
        `${REMEDIATION_MODE_LABELS[KubernetesAiRemediationMode.BypassApproval]} (current)`,
      ]);

      fireEvent.click(
        menuOptions().find((option: HTMLElement): boolean => {
          return (
            option.textContent ===
            REMEDIATION_MODE_LABELS[KubernetesAiRemediationMode.Automatic]
          );
        })!,
      );
      saveEditModal(dialog);

      expect(await waitForOneUpdate()).toEqual({
        aiRemediationMode: KubernetesAiRemediationMode.Automatic,
      });
      expect(
        screen.queryByTestId("ai-access-save-error"),
      ).not.toBeInTheDocument();
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
      openAiPage();
      const dialog: HTMLElement = await openEditModal();

      expect(
        within(dialog).getByText(/You can remove patterns or clear the list/),
      ).toBeInTheDocument();
      await setAllowlistText(dialog, SET_IMAGE_PATTERN);
      saveEditModal(dialog);

      expect(await waitForOneUpdate()).toEqual({
        aiKubectlCommandAllowlist: [SET_IMAGE_PATTERN],
      });
    });

    test("a member may clear the allowlist", async () => {
      serveCluster({
        aiKubectlCommandAllowlist: [SET_IMAGE_PATTERN],
      });
      openAiPage();
      const dialog: HTMLElement = await openEditModal();

      await setAllowlistText(dialog, "");
      saveEditModal(dialog);

      expect(await waitForOneUpdate()).toEqual({
        aiKubectlCommandAllowlist: [],
      });
    });

    test("a member who adds or edits a pattern is told it needs the admin set, and nothing is sent", async () => {
      serveCluster({
        aiRemediationMode: KubernetesAiRemediationMode.Automatic,
        aiKubectlCommandAllowlist: [SET_IMAGE_PATTERN],
      });
      openAiPage();
      const dialog: HTMLElement = await openEditModal();

      await setAllowlistText(
        dialog,
        "kubectl set image deployment/web * -n prod",
      );
      saveEditModal(dialog);

      expect(
        await within(dialog).findByText(
          /is not in the saved allowlist/,
          {},
          { timeout: WAIT_TIMEOUT },
        ),
      ).toHaveTextContent("Edit Auto Remediation Rule");
      expect(updateByIdSpy).not.toHaveBeenCalled();
    });

    /*
     * The finding (SIA-4): the server and the gap copy tell every cluster
     * editor they may clear the Runner, and the page offered them no way
     * to — Settings roles and EditKubernetesCluster cannot even list
     * Runners.
     */
    for (const [role, permissions] of [
      ["a member", MEMBER_PERMISSIONS],
      ["a Settings member", [...BASE_PERMISSIONS, Permission.SettingsMember]],
      [
        "an EditKubernetesCluster editor",
        [
          ...BASE_PERMISSIONS,
          Permission.EditKubernetesCluster,
          Permission.ReadKubernetesCluster,
        ],
      ],
    ] as Array<[string, Array<Permission>]>) {
      test(`${role} may unbind the Runner without listing Runners`, async () => {
        grant(permissions);
        openAiPage();
        const dialog: HTMLElement = await openEditModal();

        expect(
          within(dialog).getByText(/Bound now: kubernetes-agent\/prod-east/),
        ).toBeInTheDocument();
        await toggleSwitch(dialog, "ai-access-clear-runner-field", false);
        saveEditModal(dialog);

        expect(await waitForOneUpdate()).toEqual({ aiAccessRunnerId: null });
        expect(listRequestsFor(Runner)).toHaveLength(0);
      });
    }

    test("a member may unbind the credential", async () => {
      serveCluster({
        ...hostRunnerBinding(),
        aiAccessCredential: Object.assign(new RunbookCredential(), {
          _id: CREDENTIAL_ID,
          name: "prod-east token",
        }),
      });
      openAiPage();
      const dialog: HTMLElement = await openEditModal();

      await toggleSwitch(dialog, "ai-access-clear-credential-field", false);
      saveEditModal(dialog);

      expect(await waitForOneUpdate()).toEqual({
        aiAccessCredentialId: null,
      });
      expect(listRequestsFor(RunbookCredential)).toHaveLength(0);
    });

    test("with nothing bound, there is nothing to unbind", async () => {
      serveCluster({ aiAccessRunner: undefined });
      openAiPage();
      const dialog: HTMLElement = await openEditModal();

      expect(
        within(dialog).queryByTestId("ai-access-clear-runner-field"),
      ).not.toBeInTheDocument();
      expect(
        within(dialog).queryByTestId("ai-access-clear-credential-field"),
      ).not.toBeInTheDocument();
    });

    /*
     * ModelForm submitted every field, so a member who only switched
     * investigation off on an Automatic cluster with an allowlist and a
     * bound Runner re-sent all three — and the server refused the save of
     * a change they were allowed to make.
     */
    test("a member who only switches investigation off sends only that", async () => {
      serveCluster({
        aiRemediationMode: KubernetesAiRemediationMode.Automatic,
        aiKubectlCommandAllowlist: [SET_IMAGE_PATTERN],
      });
      openAiPage();
      const dialog: HTMLElement = await openEditModal();

      await toggleInvestigation(dialog, true);
      saveEditModal(dialog);

      await waitFor(
        () => {
          expect(updateByIdSpy).toHaveBeenCalledTimes(1);
        },
        { timeout: WAIT_TIMEOUT },
      );
      const request: JSONObject = updateRequests()[0]!;
      expect(request["data"]).toEqual({ isAiInvestigationEnabled: false });
      expect(String(request["id"])).toBe(CLUSTER_ID.toString());
      expect(request["modelType"]).toBe(KubernetesCluster);

      /*
       * Saved: the modal closes and the status is read again. The re-read
       * is a passive effect of the same state update that closes the
       * modal, so it can land a tick after the dialog is gone: wait for
       * it, rather than assume it has already run (a suite run once saw
       * one status post here).
       */
      await waitFor(
        () => {
          expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
        },
        { timeout: WAIT_TIMEOUT },
      );
      await waitFor(
        () => {
          expect(
            postsTo("/kubernetes-cluster/ai-access/status").length,
          ).toBeGreaterThanOrEqual(2);
        },
        { timeout: WAIT_TIMEOUT },
      );
    });

    test("a member can still switch remediation off", async () => {
      serveCluster({
        aiRemediationMode: KubernetesAiRemediationMode.Automatic,
      });
      openAiPage();
      const dialog: HTMLElement = await openEditModal();

      await pickOption(
        dialog,
        /^AI remediation/,
        REMEDIATION_MODE_LABELS[KubernetesAiRemediationMode.Disabled],
      );
      saveEditModal(dialog);

      expect(await waitForOneUpdate()).toEqual({
        aiRemediationMode: KubernetesAiRemediationMode.Disabled,
      });
    });

    test("an untouched form saves nothing", async () => {
      grant(ADMIN_PERMISSIONS);
      openAiPage();
      const dialog: HTMLElement = await openEditModal();
      await within(dialog).findByText("Runner", {}, { timeout: WAIT_TIMEOUT });

      saveEditModal(dialog);

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
          {
            error: "You do not have permission to switch on unattended fixes.",
          },
          {},
        );
      });
      openAiPage();
      const dialog: HTMLElement = await openEditModal();

      await toggleInvestigation(dialog, true);
      saveEditModal(dialog);

      const error: HTMLElement = await screen.findByTestId(
        "ai-access-save-error",
        {},
        { timeout: WAIT_TIMEOUT },
      );
      expect(error).toHaveTextContent(
        "You do not have permission to switch on unattended fixes.",
      );
      expect(screen.getByRole("dialog")).toBe(dialog);
    });
  });

  describe("confirming unattended riskier changes", () => {
    test("Bypass approval is saved only after a confirmation that names what it unlocks", async () => {
      grant(ADMIN_PERMISSIONS);
      openAiPage();
      const dialog: HTMLElement = await openEditModal();

      await pickOption(
        dialog,
        /^AI remediation/,
        REMEDIATION_MODE_LABELS[KubernetesAiRemediationMode.BypassApproval],
      );
      saveEditModal(dialog);

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

    test("cancelling the confirmation saves nothing and keeps the form", async () => {
      grant(ADMIN_PERMISSIONS);
      openAiPage();
      const dialog: HTMLElement = await openEditModal();

      await setAllowlistText(dialog, "kubectl * * * -n *");
      saveEditModal(dialog);

      const confirm: HTMLElement = await findDialogTitled(
        "Let riskier changes run without approval?",
      );
      expect(confirm).toHaveTextContent('"kubectl * * * -n *"');
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

    /*
     * "kubectl * * * -n *" auto-approves deleting any Deployment in any
     * non-protected namespace; the old whole-string check let it through
     * without a confirmation because it spells out "-n".
     */
    test("a broad allowlist is saved after confirmation, one pattern per line", async () => {
      grant(ADMIN_PERMISSIONS);
      openAiPage();
      const dialog: HTMLElement = await openEditModal();

      await setAllowlistText(
        dialog,
        `${SET_IMAGE_PATTERN}\n\nkubectl * * * -n *\n`,
      );
      saveEditModal(dialog);

      const confirm: HTMLElement = await findDialogTitled(
        "Let riskier changes run without approval?",
      );
      expect(confirm).toHaveTextContent(
        "a wildcard for the verb, the object or the namespace",
      );
      fireEvent.click(within(confirm).getByText("Confirm and save"));

      expect(await waitForOneUpdate()).toEqual({
        aiKubectlCommandAllowlist: [SET_IMAGE_PATTERN, "kubectl * * * -n *"],
      });
    });

    test("a narrow allowlist saves without a confirmation", async () => {
      grant(ADMIN_PERMISSIONS);
      openAiPage();
      const dialog: HTMLElement = await openEditModal();

      await setAllowlistText(dialog, SET_IMAGE_PATTERN);
      saveEditModal(dialog);

      expect(await waitForOneUpdate()).toEqual({
        aiKubectlCommandAllowlist: [SET_IMAGE_PATTERN],
      });
      expect(
        screen.queryByText("Let riskier changes run without approval?"),
      ).not.toBeInTheDocument();
    });

    /*
     * Validity is KubectlPolicy's: a bare "kubectl" names no command. (A
     * pattern without the leading "kubectl" is valid — the matcher reads
     * it — so it is no longer the example here.)
     */
    test("an allowlist pattern the matcher cannot use is refused in the form", async () => {
      grant(ADMIN_PERMISSIONS);
      openAiPage();
      const dialog: HTMLElement = await openEditModal();

      await setAllowlistText(dialog, `${SET_IMAGE_PATTERN}\nkubectl`);
      saveEditModal(dialog);

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
      openAiPage();
      const dialog: HTMLElement = await openEditModal();

      const description: HTMLElement = within(dialog).getByText(
        /\* matches exactly one word/,
      );
      expect(description).toHaveTextContent("flags must be written out");
      expect(description).toHaveTextContent("One pattern per line");
      expect(description).toHaveTextContent('a leading "kubectl" is optional');
    });
  });

  describe("allowlist in effect", () => {
    test("the Remediation tile lists the patterns the policy actually uses", async () => {
      serveStatus(
        makeStatus({
          remediationMode: KubernetesAiRemediationMode.Automatic,
          kubectlAllowlist: [SET_IMAGE_PATTERN],
        }),
      );
      openAiPage();

      const tile: HTMLElement = await screen.findByTestId(
        "kubectl-allowlist-in-effect",
        {},
        { timeout: WAIT_TIMEOUT },
      );
      expect(tile).toHaveTextContent(SET_IMAGE_PATTERN);
      expect(tile).toHaveTextContent("also run on their own");
      // The banner says so too, and that any other riskier fix asks.
      expect(
        screen.getByText(/plus riskier ones that match the kubectl allowlist/),
      ).toHaveTextContent(
        "Any other riskier fix is proposed for your one-click approval.",
      );
    });

    test("an empty allowlist shows nothing extra", async () => {
      serveStatus(
        makeStatus({
          remediationMode: KubernetesAiRemediationMode.Automatic,
          kubectlAllowlist: [],
        }),
      );
      openAiPage();
      await findText(STATUS_CARD_TITLE);

      expect(
        screen.queryByTestId("kubectl-allowlist-in-effect"),
      ).not.toBeInTheDocument();
      expect(
        screen.getByText(
          /and apply safe fixes on its own\. A riskier fix is proposed for your one-click approval\.$/,
        ),
      ).toBeInTheDocument();
    });

    test("a stored allowlist the policy cannot use is flagged", async () => {
      serveStatus(makeStatus({ kubectlAllowlist: [] }));
      getItemSpy.mockImplementation(async (): Promise<KubernetesCluster> => {
        return makeCluster({ aiKubectlCommandAllowlist: { a: "b" } });
      });
      openAiPage();

      expect(
        await screen.findByTestId(
          "kubectl-allowlist-ignored-warning",
          {},
          { timeout: WAIT_TIMEOUT },
        ),
      ).toHaveTextContent("no allowlist pattern is in effect");
    });

    test("a usable stored allowlist is not flagged", async () => {
      serveStatus(makeStatus({ kubectlAllowlist: [SET_IMAGE_PATTERN] }));
      serveCluster({ aiKubectlCommandAllowlist: [SET_IMAGE_PATTERN] });
      openAiPage();

      await findText(SETTINGS_CARD_TITLE);
      await waitFor(
        () => {
          expect(screen.getAllByText(SET_IMAGE_PATTERN).length).toBe(2);
        },
        { timeout: WAIT_TIMEOUT },
      );
      expect(
        screen.queryByTestId("kubectl-allowlist-ignored-warning"),
      ).not.toBeInTheDocument();
    });
  });

  describe("connect a Runner", () => {
    const noRunnerGap: KubernetesAiAccessGap = {
      code: "no_runner_bound",
      title: "No Runner can reach this cluster",
      description:
        "OneUptime AI runs kubectl through a Runner. None is bound to this cluster yet.",
      nextStep:
        "Upgrade the Kubernetes agent with --set aiAccess.enabled=true to install an in-cluster Runner (one command), or bind an existing Runner and a Kubernetes credential on this cluster's AI page.",
      blocks: "both",
    };

    // The server's gap when this cluster's in-cluster Runner is registered.
    const agentNotSelectedGap: KubernetesAiAccessGap = {
      code: "no_runner_bound",
      title: "The in-cluster Runner is installed but not selected",
      description:
        'Runner "kubernetes-agent/prod-east", this cluster\'s in-cluster Runner, is registered and online, but no Runner is bound to this cluster, so OneUptime AI does not use it.',
      nextStep:
        'Select the kubernetes-agent Runner "kubernetes-agent/prod-east" as this cluster\'s Runner on this page (leave the credential empty). No helm change is needed.',
      blocks: "both",
    };

    function installReleaseAndNamespace(): {
      release: string;
      namespace: string;
    } {
      const match: RegExpMatchArray | null = getKubernetesInstallationMarkdown({
        clusterName: "prod-east",
        oneuptimeUrl: "https://oneuptime.example.com",
        apiKey: "key",
      }).match(
        /helm install (\S+) oneuptime\/kubernetes-agent[\s\\]+--namespace (\S+)/,
      );
      if (!match) {
        throw new Error("The install markdown has no helm install command.");
      }
      return { release: match[1]!, namespace: match[2]! };
    }

    test("the default command matches the Dashboard's install and grants read-only access", async () => {
      serveStatus(makeStatus({ runner: null, gaps: [noRunnerGap] }));
      openAiPage();

      await findText("Connect a Runner (one command)");
      const readOnly: string = textOf("ai-access-helm-command");
      const install: { release: string; namespace: string } =
        installReleaseAndNamespace();

      expect(install).toEqual({
        release: KUBERNETES_AGENT_HELM_RELEASE,
        namespace: KUBERNETES_AGENT_HELM_NAMESPACE,
      });
      expect(readOnly).toContain("helm repo update");
      expect(readOnly.indexOf("helm repo update")).toBeLessThan(
        readOnly.indexOf("helm upgrade"),
      );
      expect(readOnly).toContain(
        `helm upgrade ${install.release} oneuptime/kubernetes-agent`,
      );
      expect(readOnly).toContain(`--namespace ${install.namespace}`);
      expect(readOnly).toContain("--set aiAccess.enabled=true");
      expect(readOnly).not.toContain("aiAccess.remediation.enabled=true");
      expect(screen.queryByText(/Drop the last line/)).not.toBeInTheDocument();
    });

    test("an unbound cluster shows the card and a locked test button", async () => {
      serveStatus(makeStatus({ runner: null, gaps: [noRunnerGap] }));
      openAiPage();

      expect(
        await findText("Connect a Runner (one command)"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("Bind a Runner first — there is nothing to test yet."),
      ).toBeInTheDocument();
      expect(screen.getByTestId("ai-access-test-button")).toBeDisabled();
    });

    /*
     * Known follow-up 7: with this cluster's in-cluster Runner installed
     * but not selected, the helm card told the operator to run a command
     * that changes nothing.
     */
    test("an installed but unselected in-cluster Runner asks to select it, not to run helm", async () => {
      serveStatus(makeStatus({ runner: null, gaps: [agentNotSelectedGap] }));
      openAiPage();

      const card: HTMLElement = await screen.findByTestId(
        "ai-access-select-agent-runner",
        {},
        { timeout: WAIT_TIMEOUT },
      );
      expect(card).toHaveTextContent(
        'Select the kubernetes-agent Runner "kubernetes-agent/prod-east"',
      );
      // A member cannot choose a Runner: the card says what it takes.
      expect(card).toHaveTextContent("Edit Auto Remediation Rule");
      expect(
        screen.queryByText("Connect a Runner (one command)"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("ai-access-helm-command"),
      ).not.toBeInTheDocument();
    });

    test("an admin is pointed at Edit AI access to select the installed Runner", async () => {
      grant(ADMIN_PERMISSIONS);
      serveStatus(makeStatus({ runner: null, gaps: [agentNotSelectedGap] }));
      openAiPage();

      expect(
        await screen.findByTestId(
          "ai-access-select-agent-runner",
          {},
          { timeout: WAIT_TIMEOUT },
        ),
      ).toHaveTextContent("Open Edit AI access below and choose it");
    });

    test("a ready cluster in Bypass approval shows the qualified banner and no connect card", async () => {
      serveStatus(
        makeStatus({
          remediationMode: KubernetesAiRemediationMode.BypassApproval,
          gaps: [],
        }),
      );
      openAiPage();

      const banner: HTMLElement = await findText(
        /apply every fix the policy allows on its own/,
      );
      expect(banner).toHaveTextContent("protected namespace");
      expect(banner).toHaveTextContent("drain");
      expect(banner).toHaveTextContent("circuit breaker");
      expect(banner).not.toHaveTextContent("without asking anyone");
      expect(
        screen.queryByText("Connect a Runner (one command)"),
      ).not.toBeInTheDocument();
    });

    test("a Runner bound to another cluster shows its gap, not the card", async () => {
      serveStatus(
        makeStatus({
          gaps: [
            {
              code: "runner_cluster_mismatch",
              title: "The bound Runner runs in another cluster",
              description: "kubernetes-agent/prod-eu runs inside prod-eu.",
              nextStep: "Bind this cluster's own Runner on this page.",
              blocks: "both",
            },
          ],
        }),
      );
      openAiPage();

      expect(
        await findText("The bound Runner runs in another cluster"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("Bind this cluster's own Runner on this page."),
      ).toBeInTheDocument();
      expect(
        screen.queryByText("Connect a Runner (one command)"),
      ).not.toBeInTheDocument();
    });

    // Known follow-up 7: this gap renders like every other, with its next step.
    test("a credential on another cluster's in-cluster Runner shows its gap and next step", async () => {
      serveStatus(
        makeStatus({
          runner: {
            id: OTHER_CLUSTER_RUNNER_ID,
            name: "kubernetes-agent/prod-eu",
            isOnline: true,
            canRunAiCommands: true,
            posture: {
              inCluster: true,
              allowWrites: false,
              clusterIdentifier: "prod-eu",
            },
          },
          accessMethod: "none",
          isInvestigationReady: false,
          isRemediationReady: false,
          gaps: [
            {
              code: "credential_on_agent_runner",
              title: "An in-cluster Runner cannot carry a credential",
              description:
                'Runner "kubernetes-agent/prod-eu" is the in-cluster Runner of cluster "prod-eu".',
              nextStep:
                "Create a Runner under Project Settings → Runners, assign the Kubernetes credential to it and select both on this page — or install the in-cluster Runner on THIS cluster with --set aiAccess.enabled=true, which needs no credential.",
              blocks: "both",
            },
          ],
        }),
      );
      openAiPage();

      expect(
        await findText("An in-cluster Runner cannot carry a credential"),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/Create a Runner under Project Settings → Runners/),
      ).toBeInTheDocument();
      expect(
        screen.queryByText("Connect a Runner (one command)"),
      ).not.toBeInTheDocument();
    });
  });

  /*
   * The finding (dashboard-ai-page-3): the write-access command lived in
   * the connect card, so it vanished once the recommended read-only
   * Runner connected; it granted write RBAC cluster-wide with no scoped
   * form, no `helm repo update` and understated copy.
   */
  describe("letting AI apply fixes", () => {
    const writeAccessGap: KubernetesAiAccessGap = {
      code: "remediation_write_access_missing",
      title: "The in-cluster Runner is read-only",
      description:
        "The Kubernetes agent was installed without write access, so kubectl changes would be refused by the cluster.",
      nextStep:
        "Upgrade the agent with --set aiAccess.remediation.enabled=true to grant the Runner's ServiceAccount the write verbs OneUptime AI may use.",
      blocks: "remediation",
    };

    test("a connected read-only in-cluster Runner still gets complete write-access commands", async () => {
      serveStatus(
        makeStatus({
          remediationMode: KubernetesAiRemediationMode.RequireApproval,
          isRemediationReady: false,
          gaps: [writeAccessGap],
        }),
      );
      openAiPage();

      const section: HTMLElement = await screen.findByTestId(
        "ai-access-remediation-setup",
        {},
        { timeout: WAIT_TIMEOUT },
      );
      expect(section).toHaveTextContent(
        "The in-cluster Runner has read-only RBAC",
      );
      expect(
        screen.queryByText("Connect a Runner (one command)"),
      ).not.toBeInTheDocument();

      const scoped: string = textOf(
        "ai-access-helm-remediation-scoped-command",
      );
      expect(scoped.startsWith("helm repo update")).toBe(true);
      expect(scoped).toContain(
        `helm upgrade ${KUBERNETES_AGENT_HELM_RELEASE} oneuptime/kubernetes-agent`,
      );
      expect(scoped).toContain("--set aiAccess.remediation.enabled=true");
      expect(scoped).toContain("aiAccess.remediation.namespaces=");
      expect(scoped).toContain("aiAccess.remediation.nodeOperations=false");
      expect(scoped).toBe(getAiAccessHelmCommands().enableRemediationScoped);

      const clusterWide: string = textOf("ai-access-helm-remediation-command");
      expect(clusterWide.startsWith("helm repo update")).toBe(true);
      expect(clusterWide).toContain("--set aiAccess.remediation.enabled=true");

      const disclosure: HTMLElement = screen.getByTestId(
        "ai-access-write-disclosure",
      );
      expect(disclosure).toHaveTextContent("any image as any ServiceAccount");
      expect(disclosure).toHaveTextContent("kube-system");
    });

    test("stays on the page for a Runner that already writes, saying where", async () => {
      serveStatus(
        makeStatus({
          runner: {
            ...makeStatus().runner!,
            posture: {
              inCluster: true,
              allowWrites: true,
              writeNamespaces: ["web", "api"],
              kubectlVersion: "v1.31.0",
            },
          },
        }),
      );
      openAiPage();

      expect(
        await screen.findByTestId(
          "ai-access-runner-write-access",
          {},
          { timeout: WAIT_TIMEOUT },
        ),
      ).toHaveTextContent("writes allowed in web, api");
      expect(
        screen.getByTestId("ai-access-remediation-setup"),
      ).toHaveTextContent(
        "The in-cluster Runner reports: writes allowed in web, api.",
      );
      expect(
        screen.getByTestId("ai-access-helm-remediation-scoped-command"),
      ).toBeInTheDocument();
    });

    test("an external Runner is told its credential's RBAC decides", async () => {
      serveStatus(
        makeStatus({
          runner: {
            id: HOST_RUNNER_ID,
            name: "bash-runner",
            isOnline: true,
            canRunAiCommands: true,
          },
          accessMethod: "credential",
          credentialId: CREDENTIAL_ID,
          credentialName: "prod-east token",
        }),
      );
      openAiPage();

      expect(
        await screen.findByTestId(
          "ai-access-remediation-setup",
          {},
          { timeout: WAIT_TIMEOUT },
        ),
      ).toHaveTextContent("bounded by that credential's RBAC");
      expect(
        screen.queryByTestId("ai-access-runner-write-access"),
      ).not.toBeInTheDocument();
    });
  });

  describe("access test", () => {
    const TEST_ROUTE: string = "/kubernetes-cluster/ai-access/test";

    /*
     * The finding: the button was enabled for everyone once a Runner was
     * bound, but the route needs edit access to the cluster; a reader got
     * a red "You do not have permission to change this cluster's AI
     * access" for a read-only test.
     */
    test("is locked, with the reason, for a user who may only read the cluster", async () => {
      grant([...BASE_PERMISSIONS, Permission.ReadKubernetesCluster]);
      openAiPage();

      const button: HTMLElement = await screen.findByTestId(
        "ai-access-test-button",
        {},
        { timeout: WAIT_TIMEOUT },
      );
      expect(button).toBeDisabled();
      expect(textOf("ai-access-test-permission-note")).toMatch(
        /Running the access test needs permission to edit this cluster/,
      );
      expect(textOf("ai-access-test-permission-note")).toContain(
        "Edit Kubernetes Cluster",
      );

      fireEvent.click(button);
      expect(postsTo(TEST_ROUTE)).toHaveLength(0);
    });

    test("is hidden while the permission snapshot has not landed", async () => {
      grant([]);
      openAiPage();

      await findText(STATUS_CARD_TITLE);
      expect(
        screen.queryByTestId("ai-access-test-button"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("ai-access-test-permission-note"),
      ).not.toBeInTheDocument();
    });

    test("runs once for a member and shows every command's result", async () => {
      let answer: (value: HTTPResponse<JSONObject>) => void = (): void => {
        // replaced below
      };
      serveStatusAndTest(
        makeStatus(),
        (): Promise<HTTPResponse<JSONObject>> => {
          return new Promise(
            (resolve: (value: HTTPResponse<JSONObject>) => void) => {
              answer = resolve;
            },
          );
        },
      );
      openAiPage();

      const button: HTMLElement = await screen.findByTestId(
        "ai-access-test-button",
        {},
        { timeout: WAIT_TIMEOUT },
      );
      expect(button).not.toBeDisabled();
      expect(
        screen.queryByTestId("ai-access-test-permission-note"),
      ).not.toBeInTheDocument();

      fireEvent.click(button);
      fireEvent.click(button);

      await waitFor(
        () => {
          expect(screen.getByTestId("ai-access-test-button")).toBeDisabled();
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
              ],
              status: makeStatus({
                lastVerifiedAt: "2026-09-22T10:05:00.000Z",
              }) as unknown as JSONObject,
            },
            {},
          ),
        );
      });

      expect(await findText("Access works")).toBeInTheDocument();
      expect(screen.getByText("succeeded")).toBeInTheDocument();
      expect(screen.getByText("Server Version: v1.31.0")).toBeInTheDocument();
      expect(
        screen.getByText(/Last successful kubectl command:/),
      ).toBeInTheDocument();
      expect(screen.getByTestId("ai-access-test-button")).not.toBeDisabled();
    });

    test("shows a failed command with its exit code", async () => {
      serveStatusAndTest(
        makeStatus(),
        async (): Promise<HTTPResponse<JSONObject>> => {
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
                  errorMessage: "forbidden",
                },
              ],
            },
            {},
          );
        },
      );
      openAiPage();

      fireEvent.click(
        await screen.findByTestId(
          "ai-access-test-button",
          {},
          { timeout: WAIT_TIMEOUT },
        ),
      );

      expect(await findText("Access is not working yet")).toBeInTheDocument();
      expect(screen.getByText("failed (exit 1)")).toBeInTheDocument();
      expect(screen.getByText("forbidden")).toBeInTheDocument();
    });

    test("shows an error the server returns", async () => {
      serveStatusAndTest(makeStatus(), async (): Promise<HTTPErrorResponse> => {
        return new HTTPErrorResponse(
          400,
          { error: "Kubernetes cluster not found." },
          {},
        );
      });
      openAiPage();

      fireEvent.click(
        await screen.findByTestId(
          "ai-access-test-button",
          {},
          { timeout: WAIT_TIMEOUT },
        ),
      );

      const error: HTMLElement = await screen.findByTestId(
        "ai-access-test-error",
        {},
        { timeout: WAIT_TIMEOUT },
      );
      expect(error).toHaveTextContent("The test could not run");
      expect(error).toHaveTextContent("Kubernetes cluster not found.");
    });

    test("a permission refusal talks about running the test, not changing settings", async () => {
      serveStatusAndTest(makeStatus(), async (): Promise<HTTPErrorResponse> => {
        return new HTTPErrorResponse(
          422,
          {
            error:
              "You do not have permission to change this cluster's AI access.",
          },
          {},
        );
      });
      openAiPage();

      fireEvent.click(
        await screen.findByTestId(
          "ai-access-test-button",
          {},
          { timeout: WAIT_TIMEOUT },
        ),
      );

      const error: HTMLElement = await screen.findByTestId(
        "ai-access-test-error",
        {},
        { timeout: WAIT_TIMEOUT },
      );
      expect(error).toHaveTextContent(
        "Running the access test needs permission to edit this cluster",
      );
      expect(error).toHaveTextContent("Nothing on the cluster");
      expect(error).not.toHaveTextContent("change this cluster's AI access");
    });
  });

  /*
   * The finding: Settings roles and ReadKubernetesCluster may open this
   * page but not read RunnerJob rows, so the command history showed a
   * permission error. RunnerJob's ACL is not widened; they get an
   * explanation and no failing request.
   */
  describe("command history permission", () => {
    for (const permission of [
      Permission.SettingsAdmin,
      Permission.SettingsViewer,
      Permission.ReadKubernetesCluster,
    ]) {
      test(`explains instead of failing for ${permission}`, async () => {
        grant([...BASE_PERMISSIONS, permission]);
        openAiPage();

        const note: HTMLElement = await screen.findByTestId(
          "kubectl-jobs-permission-note",
          {},
          { timeout: WAIT_TIMEOUT },
        );
        expect(note).toHaveTextContent("Runbook Viewer");
        expect(note).toHaveTextContent("Viewer");
        expect(
          screen.getByText("Commands OneUptime AI ran on this cluster"),
        ).toBeInTheDocument();
        expect(jobListRequest()).toBeUndefined();
      });
    }

    for (const permission of [Permission.ProjectMember, Permission.Viewer]) {
      test(`shows the table for ${permission}`, async () => {
        grant([...BASE_PERMISSIONS, permission]);
        openAiPage();

        await findText(
          "OneUptime AI has not run any kubectl commands on this cluster yet.",
        );
        expect(
          screen.queryByTestId("kubectl-jobs-permission-note"),
        ).not.toBeInTheDocument();
        const request: ListRequest | undefined = jobListRequest();
        expect(request?.query).toEqual(
          expect.objectContaining({ stepType: RunbookStepType.Kubectl }),
        );
        expect(String(request?.query?.["kubernetesClusterId"])).toBe(
          CLUSTER_ID.toString(),
        );
      });
    }
  });

  describe("settings edit button", () => {
    test("is locked, with the reason, for a user who may only read the cluster", async () => {
      grant([...BASE_PERMISSIONS, Permission.ReadKubernetesCluster]);
      openAiPage();

      await findText(SETTINGS_CARD_TITLE);
      const button: HTMLElement | null = (
        await findText("Edit AI access")
      ).closest("button");
      expect(button).not.toBeNull();
      expect(button).toBeDisabled();

      fireEvent.click(button as HTMLElement);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      // A reader is not told about loosening permissions they could not use.
      expect(
        screen.queryByTestId("kubernetes-ai-access-admin-note"),
      ).not.toBeInTheDocument();
    });
  });
});
