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
import DockerDocumentationCard from "../../../../App/FeatureSet/Dashboard/src/Components/Docker/DocumentationCard";
import PodmanDocumentationCard from "../../../../App/FeatureSet/Dashboard/src/Components/Podman/DocumentationCard";
import DockerSwarmDocumentationCard from "../../../../App/FeatureSet/Dashboard/src/Components/DockerSwarm/DocumentationCard";
import { SETUP_GUIDE_API_KEY_PLACEHOLDER } from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/SetupGuide";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import TelemetryIngestionKey from "../../../Models/DatabaseModels/TelemetryIngestionKey";
import TelemetryIngestionKeyType from "../../../Types/Telemetry/TelemetryIngestionKeyType";
import ObjectID from "../../../Types/ObjectID";

/*
 * The Docker, Podman and Docker Swarm cards as they reach the screen: the
 * question at the top, the default way of running the agent, the key in the
 * commands, the host or cluster a resource's own tab installs for, and —
 * for Docker Swarm — exactly what the E2E spec does after creating a key.
 *
 * The markdown viewer is a lazy boundary; it renders as plain text here
 * (as in SetupGuideCard.test.tsx), because these tests are about which
 * content is on screen, not how markdown is styled.
 */

interface MarkdownViewerProps {
  text: string;
}

jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (props: MarkdownViewerProps): React.ReactElement => {
      return React.createElement("div", {}, props.text);
    },
  };
});

const PROJECT_ID: ObjectID = new ObjectID("project-1");
// Ingestion keys are UUIDs; the Docker Swarm E2E spec matches that shape.
const SECRET: string = "0f8fad5b-d9cb-469f-a165-70867728950e";

const makeKey: (secret: string) => TelemetryIngestionKey = (
  secret: string,
): TelemetryIngestionKey => {
  const key: TelemetryIngestionKey = new TelemetryIngestionKey();
  key.id = new ObjectID("key-1");
  key.name = "Production Key";
  key.secretKey = new ObjectID(secret);
  key.keyType = TelemetryIngestionKeyType.Server;
  return key;
};

const mockKeys: (keys: Array<TelemetryIngestionKey>) => void = (
  keys: Array<TelemetryIngestionKey>,
): void => {
  jest.spyOn(ModelAPI, "getList").mockResolvedValue({
    data: keys,
    count: keys.length,
    skip: 0,
    limit: 50,
  } as never);
};

const renderInRouter: (element: React.ReactElement) => HTMLElement = (
  element: React.ReactElement,
): HTMLElement => {
  return render(<MemoryRouter>{element}</MemoryRouter>).container;
};

// Lets the key selector finish loading an empty project's keys.
const waitForNoKeys: () => Promise<void> = async (): Promise<void> => {
  await waitFor(() => {
    expect(screen.getByText("No ingestion keys yet")).toBeInTheDocument();
  });
};

const radio: (name: RegExp) => HTMLElement = (name: RegExp): HTMLElement => {
  return screen.getByRole("radio", { name: name });
};

/*
 * The key selector shows the secret before it hands the key to the card, so
 * wait for text only the guide itself renders once it has the key.
 */
const waitForText: (
  container: HTMLElement,
  text: string,
) => Promise<void> = async (
  container: HTMLElement,
  text: string,
): Promise<void> => {
  await waitFor(() => {
    expect(container.textContent).toContain(text);
  });
};

describe("the container setup guide cards", () => {
  beforeEach(() => {
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  describe("Docker", () => {
    test("asks how the agent runs and opens on the Docker CLI", async () => {
      mockKeys([makeKey(SECRET)]);
      const container: HTMLElement = renderInRouter(
        <DockerDocumentationCard title="Connect a host" description="Guide." />,
      );

      expect(
        screen.getByRole("radiogroup", {
          name: "How do you want to run the agent?",
        }),
      ).toBeInTheDocument();
      expect(screen.getAllByRole("radio")).toHaveLength(2);
      expect(radio(/^Docker CLI/)).toHaveAttribute("aria-checked", "true");
      expect(radio(/^Docker Compose/)).toHaveAttribute("aria-checked", "false");
      expect(
        within(screen.getByTestId("setup-guide-step-2")).getByText(
          "Run the agent",
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          "The agent sends this host's metrics and logs to OneUptime with this key. Pick an existing key or create a new one — the commands below update to use it.",
        ),
      ).toBeInTheDocument();

      await waitForText(container, `-e ONEUPTIME_SERVICE_TOKEN="${SECRET}"`);
      expect(container.textContent).toContain("docker run -d");
      expect(container.textContent).not.toContain("docker compose up -d");
    });

    test("Docker Compose swaps in the compose file, with the same key", async () => {
      mockKeys([makeKey(SECRET)]);
      const container: HTMLElement = renderInRouter(
        <DockerDocumentationCard title="Connect a host" description="Guide." />,
      );
      await waitForText(container, `-e ONEUPTIME_SERVICE_TOKEN="${SECRET}"`);

      fireEvent.click(radio(/^Docker Compose/));

      expect(screen.getByText("Create docker-compose.yml")).toBeInTheDocument();
      expect(container.textContent).toContain(
        `- ONEUPTIME_SERVICE_TOKEN=${SECRET}`,
      );
      expect(container.textContent).toContain("docker compose up -d");
      expect(container.textContent).not.toContain("docker run -d");
    });

    test("a host's own tab installs for that host", async () => {
      mockKeys([]);
      const container: HTMLElement = renderInRouter(
        <DockerDocumentationCard
          title="Agent Installation Guide"
          description="Guide."
          hostName="prod-docker-01"
        />,
      );
      expect(container.textContent).toContain(
        '-e DOCKER_HOST_NAME="prod-docker-01"',
      );
      expect(container.textContent).not.toContain("my-docker-host");
      await waitForNoKeys();
    });

    test("shows the placeholder until the project has a key", async () => {
      mockKeys([]);
      const container: HTMLElement = renderInRouter(
        <DockerDocumentationCard title="Connect a host" description="Guide." />,
      );
      await waitForNoKeys();
      expect(container.textContent).toContain(
        `-e ONEUPTIME_SERVICE_TOKEN="${SETUP_GUIDE_API_KEY_PLACEHOLDER}"`,
      );
    });
  });

  describe("Podman", () => {
    test("asks how the agent runs and opens on the Podman CLI", async () => {
      mockKeys([makeKey(SECRET)]);
      const container: HTMLElement = renderInRouter(
        <PodmanDocumentationCard title="Connect a host" description="Guide." />,
      );

      expect(
        screen.getByRole("radiogroup", {
          name: "How do you want to run the agent?",
        }),
      ).toBeInTheDocument();
      expect(radio(/^Podman CLI/)).toHaveAttribute("aria-checked", "true");

      await waitForText(container, `-e ONEUPTIME_SERVICE_TOKEN="${SECRET}"`);
      expect(container.textContent).toContain("podman run -d");
      // The log driver note is on screen before anything is folded open.
      expect(container.textContent).toContain("Metrics but no logs?");

      fireEvent.click(radio(/^Podman Compose/));

      expect(container.textContent).toContain(
        `- ONEUPTIME_SERVICE_TOKEN=${SECRET}`,
      );
      expect(container.textContent).toContain("podman compose up -d");
      expect(container.textContent).not.toContain("podman run -d");
    });

    test("a host's own tab installs for that host", async () => {
      mockKeys([]);
      const container: HTMLElement = renderInRouter(
        <PodmanDocumentationCard
          title="Agent Installation Guide"
          description="Guide."
          hostName="prod-podman-01"
        />,
      );
      expect(container.textContent).toContain(
        '-e PODMAN_HOST_NAME="prod-podman-01"',
      );
      expect(container.textContent).not.toContain("my-podman-host");
      await waitForNoKeys();
    });
  });

  describe("Docker Swarm", () => {
    test("opens on the install script, which asks for the URL and key itself", async () => {
      mockKeys([makeKey(SECRET)]);
      const container: HTMLElement = renderInRouter(
        <DockerSwarmDocumentationCard
          title="Getting Started with Docker Swarm Monitoring"
          description="Guide."
        />,
      );

      expect(
        screen.getByRole("radiogroup", {
          name: "How do you want to install the agent?",
        }),
      ).toBeInTheDocument();
      expect(radio(/^Install script/)).toHaveAttribute("aria-checked", "true");
      expect(
        within(screen.getByTestId("setup-guide-step-1")).getByText(
          /the install script asks for it/,
        ),
      ).toBeInTheDocument();
      expect(container.textContent).toContain("sh install.sh");

      // The key is on screen in step 1, never in the script's command.
      await waitForText(container, SECRET);
      expect(
        screen.getByTestId("setup-guide-step-2").textContent,
      ).not.toContain(SECRET);
      expect(container.textContent).not.toContain("ONEUPTIME_SERVICE_TOKEN=");
    });

    test("an empty project gets the create-key button the E2E spec clicks", async () => {
      mockKeys([]);
      renderInRouter(
        <DockerSwarmDocumentationCard
          title="Getting Started with Docker Swarm Monitoring"
          description="Guide."
        />,
      );
      await waitForNoKeys();
      expect(
        screen.getByRole("button", { name: "Create Ingestion Key" }),
      ).toBeInTheDocument();
      expect(
        screen.getByText("Getting Started with Docker Swarm Monitoring"),
      ).toBeInTheDocument();
    });

    test("with a key, picking Docker Compose shows the .env the E2E spec reads", async () => {
      mockKeys([makeKey(SECRET)]);
      const container: HTMLElement = renderInRouter(
        <DockerSwarmDocumentationCard
          title="Getting Started with Docker Swarm Monitoring"
          description="Guide."
        />,
      );
      await waitForText(container, SECRET);

      // The spec's lookup finds exactly one radio.
      expect(
        screen.getAllByRole("radio", { name: /Docker Compose/ }),
      ).toHaveLength(1);
      fireEvent.click(screen.getByRole("radio", { name: /Docker Compose/ }));
      await waitForText(container, `ONEUPTIME_SERVICE_TOKEN=${SECRET}`);

      const text: string = container.textContent || "";
      expect(text).toMatch(/ONEUPTIME_SERVICE_TOKEN=([0-9a-fA-F-]{36})/);
      expect(text.match(/ONEUPTIME_SERVICE_TOKEN=([0-9a-fA-F-]{36})/)![1]).toBe(
        SECRET,
      );
      expect(text).toMatch(/ONEUPTIME_URL=/);
      expect(text).toContain("DOCKER_SWARM_CLUSTER_NAME=my-swarm");
      expect(text).toContain("docker compose up -d");
      expect(text).not.toContain(SETUP_GUIDE_API_KEY_PLACEHOLDER);
      expect(
        within(screen.getByTestId("setup-guide-step-1")).getByText(
          /the \.env file below updates to use it/,
        ),
      ).toBeInTheDocument();
    });

    test("a cluster's own tab installs for that cluster", async () => {
      mockKeys([]);
      const container: HTMLElement = renderInRouter(
        <DockerSwarmDocumentationCard
          title="Agent Installation Guide"
          description="Guide."
          clusterName="prod-swarm-eu"
        />,
      );
      expect(container.textContent).toContain("**`prod-swarm-eu`**");

      fireEvent.click(radio(/^Docker Compose/));

      expect(container.textContent).toContain(
        "DOCKER_SWARM_CLUSTER_NAME=prod-swarm-eu",
      );
      expect(container.textContent).not.toContain("my-swarm");
      await waitForNoKeys();
    });
  });
});
