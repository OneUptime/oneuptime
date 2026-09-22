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
  REMEDIATION_MODE_LABELS,
  canPickKubernetesCredential,
  getKubernetesCredentialPermissionTitles,
  parseStatus,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/AI";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import RunbookCredential from "../../../Models/DatabaseModels/RunbookCredential";
import Runner from "../../../Models/DatabaseModels/Runner";
import RunnerJob from "../../../Models/DatabaseModels/RunnerJob";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../Types/JSON";
import {
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
} from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
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
 * page is one screen made of four pieces that each failed in review in a
 * different way: the summary tile read a status field that does not exist,
 * a background poll wiped the whole page, the commands table asked for the
 * wrong columns (and lacked the ones ModelTable requires), and the edit
 * modal loaded a credential list its users were not allowed to read.
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

const MEMBER_PERMISSIONS: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
  Permission.ProjectMember,
];

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

function makeCluster(): KubernetesCluster {
  const runner: Runner = Object.assign(new Runner(), {
    _id: RUNNER_ID,
    name: "kubernetes-agent/prod-east",
  });
  return Object.assign(new KubernetesCluster(), {
    _id: CLUSTER_ID.toString(),
    isAiInvestigationEnabled: true,
    aiRemediationMode: KubernetesAiRemediationMode.RequireApproval,
    aiKubectlCommandAllowlist: [],
    aiAccessRunner: runner,
  });
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

async function findText(text: string): Promise<HTMLElement> {
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
        const credential: RunbookCredential = Object.assign(
          new RunbookCredential(),
          { _id: CREDENTIAL_ID, name: "prod-east token" },
        );
        return {
          data: [credential as unknown as RunnerJob],
          count: 1,
          skip: 0,
          limit: 10,
        };
      }
      return { data: [], count: 0, skip: 0, limit: 10 };
    },
  );

  getItemSpy = jest.spyOn(ModelAPI, "getItem");
  getItemSpy.mockImplementation(async (): Promise<KubernetesCluster> => {
    return makeCluster();
  });
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
    // The two unattended modes must say so, and bypass must say nobody asks.
    expect(
      REMEDIATION_MODE_LABELS[KubernetesAiRemediationMode.Automatic],
    ).toMatch(/run on their own/);
    expect(
      REMEDIATION_MODE_LABELS[KubernetesAiRemediationMode.BypassApproval],
    ).toMatch(/nobody is asked/);
    expect(
      REMEDIATION_MODE_LABELS[KubernetesAiRemediationMode.Disabled],
    ).toMatch(/Off/);
  });

  test("Automatic never claims riskier fixes ask for approval", () => {
    /*
     * In Automatic mode a riskier change is never run without a human: the
     * unattended round refuses it and leaves the command in the written
     * recommendations. The label must not promise an approval prompt.
     */
    const label: string =
      REMEDIATION_MODE_LABELS[KubernetesAiRemediationMode.Automatic];
    expect(label).not.toMatch(/\bask/i);
    expect(label).toMatch(/left for you/);
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

  describe("edit modal", () => {
    test("omits the credential picker for a member who may not read Runner credentials", async () => {
      openAiPage();

      expect(
        await screen.findByTestId(
          "kubernetes-credential-permission-note",
          {},
          { timeout: WAIT_TIMEOUT },
        ),
      ).toHaveTextContent("Runbook Credential");

      const dialog: HTMLElement = await openEditModal();

      expect(within(dialog).getByText("Runner")).toBeInTheDocument();
      expect(
        within(dialog).queryByText("Kubernetes credential"),
      ).not.toBeInTheDocument();
      expect(
        within(dialog).queryByText(/do not have permission/i),
      ).not.toBeInTheDocument();

      await waitFor(() => {
        expect(
          listRequests().some((request: ListRequest): boolean => {
            return request.modelType === Runner;
          }),
        ).toBe(true);
      });
      expect(
        listRequests().some((request: ListRequest): boolean => {
          return request.modelType === RunbookCredential;
        }),
      ).toBe(false);
    });

    test("offers the credential picker to a member who may read Runner credentials", async () => {
      grant([...MEMBER_PERMISSIONS, Permission.ReadRunbookCredential]);
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
      await waitFor(() => {
        expect(
          listRequests().some((request: ListRequest): boolean => {
            return request.modelType === RunbookCredential;
          }),
        ).toBe(true);
      });
    });
  });
});
