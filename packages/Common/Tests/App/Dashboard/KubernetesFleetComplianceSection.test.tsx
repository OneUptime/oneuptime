import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
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

import KubernetesFleetComplianceSection, {
  KUBERNETES_FLEET_COMPLIANCE_TEST_ID,
  getFailingControlLabel,
  toFleetCluster,
} from "../../../../App/FeatureSet/Dashboard/src/Components/KubernetesCompliance/KubernetesFleetComplianceSection";
import KubernetesCompliance from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Compliance";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import { KubernetesComplianceFramework } from "../../../Types/Kubernetes/Compliance/KubernetesComplianceFramework";
import {
  KUBERNETES_COMPLIANCE_SUMMARY_VERSION,
  KubernetesComplianceFrameworkSummary,
  KubernetesComplianceSummary,
} from "../../../Types/Kubernetes/Compliance/KubernetesComplianceSummary";
import { createTranslator } from "../../../Types/Translator";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import TableColumnsToCsv from "../../../UI/Utils/TableColumnsToCsv";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

/*
 * KUBERNETES > COMPLIANCE (#9876): every cluster's hardening on one page,
 * read from the summary each cluster's record keeps - each framework's
 * score and failing controls, the lowest score first, how fresh the scores
 * are, each cluster linked to its own Compliance page, and the project's
 * export. A project with no cluster is told so, with the way to add one.
 */

const BASELINE: string = KubernetesComplianceFramework.PssBaseline;
const RESTRICTED: string = KubernetesComplianceFramework.PssRestricted;
const CIS: string = KubernetesComplianceFramework.CisKubernetes;

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * 60000);
}

function framework(
  name: string,
  score: number | null,
  failing: Array<[string, number]> = [],
  isTurnedOff: boolean = false,
): KubernetesComplianceFrameworkSummary {
  return {
    framework: name,
    fullName: `${name} in full`,
    score,
    isTurnedOff,
    controlsEvaluated: 10,
    controlsPassing: 10 - failing.length,
    controlsNotEvaluated: 0,
    workloadsEvaluated: 14,
    workloadsPassing: 10,
    workloadsFromTemplates: 0,
    acceptedCount: 0,
    failingControls: failing.map(
      ([requirement, failingCount]: [string, number]) => {
        return { requirement, title: requirement, failingCount };
      },
    ),
  };
}

function summary(
  frameworks: Array<KubernetesComplianceFrameworkSummary>,
  refreshedAt: Date,
): KubernetesComplianceSummary {
  return {
    version: KUBERNETES_COMPLIANCE_SUMMARY_VERSION,
    refreshedAt: refreshedAt.toISOString(),
    kubernetesVersion: "1.31",
    podCount: 40,
    workloadCount: 14,
    frameworks,
  };
}

function clusterOf(
  id: string,
  name: string,
  complianceSummary: KubernetesComplianceSummary | null,
  isConnected: boolean = true,
): KubernetesCluster {
  const cluster: KubernetesCluster = new KubernetesCluster();
  cluster.id = new ObjectID(id);
  cluster.name = name;
  cluster.otelCollectorStatus = isConnected ? "connected" : "disconnected";
  cluster.lastSeenAt = minutesAgo(1);

  if (complianceSummary) {
    cluster.complianceSummary = complianceSummary;
    cluster.complianceSummaryRefreshedAt = new Date(
      complianceSummary.refreshedAt,
    );
  }

  return cluster;
}

const PROD_EU: string = "11111111-0000-4000-8000-000000000001";
const PROD_US: string = "11111111-0000-4000-8000-000000000002";
const NEW_CLUSTER: string = "11111111-0000-4000-8000-000000000003";
const EDGE: string = "11111111-0000-4000-8000-000000000004";

let clusters: Array<KubernetesCluster>;
let listSpy: SpyInstance<typeof ModelAPI.getList>;

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}/kubernetes/compliance`);
  clusters = [
    clusterOf(
      PROD_US,
      "prod-us",
      summary(
        [
          framework(BASELINE, 100),
          framework(RESTRICTED, 80, [["Seccomp", 1]]),
          framework(CIS, 95),
        ],
        minutesAgo(4),
      ),
    ),
    clusterOf(NEW_CLUSTER, "new-cluster", null),
    clusterOf(
      PROD_EU,
      "prod-eu",
      summary(
        [
          framework(BASELINE, 90, [["Privileged Containers", 2]]),
          framework(RESTRICTED, 40, [
            ["Running as Non-root", 9],
            ["Seccomp", 4],
          ]),
          framework(CIS, 70, [["5.1.1", 1]]),
        ],
        minutesAgo(6),
      ),
    ),
    clusterOf(
      EDGE,
      "edge",
      summary(
        [framework(BASELINE, 100), framework(CIS, null, [], true)],
        minutesAgo(2),
      ),
      false,
    ),
  ];
  listSpy = jest.spyOn(ModelAPI, "getList").mockImplementation((async () => {
    return { data: clusters, count: clusters.length, skip: 0, limit: 500 };
  }) as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function drawPage(): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter>
        <KubernetesFleetComplianceSection />
      </MemoryRouter>,
    );
  });
}

function rowNames(): Array<string> {
  return screen
    .getAllByRole("row")
    .slice(1)
    .map((row: HTMLElement): string => {
      return within(row).queryAllByRole("link")[0]?.textContent || "";
    })
    .filter((name: string): boolean => {
      return Boolean(name);
    });
}

describe("every cluster's hardening", () => {
  test("reads the project's clusters with their summaries, as the reader may read them", async () => {
    await drawPage();

    expect(listSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        modelType: KubernetesCluster,
        query: { isArchived: false },
        select: expect.objectContaining({
          complianceSummary: true,
          complianceSummaryRefreshedAt: true,
          otelCollectorStatus: true,
          lastSeenAt: true,
        }),
      }),
    );
  });

  test("lists every cluster, the lowest score first, one not scored yet last", async () => {
    await drawPage();

    expect(rowNames()).toEqual(["prod-eu", "prod-us", "edge", "new-cluster"]);
  });

  test("a column per framework any cluster was scored against, each with its score and how many controls fail", async () => {
    await drawPage();

    const headers: Array<string> = screen
      .getAllByRole("columnheader")
      .map((header: HTMLElement): string => {
        return header.textContent || "";
      });

    expect(headers.join(" ")).toContain(BASELINE);
    expect(headers.join(" ")).toContain(RESTRICTED);
    expect(headers.join(" ")).toContain(CIS);

    const prodEu: HTMLElement = screen
      .getByRole("link", { name: "prod-eu" })
      .closest("tr") as HTMLElement;

    expect(prodEu).toHaveTextContent("40%");
    expect(prodEu).toHaveTextContent("2 controls failing");
    expect(prodEu).toHaveTextContent("1 control failing");
    expect(prodEu).toHaveTextContent("14");

    // A framework turned off for a cluster says so, in grey.
    const edge: HTMLElement = screen
      .getByRole("link", { name: "edge" })
      .closest("tr") as HTMLElement;

    expect(edge).toHaveTextContent("Turned off");
  });

  test("each cluster opens its own Compliance page", async () => {
    await drawPage();

    const link: HTMLElement = screen.getByRole("link", { name: "prod-eu" });

    expect(link.getAttribute("href") || "").toContain(
      `/kubernetes/${PROD_EU}/compliance`,
    );
  });

  test("says how fresh each cluster's scores are", async () => {
    await drawPage();

    const rowOf: (name: string) => HTMLElement = (name: string) => {
      return screen.getByRole("link", { name }).closest("tr") as HTMLElement;
    };

    expect(rowOf("prod-eu")).toHaveTextContent("Scored 6m ago");
    expect(rowOf("edge")).toHaveTextContent(
      "Agent disconnected: scores from its last report",
    );
    expect(rowOf("new-cluster")).toHaveTextContent(
      "Not scored yet: scored once its agent reports",
    );
  });

  test("a cluster whose scores are late says so", async () => {
    clusters = [
      clusterOf(
        PROD_EU,
        "prod-eu",
        summary([framework(BASELINE, 90)], minutesAgo(50)),
      ),
    ];

    await drawPage();

    expect(
      screen.getByRole("link", { name: "prod-eu" }).closest("tr"),
    ).toHaveTextContent("Scored 50m ago: later than it should be");
  });

  test("exports what it lists as CSV, every cluster's failing controls", async () => {
    const download: SpyInstance<typeof TableColumnsToCsv.downloadCsv> = jest
      .spyOn(TableColumnsToCsv, "downloadCsv")
      .mockReturnValue(undefined);

    await drawPage();
    await act(async () => {
      fireEvent.click(screen.getByText("Export CSV"));
    });

    expect(download).toHaveBeenCalledTimes(1);

    const csv: string = (download.mock.calls[0]![0] as { csv: string }).csv;

    expect(csv).toContain("prod-eu");
    expect(csv).toContain("5.1.1");
    expect(csv).toContain("Not scored yet");
  });
});

describe("a project with no cluster", () => {
  test("says there is none yet, what the page is for, and offers to add one", async () => {
    clusters = [];

    await drawPage();

    const empty: HTMLElement = screen.getByTestId(
      `${KUBERNETES_FLEET_COMPLIANCE_TEST_ID}-empty`,
    );

    expect(empty).toHaveTextContent("No Kubernetes clusters yet");
    expect(empty).toHaveTextContent(
      "Add a cluster to see how it stands against the Pod Security Standards and the CIS Kubernetes Benchmark",
    );
    expect(
      within(empty).getByRole("button", { name: "Add Kubernetes Cluster" }),
    ).toBeInTheDocument();
  });
});

describe("a read that fails", () => {
  test("says why, and reads again when asked", async () => {
    listSpy.mockRejectedValueOnce(new Error("The clusters could not be read."));

    await drawPage();

    expect(
      screen.getByTestId(KUBERNETES_FLEET_COMPLIANCE_TEST_ID),
    ).toHaveTextContent("The clusters could not be read.");
  });
});

describe("the page and its words", () => {
  test("the page draws the section", async () => {
    await act(async () => {
      render(
        <MemoryRouter>
          <KubernetesCompliance {...({} as never)} />
        </MemoryRouter>,
      );
    });

    expect(
      screen.getByTestId(KUBERNETES_FLEET_COMPLIANCE_TEST_ID),
    ).toBeInTheDocument();
  });

  test("a cluster with no name is named by its identifier", () => {
    const cluster: KubernetesCluster = new KubernetesCluster();
    cluster.id = new ObjectID(PROD_EU);
    cluster.clusterIdentifier = "arn:eks:prod";

    expect(toFleetCluster(cluster).name).toBe("arn:eks:prod");
  });

  test("the Fails filter names a CIS control by its number and title, a Pod Security Standards control by its title", () => {
    const translator: ReturnType<typeof createTranslator> = createTranslator(
      (key: string): string => {
        return key;
      },
    );

    expect(
      getFailingControlLabel(
        { framework: CIS, requirement: "5.1.1", title: "x" },
        translator,
      ),
    ).toMatch(/^CIS Kubernetes 5\.1\.1 · /);
    expect(
      getFailingControlLabel(
        {
          framework: BASELINE,
          requirement: "Privileged Containers",
          title: "Privileged Containers",
        },
        translator,
      ),
    ).toBe("PSS Baseline · Privileged Containers");
    // A framework OneUptime does not know yet keeps the summary's words.
    expect(
      getFailingControlLabel(
        {
          framework: "NSA/CISA Hardening",
          requirement: "NSA-3",
          title: "Non-root containers",
        },
        translator,
      ),
    ).toBe("NSA/CISA Hardening NSA-3 · Non-root containers");
  });
});
