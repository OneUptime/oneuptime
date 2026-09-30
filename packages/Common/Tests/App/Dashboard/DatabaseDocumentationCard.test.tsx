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
import DatabaseDocumentationCard from "../../../../App/FeatureSet/Dashboard/src/Components/DatabaseServer/DocumentationCard";
import {
  DATABASE_AGENT_SYSTEM_OPTIONS,
  DatabaseDocumentationTarget,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DocumentationMarkdown";
import { SetupGuideOption } from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/SetupGuide";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import TelemetryIngestionKey from "../../../Models/DatabaseModels/TelemetryIngestionKey";
import TelemetryIngestionKeyType from "../../../Types/Telemetry/TelemetryIngestionKeyType";
import ObjectID from "../../../Types/ObjectID";

/*
 * The Database Agent guide as it reaches the screen, in its two modes:
 *
 *   - the product page (no `database`): an engine picker, and only the
 *     picked engine's grants, config and commands below it;
 *   - a database's own Documentation tab: no picker, this row's identity
 *     up front, a Kubernetes database's Deployment as the first install
 *     tab, and an engine the agent has no config for sent to its own
 *     collector.
 *
 * The markdown viewer is a lazy boundary; it renders its source as text
 * here (as in CloudDocumentationCard.test.tsx), since these tests are about
 * which guide is on screen, not how markdown is styled.
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
const DATABASE_ID: string = "3c1e9a52-1f2b-4c3d-9e8f-0a1b2c3d4e5f";

const makeKey: () => TelemetryIngestionKey = (): TelemetryIngestionKey => {
  const key: TelemetryIngestionKey = new TelemetryIngestionKey();
  key.id = new ObjectID("key-1");
  key.name = "Production Key";
  key.secretKey = new ObjectID("secret-production");
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

const renderCard: (database?: DatabaseDocumentationTarget) => HTMLElement = (
  database?: DatabaseDocumentationTarget,
): HTMLElement => {
  const { container } = render(
    <MemoryRouter>
      <DatabaseDocumentationCard
        title="Connect Database Engine Metrics"
        description="Install the agent next to a database."
        database={database}
      />
    </MemoryRouter>,
  );
  return container;
};

// A step's title, without the "Step N: " screen readers are told first.
const stepTitle: (stepNumber: number) => string = (
  stepNumber: number,
): string => {
  const heading: string =
    within(screen.getByTestId(`setup-guide-step-${stepNumber}`)).getByRole(
      "heading",
    ).textContent || "";
  expect(heading.startsWith(`Step ${stepNumber}: `)).toBe(true);
  return heading.substring(`Step ${stepNumber}: `.length);
};

const tabLabels: () => Array<string> = (): Array<string> => {
  return screen.getAllByRole("tab").map((tab: HTMLElement): string => {
    return tab.textContent || "";
  });
};

// Opens a folded section and one of its topics.
const openTopic: (sectionTestId: string, title: string) => void = (
  sectionTestId: string,
  title: string,
): void => {
  fireEvent.click(screen.getByTestId(`${sectionTestId}-toggle`));
  const topic: HTMLElement | undefined = screen
    .getAllByTestId("setup-guide-topic")
    .find((element: HTMLElement): boolean => {
      return (element.textContent || "").startsWith(title);
    });
  if (!topic) {
    throw new Error(`No topic titled "${title}" is on screen`);
  }
  fireEvent.click(within(topic).getByRole("button"));
};

describe("DatabaseDocumentationCard", () => {
  beforeEach(() => {
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  describe("on the product page", () => {
    test("asks which engine, offering every engine the agent monitors, PostgreSQL first", () => {
      mockKeys([]);
      renderCard();

      const picker: HTMLElement = screen.getByRole("radiogroup", {
        name: "Which database engine?",
      });
      const radios: Array<HTMLElement> = within(picker).getAllByRole("radio");
      expect(
        radios.map((radio: HTMLElement): string => {
          return radio.textContent || "";
        }),
      ).toEqual(
        DATABASE_AGENT_SYSTEM_OPTIONS.map(
          (option: SetupGuideOption): string => {
            return option.label;
          },
        ),
      );
      expect(screen.getByRole("radio", { name: "PostgreSQL" })).toHaveAttribute(
        "aria-checked",
        "true",
      );
      // A long list of short names: pills, the description as a tooltip.
      expect(screen.getByRole("radio", { name: "MariaDB" })).toHaveAttribute(
        "title",
        "Runs the mysql receiver and reports the server as MariaDB.",
      );
    });

    test("shows only the picked engine's steps, and switches with the pick", () => {
      mockKeys([]);
      const container: HTMLElement = renderCard();

      expect(stepTitle(2)).toBe("Create a monitoring user");
      expect(container.textContent).toContain(
        "GRANT pg_monitor TO oneuptime_monitor;",
      );
      expect(container.textContent).toContain(
        "DATABASE_SYSTEM=postgresql bash install.sh",
      );

      fireEvent.click(screen.getByRole("radio", { name: "MySQL" }));

      expect(screen.getByRole("radio", { name: "MySQL" })).toHaveAttribute(
        "aria-checked",
        "true",
      );
      expect(container.textContent).toContain(
        "GRANT PROCESS, REPLICATION CLIENT ON *.* TO 'oneuptime_monitor'@'%';",
      );
      expect(container.textContent).toContain(
        "DATABASE_SYSTEM=mysql bash install.sh",
      );
      expect(container.textContent).not.toContain("GRANT pg_monitor");
      expect(container.textContent).not.toContain("SLAVE MONITOR");

      fireEvent.click(screen.getByRole("radio", { name: "MariaDB" }));
      expect(container.textContent).toContain("SLAVE MONITOR");
      expect(container.textContent).toContain(
        "DATABASE_SYSTEM=mariadb bash install.sh",
      );
    });

    test("Memcached has no login to create, so the install is step 2", () => {
      mockKeys([]);
      renderCard();

      fireEvent.click(screen.getByRole("radio", { name: "Memcached" }));

      expect(stepTitle(2)).toBe("Install the agent");
      expect(stepTitle(3)).toBe("Verify the installation");
      expect(
        screen.getByTestId("setup-guide-prerequisites").textContent,
      ).toContain("without SASL authentication");
    });

    test("installs with the script or Docker Compose, the script first", () => {
      mockKeys([]);
      const container: HTMLElement = renderCard();

      expect(tabLabels()).toEqual(["Install script", "Docker Compose"]);
      expect(container.textContent).toContain("bash install.sh");
      expect(container.textContent).not.toContain("docker compose up -d");

      fireEvent.click(screen.getByRole("tab", { name: "Docker Compose" }));

      expect(container.textContent).toContain("docker compose up -d");
      expect(container.textContent).toContain(
        "/agents/DatabaseAgent/configs/postgresql.yaml -o otel-collector-config.yaml",
      );
    });

    test("puts the picked key on the install command line once there is one", async () => {
      mockKeys([makeKey()]);
      const container: HTMLElement = renderCard();

      await waitFor(() => {
        expect(container.textContent).toContain(
          "ONEUPTIME_TELEMETRY_INGESTION_KEY=secret-production DATABASE_SYSTEM=postgresql bash install.sh",
        );
      });
      expect(container.textContent).not.toContain("<YOUR_API_KEY>");
      expect(container.textContent).not.toContain(
        "the ingestion key from step 1",
      );

      // The key follows the guide across a pick.
      fireEvent.click(screen.getByRole("radio", { name: "Redis" }));
      expect(container.textContent).toContain(
        "ONEUPTIME_TELEMETRY_INGESTION_KEY=secret-production DATABASE_SYSTEM=redis bash install.sh",
      );
    });

    test("without a key, the command carries none and says the script asks for it", async () => {
      mockKeys([]);
      const container: HTMLElement = renderCard();

      await waitFor(() => {
        expect(screen.getByText("No ingestion keys yet")).toBeInTheDocument();
      });
      expect(container.textContent).toContain(
        "\nDATABASE_SYSTEM=postgresql bash install.sh",
      );
      expect(container.textContent).not.toContain(
        "ONEUPTIME_TELEMETRY_INGESTION_KEY=",
      );
      expect(container.textContent).toContain("the ingestion key from step 1");
    });

    test("folds the reference material, and links the Database Health monitor's form", () => {
      mockKeys([]);
      const container: HTMLElement = renderCard();

      expect(screen.getByTestId("setup-guide-advanced-toggle")).toHaveAttribute(
        "aria-expanded",
        "false",
      );
      expect(container.textContent).not.toContain("| Variable | Required |");

      openTopic(
        "setup-guide-advanced",
        "No agent? Use a Database Health monitor",
      );

      expect(container.textContent).toContain(
        `[create a Database Health monitor](/dashboard/${PROJECT_ID.toString()}/monitors/create?monitorType=Database)`,
      );
    });
  });

  describe("on a database's own tab", () => {
    const row: DatabaseDocumentationTarget = {
      id: DATABASE_ID,
      dbSystem: "postgresql",
      serverAddress: "db.prod.internal",
      serverPort: 5432,
      endpoints: ["db.prod.internal:5432"],
    };

    test("has no picker, and opens with this database's identity", () => {
      mockKeys([]);
      const container: HTMLElement = renderCard(row);

      expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
      expect(container.textContent).toContain("**This database**");
      expect(container.textContent).toContain(
        `| \`DATABASE_SERVER_ID\` | \`${DATABASE_ID}\` |`,
      );
      expect(container.textContent).toContain(
        `DATABASE_SYSTEM=postgresql DATABASE_SERVER_ADDRESS=db.prod.internal DATABASE_SERVER_PORT=5432 DATABASE_SERVER_ID=${DATABASE_ID} bash install.sh`,
      );
      expect(tabLabels()).toEqual(["Install script", "Docker Compose"]);
    });

    test("links the row's Recommendations tab from Alert on this database", () => {
      mockKeys([]);
      const container: HTMLElement = renderCard(row);

      openTopic("setup-guide-advanced", "Alert on this database");

      expect(container.textContent).toContain(
        `The [Recommendations](/dashboard/${PROJECT_ID.toString()}/databases/${DATABASE_ID}/recommendations) tab offers ready-made PostgreSQL monitors`,
      );
    });

    test("a fork's row installs under its own name with its family's config", () => {
      mockKeys([]);
      const container: HTMLElement = renderCard({
        id: DATABASE_ID,
        dbSystem: "valkey",
        serverAddress: "cache.prod.internal",
      });

      expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
      expect(container.textContent).toContain(
        "Valkey, KeyDB and Dragonfly take the same ACL.",
      );
      expect(container.textContent).toContain(
        `DATABASE_SYSTEM=valkey DATABASE_SERVER_ADDRESS=cache.prod.internal DATABASE_SERVER_PORT=6379 DATABASE_SERVER_ID=${DATABASE_ID} bash install.sh`,
      );
    });

    test("a Kubernetes database opens on its Deployment", () => {
      mockKeys([]);
      const container: HTMLElement = renderCard({
        id: DATABASE_ID,
        dbSystem: "postgresql",
        endpoints: ["postgres.payments.svc.cluster.local:5432@prod"],
        kubernetesNamespace: "payments",
        isKubernetes: true,
      });

      expect(tabLabels()).toEqual([
        "Kubernetes",
        "Install script",
        "Docker Compose",
      ]);
      expect(screen.getByRole("tab", { name: "Kubernetes" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      expect(container.textContent).toContain(
        "kubectl -n payments create configmap oneuptime-database-agent",
      );
      expect(container.textContent).toContain("namespace: payments");
      expect(container.textContent).not.toContain("bash install.sh\n");
    });

    test("an engine the agent has no config for gets its own collector's config", async () => {
      mockKeys([makeKey()]);
      const container: HTMLElement = renderCard({
        id: DATABASE_ID,
        dbSystem: "couchdb",
        serverAddress: "couch.example.com",
      });

      expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
      expect(stepTitle(2)).toBe("Add the couchdb receiver to your collector");
      expect(stepTitle(3)).toBe("Verify the metrics arrive");
      expect(screen.queryAllByRole("tab")).toHaveLength(0);
      expect(container.textContent).not.toContain("install.sh");

      // Step 1 shows the OTLP endpoint the config exports to.
      const first: HTMLElement = screen.getByTestId("setup-guide-step-1");
      await waitFor(() => {
        expect(within(first).getByText("OTLP endpoint")).toBeInTheDocument();
      });
      await waitFor(() => {
        expect(container.textContent).toContain(
          'x-oneuptime-token: "secret-production"',
        );
      });
      expect(container.textContent).toContain(`value: "${DATABASE_ID}"`);
    });
  });
});
