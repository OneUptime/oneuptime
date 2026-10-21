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
import * as React from "react";
import Route from "../../../Types/API/Route";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import { getCloudResourceTypeLabel } from "../../../Types/Cloud/CloudResourceCatalog";
import {
  CloudConnectionAuthMethod,
  CloudConnectionCatalog,
  CloudConnectionDefinition,
  getCloudConnectionDefinition,
} from "../../../Types/CloudConnection/CloudConnectionCatalog";
import { getAwsExternalIdForProject } from "../../../Types/CloudConnection/CloudConnectionSetupCommands";
import {
  CloudConnectionFailureKind,
  CloudConnectionTestResult,
} from "../../../Types/CloudConnection/CloudConnectionTest";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";
import { PROJECT_ID, goTo } from "./SideMenuHarness";
import CloudConnectCallout from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/Connect/CloudConnectCallout";
import CloudConnectionTestPanel from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/Connect/CloudConnectionTestPanel";
import CloudConnectionTiles from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/Connect/CloudConnectionTiles";
import CloudResourceGroups from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/Connect/CloudResourceGroups";
import CloudSetupCommand from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/Connect/CloudSetupCommand";

/*
 * The pieces of Cloud > Connect, drawn:
 *
 *   - a tile per cloud, saying what connecting it brings and whether it is
 *     connected - or greyed, with why, without the right to connect;
 *   - the setup step: what the command does, the command itself (an AWS
 *     role's written for this project's external id), the cloud's own
 *     terminal one click away, and what OneUptime may do with the access;
 *   - the test: it waits for the settings, signs in once, and shows what
 *     it found by service and region with what reading it costs - or what
 *     to fix, with the cloud's own answer kept apart;
 *   - the empty All Resources page's way in, one click to a cloud's form.
 */

const AWS: CloudConnectionDefinition = getCloudConnectionDefinition(
  CloudProvider.AWS,
)!;
const AZURE: CloudConnectionDefinition = getCloudConnectionDefinition(
  CloudProvider.Azure,
)!;
const GCP: CloudConnectionDefinition = getCloudConnectionDefinition(
  CloudProvider.GCP,
)!;

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}/cloud/connect`);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the tiles", () => {
  test("one per cloud: its name, what it brings, and Connect", () => {
    render(
      <CloudConnectionTiles
        connectionCounts={{}}
        canConnect={true}
        onConnect={getJestMockFunction()}
      />,
    );

    for (const definition of CloudConnectionCatalog) {
      const tile: HTMLElement = screen.getByTestId(
        `cloud-connection-tile-${definition.provider}`,
      );

      expect(tile).toHaveTextContent(definition.title);
      expect(tile).toHaveTextContent(definition.description);
      expect(tile).toHaveTextContent("Connect");
      expect(tile).toBeEnabled();
    }
  });

  test("a connected cloud says so, how many times, and offers another", () => {
    render(
      <CloudConnectionTiles
        connectionCounts={{ aws: 1, azure: 2 }}
        canConnect={true}
        onConnect={getJestMockFunction()}
      />,
    );

    expect(
      screen.getByTestId("cloud-connection-tile-connected-aws"),
    ).toHaveTextContent(/^Connected$/);
    expect(
      screen.getByTestId("cloud-connection-tile-connected-azure"),
    ).toHaveTextContent("Connected (2)");
    expect(
      screen.queryByTestId("cloud-connection-tile-connected-gcp"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("cloud-connection-tile-aws")).toHaveTextContent(
      "Connect another",
    );
  });

  test("a click hands the cloud on", () => {
    const onConnect: MockFunction = getJestMockFunction();

    render(
      <CloudConnectionTiles
        connectionCounts={{}}
        canConnect={true}
        onConnect={onConnect}
      />,
    );

    fireEvent.click(screen.getByTestId("cloud-connection-tile-gcp"));

    expect(onConnect).toHaveBeenCalledWith(CloudProvider.GCP);
  });

  test("without the right to connect, every tile is disabled and says why", () => {
    render(
      <CloudConnectionTiles
        connectionCounts={{}}
        canConnect={false}
        connectDisabledReason="Ask a project admin to connect a cloud account."
        onConnect={getJestMockFunction()}
      />,
    );

    for (const definition of CloudConnectionCatalog) {
      expect(
        screen.getByTestId(`cloud-connection-tile-${definition.provider}`),
      ).toBeDisabled();
    }
  });
});

describe("the setup step", () => {
  test("Azure: what the command does, the command, its shell and its guide", () => {
    render(
      <CloudSetupCommand
        definition={AZURE}
        method={CloudConnectionAuthMethod.AzureClientSecret}
      />,
    );

    const step: HTMLElement = screen.getByTestId("cloud-setup-command");

    expect(step).toHaveTextContent(AZURE.authMethods[0]!.hint);
    expect(screen.getByTestId("cloud-setup-command-code")).toHaveTextContent(
      "az ad sp create-for-rbac",
    );
    expect(screen.getByTestId("cloud-setup-open-shell")).toHaveAttribute(
      "href",
      AZURE.shellUrl,
    );
    expect(screen.getByTestId("cloud-setup-open-shell")).toHaveTextContent(
      "Open Azure Cloud Shell",
    );
    expect(screen.getByTestId("cloud-setup-open-shell")).toHaveAttribute(
      "rel",
      "noopener noreferrer",
    );
    expect(
      screen.getByTestId("cloud-setup-guide-link").getAttribute("href"),
    ).toMatch(/\/telemetry\/cloud-accounts#microsoft-azure$/);
    expect(screen.getByTestId("cloud-setup-read-only")).toHaveTextContent(
      "OneUptime can only read resources and metrics.",
    );
  });

  test("an AWS role's command trusts this OneUptime, with this project's external id", () => {
    const externalId: string = getAwsExternalIdForProject(PROJECT_ID);

    render(
      <CloudSetupCommand
        definition={AWS}
        method={CloudConnectionAuthMethod.AwsRole}
        roleSetup={{
          isAvailable: true,
          trustedPrincipalArn: "arn:aws:iam::999988887777:root",
          externalId,
        }}
      />,
    );

    const code: HTMLElement = screen.getByTestId("cloud-setup-command-code");

    expect(code).toHaveTextContent("arn:aws:iam::999988887777:root");
    expect(code).toHaveTextContent(externalId);
    expect(code).toHaveTextContent("aws iam create-role");
    expect(screen.getByTestId("cloud-setup-read-only")).toHaveTextContent(
      "OneUptime can only read metrics and tags.",
    );
  });

  test("an AWS role's command waits until what it trusts is known", () => {
    render(
      <CloudSetupCommand
        definition={AWS}
        method={CloudConnectionAuthMethod.AwsRole}
      />,
    );

    expect(screen.getByTestId("cloud-setup-command-loading")).toHaveTextContent(
      "Getting the command ready…",
    );
    expect(
      screen.queryByTestId("cloud-setup-command-code"),
    ).not.toBeInTheDocument();
  });

  test("Google Cloud: a service account with the Monitoring Viewer role, its key printed", () => {
    render(
      <CloudSetupCommand
        definition={GCP}
        method={CloudConnectionAuthMethod.GcpServiceAccountKey}
      />,
    );

    const code: HTMLElement = screen.getByTestId("cloud-setup-command-code");

    expect(code).toHaveTextContent("roles/monitoring.viewer");
    expect(code).toHaveTextContent("gcloud iam service-accounts keys create");
    expect(screen.getByTestId("cloud-setup-open-shell")).toHaveAttribute(
      "href",
      GCP.shellUrl,
    );
  });
});

const PASS: CloudConnectionTestResult = {
  provider: CloudProvider.AWS,
  status: "pass",
  message: "Signed in to AWS account 123456789012.",
  accounts: ["123456789012"],
  resourceCount: 7,
  resourceTypes: [
    { type: "AWS::EC2::Instance", count: 5 },
    { type: "AWS::RDS::DBInstance", count: 2 },
  ],
  regions: [
    { region: "us-east-1", count: 6 },
    { region: "eu-west-1", count: 1 },
  ],
  isSample: true,
  durationMs: 300,
};

async function clickTest(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByTestId("cloud-connection-test-button"));
  });
}

describe("the test", () => {
  test("waits for the settings it needs, and says which", () => {
    render(
      <CloudConnectionTestPanel
        definition={AWS}
        readIntervalInMinutes={10}
        disabledReason="Fill in Role ARN to test."
        runTest={getJestMockFunction()}
      />,
    );

    expect(screen.getByTestId("cloud-connection-test-panel")).toHaveTextContent(
      "Signs in and counts what there is to monitor. Nothing is kept until you connect.",
    );
    expect(screen.getByTestId("cloud-connection-test-button")).toBeDisabled();
  });

  test("a pass: what was found, by service and region, the accounts, and what reading costs", async () => {
    const runTest: MockFunction = getJestMockFunction().mockResolvedValue(PASS);

    render(
      <CloudConnectionTestPanel
        definition={AWS}
        readIntervalInMinutes={10}
        runTest={runTest as never}
      />,
    );

    await clickTest();

    const answer: HTMLElement = await screen.findByTestId(
      "cloud-connection-test-pass",
    );

    expect(runTest).toHaveBeenCalledTimes(1);
    expect(answer).toHaveTextContent(
      "It works. Here is what OneUptime found to monitor.",
    );
    expect(screen.getByTestId("cloud-test-found")).toHaveTextContent(
      "7 resources",
    );
    expect(screen.getByTestId("cloud-test-found")).toHaveTextContent(
      "A quick look. The first read finds every resource.",
    );
    expect(screen.getByTestId("cloud-resource-groups-types")).toHaveTextContent(
      getCloudResourceTypeLabel(CloudProvider.AWS, "AWS::EC2::Instance"),
    );
    expect(
      screen.getByTestId("cloud-resource-groups-regions"),
    ).toHaveTextContent("us-east-1");
    expect(
      screen.getByTestId("cloud-resource-groups-accounts"),
    ).toHaveTextContent("Reads 123456789012");
    expect(screen.getByTestId("cloud-test-cost")).toHaveTextContent(
      "Reading these every 10 minutes costs about $",
    );
    // The cloud's own words stay out of a pass.
    expect(
      screen.queryByTestId("cloud-connection-test-details"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("cloud-connection-test-button"),
    ).toHaveTextContent("Test again");
  });

  test("a failure: what to fix, and the cloud's own answer apart", async () => {
    render(
      <CloudConnectionTestPanel
        definition={AZURE}
        readIntervalInMinutes={5}
        runTest={
          getJestMockFunction().mockResolvedValue({
            provider: CloudProvider.Azure,
            status: "fail",
            message: "AADSTS7000215: Invalid client secret provided.",
            failureKind: CloudConnectionFailureKind.Authentication,
            durationMs: 50,
          }) as never
        }
      />,
    );

    await clickTest();

    const answer: HTMLElement = await screen.findByTestId(
      "cloud-connection-test-fail",
    );

    expect(answer).toHaveTextContent("The key or secret was not accepted.");
    expect(answer).toHaveTextContent("Copy everything the command printed");
    expect(
      screen.getByTestId("cloud-connection-test-details"),
    ).toHaveTextContent("AADSTS7000215: Invalid client secret provided.");
    expect(screen.queryByTestId("cloud-test-found")).not.toBeInTheDocument();
  });

  test("works but found nothing: a warning that says where resources come from", async () => {
    render(
      <CloudConnectionTestPanel
        definition={GCP}
        readIntervalInMinutes={5}
        runTest={
          getJestMockFunction().mockResolvedValue({
            provider: CloudProvider.GCP,
            status: "warn",
            message: "Signed in to acme-prod; nothing reports metrics yet.",
            resourceCount: 0,
            durationMs: 50,
          }) as never
        }
      />,
    );

    await clickTest();

    expect(
      await screen.findByTestId("cloud-connection-test-warn"),
    ).toHaveTextContent(
      "It works, but OneUptime found no resources to monitor yet.",
    );
    expect(screen.queryByTestId("cloud-test-cost")).not.toBeInTheDocument();
  });

  test("a request that fails is said as an error", async () => {
    render(
      <CloudConnectionTestPanel
        definition={GCP}
        readIntervalInMinutes={5}
        runTest={
          getJestMockFunction().mockRejectedValue(
            new Error("Network Error"),
          ) as never
        }
      />,
    );

    await clickTest();

    expect(
      await screen.findByTestId("cloud-connection-test-error"),
    ).toHaveTextContent("Network Error");
  });

  test("from the list: it runs as soon as it opens, once, with only its answer and a Test again", async () => {
    const runTest: MockFunction = getJestMockFunction().mockResolvedValue(PASS);

    await act(async () => {
      render(
        <CloudConnectionTestPanel
          definition={AWS}
          readIntervalInMinutes={10}
          startImmediately={true}
          runTest={runTest as never}
        />,
      );
    });

    await waitFor(() => {
      expect(
        screen.getByTestId("cloud-connection-test-pass"),
      ).toBeInTheDocument();
    });
    expect(runTest).toHaveBeenCalledTimes(1);
    expect(
      screen.getByTestId("cloud-connection-test-panel"),
    ).not.toHaveTextContent("Nothing is kept until you connect.");
  });
});

describe("the resources at a glance", () => {
  const types: Array<{ type: string; count: number }> = [
    { type: "Microsoft.Compute/virtualMachines", count: 9 },
    { type: "Microsoft.Sql/servers/databases", count: 4 },
    { type: "Microsoft.Web/sites", count: 3 },
    { type: "Microsoft.Storage/storageAccounts", count: 2 },
    { type: "Microsoft.Network/loadBalancers", count: 1 },
  ];

  test("compact: the first three services and how many more, no regions", () => {
    render(
      <CloudResourceGroups
        provider={CloudProvider.Azure}
        resourceTypes={types}
        regions={[{ region: "westeurope", count: 19 }]}
        accounts={["sub-1"]}
        compact={true}
      />,
    );

    const list: HTMLElement = screen.getByTestId("cloud-resource-groups-types");

    expect(within(list).getAllByRole("listitem")).toHaveLength(4);
    expect(list).toHaveTextContent("+2 more");
    expect(
      screen.queryByTestId("cloud-resource-groups-regions"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("cloud-resource-groups-accounts"),
    ).not.toBeInTheDocument();
  });

  test("in full: every service and every region, by their counts", () => {
    render(
      <CloudResourceGroups
        provider={CloudProvider.Azure}
        resourceTypes={types}
        regions={[
          { region: "westeurope", count: 18 },
          { region: "", count: 1 },
        ]}
      />,
    );

    expect(
      within(screen.getByTestId("cloud-resource-groups-types")).getAllByRole(
        "listitem",
      ),
    ).toHaveLength(5);
    expect(screen.getByTestId("cloud-resource-groups")).toHaveTextContent(
      "By service",
    );
    // A resource with no region is counted, not listed as a region.
    expect(
      within(screen.getByTestId("cloud-resource-groups-regions")).getAllByRole(
        "listitem",
      ),
    ).toHaveLength(1);
  });
});

describe("the way in from an empty All Resources", () => {
  test("a tile opens that cloud's form on Cloud > Connect", () => {
    getJestSpyOn(PermissionGate, "check").mockReturnValue({
      isAllowed: true,
    } as PermissionGateResult);
    const navigate: jest.SpyInstance<any, any> = getJestSpyOn(
      Navigation,
      "navigate",
    ).mockImplementation((): void => {});

    render(<CloudConnectCallout />);

    expect(screen.getByTestId("cloud-connect-callout")).toHaveTextContent(
      "Connect a cloud account",
    );

    fireEvent.click(screen.getByTestId("cloud-connection-tile-azure"));

    expect(navigate).toHaveBeenCalledTimes(1);
    expect((navigate.mock.calls[0]![0] as Route).toString()).toBe(
      `/dashboard/${PROJECT_ID}/cloud/connect?cloud=azure`,
    );
  });

  test("whoever may not connect sees the tiles greyed", () => {
    getJestSpyOn(PermissionGate, "check").mockReturnValue({
      isAllowed: false,
      disabledReason: "Ask a project admin to connect a cloud account.",
    } as PermissionGateResult);

    render(<CloudConnectCallout />);

    expect(screen.getByTestId("cloud-connection-tile-aws")).toBeDisabled();
  });
});
