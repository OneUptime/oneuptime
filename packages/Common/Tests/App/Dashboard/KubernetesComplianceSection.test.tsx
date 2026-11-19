import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock, SpyInstance } from "jest-mock";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";

type DownloadFileMock = (...args: Array<unknown>) => unknown;

const mockDownloadFile: Mock<DownloadFileMock> = jest.fn<DownloadFileMock>();

jest.mock("../../../UI/Utils/DownloadFile", () => {
  return {
    __esModule: true,
    ...(jest.requireActual("../../../UI/Utils/DownloadFile") as Record<
      string,
      unknown
    >),
    default: (...args: Array<unknown>): unknown => {
      return mockDownloadFile(...args);
    },
  };
});

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
        i18n: { language: "en" },
      };
    },
  };
});

import KubernetesComplianceSection, {
  FINDINGS_SHOWN,
  KUBERNETES_COMPLIANCE_TEST_ID,
  getSwitchControlName,
} from "../../../../App/FeatureSet/Dashboard/src/Components/KubernetesCompliance/KubernetesComplianceSection";
import { Translator, createTranslator } from "../../../Types/Translator";
import fs from "fs";
import path from "path";
import KubernetesComplianceApi from "../../../../App/FeatureSet/Dashboard/src/Components/KubernetesCompliance/KubernetesComplianceApi";
import DataSecurityComplianceSetting from "../../../Models/DatabaseModels/DataSecurityComplianceSetting";
import { ComplianceRequirementStatus } from "../../../Types/DataSecurity/ComplianceRequirementCatalog";
import { DataStoreResourceKind } from "../../../Types/DataSecurity/DataStoreResource";
import { JSONObject } from "../../../Types/JSON";
import { readPodSecurity } from "../../../Types/Kubernetes/KubernetesPodSecurity";
import {
  KubernetesComplianceFrameworkResponse,
  KubernetesComplianceResponse,
  KubernetesComplianceTurnedOff,
} from "../../../Types/Kubernetes/Compliance/KubernetesComplianceApiTypes";
import { KubernetesComplianceFramework } from "../../../Types/Kubernetes/Compliance/KubernetesComplianceFramework";
import {
  KubernetesComplianceFrameworkResult,
  KubernetesComplianceRequirementResult,
  KubernetesComplianceSetting,
  scoreKubernetesFrameworks,
} from "../../../Types/Kubernetes/Compliance/KubernetesComplianceScoring";
import {
  KubernetesCompliancePod,
  KubernetesComplianceSnapshot,
} from "../../../Types/Kubernetes/Compliance/KubernetesComplianceSnapshot";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import TableColumnsToCsv from "../../../UI/Utils/TableColumnsToCsv";
import Toast from "../../../UI/Utils/Toast";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

/*
 * A KUBERNETES CLUSTER'S OWN HARDENING ON ITS COMPLIANCE PAGE (#9627): the
 * Pod Security Standards' two policies and the CIS Kubernetes Benchmark as
 * tiles; a framework picked lists its controls, failing first, each saying
 * what is wrong, how to fix it and which workloads fail it, linked to their
 * pages; the switches turn a framework, a control or a namespace off, as a
 * cluster's setting, and ask why; the CIS benchmark says plainly what it
 * does not score; and each framework exports as CSV and JSON.
 */

const CLUSTER_ID: ObjectID = new ObjectID(
  "44444444-0000-4000-8000-000000000004",
);
const SETTING_ID: ObjectID = new ObjectID(
  "66666666-0000-4000-8000-000000000006",
);

const BASELINE: KubernetesComplianceFramework =
  KubernetesComplianceFramework.PssBaseline;
const RESTRICTED: KubernetesComplianceFramework =
  KubernetesComplianceFramework.PssRestricted;
const CIS: KubernetesComplianceFramework =
  KubernetesComplianceFramework.CisKubernetes;

const HARDENED: JSONObject = {
  securityContext: {
    runAsNonRoot: true,
    seccompProfile: { type: "RuntimeDefault" },
  },
  containers: [
    {
      name: "api",
      securityContext: {
        allowPrivilegeEscalation: false,
        capabilities: { drop: ["ALL"] },
      },
    },
  ],
};

const PRIVILEGED: JSONObject = {
  hostNetwork: true,
  containers: [{ name: "kube-proxy", securityContext: { privileged: true } }],
};

function pod(
  namespace: string,
  name: string,
  workload: { kind: string; name: string },
  spec: JSONObject,
): KubernetesCompliancePod {
  return {
    namespace,
    name,
    workload: { kind: workload.kind, namespace, name: workload.name },
    serviceAccountName: "default",
    security: readPodSecurity(spec),
    images: ["ghcr.io/acme/app:1"],
  };
}

function snapshotOf(
  extraPods: Array<KubernetesCompliancePod> = [],
): KubernetesComplianceSnapshot {
  return {
    version: { major: 1, minor: 31 },
    provider: "EKS",
    pods: [
      pod("payments", "api-1", { kind: "Deployment", name: "api" }, HARDENED),
      pod(
        "kube-system",
        "kube-proxy-a",
        { kind: "DaemonSet", name: "kube-proxy" },
        PRIVILEGED,
      ),
      pod(
        "kube-system",
        "kube-proxy-b",
        { kind: "DaemonSet", name: "kube-proxy" },
        PRIVILEGED,
      ),
      ...extraPods,
    ],
    namespaces: [],
    roles: [],
    bindings: [],
    serviceAccounts: [],
    networkPolicies: [],
    hasPolicyObjects: false,
  };
}

function answerOf(
  options: {
    snapshot?: KubernetesComplianceSnapshot;
    settings?: Array<KubernetesComplianceSetting>;
    turnedOff?: Array<KubernetesComplianceTurnedOff>;
    extra?: Partial<KubernetesComplianceResponse>;
  } = {},
): KubernetesComplianceResponse {
  const snapshot: KubernetesComplianceSnapshot =
    options.snapshot || snapshotOf();
  const frameworks: Array<KubernetesComplianceFrameworkResponse> =
    scoreKubernetesFrameworks(snapshot, options.settings || []).map(
      (
        framework: KubernetesComplianceFrameworkResult,
      ): KubernetesComplianceFrameworkResponse => {
        return {
          ...framework,
          turnedOff: (options.turnedOff || []).filter(
            (entry: KubernetesComplianceTurnedOff): boolean => {
              return entry.framework === framework.framework;
            },
          ),
        };
      },
    );

  return {
    clusterId: CLUSTER_ID.toString(),
    kubernetesVersion: "1.31",
    standardVersion: "1.31",
    provider: "EKS",
    isManagedControlPlane: true,
    podCount: snapshot.pods.length,
    podsRead: snapshot.pods.length,
    hasPolicyObjects: false,
    policyEngine: null,
    isTruncated: false,
    namespaces: [
      {
        name: "kube-system",
        podCount: 2,
        enforce: null,
        audit: null,
        warn: null,
      },
      {
        name: "payments",
        podCount: 1,
        enforce: "restricted",
        audit: null,
        warn: null,
      },
    ],
    frameworks,
    ...options.extra,
  };
}

let complianceSpy: SpyInstance<
  typeof KubernetesComplianceApi.getClusterCompliance
>;
let rowsSpy: ReturnType<typeof jest.spyOn>;
let createSpy: ReturnType<typeof jest.spyOn>;
let updateSpy: ReturnType<typeof jest.spyOn>;
let toastSpy: SpyInstance<typeof Toast.success>;
let rows: Array<DataSecurityComplianceSetting>;
let canChange: boolean;

beforeEach(() => {
  rows = [];
  canChange = true;
  mockDownloadFile.mockReset();
  goTo(
    `/dashboard/${PROJECT_ID}/kubernetes/${CLUSTER_ID.toString()}/compliance`,
  );
  complianceSpy = jest
    .spyOn(KubernetesComplianceApi, "getClusterCompliance")
    .mockResolvedValue(answerOf());
  rowsSpy = jest.spyOn(ModelAPI, "getList").mockImplementation((async () => {
    return { data: rows, count: rows.length, skip: 0, limit: 1000 };
  }) as never);
  createSpy = jest
    .spyOn(ModelAPI, "create")
    .mockResolvedValue({ data: {} } as never);
  updateSpy = jest
    .spyOn(ModelAPI, "updateById")
    .mockResolvedValue({ data: {} } as never);
  toastSpy = jest.spyOn(Toast, "success").mockReturnValue("toast");
  jest.spyOn(PermissionGate, "check").mockImplementation(() => {
    return canChange
      ? ({ isAllowed: true } as PermissionGateResult)
      : ({
          isAllowed: false,
          disabledReason: "Changing this takes the Security Member role.",
        } as PermissionGateResult);
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function drawSection(): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter>
        <KubernetesComplianceSection clusterId={CLUSTER_ID} />
      </MemoryRouter>,
    );
  });
}

function tiles(): Array<string> {
  return within(
    screen.getByTestId(`${KUBERNETES_COMPLIANCE_TEST_ID}-frameworks`),
  )
    .getAllByTestId("data-security-compliance-framework")
    .map((tile: HTMLElement): string => {
      return tile.querySelector("span")?.textContent || "";
    });
}

async function pick(framework: KubernetesComplianceFramework): Promise<void> {
  const tile: HTMLElement | undefined = within(
    screen.getByTestId(`${KUBERNETES_COMPLIANCE_TEST_ID}-frameworks`),
  )
    .getAllByTestId("data-security-compliance-framework")
    .find((each: HTMLElement): boolean => {
      return each.querySelector("span")?.textContent === framework;
    });

  expect(tile).toBeDefined();

  await act(async () => {
    fireEvent.click(tile!);
  });
}

async function press(testId: string): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByTestId(testId));
  });
}

// The controls the table lists, in its order: "Privileged Containers", "5.2.2".
function listedControls(): Array<string> {
  return screen
    .getAllByTestId(new RegExp(`^${KUBERNETES_COMPLIANCE_TEST_ID}-control-`))
    .map((cell: HTMLElement): string => {
      return (cell.getAttribute("data-testid") || "").replace(
        `${KUBERNETES_COMPLIANCE_TEST_ID}-control-`,
        "",
      );
    });
}

async function openFold(testId: string): Promise<void> {
  const fold: HTMLElement = screen.getByTestId(testId);
  const toggle: HTMLElement = within(fold).getAllByRole("button")[0]!;

  await act(async () => {
    fireEvent.click(toggle);
  });
}

describe("a cluster's hardening", () => {
  test("asks for this cluster's hardening, and the switches set on it", async () => {
    await drawSection();

    expect(complianceSpy).toHaveBeenCalledWith(CLUSTER_ID);
    expect(rowsSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        modelType: DataSecurityComplianceSetting,
        query: expect.objectContaining({
          resourceType: DataStoreResourceKind.KubernetesCluster,
          resourceId: CLUSTER_ID,
        }),
        select: expect.objectContaining({ namespace: true }),
      }),
    );
  });

  test("shows a tile for each framework, with its score and how many controls fail", async () => {
    await drawSection();

    expect(tiles()).toEqual([BASELINE, RESTRICTED, CIS]);

    const baseline: HTMLElement = within(
      screen.getByTestId(`${KUBERNETES_COMPLIANCE_TEST_ID}-frameworks`),
    ).getAllByTestId("data-security-compliance-framework")[0]!;

    // kube-proxy fails Host Namespaces and Privileged Containers.
    expect(baseline).toHaveTextContent("2 workloads evaluated");
    expect(baseline).toHaveTextContent("controls failing");
  });

  test("a framework picked lists its controls, failing first, each saying what is wrong, how to fix it and which workloads fail it", async () => {
    await drawSection();
    await pick(BASELINE);

    // The two that fail first, then the rest in the standard's order.
    expect(listedControls().slice(0, 3)).toEqual([
      "Host Namespaces",
      "Privileged Containers",
      "HostProcess",
    ]);
    expect(listedControls()).toHaveLength(11);

    const privileged: HTMLElement = screen.getByTestId(
      `${KUBERNETES_COMPLIANCE_TEST_ID}-control-Privileged Containers`,
    );

    expect(privileged).toHaveTextContent("Containers must not run privileged");
    expect(privileged).toHaveTextContent("How to fix");
    expect(privileged).toHaveTextContent(
      "Remove securityContext.privileged, or set it to false",
    );
    expect(privileged).toHaveTextContent("1 workload");
    expect(privileged).toHaveTextContent("2 pods");
    expect(privileged).toHaveTextContent("securityContext.privileged: true");

    // The workload opens its own page, in its namespace.
    const link: HTMLElement = within(privileged).getByRole("link", {
      name: "kube-system/kube-proxy",
    });
    const href: globalThis.URL = new globalThis.URL(
      link.getAttribute("href") || "",
      "https://oneuptime.example",
    );

    expect(href.pathname).toContain(
      `/kubernetes/${CLUSTER_ID.toString()}/daemonsets/kube-proxy`,
    );
    expect(href.searchParams.get("namespace")).toBe("kube-system");
  });

  test("names the container a field is of, and says when a field the control needs is not set", async () => {
    await drawSection();
    await pick(RESTRICTED);

    const nonRoot: HTMLElement = screen.getByTestId(
      `${KUBERNETES_COMPLIANCE_TEST_ID}-control-Running as Non-root`,
    );

    expect(nonRoot).toHaveTextContent(
      "securityContext.runAsNonRoot is not set",
    );
    expect(
      within(nonRoot).getByLabelText("Container kube-proxy"),
    ).toBeInTheDocument();

    /*
     * The sentence is one item of the chip's flex row (TranslatedSentenceInRowGuard):
     * its words and the field sit in one element, so no piece of it is an item
     * of its own, and nothing of it is loose in the row.
     */
    const chip: HTMLElement | null = within(nonRoot)
      .getByText("securityContext.runAsNonRoot")
      .closest("li");

    expect(chip).not.toBeNull();
    expect(chip!.lastElementChild).toHaveTextContent(
      "securityContext.runAsNonRoot is not set",
    );
    expect(
      Array.from(chip!.childNodes).every((node: ChildNode): boolean => {
        return node.nodeType === globalThis.Node.ELEMENT_NODE;
      }),
    ).toBe(true);
  });

  test("a control many workloads fail shows the first few, then all, and says which way it is", async () => {
    const batchPods: Array<KubernetesCompliancePod> = [];

    for (let index: number = 0; index < FINDINGS_SHOWN + 3; index++) {
      batchPods.push(
        pod(
          "batch",
          `job-${index}-x`,
          { kind: "Job", name: `job-${index}` },
          PRIVILEGED,
        ),
      );
    }

    complianceSpy.mockResolvedValue(
      answerOf({ snapshot: snapshotOf(batchPods) }),
    );

    await drawSection();
    await pick(BASELINE);

    const findings: () => HTMLElement = (): HTMLElement => {
      return screen.getByTestId(
        `${KUBERNETES_COMPLIANCE_TEST_ID}-findings-Privileged Containers`,
      );
    };
    const toggle: HTMLElement = screen.getByTestId(
      `${KUBERNETES_COMPLIANCE_TEST_ID}-show-all-Privileged Containers`,
    );

    expect(within(findings()).getAllByRole("listitem").length).toBeGreaterThan(
      0,
    );
    expect(findings().querySelectorAll(":scope > li")).toHaveLength(
      FINDINGS_SHOWN,
    );
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveTextContent(`Show all ${FINDINGS_SHOWN + 4}`);

    await press(
      `${KUBERNETES_COMPLIANCE_TEST_ID}-show-all-Privileged Containers`,
    );

    expect(findings().querySelectorAll(":scope > li")).toHaveLength(
      FINDINGS_SHOWN + 4,
    );
    expect(
      screen.getByTestId(
        `${KUBERNETES_COMPLIANCE_TEST_ID}-show-all-Privileged Containers`,
      ),
    ).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByTestId(
        `${KUBERNETES_COMPLIANCE_TEST_ID}-show-all-Privileged Containers`,
      ),
    ).toHaveTextContent("Show fewer");
  });
});

describe("its switches", () => {
  test("turning a control off makes this cluster's setting for it, says so and reads the scores again", async () => {
    await drawSection();
    await pick(BASELINE);
    await press(
      `${KUBERNETES_COMPLIANCE_TEST_ID}-applies-${BASELINE}-Privileged Containers`,
    );

    expect(createSpy).toHaveBeenCalledTimes(1);

    const made: DataSecurityComplianceSetting = (
      createSpy.mock.calls[0]![0] as { model: DataSecurityComplianceSetting }
    ).model;

    expect(made.projectId?.toString()).toBe(PROJECT_ID);
    expect(made.resourceType).toBe(DataStoreResourceKind.KubernetesCluster);
    expect(made.resourceId?.toString()).toBe(CLUSTER_ID.toString());
    expect(made.framework).toBe(BASELINE);
    expect(made.requirement).toBe("Privileged Containers");
    expect(made.namespace).toBeUndefined();
    expect(made.isEnabled).toBe(false);
    expect(toastSpy).toHaveBeenCalledWith("Changes saved");
    expect(complianceSpy).toHaveBeenCalledTimes(2);
  });

  test("turning a namespace off makes a setting that names it, as Pod Security Admission exempts one", async () => {
    await drawSection();
    await pick(BASELINE);

    // Folded, it says what it holds.
    expect(
      screen.getByTestId(`${KUBERNETES_COMPLIANCE_TEST_ID}-namespaces`),
    ).toHaveTextContent("Every namespace applies");

    await openFold(`${KUBERNETES_COMPLIANCE_TEST_ID}-namespaces`);

    // A namespace says the level it enforces, and how many of its workloads fail.
    expect(
      screen.getByTestId(`${KUBERNETES_COMPLIANCE_TEST_ID}-namespace-payments`),
    ).toHaveTextContent("Enforces restricted");
    expect(
      screen.getByTestId(
        `${KUBERNETES_COMPLIANCE_TEST_ID}-namespace-kube-system`,
      ),
    ).toHaveTextContent("1 failing");

    await press(
      `${KUBERNETES_COMPLIANCE_TEST_ID}-applies-${BASELINE}-namespace-kube-system`,
    );

    const made: DataSecurityComplianceSetting = (
      createSpy.mock.calls[0]![0] as { model: DataSecurityComplianceSetting }
    ).model;

    expect(made.framework).toBe(BASELINE);
    expect(made.namespace).toBe("kube-system");
    expect(made.requirement).toBeUndefined();
    expect(made.isEnabled).toBe(false);
  });

  test("a namespace turned off says who turned it off and why, and turning it on again changes its setting", async () => {
    const setting: DataSecurityComplianceSetting =
      new DataSecurityComplianceSetting(SETTING_ID);
    setting.framework = BASELINE;
    setting.namespace = "kube-system";
    setting.isEnabled = false;
    rows = [setting];
    complianceSpy.mockResolvedValue(
      answerOf({
        settings: [
          {
            framework: BASELINE,
            requirement: "",
            namespace: "kube-system",
            isEnabled: false,
          },
        ],
        turnedOff: [
          {
            id: SETTING_ID.toString(),
            framework: BASELINE,
            resource: {
              kind: DataStoreResourceKind.KubernetesCluster,
              id: CLUSTER_ID.toString(),
              name: "prod-eu",
            },
            requirement: null,
            namespace: "kube-system",
            note: "System components run privileged.",
            turnedOffAt: "2026-11-12T09:00:00.000Z",
            turnedOffBy: "Jane Doe",
          },
        ],
      }),
    );

    await drawSection();
    await pick(BASELINE);

    // kube-system is left out: Baseline passes.
    expect(
      screen.getByTestId(`${KUBERNETES_COMPLIANCE_TEST_ID}-framework`),
    ).toHaveTextContent("100");

    await openFold(`${KUBERNETES_COMPLIANCE_TEST_ID}-namespaces`);

    const note: HTMLElement = screen.getByTestId(
      `${KUBERNETES_COMPLIANCE_TEST_ID}-namespace-turned-off-kube-system`,
    );

    expect(note).toHaveTextContent("Jane Doe");
    expect(note).toHaveTextContent("System components run privileged.");
    expect(
      screen.getByTestId(
        `${KUBERNETES_COMPLIANCE_TEST_ID}-applies-${BASELINE}-namespace-kube-system`,
      ),
    ).toHaveAttribute("aria-checked", "false");

    await press(
      `${KUBERNETES_COMPLIANCE_TEST_ID}-applies-${BASELINE}-namespace-kube-system`,
    );

    expect(createSpy).not.toHaveBeenCalled();
    expect(updateSpy).toHaveBeenCalledWith({
      modelType: DataSecurityComplianceSetting,
      id: SETTING_ID,
      data: { isEnabled: true },
    });
  });

  test("a control turned off for the cluster reads Turned off, in grey, its switch off", async () => {
    complianceSpy.mockResolvedValue(
      answerOf({
        settings: [
          {
            framework: BASELINE,
            requirement: "Privileged Containers",
            namespace: "",
            isEnabled: false,
          },
        ],
      }),
    );

    await drawSection();
    await pick(BASELINE);

    expect(
      screen.getByTestId(
        `${KUBERNETES_COMPLIANCE_TEST_ID}-applies-${BASELINE}-Privileged Containers`,
      ),
    ).toHaveAttribute("aria-checked", "false");

    const chip: HTMLElement = within(
      screen
        .getByTestId(
          `${KUBERNETES_COMPLIANCE_TEST_ID}-control-Privileged Containers`,
        )
        .closest("tr") as HTMLElement,
    ).getByText(ComplianceRequirementStatus.TurnedOff);

    expect(chip.closest("[data-tone]")).toHaveAttribute("data-tone", "paused");
    // Turned off controls come last.
    const controls: Array<string> = listedControls();

    expect(controls[controls.length - 1]).toBe("Privileged Containers");
  });

  test("a framework turned off for the cluster folds away below, with its switch", async () => {
    complianceSpy.mockResolvedValue(
      answerOf({
        settings: [
          {
            framework: RESTRICTED,
            requirement: "",
            namespace: "",
            isEnabled: false,
          },
        ],
      }),
    );

    await drawSection();

    expect(tiles()).toEqual([BASELINE, CIS]);
    expect(
      screen.getByTestId(`${KUBERNETES_COMPLIANCE_TEST_ID}-turned-off`),
    ).toHaveTextContent(RESTRICTED);
  });

  test("a reader who may not change them sees every switch locked", async () => {
    canChange = false;

    await drawSection();
    await pick(BASELINE);

    const control: HTMLElement = screen.getByTestId(
      `${KUBERNETES_COMPLIANCE_TEST_ID}-applies-${BASELINE}-Privileged Containers`,
    );

    // Locked, and still reachable, so its tooltip says why.
    expect(control).toHaveAttribute("aria-disabled", "true");

    await press(
      `${KUBERNETES_COMPLIANCE_TEST_ID}-applies-${BASELINE}-Privileged Containers`,
    );

    expect(createSpy).not.toHaveBeenCalled();
  });
});

describe("the CIS benchmark", () => {
  test("says plainly which controls are not scored here, and why, never as passing or failing", async () => {
    await drawSection();
    await pick(CIS);

    // Folded, it says how many.
    expect(
      screen.getByTestId(`${KUBERNETES_COMPLIANCE_TEST_ID}-not-scored`),
    ).toHaveTextContent("104 controls not scored here");

    await openFold(`${KUBERNETES_COMPLIANCE_TEST_ID}-not-scored`);

    const fold: HTMLElement = screen.getByTestId(
      `${KUBERNETES_COMPLIANCE_TEST_ID}-not-scored`,
    );

    expect(
      screen.getByTestId(
        `${KUBERNETES_COMPLIANCE_TEST_ID}-not-scored-NodeAccess`,
      ),
    ).toHaveTextContent("Kubelet");
    expect(
      screen.getByTestId(
        `${KUBERNETES_COMPLIANCE_TEST_ID}-not-scored-ControlPlaneAccess`,
      ),
    ).toHaveTextContent("API server");
    expect(
      screen.getByTestId(`${KUBERNETES_COMPLIANCE_TEST_ID}-not-scored-Manual`),
    ).toHaveTextContent("client certificates");
    expect(
      screen.getByTestId(
        `${KUBERNETES_COMPLIANCE_TEST_ID}-managed-control-plane`,
      ),
    ).toHaveTextContent("EKS runs this cluster's control plane");
    expect(within(fold).queryByText("Passing")).not.toBeInTheDocument();
    expect(within(fold).queryByText("Failing")).not.toBeInTheDocument();
  });

  test("an agent that sends no RBAC is told once what it takes, and its controls are not evaluated", async () => {
    await drawSection();
    await pick(CIS);

    expect(
      screen.getAllByTestId(
        `${KUBERNETES_COMPLIANCE_TEST_ID}-not-evaluated-PolicyObjectsNotRead`,
      ),
    ).toHaveLength(1);
    expect(
      screen.getByTestId(
        `${KUBERNETES_COMPLIANCE_TEST_ID}-not-evaluated-PolicyObjectsNotRead`,
      ),
    ).toHaveTextContent("resourceSpecs.compliance");
    // A CIS control is named by its number.
    expect(listedControls()).toContain("5.2.2");
  });

  /*
   * The OneUptime agent's own binding fails 5.1.10 where its role still grants
   * nodes/proxy (#9878): the page says the binding is the agent's, why it
   * asks, as the role's label says, and the value that drops it.
   */
  function agentSnapshot(options: {
    reasons?: string;
    isAgents?: boolean;
  }): KubernetesComplianceSnapshot {
    const agentLabels: Record<string, string> = {
      "helm.sh/chart": "kubernetes-agent-16.2.0",
      "app.kubernetes.io/part-of": "oneuptime",
    };

    return {
      ...snapshotOf(),
      hasPolicyObjects: true,
      roles: [
        {
          kind: "ClusterRole",
          namespace: "",
          name: "oneuptime-agent",
          labels:
            options.reasons === undefined
              ? agentLabels
              : {
                  ...agentLabels,
                  "oneuptime.com/nodes-proxy": options.reasons,
                },
          spec: {
            rules: [
              {
                apiGroups: [""],
                resources: ["nodes/proxy"],
                verbs: ["get"],
              },
            ],
          },
        },
      ],
      bindings: [
        {
          kind: "ClusterRoleBinding",
          namespace: "",
          name: "oneuptime-agent",
          labels: options.isAgents === false ? {} : agentLabels,
          spec: {
            roleRef: { kind: "ClusterRole", name: "oneuptime-agent" },
            subjects: [
              {
                kind: "ServiceAccount",
                name: "oneuptime-agent",
                namespace: "oneuptime-agent",
              },
            ],
          },
        },
      ],
    };
  }

  async function drawAgentFinding(
    snapshot: KubernetesComplianceSnapshot,
  ): Promise<HTMLElement> {
    complianceSpy.mockResolvedValue(
      answerOf({ snapshot, extra: { hasPolicyObjects: true } }),
    );

    await drawSection();
    await pick(CIS);

    return screen.getByTestId(
      `${KUBERNETES_COMPLIANCE_TEST_ID}-findings-5.1.10`,
    );
  }

  test("the OneUptime agent's own binding says whose it is, why its role grants nodes/proxy and the value that drops it", async () => {
    const findings: HTMLElement = await drawAgentFinding(
      agentSnapshot({ reasons: "kubelet-pods" }),
    );
    const note: HTMLElement = within(findings).getByTestId(
      `${KUBERNETES_COMPLIANCE_TEST_ID}-agent-binding`,
    );

    expect(note).toHaveTextContent(
      "This binding is the OneUptime Kubernetes agent's own.",
    );
    expect(note).toHaveTextContent(
      "A kubelet older than Kubernetes 1.33 lets the agent read its node's pods only through nodes/proxy. Once every node runs 1.33 or later, upgrade the agent with --set kubeletstats.nodesProxy=false.",
    );
    // The value is code, drawn as written in every language.
    expect(
      within(note).getByText("--set kubeletstats.nodesProxy=false").tagName,
    ).toBe("CODE");
    expect(note).not.toHaveTextContent("cost Prometheus");
    expect(note).not.toHaveTextContent("newer versions");
  });

  test("names the cost Prometheus too when the role says it needs nodes/proxy", async () => {
    const note: HTMLElement = within(
      await drawAgentFinding(
        agentSnapshot({ reasons: "kubelet-pods.cost-prometheus" }),
      ),
    ).getByTestId(`${KUBERNETES_COMPLIANCE_TEST_ID}-agent-binding`);

    expect(
      within(note).getByText("--set kubeletstats.nodesProxy=false"),
    ).toBeInTheDocument();
    expect(note).toHaveTextContent(
      "The agent's cost Prometheus reads each node's cAdvisor through the API server, as EKS Fargate needs. Where pods can reach each node's kubelet, upgrade the agent with --set cost.prometheus.nodesProxy=false.",
    );
  });

  test("a role from a chart before the label says upgrading the agent drops it", async () => {
    const note: HTMLElement = within(
      await drawAgentFinding(agentSnapshot({})),
    ).getByTestId(`${KUBERNETES_COMPLIANCE_TEST_ID}-agent-binding`);

    expect(note).toHaveTextContent(
      "This binding is the OneUptime Kubernetes agent's own.",
    );
    expect(note).toHaveTextContent(
      "Upgrade the agent: newer versions grant nodes/proxy only where a node's kubelet needs it.",
    );
    expect(within(note).queryByText(/--set/)).not.toBeInTheDocument();
  });

  test("a binding someone else made says nothing of the agent", async () => {
    const findings: HTMLElement = await drawAgentFinding(
      agentSnapshot({ reasons: "kubelet-pods", isAgents: false }),
    );

    expect(findings).toHaveTextContent("get nodes/proxy");
    expect(
      within(findings).queryByTestId(
        `${KUBERNETES_COMPLIANCE_TEST_ID}-agent-binding`,
      ),
    ).not.toBeInTheDocument();
  });
});

/*
 * A control's switch, named to a screen reader: a Pod Security Standards
 * control by its title in the reader's language (its requirement is the
 * standard's English name), a CIS control by its number.
 */
describe("a control's switch", () => {
  function dashboardTranslator(language: string): Translator {
    const words: Record<string, unknown> =
      language === "en"
        ? {}
        : (JSON.parse(
            fs.readFileSync(
              path.join(
                __dirname,
                "../../../../App/FeatureSet/Dashboard/src/Locales",
                `${language}.json`,
              ),
              "utf8",
            ),
          ) as Record<string, unknown>);

    return createTranslator((key: string): string => {
      const value: unknown = words[key];

      return typeof value === "string" ? value : key;
    }, language);
  }

  function row(requirement: string): KubernetesComplianceRequirementResult {
    return {
      requirement,
      title: requirement,
      status: ComplianceRequirementStatus.Passing,
      failingCount: 0,
      findings: [],
      turnedOffNamespaces: [],
    } as unknown as KubernetesComplianceRequirementResult;
  }

  test("names a Pod Security Standards control by its title in the reader's language, and a CIS control by its number", () => {
    const english: Translator = dashboardTranslator("en");
    const german: Translator = dashboardTranslator("de");
    const japanese: Translator = dashboardTranslator("ja");

    expect(
      getSwitchControlName(BASELINE, row("Privileged Containers"), english),
    ).toBe("Privileged Containers");
    expect(
      getSwitchControlName(BASELINE, row("Privileged Containers"), german),
    ).toBe(german.translateText("Privileged Containers"));
    expect(
      getSwitchControlName(BASELINE, row("Privileged Containers"), german),
    ).not.toBe("Privileged Containers");
    // Linux's capabilities, by the key that names that meaning.
    expect(getSwitchControlName(BASELINE, row("Capabilities"), english)).toBe(
      "Capabilities",
    );
    expect(getSwitchControlName(BASELINE, row("Capabilities"), japanese)).toBe(
      "ケーパビリティ",
    );
    expect(getSwitchControlName(CIS, row("5.1.10"), japanese)).toBe("5.1.10");
  });

  test("labels each switch so, where the page draws it", async () => {
    await drawSection();
    await pick(BASELINE);

    expect(
      screen.getByTestId(
        `${KUBERNETES_COMPLIANCE_TEST_ID}-applies-${BASELINE}-Privileged Containers`,
      ),
    ).toHaveAttribute("aria-label", "Privileged Containers applies here");

    await pick(CIS);

    expect(
      screen.getByTestId(
        `${KUBERNETES_COMPLIANCE_TEST_ID}-applies-${CIS}-5.2.2`,
      ),
    ).toHaveAttribute("aria-label", "5.2.2 applies here");
  });
});

describe("what it cannot say yet", () => {
  test("a cluster whose agent reported no pods has nothing to score yet", async () => {
    complianceSpy.mockResolvedValue(
      answerOf({ snapshot: { ...snapshotOf(), pods: [] } }),
    );

    await drawSection();

    expect(screen.getByTestId(KUBERNETES_COMPLIANCE_TEST_ID)).toHaveTextContent(
      "Nothing to score yet",
    );
    expect(
      screen.queryByTestId(`${KUBERNETES_COMPLIANCE_TEST_ID}-frameworks`),
    ).not.toBeInTheDocument();
  });

  test("pods not read yet are counted, and the version scored against is said", async () => {
    complianceSpy.mockResolvedValue(
      answerOf({ extra: { podCount: 5, podsRead: 3 } }),
    );

    await drawSection();
    await pick(BASELINE);

    expect(
      screen.getByTestId(`${KUBERNETES_COMPLIANCE_TEST_ID}-note-unread`),
    ).toHaveTextContent("2 pods are scored at the agent's next report");
    expect(
      screen.getByTestId(`${KUBERNETES_COMPLIANCE_TEST_ID}-note-version`),
    ).toHaveTextContent("Kubernetes 1.31, this cluster's version");
  });

  test("a read that fails says why, and reads again when asked", async () => {
    complianceSpy.mockRejectedValueOnce(
      new Error("This cluster could not be found."),
    );

    await drawSection();

    expect(screen.queryByTestId(KUBERNETES_COMPLIANCE_TEST_ID)).toBeNull();
    expect(
      screen.getByText("This cluster could not be found."),
    ).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });

    expect(complianceSpy).toHaveBeenCalledTimes(2);
    expect(tiles()).toEqual([BASELINE, RESTRICTED, CIS]);
  });
});

describe("its exports", () => {
  test("exports the framework's report as CSV, with what fails it and how to fix it", async () => {
    const csvSpy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(TableColumnsToCsv, "downloadCsv")
      .mockImplementation(() => {});

    await drawSection();
    await pick(BASELINE);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Export CSV/ }));
    });

    const csv: string = (csvSpy.mock.calls[0]![0] as { csv: string }).csv;

    expect(csv).toContain("PSS Baseline,Privileged Containers");
    expect(csv).toContain(
      "DaemonSet kube-system/kube-proxy (2 pods): kube-proxy: securityContext.privileged=true",
    );
    expect(csv).toContain("Remove securityContext.privileged");
  });

  test("exports it as JSON, with the cluster's version and every control's findings", async () => {
    await drawSection();
    await pick(BASELINE);

    // A lesser action: in the card's ⋯.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "More options" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Export JSON"));
    });

    expect(mockDownloadFile).toHaveBeenCalledTimes(1);

    const report: JSONObject = JSON.parse(
      (mockDownloadFile.mock.calls[0]![0] as { content: string }).content,
    ) as JSONObject;

    expect(report["framework"]).toBe(BASELINE);
    expect(report["standardVersion"]).toBe("1.31");
    expect(
      (report["requirements"] as Array<JSONObject>).find(
        (requirement: JSONObject): boolean => {
          return requirement["requirement"] === "Privileged Containers";
        },
      )?.["failingCount"],
    ).toBe(1);
  });
});
