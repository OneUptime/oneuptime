import { BASE_URL } from "../../Config";
import {
  APIResponse,
  Browser,
  Locator,
  Page,
  expect,
  test,
} from "@playwright/test";
import URL from "Common/Types/API/URL";
import Faker from "Common/Utils/Faker";
import { JSONish, listItems } from "./Helpers/MonitorAlerting";
import {
  gotoProjectPage,
  registerAndCreateProject,
} from "./Helpers/ProductOnboarding";
import {
  createTelemetryIngestionKey,
  postOtlpMetrics,
  postOtlpTraces,
  waitForTelemetryText,
} from "./Helpers/Telemetry";

/*
 * Queues product: the path a person takes through it, in serial steps that
 * share one project (and one page).
 *
 *   1. Products → Resources → Queues opens the empty list, followed by the
 *      setup guide and its messaging-system picker.
 *   2. Create Queue adds an Apache Kafka queue for the topic `orders` by hand;
 *      its name opens the queue's page, where Broker health says where the
 *      broker's metrics come from.
 *   3. A fresh ingestion key sends, through the real /otlp endpoints, the
 *      PRODUCER and CONSUMER spans of a Kafka client for `orders` (one of them
 *      failed) and a kafka_metrics-shaped consumer-lag datapoint (topic=orders,
 *      group=billing) — plus, through the generic Telemetry helpers, a span
 *      and a metric that name no queue. The queue's Documentation tab is
 *      prefilled with the key.
 *   4. The Overview counts the published, consumed and failed spans and names
 *      the service on each side.
 *   5. Broker health charts Consumer lag; its Create monitor link opens
 *      Monitor Create with the metric and the topic filter filled in.
 *   6. The Traces tab lists the queue's spans, and not the unrelated span.
 *   7. The Metrics tab lists kafka.consumer_group.lag_sum, and not the
 *      unrelated metric.
 *   8. An Azure Service Bus queue added by hand in the namespace `shop-prod`
 *      charts Active messages from an azure_monitor-shaped datapoint.
 *   9. Settings archives a queue out of the list and restores it.
 *  10. Delete Queue removes a queue.
 *
 * Queue DISCOVERY is not exercised. The ComputeServiceDependencies cron that
 * creates queues from messaging spans and broker metrics runs every 10
 * minutes (and not on startup), far too slowly for a spec, so both queues are
 * added by hand. What joins the telemetry to them is ingest stamping the
 * queue's entity key on every span and datapoint that names it
 * (MessagingEntityKeys) — the key every Queue page is scoped by. Only that
 * cron's sightings set a queue's "Last seen", so it is not asserted here.
 *
 * Skip-gated to match the other Dashboard specs (CreateProject.spec.ts /
 * CreateMonitor.spec.ts) so CI behavior stays identical. To run locally
 * against a full stack, change `test.describe.skip` to `test.describe` and:
 *
 *   cd packages/E2E && HOST=localhost npx playwright test \
 *     Tests/Dashboard/MessageQueueProduct.spec.ts --project=chromium
 *
 * No broker, collector or instrumented application is required: the spec
 * posts minimal OTLP/JSON fixtures straight to /otlp/v1/traces and
 * /otlp/v1/metrics itself.
 */
test.describe.configure({ mode: "serial" });

/*
 * The destination both queues are named after: a Kafka topic and an Azure
 * Service Bus queue of the same name are two queues, because a queue's
 * identity is its system, its destination and (Service Bus / Event Hubs
 * only) its namespace.
 */
const DESTINATION: string = "orders";
const KAFKA_QUEUE_IDENTIFIER: string = "kafka||orders";
const KAFKA_CONSUMER_GROUP: string = "billing";

// kafka_metrics' consumer lag: a gauge, so it can be monitored.
const KAFKA_LAG_METRIC: string = "kafka.consumer_group.lag_sum";
// getMessageQueueMetricId: `${system}:${metricName}`.
const KAFKA_LAG_METRIC_ID: string = "kafka:kafka.consumer_group.lag_sum";
const KAFKA_LAG: number = 42;

/*
 * Span names as the current messaging semantic conventions spell them,
 * "{operation} {destination}".
 */
const PUBLISH_SPAN_NAME: string = "send orders";
const PROCESS_SPAN_NAME: string = "process orders";
/*
 * Three messages published, two of them processed, and the second of those
 * failed: one failed span of the queue's five.
 */
const PUBLISHED_MESSAGES: number = 3;
const PROCESSED_MESSAGES: number = 2;
const FAILED_MESSAGE_INDEX: number = 1;
const QUEUE_SPANS: number = PUBLISHED_MESSAGES + PROCESSED_MESSAGES;
// The Errors tile's sublabel, "20.0% of 5 spans": only there once all arrived.
const ERROR_RATE_SUBLABEL: string = `${(100 / QUEUE_SPANS).toFixed(1)}% of ${QUEUE_SPANS} spans`;

const SERVICE_BUS_NAMESPACE: string = "shop-prod";
const SERVICE_BUS_QUEUE_NAME: string = "Shop orders";
const SERVICE_BUS_QUEUE_IDENTIFIER: string = "servicebus|shop-prod|orders";
const SERVICE_BUS_ACTIVE_METRIC: string = "azure_activemessages_average";
const SERVICE_BUS_ACTIVE_METRIC_ID: string =
  "servicebus:azure_activemessages_average";
const SERVICE_BUS_ACTIVE_MESSAGES: number = 7;
const AZURE_SUBSCRIPTION_ID: string = "00000000-0000-4000-8000-000000000000";

// OTLP enum values (opentelemetry-proto trace.proto).
const OTLP_SPAN_KIND_PRODUCER: number = 4;
const OTLP_SPAN_KIND_CONSUMER: number = 5;
const OTLP_STATUS_CODE_OK: number = 1;
const OTLP_STATUS_CODE_ERROR: number = 2;

const MESSAGE_QUEUE_API_PATH: string = "/api/message-queue";

const urlFor: (path: string) => string = (path: string): string => {
  return URL.fromString(BASE_URL.toString()).addRoute(path).toString();
};

const queuesPath: (projectId: string) => string = (
  projectId: string,
): string => {
  return `/dashboard/${projectId}/queues`;
};

const queuePath: (projectId: string, queueId: string) => string = (
  projectId: string,
  queueId: string,
): string => {
  return `${queuesPath(projectId)}/${queueId}`;
};

// The Queues list, with or without the query string its filters may add.
const queuesListUrlRegex: (projectId: string) => RegExp = (
  projectId: string,
): RegExp => {
  return new RegExp(`/dashboard/${projectId}/queues/?(?:\\?.*)?$`);
};

type QueueIdFromUrlFunction = (url: string) => string;

const queueIdFromUrl: QueueIdFromUrlFunction = (url: string): string => {
  const match: RegExpMatchArray | null = url.match(
    /\/queues\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[/?#]|$)/,
  );
  expect(match, `No queue id in ${url}`).not.toBeNull();
  return match![1]!;
};

type ReadQueueFunction = (data: {
  page: Page;
  projectId: string;
  queueId: string;
}) => Promise<JSONish | null>;

/*
 * The queue as the server stored it (the CRUD API, which refreshes the
 * session cookie itself), or null once it is deleted.
 */
const readQueue: ReadQueueFunction = async (data: {
  page: Page;
  projectId: string;
  queueId: string;
}): Promise<JSONish | null> => {
  const rows: Array<JSONish> = await listItems({
    page: data.page,
    projectId: data.projectId,
    path: MESSAGE_QUEUE_API_PATH,
    query: { _id: data.queueId },
    select: {
      _id: true,
      name: true,
      messagingSystem: true,
      destinationName: true,
      brokerScope: true,
      queueIdentifier: true,
      discoverySource: true,
      isArchived: true,
    },
    limit: 1,
  });
  return rows[0] || null;
};

// ---- OTLP/JSON fixtures -------------------------------------------------------

interface OtlpAttribute {
  key: string;
  value: { stringValue: string } | { intValue: string };
}

const stringAttribute: (key: string, value: string) => OtlpAttribute = (
  key: string,
  value: string,
): OtlpAttribute => {
  return { key: key, value: { stringValue: value } };
};

// OTLP/JSON encodes 64-bit integers as decimal strings.
const intAttribute: (key: string, value: number) => OtlpAttribute = (
  key: string,
  value: number,
): OtlpAttribute => {
  return { key: key, value: { intValue: String(value) } };
};

const unixNano: (epochMs: number) => string = (epochMs: number): string => {
  return `${Math.round(epochMs)}000000`;
};

// `bytes` random bytes as lowercase hex: OTLP trace ids (16) and span ids (8).
const randomHex: (bytes: number) => string = (bytes: number): string => {
  let hex: string = "";
  for (let index: number = 0; index < bytes; index++) {
    hex += Math.floor(Math.random() * 256)
      .toString(16)
      .padStart(2, "0");
  }
  return hex;
};

type PostOtlpJsonFunction = (data: {
  page: Page;
  ingestionKey: string;
  signal: "traces" | "metrics";
  body: Record<string, unknown>;
}) => Promise<void>;

const postOtlpJson: PostOtlpJsonFunction = async (data: {
  page: Page;
  ingestionKey: string;
  signal: "traces" | "metrics";
  body: Record<string, unknown>;
}): Promise<void> => {
  const response: APIResponse = await data.page.request.post(
    urlFor(`/otlp/v1/${data.signal}`),
    {
      headers: {
        "content-type": "application/json",
        "x-oneuptime-token": data.ingestionKey,
      },
      data: data.body,
    },
  );
  expect(
    response.ok(),
    `POST /otlp/v1/${data.signal}: ${response.status()} ${await response.text()}`,
  ).toBe(true);
};

type PostKafkaTracesFunction = (data: {
  page: Page;
  ingestionKey: string;
  producerServiceName: string;
  consumerServiceName: string;
}) => Promise<void>;

/*
 * What a Kafka client instrumentation records under the current messaging
 * semantic conventions (the OpenTelemetry Java agent's kafka-clients
 * instrumentation, for one): a PRODUCER "send orders" span per message the
 * checkout service publishes, and a CONSUMER "process orders" span, in the
 * same trace, per message the billing service's consumer group processes.
 * The second message fails to process (status ERROR); the third has not been
 * consumed yet. A minute in the past, so every "past hour" window holds it.
 */
const postKafkaTraces: PostKafkaTracesFunction = async (data: {
  page: Page;
  ingestionKey: string;
  producerServiceName: string;
  consumerServiceName: string;
}): Promise<void> => {
  const start: number = Date.now() - 60 * 1000;
  const broker: Array<OtlpAttribute> = [
    stringAttribute("server.address", "kafka-1.e2e.internal"),
    intAttribute("server.port", 9092),
  ];

  interface Message {
    traceId: string;
    publishSpanId: string;
    publishedAt: number;
  }

  const messages: Array<Message> = Array.from(
    { length: PUBLISHED_MESSAGES },
    (_: unknown, index: number): Message => {
      return {
        traceId: randomHex(16),
        publishSpanId: randomHex(8),
        publishedAt: start + index * 1000,
      };
    },
  );

  const publishSpans: Array<Record<string, unknown>> = messages.map(
    (message: Message): Record<string, unknown> => {
      return {
        traceId: message.traceId,
        spanId: message.publishSpanId,
        name: PUBLISH_SPAN_NAME,
        kind: OTLP_SPAN_KIND_PRODUCER,
        startTimeUnixNano: unixNano(message.publishedAt),
        endTimeUnixNano: unixNano(message.publishedAt + 3),
        attributes: [
          stringAttribute("messaging.system", "kafka"),
          stringAttribute("messaging.destination.name", DESTINATION),
          stringAttribute("messaging.operation.type", "send"),
          stringAttribute("messaging.operation.name", "send"),
          ...broker,
        ],
        status: { code: OTLP_STATUS_CODE_OK },
      };
    },
  );

  const processSpans: Array<Record<string, unknown>> = messages
    .slice(0, PROCESSED_MESSAGES)
    .map((message: Message, index: number): Record<string, unknown> => {
      const failed: boolean = index === FAILED_MESSAGE_INDEX;
      return {
        traceId: message.traceId,
        spanId: randomHex(8),
        parentSpanId: message.publishSpanId,
        name: PROCESS_SPAN_NAME,
        kind: OTLP_SPAN_KIND_CONSUMER,
        startTimeUnixNano: unixNano(message.publishedAt + 10),
        endTimeUnixNano: unixNano(message.publishedAt + 30),
        attributes: [
          stringAttribute("messaging.system", "kafka"),
          stringAttribute("messaging.destination.name", DESTINATION),
          stringAttribute("messaging.operation.type", "process"),
          stringAttribute("messaging.operation.name", "process"),
          stringAttribute(
            "messaging.consumer.group.name",
            KAFKA_CONSUMER_GROUP,
          ),
          ...broker,
        ],
        status: failed
          ? { code: OTLP_STATUS_CODE_ERROR, message: "payment declined" }
          : { code: OTLP_STATUS_CODE_OK },
      };
    });

  const scope: Record<string, string> = {
    name: "io.opentelemetry.kafka-clients-2.6",
    version: "2.20.0",
  };

  await postOtlpJson({
    page: data.page,
    ingestionKey: data.ingestionKey,
    signal: "traces",
    body: {
      resourceSpans: [
        {
          resource: {
            attributes: [
              stringAttribute("service.name", data.producerServiceName),
            ],
          },
          scopeSpans: [{ scope: scope, spans: publishSpans }],
        },
        {
          resource: {
            attributes: [
              stringAttribute("service.name", data.consumerServiceName),
            ],
          },
          scopeSpans: [{ scope: scope, spans: processSpans }],
        },
      ],
    },
  });
};

type PostBrokerMetricFunction = (data: {
  page: Page;
  ingestionKey: string;
}) => Promise<void>;

/*
 * The consumer lag the collector's kafka_metrics receiver reports (its
 * `consumers` scraper): kafka.consumer_group.lag_sum, an int gauge whose
 * datapoints carry the topic and the consumer group, on a resource with no
 * attributes of its own.
 */
const postKafkaConsumerLag: PostBrokerMetricFunction = async (data: {
  page: Page;
  ingestionKey: string;
}): Promise<void> => {
  await postOtlpJson({
    page: data.page,
    ingestionKey: data.ingestionKey,
    signal: "metrics",
    body: {
      resourceMetrics: [
        {
          resource: { attributes: [] },
          scopeMetrics: [
            {
              scope: {
                name: "github.com/open-telemetry/opentelemetry-collector-contrib/receiver/kafkametricsreceiver",
                version: "0.161.0",
              },
              metrics: [
                {
                  name: KAFKA_LAG_METRIC,
                  unit: "1",
                  gauge: {
                    dataPoints: [
                      {
                        asInt: String(KAFKA_LAG),
                        timeUnixNano: unixNano(Date.now() - 30 * 1000),
                        attributes: [
                          stringAttribute("group", KAFKA_CONSUMER_GROUP),
                          stringAttribute("topic", DESTINATION),
                        ],
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    },
  });
};

/*
 * Active messages as the collector's azure_monitor receiver reports them: a
 * double gauge named azure_<metric>_<aggregation>, lowercased, with one
 * point per minute. The subscription is the only resource attribute; the
 * namespace (`name`), its resource type and the queue (`metadata_entityname`,
 * the EntityName split) are datapoint attributes.
 */
const postServiceBusActiveMessages: PostBrokerMetricFunction = async (data: {
  page: Page;
  ingestionKey: string;
}): Promise<void> => {
  const minute: string = unixNano(Date.now() - 60 * 1000);
  await postOtlpJson({
    page: data.page,
    ingestionKey: data.ingestionKey,
    signal: "metrics",
    body: {
      resourceMetrics: [
        {
          resource: {
            attributes: [
              stringAttribute(
                "azuremonitor.subscription_id",
                AZURE_SUBSCRIPTION_ID,
              ),
            ],
          },
          scopeMetrics: [
            {
              scope: {
                name: "github.com/open-telemetry/opentelemetry-collector-contrib/receiver/azuremonitorreceiver",
                version: "0.161.0",
              },
              metrics: [
                {
                  name: SERVICE_BUS_ACTIVE_METRIC,
                  unit: "Count",
                  gauge: {
                    dataPoints: [
                      {
                        asDouble: SERVICE_BUS_ACTIVE_MESSAGES,
                        startTimeUnixNano: minute,
                        timeUnixNano: minute,
                        attributes: [
                          stringAttribute(
                            "azuremonitor.resource_id",
                            `/subscriptions/${AZURE_SUBSCRIPTION_ID}/resourceGroups/shop-rg/providers/Microsoft.ServiceBus/namespaces/${SERVICE_BUS_NAMESPACE}`,
                          ),
                          stringAttribute("name", SERVICE_BUS_NAMESPACE),
                          stringAttribute(
                            "type",
                            "Microsoft.ServiceBus/namespaces",
                          ),
                          stringAttribute("resource_group", "shop-rg"),
                          stringAttribute("location", "westeurope"),
                          stringAttribute("metadata_entityname", DESTINATION),
                        ],
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    },
  });
};

// ---- page locators ------------------------------------------------------------

/*
 * The list card's own "Create Queue" button. An empty list offers the same
 * action again as its call to action (empty-table-create-button), so the
 * button's name alone matches two buttons there.
 */
const createQueueButton: (page: Page) => Locator = (page: Page): Locator => {
  return page.getByTestId("card-button").filter({ hasText: "Create Queue" });
};

/*
 * The Overview's Broker health section once every telemetry read of the
 * page has settled (one Promise.all loads the tiles, the cards and the broker
 * metrics): its charts, the guidance card or the "no metrics in this range"
 * card — never the loader. A ready signal that holds with or without data.
 */
const brokerHealthSettled: (page: Page) => Locator = (page: Page): Locator => {
  return page
    .locator(
      [
        '[data-testid="message-queue-broker-health"]',
        '[data-testid="message-queue-broker-health-guidance"]',
        '[data-testid="message-queue-broker-health-no-data"]',
      ].join(", "),
    )
    .first();
};

/*
 * One of the Overview's golden-metric tiles, by its title. The tiles are the
 * only elements of the page with aria-busy, "false" once the value loaded.
 */
const overviewTile: (page: Page, title: string) => Locator = (
  page: Page,
  title: string,
): Locator => {
  return page.locator('div[aria-busy="false"]').filter({
    has: page.getByText(title, { exact: true }),
  });
};

const brokerMetricTile: (page: Page, metricId: string) => Locator = (
  page: Page,
  metricId: string,
): Locator => {
  return page.locator(
    `[data-testid="message-queue-broker-metric-tile"][data-metric-id="${metricId}"]`,
  );
};

const brokerMetricChart: (page: Page, metricId: string) => Locator = (
  page: Page,
  metricId: string,
): Locator => {
  return page.locator(
    `[data-testid="message-queue-broker-metric-chart"][data-metric-id="${metricId}"]`,
  );
};

type SelectDropdownOptionFunction = (data: {
  page: Page;
  combobox: Locator;
  search: string;
  option: string | RegExp;
}) => Promise<void>;

/*
 * Picks an option of a react-select Dropdown: type to narrow the menu, then
 * click the option. The menu may render outside the modal, so the option is
 * looked up on the page.
 */
const selectDropdownOption: SelectDropdownOptionFunction = async (data: {
  page: Page;
  combobox: Locator;
  search: string;
  option: string | RegExp;
}): Promise<void> => {
  await data.combobox.click();
  await data.combobox.fill(data.search);
  const option: Locator =
    typeof data.option === "string"
      ? data.page.getByRole("option", { name: data.option, exact: true })
      : data.page.getByRole("option", { name: data.option });
  await option.first().click();
};

type BodyTextFunction = (page: Page) => Promise<string>;

const bodyText: BodyTextFunction = async (page: Page): Promise<string> => {
  return await page.locator("body").innerText();
};

// The shape of one query in Monitor Create's `metricQueries` parameter.
interface SerializedMetricQueryParam {
  metricName?: string;
  attributes?: Record<string, unknown>;
  warningThreshold?: number;
}

interface QueuesContext {
  page: Page;
  projectId: string;
  ingestionKey: string;
  kafkaQueueId: string;
  serviceBusQueueId: string;
  producerServiceName: string;
  consumerServiceName: string;
  unrelatedServiceName: string;
  unrelatedSpanName: string;
  unrelatedMetricName: string;
}

test.describe.skip("Queues Product", () => {
  const runId: string = Faker.generateName().toLowerCase();

  const ctx: QueuesContext = {
    page: undefined as unknown as Page,
    projectId: "",
    ingestionKey: "",
    kafkaQueueId: "",
    serviceBusQueueId: "",
    producerServiceName: `e2e-queues-checkout-${runId}`,
    consumerServiceName: `e2e-queues-billing-${runId}`,
    unrelatedServiceName: `e2e-queues-unrelated-${runId}`,
    unrelatedSpanName: `e2eunrelatedspan${runId}`,
    unrelatedMetricName: `e2e_unrelated_metric_${runId}`,
  };

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    test.setTimeout(300000);
    ctx.page = await browser.newPage();
    ctx.projectId = await registerAndCreateProject({
      page: ctx.page,
      projectNamePrefix: "E2E Queues Project",
    });
  });

  test.afterAll(async () => {
    await ctx.page.close();
  });

  test("Products → Resources → Queues opens the empty list with its setup guide and messaging-system picker", async () => {
    test.setTimeout(240000);
    const page: Page = ctx.page;

    await page.getByRole("button", { name: "Products" }).click();
    const productsMenu: Locator = page.getByRole("dialog", {
      name: "Products menu",
    });
    /*
     * The dialog element itself is a zero-size wrapper around fixed-position
     * panels (see NavigationSearch/ForeignHiddenRule.spec.ts), so assert on
     * what the user sees inside it.
     */
    await expect(productsMenu).toHaveCount(1, { timeout: 30000 });
    await expect(
      productsMenu.getByRole("combobox", { name: "Search products" }),
    ).toBeVisible({ timeout: 30000 });

    /*
     * A search narrows the menu to the matching products under their
     * category headings: Queues, alone, under Resources.
     */
    await productsMenu
      .getByRole("combobox", { name: "Search products" })
      .fill("Queues");
    await expect(productsMenu.getByRole("option")).toHaveCount(1);
    const queuesOption: Locator = productsMenu
      .getByRole("option")
      .filter({ hasText: "Queues" });
    await expect(queuesOption).toContainText(
      "Message queues and topics from your traces and brokers.",
    );
    await expect(productsMenu.getByRole("heading", { level: 3 })).toHaveText([
      "Resources",
    ]);
    await queuesOption.click();
    await page.waitForURL(queuesListUrlRegex(ctx.projectId), {
      timeout: 30000,
    });

    // A project without queues: the list, then the setup guide.
    await expect(page.getByText("Getting Started with Queues")).toBeVisible({
      timeout: 60000,
    });
    // The card's own button, and the empty table's call to action.
    await expect(createQueueButton(page)).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId("empty-table-create-button")).toHaveText(
      "Create Queue",
      { timeout: 30000 },
    );
    await expect(page.getByText("No ingestion keys yet")).toBeVisible({
      timeout: 30000,
    });

    /*
     * The picker is the setup guide's radio group, one radio per messaging
     * system. It starts on Apache Kafka: its guide and collector receiver.
     */
    const systemPicker: Locator = page.getByRole("radiogroup", {
      name: "Which messaging system?",
    });
    await expect(systemPicker).toBeVisible();
    const kafkaRadio: Locator = systemPicker.getByRole("radio", {
      name: "Apache Kafka",
      exact: true,
    });
    const serviceBusRadio: Locator = systemPicker.getByRole("radio", {
      name: "Azure Service Bus",
      exact: true,
    });
    await expect(kafkaRadio).toHaveAttribute("aria-checked", "true");
    await expect(serviceBusRadio).toHaveAttribute("aria-checked", "false");
    await expect
      .poll(
        async (): Promise<string> => {
          return await bodyText(page);
        },
        { timeout: 30000 },
      )
      .toContain("Apache Kafka queues appear in OneUptime on their own");
    await expect
      .poll(
        async (): Promise<string> => {
          return await bodyText(page);
        },
        { timeout: 30000 },
      )
      .toContain("kafka_metrics");

    // Another system swaps the whole guide: Service Bus is read from Azure Monitor.
    await serviceBusRadio.click();
    await expect(serviceBusRadio).toHaveAttribute("aria-checked", "true");
    await expect(kafkaRadio).toHaveAttribute("aria-checked", "false");
    await expect
      .poll(
        async (): Promise<string> => {
          return await bodyText(page);
        },
        { timeout: 30000 },
      )
      .toContain("azure_monitor/servicebus");
    const serviceBusGuide: string = await bodyText(page);
    expect(serviceBusGuide).toContain(
      "Azure Service Bus queues appear in OneUptime on their own",
    );
    expect(serviceBusGuide).not.toContain("kafka_metrics");
  });

  test("Create Queue adds a Kafka queue by hand and opens its page", async () => {
    test.setTimeout(240000);
    const page: Page = ctx.page;

    await createQueueButton(page).click();
    const modal: Locator = page.getByTestId("modal");
    await expect(modal).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId("modal-title")).toContainText(
      "Create New Queue",
    );

    await selectDropdownOption({
      page,
      combobox: modal.getByRole("combobox", { name: /^Messaging System/ }),
      search: "kafka",
      option: "Apache Kafka (kafka)",
    });

    // Only Service Bus and Event Hubs key a queue on its namespace.
    await expect(
      modal.getByPlaceholder("orders-prod", { exact: true }),
    ).toHaveCount(0);

    await modal
      .getByPlaceholder("orders.created", { exact: true })
      .fill(DESTINATION);

    /*
     * Three steps - Messaging System, Queue Info, Labels - with the footer's
     * one submit button reading "Next" until the last.
     */
    const submit: Locator = modal.getByTestId("modal-footer-submit-button");
    await expect(submit).toHaveText("Next");
    await submit.click();

    // Queue Info. No name: the server names the queue after its destination.
    await expect(
      modal.getByPlaceholder("Order events", { exact: true }),
    ).toBeVisible({ timeout: 30000 });
    await expect(submit).toHaveText("Next");
    await submit.click();

    // Labels, optional, and the last step.
    await expect(submit).toHaveText("Create Queue");
    await submit.click();
    await expect(modal).toBeHidden({ timeout: 30000 });

    // The queue is listed, and the setup guide of the empty list is gone.
    const queueLink: Locator = page.getByRole("link", {
      name: DESTINATION,
      exact: true,
    });
    await expect(queueLink).toBeVisible({ timeout: 30000 });
    await expect(page.getByText("Getting Started with Queues")).toHaveCount(0);

    await queueLink.click();
    await page.waitForURL(
      new RegExp(`/dashboard/${ctx.projectId}/queues/[0-9a-f-]{36}$`),
      { timeout: 30000 },
    );
    ctx.kafkaQueueId = queueIdFromUrl(page.url());

    // What the server stored: the identity it worked out from the form.
    const stored: JSONish | null = await readQueue({
      page,
      projectId: ctx.projectId,
      queueId: ctx.kafkaQueueId,
    });
    expect(stored).not.toBeNull();
    expect(stored!["name"]).toBe(DESTINATION);
    expect(stored!["messagingSystem"]).toBe("kafka");
    expect(stored!["destinationName"]).toBe(DESTINATION);
    expect(stored!["queueIdentifier"]).toBe(KAFKA_QUEUE_IDENTIFIER);
    expect(stored!["discoverySource"]).toBe("manual");
    expect(stored!["isArchived"]).toBe(false);

    // Its Overview.
    await expect(
      page.getByRole("heading", { name: DESTINATION, exact: true }),
    ).toBeVisible({ timeout: 60000 });
    await expect(
      page.getByText("Apache Kafka (kafka)", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(KAFKA_QUEUE_IDENTIFIER, { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Added manually", { exact: true }).first(),
    ).toBeVisible();

    // Its tabs, as the docs name them.
    const kafkaPath: string = queuePath(ctx.projectId, ctx.kafkaQueueId);
    for (const tab of [
      { label: "Traces", path: "/traces" },
      { label: "Metrics", path: "/metrics" },
      { label: "Documentation", path: "/documentation" },
      { label: "Settings", path: "/settings" },
      { label: "Delete Queue", path: "/delete" },
    ]) {
      await expect(
        page
          .locator(`a[href="${kafkaPath}${tab.path}"]`)
          .filter({ hasText: new RegExp(`^\\s*${tab.label}\\s*$`) }),
      ).toHaveCount(1);
    }

    /*
     * No broker metric yet: Broker health says where Kafka's come from and
     * links to the system's section of the Queues guide.
     */
    const guidance: Locator = page.getByTestId(
      "message-queue-broker-health-guidance",
    );
    await expect(guidance).toBeVisible({ timeout: 60000 });
    await expect(guidance).toContainText("kafka_metrics");
    await expect(
      guidance.getByRole("link", {
        name: "Apache Kafka broker metrics in the Queues guide",
      }),
    ).toHaveAttribute("href", "/docs/telemetry/queues#apache-kafka");
    await expect(
      guidance.getByRole("link", {
        name: "Set up broker metrics for this queue",
      }),
    ).toHaveAttribute("href", `${kafkaPath}/documentation`);
  });

  test("A fresh ingestion key sends Kafka spans and consumer lag through /otlp, and the queue's Documentation tab uses it", async () => {
    test.setTimeout(300000);
    const page: Page = ctx.page;

    ctx.ingestionKey = await createTelemetryIngestionKey({
      page,
      projectId: ctx.projectId,
      keyName: "E2E Queues Key " + Faker.generateName(),
    });

    await postKafkaTraces({
      page,
      ingestionKey: ctx.ingestionKey,
      producerServiceName: ctx.producerServiceName,
      consumerServiceName: ctx.consumerServiceName,
    });
    await postKafkaConsumerLag({ page, ingestionKey: ctx.ingestionKey });

    /*
     * A span and a metric that name no queue, through the generic helpers:
     * the queue's Traces and Metrics tabs must leave them out.
     */
    await postOtlpTraces({
      page,
      ingestionKey: ctx.ingestionKey,
      serviceName: ctx.unrelatedServiceName,
      spanName: ctx.unrelatedSpanName,
    });
    await postOtlpMetrics({
      page,
      ingestionKey: ctx.ingestionKey,
      serviceName: ctx.unrelatedServiceName,
      metricName: ctx.unrelatedMetricName,
    });

    // The queue's own guide: prefilled for `orders`, with the new key.
    await gotoProjectPage({
      page,
      projectId: ctx.projectId,
      url: urlFor(
        `${queuePath(ctx.projectId, ctx.kafkaQueueId)}/documentation`,
      ),
      ready: page.getByText("Send Apache Kafka telemetry for this queue"),
    });
    // A queue's system is fixed: no messaging-system picker.
    await expect(
      page.getByRole("radiogroup", { name: "Which messaging system?" }),
    ).toHaveCount(0);
    await expect
      .poll(
        async (): Promise<string> => {
          return await bodyText(page);
        },
        { timeout: 30000 },
      )
      .toContain(`This is the Apache Kafka queue ${DESTINATION}.`);
    await expect(
      page.getByRole("heading", {
        name: "Step 4: Check that this queue fills in",
      }),
    ).toBeVisible();
    // How its telemetry finds it is folded under Advanced.
    await page.getByTestId("setup-guide-advanced-toggle").click();
    await page
      .getByTestId("setup-guide-topic")
      .filter({ hasText: "How telemetry finds this queue" })
      .getByRole("button")
      .click();
    await expect
      .poll(
        async (): Promise<string> => {
          return await bodyText(page);
        },
        { timeout: 30000 },
      )
      .toContain(`topic = ${DESTINATION}.`);
    await expect
      .poll(
        async (): Promise<string> => {
          return await bodyText(page);
        },
        { timeout: 30000 },
      )
      .toContain(`x-oneuptime-token=${ctx.ingestionKey}`);
  });

  test("The Overview counts published, consumed and failed messages and names both sides of the queue", async () => {
    test.setTimeout(420000);
    const page: Page = ctx.page;

    await waitForTelemetryText({
      page,
      projectId: ctx.projectId,
      url: urlFor(queuePath(ctx.projectId, ctx.kafkaQueueId)),
      ready: brokerHealthSettled(page),
      text: ERROR_RATE_SUBLABEL,
    });

    // PRODUCER spans are publishes, CONSUMER spans deliveries.
    await expect(
      overviewTile(page, "Published").getByText(String(PUBLISHED_MESSAGES), {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      overviewTile(page, "Consumed").getByText(String(PROCESSED_MESSAGES), {
        exact: true,
      }),
    ).toBeVisible();
    const errors: Locator = overviewTile(page, "Errors");
    await expect(errors.getByText("1", { exact: true })).toBeVisible();
    await expect(errors).toContainText(ERROR_RATE_SUBLABEL);

    // Each service on the side its span kind puts it.
    const producers: Locator = page.getByTestId("message-queue-producers");
    const consumers: Locator = page.getByTestId("message-queue-consumers");
    await expect(producers).toContainText(ctx.producerServiceName, {
      timeout: 30000,
    });
    await expect(consumers).toContainText(ctx.consumerServiceName, {
      timeout: 30000,
    });
    await expect(producers).not.toContainText(ctx.consumerServiceName);
    await expect(consumers).not.toContainText(ctx.producerServiceName);
  });

  test("Broker health charts Consumer lag, and its Create monitor link opens Monitor Create with the metric and the topic filter", async () => {
    test.setTimeout(420000);
    const page: Page = ctx.page;

    // The tile names the metric it reads; nothing else on the page does.
    await waitForTelemetryText({
      page,
      projectId: ctx.projectId,
      url: urlFor(queuePath(ctx.projectId, ctx.kafkaQueueId)),
      ready: brokerHealthSettled(page),
      text: KAFKA_LAG_METRIC,
    });

    const brokerHealth: Locator = page.getByTestId(
      "message-queue-broker-health",
    );
    await expect(
      brokerHealth.getByRole("heading", { name: "Broker health", exact: true }),
    ).toBeVisible();

    const lagTile: Locator = brokerMetricTile(page, KAFKA_LAG_METRIC_ID);
    await expect(lagTile).toContainText("Consumer lag");
    await expect(
      lagTile.getByTestId("message-queue-broker-metric-value"),
    ).toHaveText(`${KAFKA_LAG} messages`);

    /*
     * A gauge gets Create monitor, starting at the Consumer lag template's
     * threshold — stated as the criteria Monitor Create builds.
     */
    const lagChart: Locator = brokerMetricChart(page, KAFKA_LAG_METRIC_ID);
    await expect(
      lagChart.getByTestId("message-queue-create-monitor-hint"),
    ).toHaveText(
      "Warning when any point in the last 10 minutes is above 10,000 messages",
    );
    const createMonitor: Locator = lagChart
      .getByTestId("message-queue-create-monitor")
      .getByRole("link", { name: "Create monitor", exact: true });
    await expect(createMonitor).toHaveAttribute(
      "href",
      new RegExp(`/dashboard/${ctx.projectId}/monitors/create\\?`),
    );
    await createMonitor.click();

    await page.waitForURL(
      new RegExp(`/dashboard/${ctx.projectId}/monitors/create\\?`),
      { timeout: 30000 },
    );

    // The link carries the metric, the queue's exact topic filter and the threshold.
    const params: URLSearchParams = new globalThis.URL(page.url()).searchParams;
    const queries: Array<SerializedMetricQueryParam> = JSON.parse(
      params.get("metricQueries") || "[]",
    ) as Array<SerializedMetricQueryParam>;
    expect(queries).toHaveLength(1);
    expect(queries[0]!.metricName).toBe(KAFKA_LAG_METRIC);
    expect(queries[0]!.attributes).toEqual({ topic: DESTINATION });
    expect(queries[0]!.warningThreshold).toBe(10000);
    expect(params.get("monitorDescription")).toBe(
      `Created from queue ${DESTINATION}.`,
    );

    // ...and Monitor Create is filled in from it.
    const form: Locator = page.locator("#create-monitor-form");
    await expect(form.locator("input[placeholder='Monitor Name']")).toHaveValue(
      `${DESTINATION}: Consumer lag Monitor`,
      { timeout: 60000 },
    );
    await expect(
      form.getByPlaceholder("Description", { exact: true }),
    ).toHaveValue(`Created from queue ${DESTINATION}.`);

    /*
     * "Next" (the submit button keeps its "Create Monitor" test id on every
     * step) opens the Metrics monitor's query: the metric, and the topic
     * filter under "Filters & grouping", open because the query has one.
     */
    await page.getByTestId("Create Monitor").click();
    await expect(
      form.getByText("Metric Monitor Configuration", { exact: true }).first(),
    ).toBeVisible({ timeout: 30000 });
    await expect(
      form.getByText(KAFKA_LAG_METRIC, { exact: true }).first(),
    ).toBeVisible({ timeout: 30000 });
    await expect(
      form.getByPlaceholder("Key", { exact: true }).first(),
    ).toHaveValue("topic", { timeout: 30000 });
    await expect(
      form.getByPlaceholder("Value", { exact: true }).first(),
    ).toHaveValue(DESTINATION);
  });

  test("The Traces tab lists the queue's spans and no other span of the project", async () => {
    test.setTimeout(420000);
    const page: Page = ctx.page;
    const tracesUrl: string = urlFor(
      `${queuePath(ctx.projectId, ctx.kafkaQueueId)}/traces`,
    );

    await waitForTelemetryText({
      page,
      projectId: ctx.projectId,
      url: tracesUrl,
      ready: page.getByPlaceholder(/Search traces/i),
      text: PUBLISH_SPAN_NAME,
    });
    await expect(page.getByText(PROCESS_SPAN_NAME).first()).toBeVisible({
      timeout: 30000,
    });

    // The span that names no queue has arrived in the project...
    await waitForTelemetryText({
      page,
      projectId: ctx.projectId,
      url: urlFor(`/dashboard/${ctx.projectId}/traces`),
      ready: page.getByPlaceholder(/Search traces/i),
      text: ctx.unrelatedSpanName,
    });

    // ...and stays off the queue's tab.
    await gotoProjectPage({
      page,
      projectId: ctx.projectId,
      url: tracesUrl,
      ready: page.getByText(PUBLISH_SPAN_NAME).first(),
    });
    await expect(page.getByText(PROCESS_SPAN_NAME).first()).toBeVisible({
      timeout: 30000,
    });
    await expect(page.getByText(ctx.unrelatedSpanName)).toHaveCount(0);
  });

  test("The Metrics tab lists kafka.consumer_group.lag_sum and no other metric of the project", async () => {
    test.setTimeout(420000);
    const page: Page = ctx.page;
    const metricsUrl: string = urlFor(
      `${queuePath(ctx.projectId, ctx.kafkaQueueId)}/metrics`,
    );

    await waitForTelemetryText({
      page,
      projectId: ctx.projectId,
      url: metricsUrl,
      ready: page.getByPlaceholder(/Search metrics/i),
      text: KAFKA_LAG_METRIC,
    });

    // The metric that names no queue has arrived in the project...
    await waitForTelemetryText({
      page,
      projectId: ctx.projectId,
      url: urlFor(`/dashboard/${ctx.projectId}/metrics`),
      ready: page.getByPlaceholder(/Search metrics/i),
      text: ctx.unrelatedMetricName,
    });

    // ...and stays off the queue's tab.
    await gotoProjectPage({
      page,
      projectId: ctx.projectId,
      url: metricsUrl,
      ready: page.getByText(KAFKA_LAG_METRIC).first(),
    });
    await expect(page.getByText(ctx.unrelatedMetricName)).toHaveCount(0);
  });

  test("A Service Bus queue added by hand in its namespace charts Active messages from azure_monitor metrics", async () => {
    test.setTimeout(420000);
    const page: Page = ctx.page;
    const createButton: Locator = createQueueButton(page);

    await gotoProjectPage({
      page,
      projectId: ctx.projectId,
      url: urlFor(queuesPath(ctx.projectId)),
      ready: createButton,
    });
    await createButton.click();
    const modal: Locator = page.getByTestId("modal");
    await expect(modal).toBeVisible({ timeout: 30000 });

    await selectDropdownOption({
      page,
      combobox: modal.getByRole("combobox", { name: /^Messaging System/ }),
      search: "Service Bus",
      option: "Azure Service Bus (servicebus)",
    });

    // The namespace is part of a Service Bus queue's identity.
    const namespaceInput: Locator = modal.getByPlaceholder("orders-prod", {
      exact: true,
    });
    await expect(namespaceInput).toBeVisible();
    await namespaceInput.fill(SERVICE_BUS_NAMESPACE);
    await modal
      .getByPlaceholder("orders.created", { exact: true })
      .fill(DESTINATION);
    await modal
      .getByPlaceholder("Order events", { exact: true })
      .fill(SERVICE_BUS_QUEUE_NAME);
    await modal.getByTestId("modal-footer-submit-button").click();
    await expect(modal).toBeHidden({ timeout: 30000 });

    // Its row: the name, the destination its telemetry names, the namespace.
    const row: Locator = page
      .getByRole("row")
      .filter({ hasText: SERVICE_BUS_QUEUE_NAME });
    await expect(row).toContainText("Azure Service Bus", { timeout: 30000 });
    await expect(row.getByTestId("message-queue-name-destination")).toHaveText(
      DESTINATION,
    );
    await expect(row.getByTestId("message-queue-broker")).toHaveText(
      SERVICE_BUS_NAMESPACE,
    );

    await row
      .getByRole("link", { name: SERVICE_BUS_QUEUE_NAME, exact: true })
      .click();
    await page.waitForURL(
      new RegExp(`/dashboard/${ctx.projectId}/queues/[0-9a-f-]{36}$`),
      { timeout: 30000 },
    );
    ctx.serviceBusQueueId = queueIdFromUrl(page.url());
    expect(ctx.serviceBusQueueId).not.toBe(ctx.kafkaQueueId);

    const stored: JSONish | null = await readQueue({
      page,
      projectId: ctx.projectId,
      queueId: ctx.serviceBusQueueId,
    });
    expect(stored).not.toBeNull();
    expect(stored!["name"]).toBe(SERVICE_BUS_QUEUE_NAME);
    expect(stored!["messagingSystem"]).toBe("servicebus");
    expect(stored!["brokerScope"]).toBe(SERVICE_BUS_NAMESPACE);
    expect(stored!["queueIdentifier"]).toBe(SERVICE_BUS_QUEUE_IDENTIFIER);

    await expect(
      page.getByText(`Namespace: ${SERVICE_BUS_NAMESPACE}`, { exact: true }),
    ).toBeVisible({ timeout: 60000 });

    // No broker metric yet: the guidance card points at Azure Monitor.
    const guidance: Locator = page.getByTestId(
      "message-queue-broker-health-guidance",
    );
    await expect(guidance).toBeVisible({ timeout: 60000 });
    await expect(
      guidance.getByRole("link", {
        name: "Azure Service Bus broker metrics in the Queues guide",
      }),
    ).toHaveAttribute("href", "/docs/telemetry/queues#azure-service-bus");

    await postServiceBusActiveMessages({
      page,
      ingestionKey: ctx.ingestionKey,
    });

    await waitForTelemetryText({
      page,
      projectId: ctx.projectId,
      url: urlFor(queuePath(ctx.projectId, ctx.serviceBusQueueId)),
      ready: brokerHealthSettled(page),
      text: SERVICE_BUS_ACTIVE_METRIC,
    });

    const activeTile: Locator = brokerMetricTile(
      page,
      SERVICE_BUS_ACTIVE_METRIC_ID,
    );
    await expect(activeTile).toContainText("Active messages");
    await expect(
      activeTile.getByTestId("message-queue-broker-metric-value"),
    ).toHaveText(`${SERVICE_BUS_ACTIVE_MESSAGES} messages`);
    // A backlog gauge: it can be monitored too.
    await expect(
      brokerMetricChart(page, SERVICE_BUS_ACTIVE_METRIC_ID).getByRole("link", {
        name: "Create monitor",
        exact: true,
      }),
    ).toBeVisible();
  });

  test("Settings archives a queue out of the list, Archived lists it, and Settings restores it", async () => {
    test.setTimeout(300000);
    const page: Page = ctx.page;
    const kafkaPath: string = queuePath(ctx.projectId, ctx.kafkaQueueId);
    const settingsUrl: string = urlFor(`${kafkaPath}/settings`);
    const settingsLink: Locator = page.locator(
      `a[href='${kafkaPath}/settings']`,
    );
    const kafkaQueueLink: Locator = page.getByRole("link", {
      name: DESTINATION,
      exact: true,
    });
    const serviceBusQueueLink: Locator = page.getByRole("link", {
      name: SERVICE_BUS_QUEUE_NAME,
      exact: true,
    });

    type IsArchivedFunction = () => Promise<unknown>;
    const isArchived: IsArchivedFunction = async (): Promise<unknown> => {
      const stored: JSONish | null = await readQueue({
        page,
        projectId: ctx.projectId,
        queueId: ctx.kafkaQueueId,
      });
      return stored ? stored["isArchived"] : null;
    };

    /*
     * The queue's Settings page sits in a Settings section that starts
     * folded down to its title, like every rarely used section: its rows are
     * hidden until the section is opened.
     */
    const settingsSectionToggle: Locator = page
      .locator("aside[role='navigation'][aria-label='Main navigation']")
      .locator(
        "xpath=.//h6[normalize-space(.)='Settings']/ancestor::button[1]",
      );

    await gotoProjectPage({
      page,
      projectId: ctx.projectId,
      url: urlFor(kafkaPath),
      ready: settingsSectionToggle,
    });
    await expect(
      page.getByRole("heading", { name: DESTINATION, exact: true }),
    ).toBeVisible({ timeout: 60000 });
    // Archiving lives in Settings, not on the Overview.
    await expect(
      page.getByRole("heading", { name: "Archive queue", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Archive", exact: true }),
    ).toHaveCount(0);

    await expect(settingsSectionToggle).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await expect(settingsLink.first()).toBeHidden();
    await settingsSectionToggle.click();
    await settingsLink.first().click();
    await expect(page).toHaveURL(settingsUrl);
    await expect(page.getByText("Queue Settings").first()).toBeVisible({
      timeout: 30000,
    });
    await expect(
      page.getByRole("heading", { name: "Archive queue", exact: true }),
    ).toBeVisible({ timeout: 30000 });

    const archive: Locator = page.getByRole("button", {
      name: "Archive",
      exact: true,
    });
    const modal: Locator = page.getByTestId("modal");

    // Cancelling the confirmation archives nothing.
    await expect(archive).toBeEnabled();
    await archive.click();
    await expect(modal).toBeVisible();
    await modal.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(modal).toBeHidden();
    expect(await isArchived()).toBe(false);

    // Confirming archives it and returns to the list, which no longer shows it.
    await archive.click();
    await modal.getByTestId("modal-footer-submit-button").click();
    await expect(page).toHaveURL(queuesListUrlRegex(ctx.projectId), {
      timeout: 30000,
    });
    expect(await isArchived()).toBe(true);
    await expect(serviceBusQueueLink).toBeVisible({ timeout: 30000 });
    await expect(kafkaQueueLink).toHaveCount(0);

    /*
     * Archived lists it. Its entry waits in the menu's Advanced section,
     * which starts folded away on the list: its rows are hidden until it is
     * opened.
     */
    const productAdvancedToggle: Locator = page
      .locator("aside[role='navigation'][aria-label='Main navigation']")
      .locator(
        "xpath=.//h6[normalize-space(.)='Advanced']/ancestor::button[1]",
      );
    const archivedLink: Locator = page.getByRole("link", {
      name: "Archived",
      exact: true,
    });

    if (
      (await productAdvancedToggle.getAttribute("aria-expanded")) !== "true"
    ) {
      await expect(archivedLink).toBeHidden();
      await productAdvancedToggle.click();
    }
    await expect(productAdvancedToggle).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await archivedLink.click();
    await expect(page).toHaveURL(
      new RegExp(`/dashboard/${ctx.projectId}/queues/archived/?(?:\\?.*)?$`),
      { timeout: 30000 },
    );
    await expect(kafkaQueueLink).toBeVisible({ timeout: 30000 });
    await expect(serviceBusQueueLink).toHaveCount(0);

    // An archived queue stays reachable, and its Settings restore it.
    await gotoProjectPage({
      page,
      projectId: ctx.projectId,
      url: settingsUrl,
      ready: page.getByRole("heading", {
        name: "Unarchive queue",
        exact: true,
      }),
    });
    await page.getByRole("button", { name: "Unarchive", exact: true }).click();
    await modal.getByTestId("modal-footer-submit-button").click();
    await expect(modal).toBeHidden({ timeout: 30000 });
    await expect(archive).toBeVisible({ timeout: 30000 });
    await expect(page).toHaveURL(settingsUrl);
    expect(await isArchived()).toBe(false);

    // Back on the list.
    await gotoProjectPage({
      page,
      projectId: ctx.projectId,
      url: urlFor(queuesPath(ctx.projectId)),
      ready: kafkaQueueLink,
    });
    await expect(serviceBusQueueLink).toBeVisible({ timeout: 30000 });
  });

  test("Delete Queue removes a queue", async () => {
    test.setTimeout(240000);
    const page: Page = ctx.page;
    const serviceBusPath: string = queuePath(
      ctx.projectId,
      ctx.serviceBusQueueId,
    );
    const deleteLink: Locator = page.locator(
      `a[href='${serviceBusPath}/delete']`,
    );
    // The queue's Advanced section, which holds Delete Queue, by its heading.
    const advancedToggle: Locator = page
      .locator("aside[role='navigation'][aria-label='Main navigation']")
      .locator(
        "xpath=.//h6[normalize-space(.)='Advanced']/ancestor::button[1]",
      );

    await gotoProjectPage({
      page,
      projectId: ctx.projectId,
      url: urlFor(serviceBusPath),
      ready: advancedToggle,
    });
    await expect(deleteLink.first()).toHaveText("Delete Queue");

    // Advanced starts folded away, as in every menu; open it to reach Delete.
    await expect(advancedToggle).toHaveAttribute("aria-expanded", "false");
    await expect(deleteLink.first()).toBeHidden();
    await advancedToggle.click();
    await expect(deleteLink.first()).toBeVisible();
    await deleteLink.first().click();
    await expect(page).toHaveURL(urlFor(`${serviceBusPath}/delete`));

    // The page warns that a discovered queue would come back.
    await expect(
      page.getByTestId("message-queue-delete-warning"),
    ).toContainText("Discovered queues come back.", { timeout: 30000 });

    await page
      .getByRole("button", { name: "Delete Queue", exact: true })
      .click();
    const modal: Locator = page.getByTestId("modal");
    await expect(modal).toBeVisible();
    await modal.getByTestId("modal-footer-submit-button").click();
    await expect(page).toHaveURL(queuesListUrlRegex(ctx.projectId), {
      timeout: 30000,
    });

    // Gone from the list (whose other queue shows it has loaded) and the API.
    await expect(
      page.getByRole("link", { name: DESTINATION, exact: true }),
    ).toBeVisible({ timeout: 30000 });
    await expect(
      page.getByRole("link", { name: SERVICE_BUS_QUEUE_NAME, exact: true }),
    ).toHaveCount(0);
    expect(
      await readQueue({
        page,
        projectId: ctx.projectId,
        queueId: ctx.serviceBusQueueId,
      }),
    ).toBeNull();
  });
});
