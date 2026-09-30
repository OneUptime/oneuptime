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
import MessageQueueDocumentationCard, {
  DEFAULT_MESSAGE_QUEUE_GUIDE_SYSTEM,
  resolveMessageQueueGuideSystem,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/MessageQueue/Utils/MessageQueueDocumentationCard";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import TelemetryIngestionKey from "../../../Models/DatabaseModels/TelemetryIngestionKey";
import ObjectID from "../../../Types/ObjectID";
import {
  MESSAGING_SYSTEMS,
  MessagingSystemDescriptor,
} from "../../../Types/MessageQueue/MessagingSystem";

/*
 * The Queues setup guide with its messaging-system picker, as it reaches the
 * screen (the product Documentation page and the empty list). The picker
 * opens on the system it is given, falls back to Kafka for one the catalog
 * does not know, offers exactly the catalog's systems, re-renders the guide
 * when the selection changes, and hands the guide the selected ingestion
 * key rather than a placeholder.
 *
 * react-markdown is mocked in Common's jest config to render its children
 * as text, and the lazy viewer is replaced by a plain one (see
 * CloudDocumentationCard.test.tsx for why), so the container holds the
 * guide's markdown source.
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

const KEY: TelemetryIngestionKey = new TelemetryIngestionKey();
KEY.id = new ObjectID("key-1");
KEY.name = "Production Key";
KEY.secretKey = new ObjectID("secret-production");

function renderCard(initialSystem?: string | undefined): HTMLElement {
  const { container } = render(
    <MemoryRouter>
      <MessageQueueDocumentationCard
        title="Queues Installation Guide"
        description="Queues appear on their own."
        initialSystem={initialSystem}
      />
    </MemoryRouter>,
  );
  return container;
}

function systemPicker(): HTMLElement {
  return screen.getByRole("combobox", { name: "Select messaging system" });
}

function pickSystem(label: string): void {
  fireEvent.keyDown(systemPicker(), { key: "ArrowDown" });
  const option: HTMLElement = screen
    .getAllByText(label)
    .find((candidate: HTMLElement): boolean => {
      return candidate.closest('[role="option"]') !== null;
    })!;
  fireEvent.mouseDown(option);
  fireEvent.click(option);
}

describe("MessageQueueDocumentationCard", () => {
  beforeEach(() => {
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
    jest.spyOn(ModelAPI, "getList").mockResolvedValue({
      data: [KEY],
      count: 1,
      skip: 0,
      limit: 50,
    } as never);
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("opens on Kafka by default", async () => {
    const container: HTMLElement = renderCard();

    await waitFor(() => {
      expect(container.textContent).toContain("## Connect Apache Kafka");
    });
    expect(DEFAULT_MESSAGE_QUEUE_GUIDE_SYSTEM).toBe("kafka");
    expect(container.textContent).toContain("Queues Installation Guide");
  });

  test("opens on the system it is given, aliases included", async () => {
    const container: HTMLElement = renderCard("azure_servicebus");

    await waitFor(() => {
      expect(container.textContent).toContain("## Connect Azure Service Bus");
    });
    expect(container.textContent).toContain("azure_monitor/servicebus");
    expect(container.textContent).not.toContain("## Connect Apache Kafka");
  });

  test("falls back to Kafka for a system the catalog does not know", async () => {
    const container: HTMLElement = renderCard("ibmmq");

    await waitFor(() => {
      expect(container.textContent).toContain("## Connect Apache Kafka");
    });
    expect(resolveMessageQueueGuideSystem("ibmmq")).toBe("kafka");
    expect(resolveMessageQueueGuideSystem(undefined)).toBe("kafka");
    expect(resolveMessageQueueGuideSystem("AmazonSQS")).toBe("aws_sqs");
  });

  test("interpolates the selected key's secret, not the placeholder", async () => {
    const container: HTMLElement = renderCard("rabbitmq");

    await waitFor(() => {
      expect(container.textContent).toContain(
        'x-oneuptime-token: "secret-production"',
      );
    });
    expect(container.textContent).not.toContain("<YOUR_API_KEY>");
  });

  test("offers exactly the catalog's systems", async () => {
    renderCard();

    await waitFor(() => {
      expect(systemPicker()).toBeInTheDocument();
    });

    fireEvent.keyDown(systemPicker(), { key: "ArrowDown" });

    const options: Array<string> = screen
      .getAllByRole("option")
      .map((option: HTMLElement): string => {
        return option.textContent || "";
      });
    expect(options).toHaveLength(MESSAGING_SYSTEMS.length);
    for (const descriptor of MESSAGING_SYSTEMS) {
      expect(
        options.some((option: string): boolean => {
          return option.startsWith(descriptor.displayName);
        }),
      ).toBe(true);
    }
  });

  test("switching the system switches the guide", async () => {
    const container: HTMLElement = renderCard("kafka");

    await waitFor(() => {
      expect(container.textContent).toContain("## Connect Apache Kafka");
    });

    const pulsar: MessagingSystemDescriptor = MESSAGING_SYSTEMS.find(
      (descriptor: MessagingSystemDescriptor): boolean => {
        return descriptor.system === "pulsar";
      },
    )!;
    pickSystem(pulsar.displayName);

    await waitFor(() => {
      expect(container.textContent).toContain("## Connect Apache Pulsar");
    });
    expect(container.textContent).toContain("job_name: pulsar-broker");
    expect(container.textContent).not.toContain("## Connect Apache Kafka");
  });

  test("follows a system its parent learns later, but never an unknown one", async () => {
    const { container, rerender } = render(
      <MemoryRouter>
        <MessageQueueDocumentationCard
          title="Guide"
          description="Guide"
          initialSystem={undefined}
        />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(container.textContent).toContain("## Connect Apache Kafka");
    });

    rerender(
      <MemoryRouter>
        <MessageQueueDocumentationCard
          title="Guide"
          description="Guide"
          initialSystem="gcp_pubsub"
        />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(container.textContent).toContain(
        "## Connect Google Cloud Pub/Sub",
      );
    });

    rerender(
      <MemoryRouter>
        <MessageQueueDocumentationCard
          title="Guide"
          description="Guide"
          initialSystem="not-a-system"
        />
      </MemoryRouter>,
    );
    expect(container.textContent).toContain("## Connect Google Cloud Pub/Sub");
  });
});
