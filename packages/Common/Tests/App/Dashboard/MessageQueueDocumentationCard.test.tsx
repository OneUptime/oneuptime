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
import MessageQueueDocumentationCard from "../../../../App/FeatureSet/Dashboard/src/Pages/MessageQueue/Utils/MessageQueueDocumentationCard";
import {
  MESSAGE_QUEUE_SETUP_GUIDE_OPTIONS,
  MessageQueueDocumentationTarget,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/MessageQueue/Utils/DocumentationMarkdown";
import {
  SETUP_GUIDE_API_KEY_PLACEHOLDER,
  SetupGuideOption,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/SetupGuide";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import TelemetryIngestionKey from "../../../Models/DatabaseModels/TelemetryIngestionKey";
import TelemetryIngestionKeyType from "../../../Types/Telemetry/TelemetryIngestionKeyType";
import ObjectID from "../../../Types/ObjectID";
import {
  MESSAGING_SYSTEMS,
  MessagingSystemDescriptor,
} from "../../../Types/MessageQueue/MessagingSystem";

/*
 * The Queues setup guide as it reaches the screen, on the shared
 * SetupGuideCard, in its two modes:
 *
 *   - the product Documentation page and the empty list (no `queue`): a
 *     "Which messaging system?" radio group over the catalog, alphabetical,
 *     opening on Apache Kafka, and only the picked system's guide below it;
 *   - a queue's own Documentation tab: no picker, the guide of the queue's
 *     own system prefilled for its destination, namespace and broker.
 *
 * Only Server keys are offered (applications' exporters and collectors send
 * no Origin header, so a Browser key would be refused on every export), and
 * the picked key lands in every snippet the reader copies — the
 * placeholders until one is picked.
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

const makeKey: () => TelemetryIngestionKey = (): TelemetryIngestionKey => {
  const key: TelemetryIngestionKey = new TelemetryIngestionKey();
  key.id = new ObjectID("key-1");
  key.name = "Production Key";
  key.secretKey = new ObjectID("secret-production");
  key.keyType = TelemetryIngestionKeyType.Server;
  return key;
};

type GetList = typeof ModelAPI.getList;

interface ListArguments {
  query: Record<string, unknown>;
}

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

const renderCard: (queue?: MessageQueueDocumentationTarget) => HTMLElement = (
  queue?: MessageQueueDocumentationTarget,
): HTMLElement => {
  const { container } = render(
    <MemoryRouter>
      <MessageQueueDocumentationCard
        title="Queues Installation Guide"
        description="Queues appear on their own."
        queue={queue}
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

const systemRadio: (label: string) => HTMLElement = (
  label: string,
): HTMLElement => {
  return screen.getByRole("radio", { name: label });
};

describe("MessageQueueDocumentationCard", () => {
  beforeEach(() => {
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  describe("on the product page", () => {
    test("asks which messaging system, offering every catalog system alphabetically, and opens on Apache Kafka", () => {
      mockKeys([]);
      const container: HTMLElement = renderCard();

      const picker: HTMLElement = screen.getByRole("radiogroup", {
        name: "Which messaging system?",
      });
      const labels: Array<string> = within(picker)
        .getAllByRole("radio")
        .map((radio: HTMLElement): string => {
          return radio.textContent || "";
        });
      expect(labels).toEqual(
        MESSAGE_QUEUE_SETUP_GUIDE_OPTIONS.map(
          (option: SetupGuideOption): string => {
            return option.label;
          },
        ),
      );
      expect([...labels].sort()).toEqual(
        MESSAGING_SYSTEMS.map(
          (descriptor: MessagingSystemDescriptor): string => {
            return descriptor.displayName;
          },
        ).sort(),
      );
      expect(labels).toEqual(
        [...labels].sort((a: string, b: string): number => {
          return a.localeCompare(b);
        }),
      );

      expect(systemRadio("Apache Kafka")).toHaveAttribute(
        "aria-checked",
        "true",
      );
      expect(
        within(picker)
          .getAllByRole("radio")
          .filter((radio: HTMLElement): boolean => {
            return radio.getAttribute("aria-checked") === "true";
          }),
      ).toHaveLength(1);
      // A long list of short names: pills, the messaging.system as a tooltip.
      expect(systemRadio("Azure Service Bus")).toHaveAttribute(
        "title",
        "messaging.system: servicebus",
      );

      // Kafka's guide is on screen: its receiver, and no other system's.
      expect(container.textContent).toContain("Queues Installation Guide");
      expect(stepTitle(1)).toBe("Choose an ingestion key");
      expect(stepTitle(2)).toBe("Instrument the applications that use them");
      expect(stepTitle(3)).toBe("Send the broker's metrics");
      expect(stepTitle(4)).toBe("Check that your queues appear");
      expect(container.textContent).toContain(
        "Apache Kafka queues appear in OneUptime on their own",
      );
      expect(container.textContent).toContain("kafka_metrics:");
      expect(container.textContent).not.toContain("azure_monitor");
    });

    test("picking another system swaps the guide", () => {
      mockKeys([]);
      const container: HTMLElement = renderCard();

      fireEvent.click(systemRadio("Azure Service Bus"));

      expect(systemRadio("Azure Service Bus")).toHaveAttribute(
        "aria-checked",
        "true",
      );
      expect(systemRadio("Apache Kafka")).toHaveAttribute(
        "aria-checked",
        "false",
      );
      expect(container.textContent).toContain(
        "Azure Service Bus queues appear in OneUptime on their own",
      );
      expect(container.textContent).toContain("azure_monitor/servicebus");
      expect(container.textContent).not.toContain("kafka_metrics");

      fireEvent.click(systemRadio("Apache Pulsar"));

      expect(container.textContent).toContain("job_name: pulsar-broker");
      expect(container.textContent).not.toContain("azure_monitor");
    });

    test("a system with no ready-made metrics path has no broker step", () => {
      mockKeys([]);
      const container: HTMLElement = renderCard();

      fireEvent.click(systemRadio("JMS"));

      expect(stepTitle(2)).toBe("Instrument the applications that use them");
      expect(stepTitle(3)).toBe("Check that your queues appear");
      expect(
        screen.queryByTestId("setup-guide-step-4"),
      ).not.toBeInTheDocument();
      expect(container.textContent).toContain("JMS is an API");
      // The ActiveMQ scraper is folded under Advanced.
      expect(container.textContent).not.toContain("opentelemetry-jmx-scraper");
      openTopic("setup-guide-advanced", "If the broker is Apache ActiveMQ");
      expect(container.textContent).toContain(
        "java -jar opentelemetry-jmx-scraper.jar",
      );
    });

    test("BullMQ tags its telemetry in the collector and reports its depth", () => {
      mockKeys([]);
      const container: HTMLElement = renderCard();

      fireEvent.click(systemRadio("BullMQ"));

      expect(stepTitle(2)).toBe("Tag BullMQ's telemetry in your collector");
      expect(stepTitle(3)).toBe("Report the queue's depth");
      expect(container.textContent).toContain("transform/bullmq:");
      expect(container.textContent).toContain(
        'createObservableGauge("queue.size"',
      );
    });

    test("folds the charted metrics and troubleshooting", () => {
      mockKeys([]);
      const container: HTMLElement = renderCard();

      expect(screen.getByTestId("setup-guide-advanced-toggle")).toHaveAttribute(
        "aria-expanded",
        "false",
      );
      expect(container.textContent).not.toContain("| Metric | Shown as |");

      openTopic("setup-guide-advanced", "What a queue's page charts");
      expect(container.textContent).toContain(
        "| `kafka.consumer_group.lag_sum` | Consumer lag | Gauge |",
      );

      expect(
        screen.getByTestId("setup-guide-troubleshooting-toggle"),
      ).toHaveAttribute("aria-expanded", "false");
      openTopic("setup-guide-troubleshooting", "Broker health stays empty");
      expect(container.textContent).toContain(
        "reports a consumer group's lag only after the group commits an offset",
      );
    });

    test("links the system's docs section and the Queues page", () => {
      mockKeys([]);
      renderCard();

      const links: HTMLElement = screen.getByTestId("setup-guide-links");
      expect(
        within(links)
          .getAllByRole("link")
          .map((link: HTMLElement): string => {
            return link.getAttribute("href") || "";
          }),
      ).toEqual([
        "/docs/telemetry/queues#apache-kafka",
        "/docs/telemetry/queues",
      ]);

      fireEvent.click(systemRadio("RabbitMQ"));
      expect(
        within(screen.getByTestId("setup-guide-links"))
          .getAllByRole("link")[0]!
          .getAttribute("href"),
      ).toBe("/docs/telemetry/queues#rabbitmq");
    });
  });

  describe("the ingestion key", () => {
    test("step 1 shows the OTLP endpoint", async () => {
      mockKeys([makeKey()]);
      renderCard();

      const first: HTMLElement = screen.getByTestId("setup-guide-step-1");
      await waitFor(() => {
        expect(within(first).getByText("OTLP Endpoint")).toBeInTheDocument();
      });
      expect(first.textContent).toContain("a Server key");
    });

    test("offers only Server keys, whichever system is picked", async () => {
      const getList: jest.Mock<GetList> = mockKeys([makeKey()]);
      const container: HTMLElement = renderCard();

      await waitFor(() => {
        expect(container.textContent).toContain(
          'x-oneuptime-token: "secret-production"',
        );
      });
      for (const label of ["Azure Service Bus", "BullMQ", "Amazon SQS"]) {
        fireEvent.click(systemRadio(label));
      }

      expect(getList).toHaveBeenCalled();
      for (const call of getList.mock.calls) {
        expect((call[0] as unknown as ListArguments).query["keyType"]).toBe(
          TelemetryIngestionKeyType.Server,
        );
      }
    });

    test("the picked key lands in every snippet, and follows a pick", async () => {
      mockKeys([makeKey()]);
      const container: HTMLElement = renderCard();

      await waitFor(() => {
        expect(container.textContent).toContain(
          'OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-token=secret-production"',
        );
      });
      expect(container.textContent).toContain(
        'x-oneuptime-token: "secret-production"',
      );
      expect(container.textContent).not.toContain(
        SETUP_GUIDE_API_KEY_PLACEHOLDER,
      );
      expect(container.textContent).not.toContain(
        "Pick an ingestion key in step 1",
      );

      fireEvent.click(systemRadio("Amazon SQS"));
      expect(container.textContent).toContain("aws_cloudwatch/sqs:");
      expect(container.textContent).toContain(
        'x-oneuptime-token: "secret-production"',
      );
      expect(container.textContent).not.toContain(
        SETUP_GUIDE_API_KEY_PLACEHOLDER,
      );
    });

    test("with no ingestion key yet, the guide keeps its placeholders and says where to pick one", async () => {
      mockKeys([]);
      const container: HTMLElement = renderCard();

      await waitFor(() => {
        expect(screen.getByText("No ingestion keys yet")).toBeInTheDocument();
      });
      expect(container.textContent).toContain(
        `x-oneuptime-token: "${SETUP_GUIDE_API_KEY_PLACEHOLDER}"`,
      );
      expect(container.textContent).toContain(
        `Pick an ingestion key in step 1 to fill in \`${SETUP_GUIDE_API_KEY_PLACEHOLDER}\`.`,
      );
    });
  });

  describe("on a queue's own tab", () => {
    test("has no picker, and the guide is prefilled for the queue", async () => {
      mockKeys([makeKey()]);
      const container: HTMLElement = renderCard({
        system: "kafka",
        destination: "orders",
        brokerAddress: "kafka-1.internal:9093",
      });

      expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
      expect(screen.queryAllByRole("radio")).toHaveLength(0);
      expect(stepTitle(2)).toBe("Instrument the applications that use it");
      expect(stepTitle(4)).toBe("Check that this queue fills in");
      expect(container.textContent).toContain(
        "This is the Apache Kafka queue `orders`.",
      );
      expect(container.textContent).toContain(
        'brokers: ["kafka-1.internal:9093"]',
      );
      await waitFor(() => {
        expect(container.textContent).toContain(
          'x-oneuptime-token: "secret-production"',
        );
      });

      openTopic("setup-guide-advanced", "How telemetry finds this queue");
      expect(container.textContent).toContain(
        "- **Broker metrics**: `topic` = `orders`.",
      );
    });

    test("an Azure queue is prefilled with its namespace", () => {
      mockKeys([]);
      const container: HTMLElement = renderCard({
        system: "servicebus",
        destination: "orders",
        brokerScope: "shop-prod",
      });

      expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
      expect(container.textContent).toContain(
        "This is the Azure Service Bus queue `orders` in the `shop-prod` namespace.",
      );
      expect(container.textContent).toContain("azure_monitor/servicebus");
      openTopic("setup-guide-advanced", "How telemetry finds this queue");
      expect(container.textContent).toContain(
        "from an SDK connected to `shop-prod.servicebus.windows.net`",
      );
    });

    test("the queue's own system, even one the catalog does not know", () => {
      mockKeys([]);
      const container: HTMLElement = renderCard({
        system: "ibmmq",
        destination: "DEV.QUEUE.1",
      });

      expect(container.textContent).toContain(
        "This is the ibmmq queue `DEV.QUEUE.1`.",
      );
      expect(container.textContent).not.toContain("kafka_metrics");
      expect(stepTitle(3)).toBe("Check that this queue fills in");
      expect(
        within(screen.getByTestId("setup-guide-links"))
          .getAllByRole("link")[0]!
          .getAttribute("href"),
      ).toBe("/docs/telemetry/queues#supported-messaging-systems");
    });
  });
});
