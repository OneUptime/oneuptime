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
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import CloudDocumentationCard from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudDocumentationCard";
import {
  SETUP_GUIDE_API_KEY_PLACEHOLDER,
  getSetupGuideOneUptimeUrl,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/SetupGuide";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import { HOST, HTTP_PROTOCOL } from "../../../UI/Config";
import Protocol from "../../../Types/API/Protocol";
import TelemetryIngestionKey from "../../../Models/DatabaseModels/TelemetryIngestionKey";
import TelemetryIngestionKeyType from "../../../Types/Telemetry/TelemetryIngestionKeyType";
import ObjectID from "../../../Types/ObjectID";
import {
  CLOUD_PROVIDER_LABELS,
  CloudProvider,
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
 * registry's platforms grouped by provider, follows a platform the page
 * learns later, re-renders the guide when the selection changes, and hands
 * the selected key's secret to the guide rather than a placeholder — the
 * one thing that makes the snippets pasteable.
 *
 * react-markdown is mocked in Common's jest config to render its children
 * as text, so the guide's markdown source is what the container holds.
 */

interface MarkdownViewerProps {
  text: string;
}

/*
 * SetupGuideCard draws the guide through LazyMarkdownViewer, a React.lazy
 * boundary. The first render in this file would have to compile the viewer
 * behind it, and ts-jest does that synchronously - it holds the event loop,
 * so not even the already-resolved ingestion-key request can land. These
 * tests are about which guide is shown, not how it is loaded, so render the
 * markdown source straight through, as the other suites that assert on a
 * lazy viewer's text already do.
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

// The origin the card fills in: the dashboard's own host, or the placeholder.
const ONEUPTIME_URL: string = getSetupGuideOneUptimeUrl({
  host: HOST,
  isHttps: HTTP_PROTOCOL === Protocol.HTTPS,
});

type GetList = typeof ModelAPI.getList;

const mockKeys: (keys: Array<TelemetryIngestionKey>) => jest.Mock<GetList> = (
  keys: Array<TelemetryIngestionKey>,
): jest.Mock<GetList> => {
  return jest.spyOn(ModelAPI, "getList").mockResolvedValue({
    data: keys,
    count: keys.length,
    skip: 0,
    limit: 50,
  } as never) as unknown as jest.Mock<GetList>;
};

const cardFor: (initialPlatform?: string | undefined) => React.ReactElement = (
  initialPlatform?: string | undefined,
): React.ReactElement => {
  return (
    <MemoryRouter>
      <CloudDocumentationCard
        title="Connect a cloud environment"
        description="Where the settings go."
        initialPlatform={initialPlatform}
      />
    </MemoryRouter>
  );
};

const renderCard: (initialPlatform?: string | undefined) => {
  container: HTMLElement;
  rerender: (initialPlatform?: string | undefined) => void;
} = (
  initialPlatform?: string | undefined,
): {
  container: HTMLElement;
  rerender: (initialPlatform?: string | undefined) => void;
} => {
  const result: ReturnType<typeof render> = render(cardFor(initialPlatform));
  return {
    container: result.container,
    rerender: (next?: string | undefined): void => {
      result.rerender(cardFor(next));
    },
  };
};

const descriptorOf: (
  platform: ManagedCloudPlatform,
) => ManagedCloudPlatformDescriptor = (
  platform: ManagedCloudPlatform,
): ManagedCloudPlatformDescriptor => {
  return MANAGED_CLOUD_PLATFORMS.find(
    (descriptor: ManagedCloudPlatformDescriptor): boolean => {
      return descriptor.platform === platform;
    },
  )!;
};

const escapeRegExp: (text: string) => string = (text: string): string => {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

/*
 * A platform's radio. Its accessible name is the product name followed by
 * the one-line description, so it is matched by prefix.
 */
const radioFor: (platform: ManagedCloudPlatform) => HTMLElement = (
  platform: ManagedCloudPlatform,
): HTMLElement => {
  return screen.getByRole("radio", {
    name: new RegExp(`^${escapeRegExp(descriptorOf(platform).productName)}`),
  });
};

const checkedPlatforms: () => Array<string> = (): Array<string> => {
  return screen
    .getAllByRole("radio")
    .filter((radio: HTMLElement): boolean => {
      return radio.getAttribute("aria-checked") === "true";
    })
    .map((radio: HTMLElement): string => {
      return radio.getAttribute("data-testid") || "";
    });
};

describe("CloudDocumentationCard", () => {
  beforeEach(() => {
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  describe("the platform picker", () => {
    beforeEach(() => {
      mockKeys([FIRST_KEY]);
    });

    test("asks where the app runs and offers exactly the registry's platforms", () => {
      renderCard(ManagedCloudPlatform.AwsEcs);

      expect(
        screen.getByRole("radiogroup", { name: "Where does your app run?" }),
      ).toBeInTheDocument();
      expect(screen.getAllByRole("radio")).toHaveLength(
        MANAGED_CLOUD_PLATFORMS.length,
      );

      for (const descriptor of MANAGED_CLOUD_PLATFORMS) {
        const radio: HTMLElement = radioFor(descriptor.platform);
        expect(radio).toHaveAttribute(
          "data-testid",
          `setup-guide-option-${descriptor.platform}`,
        );
        expect(radio.textContent).toContain(descriptor.description);
      }
    });

    test("groups the platforms under their provider's heading", () => {
      renderCard(ManagedCloudPlatform.AwsEcs);

      for (const provider of Object.values(CloudProvider)) {
        const heading: HTMLElement = screen.getByText(
          CLOUD_PROVIDER_LABELS[provider],
        );
        const group: HTMLElement = heading.parentElement as HTMLElement;

        expect(
          within(group)
            .getAllByRole("radio")
            .map((radio: HTMLElement): string | null => {
              return radio.getAttribute("data-testid");
            }),
        ).toEqual(
          MANAGED_CLOUD_PLATFORMS.filter(
            (descriptor: ManagedCloudPlatformDescriptor): boolean => {
              return descriptor.provider === provider;
            },
          ).map((descriptor: ManagedCloudPlatformDescriptor): string => {
            return `setup-guide-option-${descriptor.platform}`;
          }),
        );
      }
    });

    test("opens on the environment's own platform, with only its guide on screen", async () => {
      const { container } = renderCard(ManagedCloudPlatform.GcpCloudRun);

      expect(radioFor(ManagedCloudPlatform.GcpCloudRun)).toHaveAttribute(
        "aria-checked",
        "true",
      );
      expect(checkedPlatforms()).toHaveLength(1);

      await waitFor(() => {
        expect(container.textContent).toContain("cloud.platform=gcp_cloud_run");
      });
      expect(container.textContent).toContain("gcloud secrets create");
      expect(container.textContent).not.toContain(
        "aws secretsmanager create-secret",
      );
      expect(container.textContent).not.toContain("cloud.platform=aws_ecs");
    });

    test("falls back to AWS ECS when the platform is unknown or missing", async () => {
      for (const initialPlatform of ["aws_ec2", "", undefined]) {
        const { container } = renderCard(initialPlatform);

        expect(checkedPlatforms()).toEqual([
          `setup-guide-option-${ManagedCloudPlatform.AwsEcs}`,
        ]);
        await waitFor(() => {
          expect(container.textContent).toContain("cloud.platform=aws_ecs");
        });

        cleanup();
      }
    });

    test("follows a platform the page learns after mount, but never an unknown one", () => {
      const { container, rerender } = renderCard(undefined);
      expect(radioFor(ManagedCloudPlatform.AwsEcs)).toHaveAttribute(
        "aria-checked",
        "true",
      );

      rerender(ManagedCloudPlatform.GcpAppEngine);
      expect(radioFor(ManagedCloudPlatform.GcpAppEngine)).toHaveAttribute(
        "aria-checked",
        "true",
      );
      expect(container.textContent).toContain("gcloud app deploy");

      rerender("kubernetes");
      expect(radioFor(ManagedCloudPlatform.GcpAppEngine)).toHaveAttribute(
        "aria-checked",
        "true",
      );
    });

    test("switching the platform switches the guide and keeps the key", async () => {
      const { container } = renderCard(ManagedCloudPlatform.AwsEcs);

      await waitFor(() => {
        expect(container.textContent).toContain(
          "x-oneuptime-token: secret-production",
        );
      });
      expect(container.textContent).toContain(
        "aws secretsmanager create-secret",
      );

      fireEvent.click(radioFor(ManagedCloudPlatform.AzureContainerApps));

      const azure: ManagedCloudPlatformDescriptor = descriptorOf(
        ManagedCloudPlatform.AzureContainerApps,
      );
      expect(radioFor(ManagedCloudPlatform.AzureContainerApps)).toHaveAttribute(
        "aria-checked",
        "true",
      );
      expect(container.textContent).toContain(
        "cloud.platform=azure_container_apps",
      );
      expect(container.textContent).toContain("az containerapp secret set");
      expect(container.textContent).toContain("CONTAINER_APP_REPLICA_NAME");
      expect(container.textContent).not.toContain(
        "aws secretsmanager create-secret",
      );
      expect(
        screen.getByRole("link", {
          name: `${azure.productName} documentation`,
        }),
      ).toHaveAttribute("href", azure.docsUrl);
      // The key's secret follows the guide across the switch.
      expect(container.textContent).toContain(
        "x-oneuptime-token: secret-production",
      );
    });

    test("links every platform to its own docs page and to cloud troubleshooting", () => {
      renderCard(ManagedCloudPlatform.AwsEcs);

      for (const descriptor of MANAGED_CLOUD_PLATFORMS) {
        fireEvent.click(radioFor(descriptor.platform));
        expect(
          screen.getByRole("link", {
            name: `${descriptor.productName} documentation`,
          }),
        ).toHaveAttribute("href", descriptor.docsUrl);
        expect(
          screen.getByRole("link", { name: "Cloud troubleshooting" }),
        ).toHaveAttribute("href", "/docs/telemetry/cloud-troubleshooting");
      }
    });
  });

  describe("the ingestion key", () => {
    test("step 1 shows the OTLP endpoint, and the snippets carry the selected key's secret", async () => {
      const getList: jest.Mock<GetList> = mockKeys([FIRST_KEY]);
      const { container } = renderCard(ManagedCloudPlatform.AwsEcs);

      const first: HTMLElement = screen.getByTestId("setup-guide-step-1");
      await waitFor(() => {
        expect(within(first).getByText("OTLP Endpoint")).toBeInTheDocument();
      });
      expect(
        within(first).getByText(`${ONEUPTIME_URL}/otlp`),
      ).toBeInTheDocument();
      expect(first.textContent).toContain("Server key");

      await waitFor(() => {
        expect(container.textContent).toContain(
          "x-oneuptime-token: secret-production",
        );
      });
      expect(container.textContent).not.toContain(
        SETUP_GUIDE_API_KEY_PLACEHOLDER,
      );
      expect(container.textContent).not.toContain(
        "Pick an ingestion key in step 1",
      );

      /*
       * Only Server keys are offered (and made): a cloud workload is a
       * server, and its exporter sends no Origin header, so a Browser key
       * would be refused on every export.
       */
      const query: Record<string, unknown> = (
        getList.mock.calls[0]![0] as unknown as {
          query: Record<string, unknown>;
        }
      ).query;
      expect(query["keyType"]).toBe(TelemetryIngestionKeyType.Server);
    });

    test("before the project has a key, the snippets show the placeholder and say where to pick one", async () => {
      mockKeys([]);
      const { container } = renderCard(ManagedCloudPlatform.AwsEcs);

      await waitFor(() => {
        expect(screen.getByText("No ingestion keys yet")).toBeInTheDocument();
      });
      expect(container.textContent).toContain(
        `--secret-string "${SETUP_GUIDE_API_KEY_PLACEHOLDER}"`,
      );
      expect(container.textContent).toContain(
        "Pick an ingestion key in step 1",
      );
    });
  });

  describe("the steps", () => {
    beforeEach(() => {
      mockKeys([FIRST_KEY]);
    });

    test("step 1 is the key, then the secret, the task definition and the check", () => {
      renderCard(ManagedCloudPlatform.AwsEcs);

      expect(
        within(screen.getByTestId("setup-guide-step-1")).getByText(
          "Choose an ingestion key",
        ),
      ).toBeInTheDocument();
      expect(
        within(screen.getByTestId("setup-guide-step-2")).getByText(
          "Store the token in Secrets Manager",
        ),
      ).toBeInTheDocument();
      expect(
        within(screen.getByTestId("setup-guide-step-3")).getByText(
          "Update the task definition",
        ),
      ).toBeInTheDocument();
      expect(
        within(screen.getByTestId("setup-guide-step-4")).getByText(
          "Verify the connection",
        ),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId("setup-guide-step-5"),
      ).not.toBeInTheDocument();
    });

    test("the sidecar and SDK-direct tabs switch the task definition", async () => {
      const { container } = renderCard(ManagedCloudPlatform.AwsEcs);
      await waitFor(() => {
        expect(container.textContent).toContain(
          '--secret-string "secret-production"',
        );
      });

      const step: HTMLElement = screen.getByTestId("setup-guide-step-3");
      const tabs: Array<HTMLElement> = within(step).getAllByRole("tab");
      expect(
        tabs.map((tab: HTMLElement): string | null => {
          return tab.textContent;
        }),
      ).toEqual(["Sidecar collector", "SDK direct"]);
      expect(step.textContent).toContain("awsecscontainermetrics");
      expect(step.textContent).not.toContain(
        "OTEL_NODE_RESOURCE_DETECTORS=env,host,os,aws",
      );

      fireEvent.click(tabs[1]!);

      expect(step.textContent).toContain(
        "OTEL_NODE_RESOURCE_DETECTORS=env,host,os,aws",
      );
      expect(step.textContent).not.toContain("awsecscontainermetrics");
      /*
       * The same shape is picked for the whole guide: the step that stores
       * the token switches to its SDK-direct tab too.
       */
      const storeStep: HTMLElement = screen.getByTestId("setup-guide-step-2");
      expect(
        within(storeStep).getByRole("tab", { name: "SDK direct" }),
      ).toHaveAttribute("aria-selected", "true");
      expect(
        within(storeStep).getByRole("tab", { name: "Sidecar collector" }),
      ).toHaveAttribute("aria-selected", "false");
    });

    test("a platform with one shape has no tabs", () => {
      renderCard(ManagedCloudPlatform.AwsAppRunner);
      expect(screen.queryAllByRole("tab")).toEqual([]);
    });

    test("Advanced and Troubleshooting stay folded until opened", () => {
      renderCard(ManagedCloudPlatform.AwsEcs);

      const advanced: HTMLElement = screen.getByTestId(
        "setup-guide-advanced-toggle",
      );
      expect(advanced).toHaveAttribute("aria-expanded", "false");
      expect(
        screen.queryByText("Networking and permissions"),
      ).not.toBeInTheDocument();

      fireEvent.click(advanced);

      expect(
        screen.getByText("Networking and permissions"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("How the environment is identified"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("What the environment shows"),
      ).toBeInTheDocument();

      const troubleshooting: HTMLElement = screen.getByTestId(
        "setup-guide-troubleshooting-toggle",
      );
      expect(troubleshooting).toHaveAttribute("aria-expanded", "false");
      fireEvent.click(troubleshooting);
      expect(
        screen.getByText('Task stuck in PENDING with "unable to pull secrets"'),
      ).toBeInTheDocument();
    });
  });
});
