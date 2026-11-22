import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
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
import DataSecurityCompliancePage from "../../../../App/FeatureSet/Dashboard/src/Pages/DataSecurity/Compliance";
import DataSecurityApi from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/DataSecurityApi";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
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
  DataSecurityComplianceFramework,
  DataSecurityComplianceTurnedOff,
} from "../../../Types/DataSecurity/DataSecurityApiTypes";
import { DataStoreResourceKind } from "../../../Types/DataSecurity/DataStoreResource";
import ObjectID from "../../../Types/ObjectID";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

/*
 * WHY A FRAMEWORK OR A REQUIREMENT IS TURNED OFF, ON THE PROJECT'S
 * COMPLIANCE PAGE (#9629). A framework picked says which resources turned
 * the whole of it off, and each requirement which turned it off, beside its
 * status: each resource named and linked to its own Compliance page - by
 * its kind alone when the reader may not read it - with who turned it off,
 * when and why.
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

const CLUSTER_ID: string = "44444444-0000-4000-8000-000000000004";
const SERVICE_ID: string = "55555555-0000-4000-8000-000000000005";

function entryOf(
  data: Partial<DataSecurityComplianceTurnedOff>,
): DataSecurityComplianceTurnedOff {
  return {
    id: ObjectID.generate().toString(),
    resource: {
      kind: DataStoreResourceKind.KubernetesCluster,
      id: CLUSTER_ID,
      name: "prod-eu",
    },
    requirement: null,
    note: "",
    turnedOffAt: "2026-11-12T09:30:00.000Z",
    turnedOffBy: "Jane Doe",
    ...data,
  };
}

function frameworksWith(
  turnedOff: Array<DataSecurityComplianceTurnedOff>,
): Array<DataSecurityComplianceFramework> {
  return ALL_COMPLIANCE_FRAMEWORKS.map(
    (framework: ComplianceFramework): DataSecurityComplianceFramework => {
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
          [],
        );

      return {
        ...scored,
        fullName: COMPLIANCE_FRAMEWORK_INFO[framework].fullName,
        scope: COMPLIANCE_FRAMEWORK_INFO[framework].scope,
        turnedOff: framework === ComplianceFramework.PCIDSS ? turnedOff : [],
        requirements:
          framework === ComplianceFramework.PCIDSS
            ? scored.requirements.map(
                (
                  requirement: ComplianceRequirementResult,
                ): ComplianceRequirementResult => {
                  return requirement.requirement === "7.2"
                    ? {
                        ...requirement,
                        status: ComplianceRequirementStatus.TurnedOff,
                      }
                    : requirement;
                },
              )
            : scored.requirements,
      };
    },
  );
}

function project(): Project {
  const value: Project = new Project();
  value.id = new ObjectID(PROJECT_ID);
  return value;
}

async function drawAndPickPci(
  turnedOff: Array<DataSecurityComplianceTurnedOff>,
): Promise<void> {
  jest
    .spyOn(DataSecurityApi, "getCompliance")
    .mockResolvedValue({ frameworks: frameworksWith(turnedOff) });
  // The record of processing under the frameworks (#10398): its own suite draws it.
  jest
    .spyOn(DataSecurityApi, "getRecordOfProcessing")
    .mockResolvedValue({ rows: [] });

  await act(async () => {
    render(
      <MemoryRouter>
        <DataSecurityCompliancePage
          pageRoute={RouteMap[PageMap.DATA_SECURITY_COMPLIANCE] as Route}
          currentProject={project()}
          hasPaymentMethod={true}
        />
      </MemoryRouter>,
    );
  });

  const tile: HTMLElement | undefined = screen
    .getAllByTestId("data-security-compliance-framework")
    .find((each: HTMLElement): boolean => {
      return (
        each.querySelector("span")?.textContent === ComplianceFramework.PCIDSS
      );
    });

  await act(async () => {
    fireEvent.click(tile!);
  });
}

function compliancePageOf(page: PageMap, id: string): string {
  return RouteUtil.populateRouteParams(RouteMap[page] as Route, {
    modelId: new ObjectID(id),
  }).toString();
}

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}/data-security`);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the project's Compliance page, with why each was turned off", () => {
  test("lists the resources that turned the whole framework off, each with who, when and why", async () => {
    await drawAndPickPci([
      entryOf({ note: "No card data ever reaches prod-eu." }),
    ]);

    const section: HTMLElement = screen.getByTestId(
      "data-security-compliance-framework-turned-off",
    );

    expect(section).toHaveTextContent("Turned Off for the Whole Framework");
    expect(section).toHaveTextContent("prod-eu");
    expect(section).toHaveTextContent("Kubernetes Cluster");
    expect(section).toHaveTextContent(/Turned off by Jane Doe on .+/);
    expect(section).toHaveTextContent("No card data ever reaches prod-eu.");

    // The resource opens its own Compliance page, where it is changed.
    expect(
      within(section).getByRole("link", { name: "prod-eu" }),
    ).toHaveAttribute(
      "href",
      compliancePageOf(PageMap.KUBERNETES_CLUSTER_VIEW_COMPLIANCE, CLUSTER_ID),
    );
  });

  test("says which resources turned a requirement off, and why, beside its Turned off", async () => {
    await drawAndPickPci([
      entryOf({
        requirement: "7.2",
        resource: {
          kind: DataStoreResourceKind.Service,
          id: SERVICE_ID,
          name: "checkout",
        },
        note: "Its telemetry never holds card numbers.",
      }),
    ]);

    const beside: HTMLElement = screen.getByTestId(
      "data-security-compliance-turned-off-7.2",
    );

    expect(beside.closest("td")).toHaveTextContent("Turned off");
    expect(beside).toHaveTextContent("checkout");
    expect(beside).toHaveTextContent("Service");
    expect(beside).toHaveTextContent("Its telemetry never holds card numbers.");
    expect(
      within(beside).getByRole("link", { name: "checkout" }),
    ).toHaveAttribute(
      "href",
      compliancePageOf(PageMap.SERVICE_VIEW_COMPLIANCE, SERVICE_ID),
    );
    // Nothing is turned off for the whole framework.
    expect(
      screen.queryByTestId("data-security-compliance-framework-turned-off"),
    ).toBeNull();
  });

  test("a resource the reader may not read is named by its kind alone, with no link", async () => {
    await drawAndPickPci([
      entryOf({
        resource: {
          kind: DataStoreResourceKind.KubernetesCluster,
          id: CLUSTER_ID,
          name: "",
        },
        note: "Not ours to say.",
      }),
    ]);

    const section: HTMLElement = screen.getByTestId(
      "data-security-compliance-framework-turned-off",
    );

    expect(section).toHaveTextContent("Kubernetes Cluster");
    expect(section).toHaveTextContent("Not ours to say.");
    expect(within(section).queryByRole("link")).toBeNull();
  });

  test("nothing turned off says nothing more", async () => {
    await drawAndPickPci([]);

    expect(
      screen.queryByTestId("data-security-compliance-framework-turned-off"),
    ).toBeNull();
    expect(
      screen.queryByTestId("data-security-compliance-turned-off-7.2"),
    ).toBeNull();
  });
});
