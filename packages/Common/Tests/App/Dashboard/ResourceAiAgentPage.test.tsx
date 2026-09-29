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
  RESOURCE_AI_AGENT_STATUS_POLL_INTERVAL_MS,
  getResourceAiAgentNotInstalledText,
  getResourceAiAgentPageSubtitle,
  getResourceAiAgentReadyText,
  getResourceAiAgentSignedOffText,
  getResourceAiAgentSilentText,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceAiAgent/ResourceAiAgentStatus";
import {
  RESOURCE_REMEDIATION_MODE_LABELS,
  RESOURCE_REMEDIATION_MODE_SUMMARIES,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceAiAgent/ResourceAiAccessSettingsUtil";
import {
  getResourceAiAgentComposeSnippet,
  getResourceAiAgentLogsCommand,
  getResourceAiAgentServiceName,
  getResourceAiAgentWriteAccessCommands,
  getResourceAiAgentWriteDisclosure,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceAiAgent/ResourceAiAgentInstall";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
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
 * the server has gaps, and "What AI may do" with its Change modal — whose
 * loosening rules, allowlist checks and confirmations mirror the server's.
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
    expect(screen.getByTestId("ai-agent-meta")).toHaveTextContent(
      "agent v14.1.0 · Docker 27.3.1 · Read-only",
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
    expect(
      screen.queryByTestId("ai-agent-test-button"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("ai-agent-ready")).not.toBeInTheDocument();
    expect(screen.queryByTestId("ai-agent-meta")).not.toBeInTheDocument();
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
    fireEvent.click(within(row).getByText("Test connection"));
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

  test("lists one row per server gap with its title and next step", async () => {
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

    const list: HTMLElement = await findTestId("ai-agent-gaps");
    const rows: Array<HTMLElement> = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Title of ai_balance_insufficient");
    expect(rows[0]).toHaveTextContent("Next step for ai_balance_insufficient");
    expect(rows[1]).toHaveTextContent("Title of llm_provider_missing");
    expect(screen.getByText(GAPS_CARD_TITLE)).toBeInTheDocument();
    expect(screen.queryByTestId("ai-agent-ready")).not.toBeInTheDocument();
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
    expect(within(row).queryByRole("button")).not.toBeInTheDocument();
    expect(within(row).queryByRole("link")).not.toBeInTheDocument();
  });
});

describe("What AI may do", () => {
  test("shows investigation and fixes in plain words, with the fixes-off hint", async () => {
    openAgentPage();

    expect(await findTestId("ai-access-investigation-value")).toHaveTextContent(
      "Yes — read-only (ps, inspect, logs, stats, events)",
    );
    expect(screen.getByText(DOCKER.investigateTitle)).toBeInTheDocument();
    expect(screen.getByTestId("ai-access-fixes-value")).toHaveTextContent(
      `Off — ${RESOURCE_REMEDIATION_MODE_SUMMARIES[ResourceAiRemediationMode.Disabled]}`,
    );
    expect(screen.getByTestId("ai-access-fixes-off-hint")).toHaveTextContent(
      "Want AI to propose fixes? Choose Ask for approval.",
    );
    expect(
      screen.queryByTestId("ai-access-write-commands"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("ai-command-allowlist-in-effect"),
    ).not.toBeInTheDocument();
  });

  test("investigation off says so", async () => {
    serve(
      makeStatus({
        isAiInvestigationEnabled: false,
        isInvestigationReady: false,
      }),
    );
    openAgentPage();

    expect(await findTestId("ai-access-investigation-value")).toHaveTextContent(
      "No — AI investigates with OneUptime data only",
    );
  });

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
    expect(await findTestId("ai-access-fixes-value")).toHaveTextContent(
      "Bypass approval",
    );
    expect(
      screen.queryByTestId("ai-command-allowlist-in-effect"),
    ).not.toBeInTheDocument();
  });

  test("an empty allowlist in Automatic mode reads None", async () => {
    serve(
      makeStatus({ aiRemediationMode: ResourceAiRemediationMode.Automatic }),
    );
    openAgentPage();

    expect(
      await findTestId("ai-command-allowlist-in-effect"),
    ).toHaveTextContent("None");
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

    expect(await openDropdown(dialog, /^Fixes/)).toEqual([
      RESOURCE_REMEDIATION_MODE_LABELS[ResourceAiRemediationMode.Disabled],
      `${RESOURCE_REMEDIATION_MODE_LABELS[ResourceAiRemediationMode.RequireApproval]} (current)`,
    ]);
  });

  test("a member on an Off host cannot turn fixes on", async () => {
    serveModel({ aiRemediationMode: ResourceAiRemediationMode.Disabled });
    openAgentPage();
    const dialog: HTMLElement = await openChangeModal();

    expect(await openDropdown(dialog, /^Fixes/)).toEqual([
      RESOURCE_REMEDIATION_MODE_LABELS[ResourceAiRemediationMode.Disabled],
    ]);
  });

  test("an admin is offered every mode, and turns fixes on from Off", async () => {
    grant(ADMIN_PERMISSIONS);
    serveModel({ aiRemediationMode: ResourceAiRemediationMode.Disabled });
    openAgentPage();
    const dialog: HTMLElement = await openChangeModal();

    expect(
      within(dialog).queryByTestId("resource-ai-access-admin-note"),
    ).not.toBeInTheDocument();
    expect(await openDropdown(dialog, /^Fixes/)).toEqual(
      Object.values(ResourceAiRemediationMode).map(
        (mode: ResourceAiRemediationMode): string => {
          return RESOURCE_REMEDIATION_MODE_LABELS[mode];
        },
      ),
    );
    fireEvent.click(
      menuOptions().find((option: HTMLElement): boolean => {
        return (
          option.textContent ===
          RESOURCE_REMEDIATION_MODE_LABELS[
            ResourceAiRemediationMode.RequireApproval
          ]
        );
      })!,
    );
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

    await pickOption(
      dialog,
      /^Fixes/,
      RESOURCE_REMEDIATION_MODE_LABELS[ResourceAiRemediationMode.Automatic],
    );
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
      within(dialog).getByText(/You can remove entries or clear the list/),
    ).toBeInTheDocument();
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

    await pickOption(
      dialog,
      /^Fixes/,
      RESOURCE_REMEDIATION_MODE_LABELS[
        ResourceAiRemediationMode.RequireApproval
      ],
    );
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

    await pickOption(
      dialog,
      /^Fixes/,
      RESOURCE_REMEDIATION_MODE_LABELS[
        ResourceAiRemediationMode.RequireApproval
      ],
    );
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

describe("the Change modal: confirmations", () => {
  test("Bypass approval is confirmed before it is saved", async () => {
    grant(ADMIN_PERMISSIONS);
    openAgentPage();
    const dialog: HTMLElement = await openChangeModal();

    await pickOption(
      dialog,
      /^Fixes/,
      RESOURCE_REMEDIATION_MODE_LABELS[
        ResourceAiRemediationMode.BypassApproval
      ],
    );
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

    fireEvent.click(await findTestId("ai-agent-test-button"));

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
          "agent v14.2.0",
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

    fireEvent.click(await findTestId("ai-agent-test-button"));

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

    fireEvent.click(await findTestId("ai-agent-test-button"));

    expect(await findTestId("ai-agent-test-error")).toHaveTextContent(
      "An AI access test is already running.",
    );
  });

  test("is locked for a reader, with the reason", async () => {
    grant(READER_PERMISSIONS);
    openAgentPage();

    expect(await findTestId("ai-agent-test-button")).toBeDisabled();
    expect(
      screen.getByTestId("ai-agent-test-permission-note"),
    ).toHaveTextContent("Testing the connection needs permission to edit");
  });
});

describe("Reset agent", () => {
  test("is only offered to the admin set", async () => {
    openAgentPage();

    expect(await findText("Docker AI agent")).toBeInTheDocument();
    expect(
      screen.queryByTestId("ai-agent-reset-button"),
    ).not.toBeInTheDocument();
  });

  test("an admin resets the agent after a confirmation", async () => {
    grant(ADMIN_PERMISSIONS);
    openAgentPage();

    fireEvent.click(await findTestId("ai-agent-reset-button"));
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

    fireEvent.click(await findTestId("ai-agent-reset-button"));
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
    expect(
      screen.queryByTestId("ai-agent-reset-button"),
    ).not.toBeInTheDocument();
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
    },
  );
});
