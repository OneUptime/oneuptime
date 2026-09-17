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
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import CloudDocumentationCard from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudDocumentationCard";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import TelemetryIngestionKey from "../../../Models/DatabaseModels/TelemetryIngestionKey";
import ObjectID from "../../../Types/ObjectID";
import {
  MANAGED_CLOUD_PLATFORMS,
  ManagedCloudPlatform,
  ManagedCloudPlatformDescriptor,
} from "../../../Types/Cloud/CloudPlatform";

/*
 * The cloud guide as it reaches the screen.
 *
 * App/Tests/Dashboard/CloudDocumentationCard.test.ts pins the wiring at the
 * source level because the App suite has no React. What is pinned here is
 * the behaviour: the picker opens on the environment's own platform, falls
 * back to ECS for a value ingest would not accept, offers exactly the
 * registry's platforms, re-renders the guide when the selection changes,
 * and hands the selected key's secret to the guide rather than a
 * placeholder — the one thing that makes the snippets pasteable.
 *
 * react-markdown is mocked in Common's jest config to render its children
 * as text, so the guide's markdown source is what the container holds.
 */

interface MarkdownViewerProps {
  text: string;
}

/*
 * ResourceDocumentationCard draws the guide through LazyMarkdownViewer, a
 * React.lazy boundary. The first render in this file has to compile the viewer
 * behind it, and ts-jest does that synchronously - it holds the event loop, so
 * not even the already-resolved ingestion-key request can land. On a loaded CI
 * shard that ran past Testing Library's five-second budget with both loaders
 * still on screen ("Loading..." for the keys, "Loading content" for the lazy
 * fallback), and the first test failed on a guide that was never late, only
 * uncompiled. These tests are about which guide is shown, not how it is
 * loaded, so render the markdown source straight through, as the other suites
 * that assert on a lazy viewer's text already do.
 */
jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (props: MarkdownViewerProps): React.ReactElement => {
      return React.createElement("div", {}, props.text);
    },
  };
});

const PROJECT_ID: ObjectID = new ObjectID("project-1");

const FIRST_KEY: TelemetryIngestionKey = new TelemetryIngestionKey();
FIRST_KEY.id = new ObjectID("key-1");
FIRST_KEY.name = "Production Key";
FIRST_KEY.secretKey = new ObjectID("secret-production");

type RenderCardFunction = (initialPlatform?: string | undefined) => HTMLElement;

const renderCard: RenderCardFunction = (
  initialPlatform?: string | undefined,
): HTMLElement => {
  const { container } = render(
    <MemoryRouter>
      <CloudDocumentationCard
        title="Connect a cloud environment"
        description="Where the settings go."
        initialPlatform={initialPlatform}
      />
    </MemoryRouter>,
  );

  return container;
};

const platformPicker: () => HTMLElement = (): HTMLElement => {
  return screen.getByRole("combobox", { name: "Select cloud platform" });
};

/*
 * react-select renders its menu on ArrowDown; the option label is unique on
 * the page at that moment (the guide's heading says "Connect <name>", which
 * is a different string), so a global text lookup finds it.
 */
const pickPlatform: (label: string) => void = (label: string): void => {
  fireEvent.keyDown(platformPicker(), { key: "ArrowDown" });
  const option: HTMLElement = screen.getByText(label);
  fireEvent.mouseDown(option);
  fireEvent.click(option);
};

describe("CloudDocumentationCard", () => {
  beforeEach(() => {
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
    jest.spyOn(ModelAPI, "getList").mockResolvedValue({
      data: [FIRST_KEY],
      count: 1,
      skip: 0,
      limit: 50,
    } as never);
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("opens on the environment's own platform", async () => {
    const container: HTMLElement = renderCard(ManagedCloudPlatform.GcpCloudRun);

    await waitFor(() => {
      expect(container.textContent).toContain("## Connect Google Cloud Run");
    });

    expect(container.textContent).toContain("cloud.platform=gcp_cloud_run");
    expect(container.textContent).not.toContain("## Connect AWS ECS / Fargate");
  });

  test("falls back to AWS ECS when the platform is unknown or missing", async () => {
    const withVmPlatform: HTMLElement = renderCard("aws_ec2");

    await waitFor(() => {
      expect(withVmPlatform.textContent).toContain(
        "## Connect AWS ECS / Fargate",
      );
    });

    cleanup();

    const withoutPlatform: HTMLElement = renderCard(undefined);

    await waitFor(() => {
      expect(withoutPlatform.textContent).toContain(
        "## Connect AWS ECS / Fargate",
      );
    });
  });

  test("interpolates the selected key's secret, not the placeholder", async () => {
    const container: HTMLElement = renderCard(ManagedCloudPlatform.AwsEcs);

    await waitFor(() => {
      expect(container.textContent).toContain(
        "x-oneuptime-token: secret-production",
      );
    });

    expect(container.textContent).not.toContain("<YOUR_API_KEY>");
  });

  test("offers exactly the registry's platforms", async () => {
    renderCard(ManagedCloudPlatform.AwsEcs);

    await waitFor(() => {
      expect(platformPicker()).toBeInTheDocument();
    });

    fireEvent.keyDown(platformPicker(), { key: "ArrowDown" });

    /*
     * The selected platform's name is on screen twice — as the picker's
     * current value and as its menu option — so count matches rather than
     * insisting on one.
     */
    for (const descriptor of MANAGED_CLOUD_PLATFORMS) {
      expect(
        screen.getAllByText(descriptor.productName).length,
      ).toBeGreaterThan(0);
    }

    /* Grouped by provider, so the group headings are on screen too. */
    expect(screen.getByText("AWS")).toBeInTheDocument();
    expect(screen.getByText("Google Cloud")).toBeInTheDocument();
    expect(screen.getByText("Azure")).toBeInTheDocument();
  });

  test("switching the platform switches the guide", async () => {
    const container: HTMLElement = renderCard(ManagedCloudPlatform.AwsEcs);

    await waitFor(() => {
      expect(container.textContent).toContain("## Connect AWS ECS / Fargate");
    });

    const azure: ManagedCloudPlatformDescriptor = MANAGED_CLOUD_PLATFORMS.find(
      (descriptor: ManagedCloudPlatformDescriptor): boolean => {
        return descriptor.platform === ManagedCloudPlatform.AzureContainerApps;
      },
    ) as ManagedCloudPlatformDescriptor;

    pickPlatform(azure.productName);

    await waitFor(() => {
      expect(container.textContent).toContain(
        "## Connect Azure Container Apps",
      );
    });

    expect(container.textContent).toContain("CONTAINER_APP_REPLICA_NAME");
    expect(container.textContent).toContain(`](${azure.docsUrl})`);
    expect(container.textContent).not.toContain("## Connect AWS ECS / Fargate");
    /* The key's secret follows the guide across the switch. */
    expect(container.textContent).toContain("secret-production");
  });
});
