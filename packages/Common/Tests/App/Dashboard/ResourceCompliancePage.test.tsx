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
import ResourceCompliancePage, {
  RESOURCE_COMPLIANCE_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceDataSecurity/ResourceCompliancePage";
import { COMPLIANCE_REASON_MAX_LENGTH } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceDataSecurity/ResourceComplianceModel";
import DataSecurityApi from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/DataSecurityApi";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import DataSecurityComplianceSetting from "../../../Models/DatabaseModels/DataSecurityComplianceSetting";
import Project from "../../../Models/DatabaseModels/Project";
import Route from "../../../Types/API/Route";
import ComplianceFramework, {
  ALL_COMPLIANCE_FRAMEWORKS,
  COMPLIANCE_FRAMEWORK_INFO,
} from "../../../Types/DataSecurity/ComplianceFramework";
import {
  ComplianceRequirementResult,
  ComplianceRequirementStatus,
  scoreComplianceFramework,
} from "../../../Types/DataSecurity/ComplianceRequirementCatalog";
import {
  DataSecurityComplianceTurnedOff,
  DataSecurityResourceComplianceFramework,
  DataSecurityResourceComplianceResponse,
} from "../../../Types/DataSecurity/DataSecurityApiTypes";
import { DataStoreResourceKind } from "../../../Types/DataSecurity/DataStoreResource";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import Toast from "../../../UI/Utils/Toast";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

/*
 * A RESOURCE'S COMPLIANCE PAGE (#9555): the frameworks its data puts in
 * scope as tiles, each requirement with where it stands and a switch, the
 * framework's own switch, and the frameworks turned off or out of scope
 * folded below. A switch saves when it is flipped - a setting made or
 * changed for this resource - and the scores are read again. A database on
 * a cluster is scored with the cluster's switches, and says where to
 * change them.
 */

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

const CLUSTER_ID: ObjectID = new ObjectID(
  "44444444-0000-4000-8000-000000000004",
);
const DATABASE_ID: ObjectID = new ObjectID(
  "55555555-0000-4000-8000-000000000005",
);
const SETTING_ID: ObjectID = new ObjectID(
  "66666666-0000-4000-8000-000000000006",
);
const HOST_ID: ObjectID = new ObjectID("77777777-0000-4000-8000-000000000007");

// One evaluated store holding card numbers, with a public bucket's issue.
function frameworksOf(data: {
  turnedOff?: Array<ComplianceFramework>;
  turnedOffRequirements?: Partial<Record<ComplianceFramework, Array<string>>>;
}): Array<DataSecurityResourceComplianceFramework> {
  return ALL_COMPLIANCE_FRAMEWORKS.map(
    (
      framework: ComplianceFramework,
    ): DataSecurityResourceComplianceFramework => {
      const isTurnedOff: boolean = (data.turnedOff || []).includes(framework);
      const scored: ReturnType<typeof scoreComplianceFramework> =
        scoreComplianceFramework(
          framework,
          [
            {
              id: "orders",
              dataTypeIds: ["credit-card-number"],
              isEvaluated: true,
            },
          ],
          [{ storeId: "orders", checkId: "public-read" }],
          isTurnedOff ? { storeIds: new Set(["orders"]) } : undefined,
        );

      return {
        ...scored,
        fullName: COMPLIANCE_FRAMEWORK_INFO[framework].fullName,
        scope: COMPLIANCE_FRAMEWORK_INFO[framework].scope,
        isTurnedOff,
        turnedOffRequirements:
          (data.turnedOffRequirements || {})[framework] || [],
      };
    },
  );
}

function answerOf(
  extra: Partial<DataSecurityResourceComplianceResponse> = {},
): DataSecurityResourceComplianceResponse {
  return {
    kind: DataStoreResourceKind.KubernetesCluster,
    id: CLUSTER_ID.toString(),
    name: "prod-eu",
    storeCount: 1,
    complianceOwner: null,
    frameworks: frameworksOf({ turnedOff: [ComplianceFramework.SOC2] }),
    ...extra,
  };
}

let complianceSpy: SpyInstance<typeof DataSecurityApi.getResourceCompliance>;
let rowsSpy: ReturnType<typeof jest.spyOn>;
let createSpy: ReturnType<typeof jest.spyOn>;
let updateSpy: ReturnType<typeof jest.spyOn>;
let toastSpy: SpyInstance<typeof Toast.success>;
let rows: Array<DataSecurityComplianceSetting>;
let canCreate: boolean;

function compliancePageOf(id: ObjectID, page: PageMap): string {
  return RouteUtil.populateRouteParams(RouteMap[page] as Route, {
    modelId: id,
  }).toString();
}

beforeEach(() => {
  rows = [];
  canCreate = true;
  goTo(`/dashboard/${PROJECT_ID}/kubernetes`);
  goTo(
    compliancePageOf(CLUSTER_ID, PageMap.KUBERNETES_CLUSTER_VIEW_COMPLIANCE),
  );
  complianceSpy = jest
    .spyOn(DataSecurityApi, "getResourceCompliance")
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
    return canCreate
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

// The page as a project's page: it reads its resource from the address.
function project(): Project {
  const value: Project = new Project();
  value.id = new ObjectID(PROJECT_ID);
  return value;
}

async function drawPage(
  kind: DataStoreResourceKind = DataStoreResourceKind.KubernetesCluster,
): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter>
        <ResourceCompliancePage
          kind={kind}
          pageRoute={
            RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_COMPLIANCE] as Route
          }
          currentProject={project()}
          hasPaymentMethod={true}
        />
      </MemoryRouter>,
    );
  });
}

function tiles(): Array<string> {
  return within(screen.getByTestId(`${RESOURCE_COMPLIANCE_TEST_ID}-frameworks`))
    .getAllByTestId("data-security-compliance-framework")
    .map((tile: HTMLElement): string => {
      return tile.querySelector("span")?.textContent || "";
    });
}

async function pick(framework: ComplianceFramework): Promise<void> {
  const tile: HTMLElement | undefined = within(
    screen.getByTestId(`${RESOURCE_COMPLIANCE_TEST_ID}-frameworks`),
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

async function flip(testId: string): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByTestId(testId));
  });
}

describe("a cluster's Compliance page", () => {
  test("asks for the cluster's compliance, and the switches set on it", async () => {
    await drawPage();

    expect(complianceSpy).toHaveBeenCalledWith({
      kind: DataStoreResourceKind.KubernetesCluster,
      id: CLUSTER_ID,
    });
    expect(rowsSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        modelType: DataSecurityComplianceSetting,
        query: expect.objectContaining({
          resourceType: DataStoreResourceKind.KubernetesCluster,
          resourceId: CLUSTER_ID,
        }),
      }),
    );
  });

  test("puts the frameworks its data puts in scope first, and folds the rest away", async () => {
    await drawPage();

    // Card numbers: PCI DSS, the privacy laws that cover them, the security frameworks - SOC 2 is off.
    expect(tiles()).toContain(ComplianceFramework.PCIDSS);
    expect(tiles()).toContain(ComplianceFramework.ISO27001);
    expect(tiles()).not.toContain(ComplianceFramework.SOC2);
    expect(tiles()).not.toContain(ComplianceFramework.HIPAA);

    const fold: HTMLElement = screen.getByTestId(
      `${RESOURCE_COMPLIANCE_TEST_ID}-fold`,
    );

    // The fold names what it holds while folded, the one turned off first.
    expect(fold).toHaveTextContent("Turned Off and Not in Scope");
    expect(fold).toHaveTextContent(ComplianceFramework.SOC2);
    expect(fold).toHaveTextContent(ComplianceFramework.HIPAA);
  });

  test("a framework picked lists every requirement, each with where it stands and a switch", async () => {
    await drawPage();
    await pick(ComplianceFramework.PCIDSS);

    const failing: HTMLElement = screen.getByTestId(
      `${RESOURCE_COMPLIANCE_TEST_ID}-applies-${ComplianceFramework.PCIDSS}-7.2`,
    );

    expect(failing).toHaveAttribute("role", "switch");
    expect(failing).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("Failing")).toBeInTheDocument();

    // Its open issues open the cluster's own Data Security page, narrowed to the requirement's checks.
    const link: HTMLElement = screen.getByRole("link", {
      name: "1 open issue",
    });
    const href: globalThis.URL = new globalThis.URL(
      link.getAttribute("href") || "",
      "https://oneuptime.example",
    );

    expect(href.pathname).toBe(
      compliancePageOf(
        CLUSTER_ID,
        PageMap.KUBERNETES_CLUSTER_VIEW_DATA_SECURITY,
      ),
    );
    expect(decodeURIComponent(href.search)).toContain("public-read");
  });

  test("turning a requirement off makes this cluster's setting, says so and reads the scores again", async () => {
    await drawPage();
    await pick(ComplianceFramework.PCIDSS);
    await flip(
      `${RESOURCE_COMPLIANCE_TEST_ID}-applies-${ComplianceFramework.PCIDSS}-7.2`,
    );

    expect(createSpy).toHaveBeenCalledTimes(1);

    const made: DataSecurityComplianceSetting = (
      createSpy.mock.calls[0]![0] as { model: DataSecurityComplianceSetting }
    ).model;

    expect(made.projectId?.toString()).toBe(PROJECT_ID);
    expect(made.resourceType).toBe(DataStoreResourceKind.KubernetesCluster);
    expect(made.resourceId?.toString()).toBe(CLUSTER_ID.toString());
    expect(made.framework).toBe(ComplianceFramework.PCIDSS);
    expect(made.requirement).toBe("7.2");
    expect(made.isEnabled).toBe(false);
    expect(toastSpy).toHaveBeenCalledWith("Changes saved");
    expect(complianceSpy).toHaveBeenCalledTimes(2);
  });

  test("turning the framework off makes a setting for the whole framework", async () => {
    await drawPage();
    await pick(ComplianceFramework.PCIDSS);
    await flip(
      `${RESOURCE_COMPLIANCE_TEST_ID}-applies-${ComplianceFramework.PCIDSS}`,
    );

    const made: DataSecurityComplianceSetting = (
      createSpy.mock.calls[0]![0] as { model: DataSecurityComplianceSetting }
    ).model;

    expect(made.framework).toBe(ComplianceFramework.PCIDSS);
    expect(made.requirement).toBeUndefined();
    expect(made.isEnabled).toBe(false);
  });

  test("turning a framework on again changes its setting, rather than making another", async () => {
    const setting: DataSecurityComplianceSetting =
      new DataSecurityComplianceSetting(SETTING_ID);
    setting.framework = ComplianceFramework.SOC2;
    setting.isEnabled = false;
    rows = [setting];

    await drawPage();
    await flip(
      `${RESOURCE_COMPLIANCE_TEST_ID}-applies-${ComplianceFramework.SOC2}`,
    );

    expect(createSpy).not.toHaveBeenCalled();
    expect(updateSpy).toHaveBeenCalledWith({
      modelType: DataSecurityComplianceSetting,
      id: SETTING_ID,
      data: { isEnabled: true },
    });
  });

  test("a requirement turned off reads Turned off, its switch off", async () => {
    complianceSpy.mockResolvedValue(
      answerOf({
        frameworks: frameworksOf({
          turnedOffRequirements: { [ComplianceFramework.PCIDSS]: ["7.2"] },
        }).map(
          (
            framework: DataSecurityResourceComplianceFramework,
          ): DataSecurityResourceComplianceFramework => {
            return framework.framework === ComplianceFramework.PCIDSS
              ? {
                  ...framework,
                  requirements: framework.requirements.map(
                    (
                      requirement: ComplianceRequirementResult,
                    ): ComplianceRequirementResult => {
                      return requirement.requirement === "7.2"
                        ? {
                            ...requirement,
                            status: ComplianceRequirementStatus.TurnedOff,
                            failingIssueCount: 0,
                          }
                        : requirement;
                    },
                  ),
                }
              : framework;
          },
        ),
      }),
    );

    await drawPage();
    await pick(ComplianceFramework.PCIDSS);

    expect(
      screen.getByTestId(
        `${RESOURCE_COMPLIANCE_TEST_ID}-applies-${ComplianceFramework.PCIDSS}-7.2`,
      ),
    ).toHaveAttribute("aria-checked", "false");
    // Someone chose it: a grey Paused chip, never a red one.
    const chip: HTMLElement = screen.getByText("Turned off");
    expect(chip.closest("[data-tone]")).toHaveAttribute("data-tone", "paused");
  });

  test("a save that fails says why, and changes nothing", async () => {
    createSpy.mockRejectedValue(
      new Error("This resource is not in this project.") as never,
    );

    await drawPage();
    await pick(ComplianceFramework.PCIDSS);
    await flip(
      `${RESOURCE_COMPLIANCE_TEST_ID}-applies-${ComplianceFramework.PCIDSS}-7.2`,
    );

    expect(toastSpy).not.toHaveBeenCalled();
    expect(
      screen.getByTestId(
        `${RESOURCE_COMPLIANCE_TEST_ID}-applies-${ComplianceFramework.PCIDSS}-7.2`,
      ),
    ).toHaveAttribute("aria-checked", "true");
  });

  test("someone who may not change settings sees the switches locked, with why", async () => {
    canCreate = false;

    await drawPage();
    await pick(ComplianceFramework.PCIDSS);

    const locked: HTMLElement = screen.getByTestId(
      `${RESOURCE_COMPLIANCE_TEST_ID}-applies-${ComplianceFramework.PCIDSS}-7.2`,
    );

    expect(locked).toHaveAttribute("aria-disabled", "true");

    await flip(
      `${RESOURCE_COMPLIANCE_TEST_ID}-applies-${ComplianceFramework.PCIDSS}-7.2`,
    );

    expect(createSpy).not.toHaveBeenCalled();
  });

  test("a cluster with no data store yet has nothing to score", async () => {
    complianceSpy.mockResolvedValue(answerOf({ storeCount: 0 }));

    await drawPage();

    expect(screen.getByText("Nothing to score yet")).toBeInTheDocument();
    expect(
      screen.queryByTestId(`${RESOURCE_COMPLIANCE_TEST_ID}-frameworks`),
    ).toBeNull();
  });

  test("a read that fails says why, and can be tried again", async () => {
    complianceSpy.mockRejectedValue(
      new Error("Reading data stores takes a Security role.") as never,
    );

    await drawPage();

    expect(
      screen.getByText("Reading data stores takes a Security role.", {
        exact: false,
      }),
    ).toBeInTheDocument();

    complianceSpy.mockResolvedValue(answerOf());

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /Refresh|Try again/ }),
      );
    });

    expect(complianceSpy).toHaveBeenCalledTimes(2);
    expect(
      screen.getByTestId(`${RESOURCE_COMPLIANCE_TEST_ID}-frameworks`),
    ).toBeInTheDocument();
  });
});

describe("a database on a cluster", () => {
  beforeEach(() => {
    goTo(`/dashboard/${PROJECT_ID}/databases`);
    goTo(
      `/dashboard/${PROJECT_ID}/databases/${DATABASE_ID.toString()}/compliance`,
    );
    complianceSpy.mockResolvedValue(
      answerOf({
        kind: DataStoreResourceKind.DatabaseServer,
        id: DATABASE_ID.toString(),
        name: "orders",
        complianceOwner: {
          kind: DataStoreResourceKind.KubernetesCluster,
          id: CLUSTER_ID.toString(),
          name: "prod-eu",
        },
      }),
    );
  });

  test("names the cluster whose page turns its frameworks on and off, and links there", async () => {
    await drawPage(DataStoreResourceKind.DatabaseServer);

    const notice: HTMLElement = screen.getByTestId(
      `${RESOURCE_COMPLIANCE_TEST_ID}-owner`,
    );

    expect(notice).toHaveTextContent(
      "This database runs on the Kubernetes cluster prod-eu, whose Compliance page turns frameworks on and off for every database on it.",
    );
    expect(
      within(notice).getByRole("link", { name: "prod-eu" }),
    ).toHaveAttribute(
      "href",
      compliancePageOf(CLUSTER_ID, PageMap.KUBERNETES_CLUSTER_VIEW_COMPLIANCE),
    );
  });

  test("its switches are locked, and no setting of its own is read or made", async () => {
    await drawPage(DataStoreResourceKind.DatabaseServer);
    await pick(ComplianceFramework.PCIDSS);

    expect(
      screen.getByTestId(
        `${RESOURCE_COMPLIANCE_TEST_ID}-applies-${ComplianceFramework.PCIDSS}-7.2`,
      ),
    ).toHaveAttribute("aria-disabled", "true");
    expect(rowsSpy).not.toHaveBeenCalled();

    await flip(
      `${RESOURCE_COMPLIANCE_TEST_ID}-applies-${ComplianceFramework.PCIDSS}-7.2`,
    );

    expect(createSpy).not.toHaveBeenCalled();
  });
});

describe.each([
  [
    "a Docker host",
    DataStoreResourceKind.DockerHost,
    PageMap.DOCKER_HOST_VIEW_COMPLIANCE,
    "This database runs on the Docker host build-01, whose Compliance page turns frameworks on and off for every database on it.",
  ],
  [
    "a Podman host",
    DataStoreResourceKind.PodmanHost,
    PageMap.PODMAN_HOST_VIEW_COMPLIANCE,
    "This database runs on the Podman host build-01, whose Compliance page turns frameworks on and off for every database on it.",
  ],
])(
  "a database on %s",
  (
    _label: string,
    hostKind: DataStoreResourceKind,
    hostCompliance: PageMap,
    sentence: string,
  ) => {
    beforeEach(() => {
      goTo(`/dashboard/${PROJECT_ID}/databases`);
      goTo(
        compliancePageOf(DATABASE_ID, PageMap.DATABASE_SERVER_VIEW_COMPLIANCE),
      );
      complianceSpy.mockResolvedValue(
        answerOf({
          kind: DataStoreResourceKind.DatabaseServer,
          id: DATABASE_ID.toString(),
          name: "orders",
          complianceOwner: {
            kind: hostKind,
            id: HOST_ID.toString(),
            name: "build-01",
          },
        }),
      );
    });

    test("names the host whose page turns its frameworks on and off, and links there", async () => {
      await drawPage(DataStoreResourceKind.DatabaseServer);

      const notice: HTMLElement = screen.getByTestId(
        `${RESOURCE_COMPLIANCE_TEST_ID}-owner`,
      );

      expect(notice).toHaveTextContent(sentence);
      // The host has its own Compliance page, so a database never points nowhere.
      expect(
        within(notice).getByRole("link", { name: "build-01" }),
      ).toHaveAttribute("href", compliancePageOf(HOST_ID, hostCompliance));
      expect(rowsSpy).not.toHaveBeenCalled();
    });
  },
);

describe("a database that runs on no cluster or host", () => {
  beforeEach(() => {
    goTo(`/dashboard/${PROJECT_ID}/databases`);
    goTo(
      compliancePageOf(DATABASE_ID, PageMap.DATABASE_SERVER_VIEW_COMPLIANCE),
    );
    complianceSpy.mockResolvedValue(
      answerOf({
        kind: DataStoreResourceKind.DatabaseServer,
        id: DATABASE_ID.toString(),
        name: "orders",
      }),
    );
  });

  test("has switches of its own: a requirement turned off is this database's setting", async () => {
    await drawPage(DataStoreResourceKind.DatabaseServer);

    expect(
      screen.queryByTestId(`${RESOURCE_COMPLIANCE_TEST_ID}-owner`),
    ).not.toBeInTheDocument();
    expect(rowsSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        modelType: DataSecurityComplianceSetting,
        query: expect.objectContaining({
          resourceType: DataStoreResourceKind.DatabaseServer,
          resourceId: DATABASE_ID,
        }),
      }),
    );

    await pick(ComplianceFramework.PCIDSS);
    await flip(
      `${RESOURCE_COMPLIANCE_TEST_ID}-applies-${ComplianceFramework.PCIDSS}-7.2`,
    );

    const made: DataSecurityComplianceSetting = (
      createSpy.mock.calls[0]![0] as { model: DataSecurityComplianceSetting }
    ).model;

    expect(made.resourceType).toBe(DataStoreResourceKind.DatabaseServer);
    expect(made.resourceId?.toString()).toBe(DATABASE_ID.toString());
    expect(made.requirement).toBe("7.2");
    expect(made.isEnabled).toBe(false);
  });

  test("its open issues open the database's own Data Security page", async () => {
    await drawPage(DataStoreResourceKind.DatabaseServer);
    await pick(ComplianceFramework.PCIDSS);

    const href: globalThis.URL = new globalThis.URL(
      screen.getByRole("link", { name: "1 open issue" }).getAttribute("href") ||
        "",
      "https://oneuptime.example",
    );

    expect(href.pathname).toBe(
      compliancePageOf(DATABASE_ID, PageMap.DATABASE_SERVER_VIEW_DATA_SECURITY),
    );
  });
});

/*
 * WHY IT DOES NOT APPLY HERE (#9629). Turning a framework or a requirement
 * off saves at once, then asks why under it, which may be put off; what is
 * turned off says who turned it off, when and why, with Add Reason or Edit
 * Reason for whoever may change it. The reason is its setting's note.
 */
const TURNED_OFF_AT: string = "2026-11-12T09:30:00.000Z";

function entryOf(
  data: Partial<DataSecurityComplianceTurnedOff> = {},
): DataSecurityComplianceTurnedOff {
  return {
    id: SETTING_ID.toString(),
    resource: {
      kind: DataStoreResourceKind.KubernetesCluster,
      id: CLUSTER_ID.toString(),
      name: "prod-eu",
    },
    requirement: null,
    note: "",
    turnedOffAt: TURNED_OFF_AT,
    turnedOffBy: "Jane Doe",
    ...data,
  };
}

// PCI DSS's requirement 7.2 turned off here, with what the server says of it.
function requirementTurnedOff(
  entry: DataSecurityComplianceTurnedOff,
): DataSecurityResourceComplianceResponse {
  return answerOf({
    frameworks: frameworksOf({
      turnedOff: [ComplianceFramework.SOC2],
      turnedOffRequirements: { [ComplianceFramework.PCIDSS]: ["7.2"] },
    }).map(
      (
        framework: DataSecurityResourceComplianceFramework,
      ): DataSecurityResourceComplianceFramework => {
        return framework.framework === ComplianceFramework.PCIDSS
          ? {
              ...framework,
              turnedOff: [entry],
              requirements: framework.requirements.map(
                (
                  requirement: ComplianceRequirementResult,
                ): ComplianceRequirementResult => {
                  return requirement.requirement === "7.2"
                    ? {
                        ...requirement,
                        status: ComplianceRequirementStatus.TurnedOff,
                        failingIssueCount: 0,
                      }
                    : requirement;
                },
              ),
            }
          : framework;
      },
    ),
  });
}

// PCI DSS turned off here altogether.
function frameworkTurnedOff(
  entry: DataSecurityComplianceTurnedOff,
): DataSecurityResourceComplianceResponse {
  return answerOf({
    frameworks: frameworksOf({
      turnedOff: [ComplianceFramework.SOC2, ComplianceFramework.PCIDSS],
    }).map(
      (
        framework: DataSecurityResourceComplianceFramework,
      ): DataSecurityResourceComplianceFramework => {
        return framework.framework === ComplianceFramework.PCIDSS
          ? { ...framework, turnedOff: [entry] }
          : framework;
      },
    ),
  });
}

const REQUIREMENT_NOTE: string = `${RESOURCE_COMPLIANCE_TEST_ID}-turned-off-${ComplianceFramework.PCIDSS}-7.2`;

async function type(testId: string, value: string): Promise<void> {
  await act(async () => {
    fireEvent.change(screen.getByTestId(testId), { target: { value } });
  });
}

describe("why it does not apply here", () => {
  test("turning a requirement off asks why under it, and Save Reason writes the reason to its setting", async () => {
    complianceSpy
      .mockResolvedValueOnce(answerOf())
      .mockResolvedValue(requirementTurnedOff(entryOf({ requirement: "7.2" })));

    await drawPage();
    await pick(ComplianceFramework.PCIDSS);
    await flip(
      `${RESOURCE_COMPLIANCE_TEST_ID}-applies-${ComplianceFramework.PCIDSS}-7.2`,
    );

    const form: HTMLElement = screen.getByTestId(`${REQUIREMENT_NOTE}-form`);

    expect(form).toHaveTextContent("Why does this not apply here?");
    expect(form).toHaveTextContent(
      "Optional. Shown beside it, and kept in the audit log.",
    );

    await type(
      `${REQUIREMENT_NOTE}-form-input`,
      "  Access is reviewed weekly.  ",
    );
    await flip(`${REQUIREMENT_NOTE}-form-save`);

    expect(updateSpy).toHaveBeenCalledWith({
      modelType: DataSecurityComplianceSetting,
      id: SETTING_ID,
      data: { note: "Access is reviewed weekly." },
    });
    expect(toastSpy).toHaveBeenLastCalledWith("Changes saved");
    // Read again, to show the reason as it was kept.
    expect(complianceSpy).toHaveBeenCalledTimes(3);
    expect(screen.queryByTestId(`${REQUIREMENT_NOTE}-form`)).toBeNull();
  });

  test("Not Now puts the question off, writes nothing, and leaves Add Reason", async () => {
    complianceSpy
      .mockResolvedValueOnce(answerOf())
      .mockResolvedValue(requirementTurnedOff(entryOf({ requirement: "7.2" })));

    await drawPage();
    await pick(ComplianceFramework.PCIDSS);
    await flip(
      `${RESOURCE_COMPLIANCE_TEST_ID}-applies-${ComplianceFramework.PCIDSS}-7.2`,
    );
    await flip(`${REQUIREMENT_NOTE}-form-cancel`);

    expect(updateSpy).not.toHaveBeenCalled();
    expect(screen.queryByTestId(`${REQUIREMENT_NOTE}-form`)).toBeNull();
    expect(screen.getByTestId(`${REQUIREMENT_NOTE}-edit`)).toHaveTextContent(
      "Add Reason",
    );
  });

  test("a requirement turned off says who turned it off, when and why, beside Turned off", async () => {
    complianceSpy.mockResolvedValue(
      requirementTurnedOff(
        entryOf({
          requirement: "7.2",
          note: "Access is reviewed weekly by the platform team.",
        }),
      ),
    );

    await drawPage();
    await pick(ComplianceFramework.PCIDSS);

    const note: HTMLElement = screen.getByTestId(REQUIREMENT_NOTE);

    expect(screen.getByTestId(`${REQUIREMENT_NOTE}-who`)).toHaveTextContent(
      /^Turned off by Jane Doe on .+/,
    );
    expect(screen.getByTestId(`${REQUIREMENT_NOTE}-reason`)).toHaveTextContent(
      "Access is reviewed weekly by the platform team.",
    );
    // Beside the status it explains, in the same cell.
    expect(note.closest("td")).toHaveTextContent("Turned off");
    // Nothing asks until someone chooses to change it.
    expect(screen.queryByTestId(`${REQUIREMENT_NOTE}-form`)).toBeNull();
  });

  test("Edit Reason opens the reason as it is, and saves the change", async () => {
    complianceSpy.mockResolvedValue(
      requirementTurnedOff(
        entryOf({ requirement: "7.2", note: "Reviewed weekly." }),
      ),
    );

    await drawPage();
    await pick(ComplianceFramework.PCIDSS);
    await flip(`${REQUIREMENT_NOTE}-edit`);

    expect(screen.getByTestId(`${REQUIREMENT_NOTE}-form-input`)).toHaveValue(
      "Reviewed weekly.",
    );

    await type(`${REQUIREMENT_NOTE}-form-input`, "Reviewed daily.");
    await flip(`${REQUIREMENT_NOTE}-form-save`);

    expect(updateSpy).toHaveBeenCalledWith({
      modelType: DataSecurityComplianceSetting,
      id: SETTING_ID,
      data: { note: "Reviewed daily." },
    });
  });

  test("a reason is cut at what its setting keeps, as it is typed", async () => {
    complianceSpy.mockResolvedValue(
      requirementTurnedOff(entryOf({ requirement: "7.2" })),
    );

    await drawPage();
    await pick(ComplianceFramework.PCIDSS);
    await flip(`${REQUIREMENT_NOTE}-edit`);
    await type(`${REQUIREMENT_NOTE}-form-input`, "x".repeat(600));

    expect(
      (screen.getByTestId(`${REQUIREMENT_NOTE}-form-input`) as HTMLInputElement)
        .value,
    ).toHaveLength(COMPLIANCE_REASON_MAX_LENGTH);
  });

  test("a reason that was not saved says so, and keeps what was typed", async () => {
    updateSpy.mockRejectedValue(
      new Error("Write the reason in 500 characters or fewer.") as never,
    );
    complianceSpy.mockResolvedValue(
      requirementTurnedOff(entryOf({ requirement: "7.2" })),
    );

    await drawPage();
    await pick(ComplianceFramework.PCIDSS);
    await flip(`${REQUIREMENT_NOTE}-edit`);
    await type(`${REQUIREMENT_NOTE}-form-input`, "Reviewed weekly.");
    await flip(`${REQUIREMENT_NOTE}-form-save`);

    const form: HTMLElement = screen.getByTestId(`${REQUIREMENT_NOTE}-form`);

    // The server's own sentence, under the form; nothing said saved.
    expect(form).toHaveTextContent(
      "Write the reason in 500 characters or fewer.",
    );
    expect(toastSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId(`${REQUIREMENT_NOTE}-form-input`)).toHaveValue(
      "Reviewed weekly.",
    );
  });

  test("a framework turned off from its card keeps the card, asking why; Save Reason closes it", async () => {
    complianceSpy
      .mockResolvedValueOnce(answerOf())
      .mockResolvedValue(frameworkTurnedOff(entryOf()));

    await drawPage();
    await pick(ComplianceFramework.PCIDSS);
    await flip(
      `${RESOURCE_COMPLIANCE_TEST_ID}-applies-${ComplianceFramework.PCIDSS}`,
    );

    const card: HTMLElement = screen.getByTestId(
      `${RESOURCE_COMPLIANCE_TEST_ID}-framework-turned-off`,
    );

    // Its switch, off, to turn it on again, and the question - asked once, in the card.
    expect(
      within(card).getByTestId(
        `${RESOURCE_COMPLIANCE_TEST_ID}-applies-here-${ComplianceFramework.PCIDSS}`,
      ),
    ).toHaveAttribute("aria-checked", "false");
    expect(screen.getAllByText("Why does this not apply here?")).toHaveLength(
      1,
    );

    await type(
      `${RESOURCE_COMPLIANCE_TEST_ID}-framework-turned-off-note-form-input`,
      "No card data ever reaches prod-eu.",
    );
    await flip(
      `${RESOURCE_COMPLIANCE_TEST_ID}-framework-turned-off-note-form-save`,
    );

    expect(updateSpy).toHaveBeenCalledWith({
      modelType: DataSecurityComplianceSetting,
      id: SETTING_ID,
      data: { note: "No card data ever reaches prod-eu." },
    });
    expect(
      screen.queryByTestId(
        `${RESOURCE_COMPLIANCE_TEST_ID}-framework-turned-off`,
      ),
    ).toBeNull();
  });

  test("a framework turned off is in the fold with who turned it off, when and why", async () => {
    complianceSpy.mockResolvedValue(
      frameworkTurnedOff(
        entryOf({ note: "No card data ever reaches prod-eu." }),
      ),
    );

    await drawPage();

    const note: HTMLElement = screen.getByTestId(
      `${RESOURCE_COMPLIANCE_TEST_ID}-turned-off-${ComplianceFramework.PCIDSS}`,
    );

    expect(note).toHaveTextContent(/Turned off by Jane Doe on .+/);
    expect(note).toHaveTextContent("No card data ever reaches prod-eu.");
    expect(note).toHaveTextContent("Edit Reason");
  });

  test("an API key's turn-off names nobody, and one from before is just Turned off", async () => {
    complianceSpy.mockResolvedValue(
      requirementTurnedOff(entryOf({ requirement: "7.2", turnedOffBy: null })),
    );

    await drawPage();
    await pick(ComplianceFramework.PCIDSS);

    expect(screen.getByTestId(`${REQUIREMENT_NOTE}-who`)).toHaveTextContent(
      /^Turned off on .+/,
    );

    cleanup();
    complianceSpy.mockResolvedValue(
      requirementTurnedOff(
        entryOf({ requirement: "7.2", turnedOffBy: null, turnedOffAt: null }),
      ),
    );

    await drawPage();
    await pick(ComplianceFramework.PCIDSS);

    expect(screen.getByTestId(`${REQUIREMENT_NOTE}-who`)).toHaveTextContent(
      /^Turned off$/,
    );
  });

  test("someone who may not change settings reads why, with nothing to change it", async () => {
    canCreate = false;
    complianceSpy.mockResolvedValue(
      requirementTurnedOff(
        entryOf({ requirement: "7.2", note: "Reviewed weekly." }),
      ),
    );

    await drawPage();
    await pick(ComplianceFramework.PCIDSS);

    expect(screen.getByTestId(`${REQUIREMENT_NOTE}-reason`)).toHaveTextContent(
      "Reviewed weekly.",
    );
    expect(screen.queryByTestId(`${REQUIREMENT_NOTE}-edit`)).toBeNull();
  });

  test("a database on a cluster shows the cluster's reasons, which only the cluster's page changes", async () => {
    goTo(
      `/dashboard/${PROJECT_ID}/databases/${DATABASE_ID.toString()}/compliance`,
    );
    complianceSpy.mockResolvedValue({
      ...requirementTurnedOff(
        entryOf({ requirement: "7.2", note: "Reviewed weekly." }),
      ),
      kind: DataStoreResourceKind.DatabaseServer,
      id: DATABASE_ID.toString(),
      name: "orders",
      complianceOwner: {
        kind: DataStoreResourceKind.KubernetesCluster,
        id: CLUSTER_ID.toString(),
        name: "prod-eu",
      },
    });

    await drawPage(DataStoreResourceKind.DatabaseServer);
    await pick(ComplianceFramework.PCIDSS);

    expect(screen.getByTestId(`${REQUIREMENT_NOTE}-reason`)).toHaveTextContent(
      "Reviewed weekly.",
    );
    expect(screen.queryByTestId(`${REQUIREMENT_NOTE}-edit`)).toBeNull();
  });
});
