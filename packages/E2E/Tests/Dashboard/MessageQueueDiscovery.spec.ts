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
import { createTelemetryIngestionKey } from "./Helpers/Telemetry";

/*
 * Queues product: DISCOVERY, end to end. Nothing is created by hand. The
 * spec sends, through the real /otlp endpoints, the messaging spans of a few
 * instrumented applications and two broker metrics, then waits for the
 * TelemetryEntity:ComputeServiceDependencies cron to turn them into queues.
 * It checks both directions:
 *
 *   - what must become a queue does: a Kafka topic (4 PRODUCER + 3 CONSUMER
 *     spans), an Azure Service Bus queue in the namespace `shop-prod` (its
 *     dead-letter sub-queue folds into it), an Amazon SQS queue named only by
 *     its queue URL under the legacy `AmazonSQS` system spelling, a RabbitMQ
 *     queue reached through the default exchange (the routing key names it),
 *     and a Service Bus queue that only Azure Monitor reports (created from
 *     broker metrics alone);
 *   - what must not does not: a RabbitMQ server-named `amq.gen-…` queue, a
 *     topic with fewer spans than MESSAGE_QUEUE_MIN_SPANS (3), and SERVER
 *     spans that carry messaging attributes.
 *
 * Then the discovered Kafka topic's Overview counts its spans and names both
 * sides, as a queue created by hand would.
 *
 * The cron runs every 10 minutes (on the minute, not on startup), and reads
 * a 15-minute window, so the spec waits up to 12 minutes for its first run.
 * That is far too slow for CI: skip-gated like the other product specs. To
 * run locally against a full stack, change `test.describe.skip` to
 * `test.describe` and:
 *
 *   cd packages/E2E && HOST=localhost npx playwright test \
 *     Tests/Dashboard/MessageQueueDiscovery.spec.ts --project=chromium
 */
test.describe.configure({ mode: "serial" });

// OTLP enum values (opentelemetry-proto trace.proto).
const OTLP_SPAN_KIND_SERVER: number = 2;
const OTLP_SPAN_KIND_PRODUCER: number = 4;
const OTLP_SPAN_KIND_CONSUMER: number = 5;
const OTLP_STATUS_CODE_OK: number = 1;

const MESSAGE_QUEUE_API_PATH: string = "/api/message-queue";

// The cron's period plus its window's slack: its first run after the send.
const DISCOVERY_WAIT_MS: number = 12.5 * 60 * 1000;
const DISCOVERY_POLL_MS: number = 20 * 1000;

const SERVICE_BUS_NAMESPACE: string = "shop-prod";
const AZURE_SUBSCRIPTION_ID: string = "00000000-0000-4000-8000-000000000000";
const RABBITMQ_GENERATED_QUEUE: string = "amq.gen-JzTY20BRgKO-HjmUJj0wLg";

const PUBLISHED: number = 4;
const CONSUMED: number = 3;

const urlFor: (path: string) => string = (path: string): string => {
  return URL.fromString(BASE_URL.toString()).addRoute(path).toString();
};

// ---- OTLP/JSON fixtures -------------------------------------------------------

interface OtlpAttribute {
  key: string;
  value: { stringValue: string };
}

const attribute: (key: string, value: string) => OtlpAttribute = (
  key: string,
  value: string,
): OtlpAttribute => {
  return { key: key, value: { stringValue: value } };
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

type SpansFunction = (data: {
  count: number;
  name: string;
  kind: number;
  attributes: Array<OtlpAttribute>;
}) => Array<Record<string, unknown>>;

// `count` spans a minute in the past, so the cron's 15-minute window holds them.
const spans: SpansFunction = (data: {
  count: number;
  name: string;
  kind: number;
  attributes: Array<OtlpAttribute>;
}): Array<Record<string, unknown>> => {
  const start: number = Date.now() - 60 * 1000;
  return Array.from(
    { length: data.count },
    (_: unknown, index: number): Record<string, unknown> => {
      return {
        traceId: randomHex(16),
        spanId: randomHex(8),
        name: data.name,
        kind: data.kind,
        startTimeUnixNano: unixNano(start + index * 1000),
        endTimeUnixNano: unixNano(start + index * 1000 + 5),
        attributes: data.attributes,
        status: { code: OTLP_STATUS_CODE_OK },
      };
    },
  );
};

type ResourceSpansFunction = (
  serviceName: string,
  scopeSpans: Array<Record<string, unknown>>,
) => Record<string, unknown>;

const resourceSpans: ResourceSpansFunction = (
  serviceName: string,
  scopeSpans: Array<Record<string, unknown>>,
): Record<string, unknown> => {
  return {
    resource: { attributes: [attribute("service.name", serviceName)] },
    scopeSpans: [
      {
        scope: { name: "e2e-queues-discovery", version: "1.0.0" },
        spans: scopeSpans,
      },
    ],
  };
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

interface DiscoveryContext {
  page: Page;
  projectId: string;
  ingestionKey: string;
  runId: string;
  kafkaTopic: string;
  rareTopic: string;
  serverSideTopic: string;
  producerServiceName: string;
  consumerServiceName: string;
  queues: Array<JSONish>;
}

test.describe.skip("Queues Discovery", () => {
  const runId: string = Faker.generateName().toLowerCase();

  const ctx: DiscoveryContext = {
    page: undefined as unknown as Page,
    projectId: "",
    ingestionKey: "",
    runId: runId,
    kafkaTopic: `payments-${runId}`,
    rareTopic: `rare-${runId}`,
    serverSideTopic: `server-side-${runId}`,
    producerServiceName: `e2e-discovery-checkout-${runId}`,
    consumerServiceName: `e2e-discovery-ledger-${runId}`,
    queues: [],
  };

  // The identifiers discovery must create, and the ones it must not.
  const expectedIdentifiers: () => Array<string> = (): Array<string> => {
    return [
      `kafka||${ctx.kafkaTopic}`,
      `servicebus|${SERVICE_BUS_NAMESPACE}|invoices-${runId}`,
      `aws_sqs||emails-${runId}`,
      `rabbitmq||jobs-${runId}`,
      `servicebus|${SERVICE_BUS_NAMESPACE}|refunds-${runId}`,
    ];
  };

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    test.setTimeout(300000);
    ctx.page = await browser.newPage();
    ctx.projectId = await registerAndCreateProject({
      page: ctx.page,
      projectNamePrefix: "E2E Queues Discovery Project",
    });
  });

  test.afterAll(async () => {
    await ctx.page.close();
  });

  test("messaging spans and broker metrics are sent through /otlp with a fresh ingestion key", async () => {
    test.setTimeout(240000);
    const page: Page = ctx.page;
    ctx.ingestionKey = await createTelemetryIngestionKey({
      page,
      projectId: ctx.projectId,
      keyName: `E2E Queues Discovery Key ${runId}`,
    });

    const serviceBusHost: Array<OtlpAttribute> = [
      attribute("messaging.system", "servicebus"),
      attribute("az.namespace", "Microsoft.ServiceBus"),
      attribute(
        "server.address",
        `${SERVICE_BUS_NAMESPACE}.servicebus.windows.net`,
      ),
    ];

    await postOtlpJson({
      page,
      ingestionKey: ctx.ingestionKey,
      signal: "traces",
      body: {
        resourceSpans: [
          resourceSpans(ctx.producerServiceName, [
            // Kafka: four publishes of the topic.
            ...spans({
              count: PUBLISHED,
              name: `send ${ctx.kafkaTopic}`,
              kind: OTLP_SPAN_KIND_PRODUCER,
              attributes: [
                attribute("messaging.system", "kafka"),
                attribute("messaging.destination.name", ctx.kafkaTopic),
                attribute("messaging.operation.type", "send"),
              ],
            }),
            // Service Bus: three sends to the queue in its namespace.
            ...spans({
              count: 3,
              name: `send invoices-${runId}`,
              kind: OTLP_SPAN_KIND_PRODUCER,
              attributes: [
                ...serviceBusHost,
                attribute("messaging.destination.name", `invoices-${runId}`),
              ],
            }),
            // SQS: named only by its queue URL, under a legacy system spelling.
            ...spans({
              count: 3,
              name: "SQS.SendMessage",
              kind: OTLP_SPAN_KIND_PRODUCER,
              attributes: [
                attribute("messaging.system", "AmazonSQS"),
                attribute(
                  "aws.sqs.queue.url",
                  `https://sqs.us-east-1.amazonaws.com/123456789012/emails-${runId}`,
                ),
              ],
            }),
            // Two spans only: below MESSAGE_QUEUE_MIN_SPANS, so no queue.
            ...spans({
              count: 2,
              name: `send ${ctx.rareTopic}`,
              kind: OTLP_SPAN_KIND_PRODUCER,
              attributes: [
                attribute("messaging.system", "kafka"),
                attribute("messaging.destination.name", ctx.rareTopic),
              ],
            }),
            // SERVER spans never name a queue, whatever they carry.
            ...spans({
              count: 5,
              name: "POST /webhook",
              kind: OTLP_SPAN_KIND_SERVER,
              attributes: [
                attribute("messaging.system", "kafka"),
                attribute("messaging.destination.name", ctx.serverSideTopic),
              ],
            }),
          ]),
          resourceSpans(ctx.consumerServiceName, [
            // Kafka: three deliveries processed by the consumer group.
            ...spans({
              count: CONSUMED,
              name: `process ${ctx.kafkaTopic}`,
              kind: OTLP_SPAN_KIND_CONSUMER,
              attributes: [
                attribute("messaging.system", "kafka"),
                attribute("messaging.destination.name", ctx.kafkaTopic),
                attribute("messaging.operation.type", "process"),
                attribute("messaging.consumer.group.name", "ledger"),
              ],
            }),
            // Service Bus: two deliveries and one from its dead-letter queue.
            ...spans({
              count: 2,
              name: `process invoices-${runId}`,
              kind: OTLP_SPAN_KIND_CONSUMER,
              attributes: [
                ...serviceBusHost,
                attribute("messaging.destination.name", `invoices-${runId}`),
              ],
            }),
            ...spans({
              count: 1,
              name: `process invoices-${runId}/$DeadLetterQueue`,
              kind: OTLP_SPAN_KIND_CONSUMER,
              attributes: [
                ...serviceBusHost,
                attribute(
                  "messaging.destination.name",
                  `invoices-${runId}/$DeadLetterQueue`,
                ),
              ],
            }),
            // RabbitMQ through the default exchange: the routing key names it.
            ...spans({
              count: 3,
              name: "amq.default process",
              kind: OTLP_SPAN_KIND_CONSUMER,
              attributes: [
                attribute("messaging.system", "rabbitmq"),
                attribute("messaging.destination.name", "amq.default"),
                attribute(
                  "messaging.rabbitmq.destination.routing_key",
                  `jobs-${runId}`,
                ),
              ],
            }),
            // A server-named RabbitMQ queue is never a queue of its own.
            ...spans({
              count: 5,
              name: `${RABBITMQ_GENERATED_QUEUE} process`,
              kind: OTLP_SPAN_KIND_CONSUMER,
              attributes: [
                attribute("messaging.system", "rabbitmq"),
                attribute(
                  "messaging.destination.name",
                  RABBITMQ_GENERATED_QUEUE,
                ),
              ],
            }),
          ]),
        ],
      },
    });

    const minute: string = unixNano(Date.now() - 60 * 1000);
    await postOtlpJson({
      page,
      ingestionKey: ctx.ingestionKey,
      signal: "metrics",
      body: {
        resourceMetrics: [
          {
            // azure_monitor: a Service Bus queue only Azure Monitor reports.
            resource: {
              attributes: [
                attribute(
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
                    name: "azure_activemessages_average",
                    unit: "Count",
                    gauge: {
                      dataPoints: [
                        {
                          asDouble: 5,
                          startTimeUnixNano: minute,
                          timeUnixNano: minute,
                          attributes: [
                            attribute("name", SERVICE_BUS_NAMESPACE),
                            attribute(
                              "type",
                              "Microsoft.ServiceBus/namespaces",
                            ),
                            attribute("resource_group", "shop-rg"),
                            attribute("location", "westeurope"),
                            attribute(
                              "metadata_entityname",
                              `refunds-${runId}`,
                            ),
                          ],
                        },
                      ],
                    },
                  },
                ],
              },
            ],
          },
          {
            // kafka_metrics: the discovered topic's consumer lag.
            resource: { attributes: [] },
            scopeMetrics: [
              {
                scope: {
                  name: "github.com/open-telemetry/opentelemetry-collector-contrib/receiver/kafkametricsreceiver",
                  version: "0.161.0",
                },
                metrics: [
                  {
                    name: "kafka.consumer_group.lag_sum",
                    unit: "1",
                    gauge: {
                      dataPoints: [
                        {
                          asInt: "12",
                          timeUnixNano: minute,
                          attributes: [
                            attribute("group", "ledger"),
                            attribute("topic", ctx.kafkaTopic),
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
  });

  test("the discovery cron creates exactly the queues the telemetry names", async () => {
    test.setTimeout(DISCOVERY_WAIT_MS + 120000);
    const page: Page = ctx.page;
    const expected: Array<string> = expectedIdentifiers();

    await expect
      .poll(
        async (): Promise<Array<string>> => {
          ctx.queues = await listItems({
            page,
            projectId: ctx.projectId,
            path: MESSAGE_QUEUE_API_PATH,
            query: {},
            select: {
              _id: true,
              name: true,
              messagingSystem: true,
              destinationName: true,
              brokerScope: true,
              queueIdentifier: true,
              discoverySource: true,
              lastSeenAt: true,
              brokerMetricsLastSeenAt: true,
            },
            limit: 100,
          });
          return ctx.queues
            .map((queue: JSONish): string => {
              return String(queue["queueIdentifier"]);
            })
            .sort();
        },
        {
          timeout: DISCOVERY_WAIT_MS,
          intervals: [DISCOVERY_POLL_MS],
          message: "the discovery cron's first run after the send",
        },
      )
      .toEqual([...expected].sort());
  });

  test("each discovered queue has the system, scope, source and sightings its telemetry gives it", async () => {
    const byIdentifier: Map<string, JSONish> = new Map<string, JSONish>(
      ctx.queues.map((queue: JSONish): [string, JSONish] => {
        return [String(queue["queueIdentifier"]), queue];
      }),
    );

    const kafka: JSONish = byIdentifier.get(`kafka||${ctx.kafkaTopic}`)!;
    expect(kafka["messagingSystem"]).toBe("kafka");
    expect(kafka["destinationName"]).toBe(ctx.kafkaTopic);
    expect(kafka["discoverySource"]).toBe("traces");
    expect(kafka["lastSeenAt"]).toBeTruthy();
    // kafka_metrics reported its lag: a broker-metrics sighting too.
    expect(kafka["brokerMetricsLastSeenAt"]).toBeTruthy();

    const invoices: JSONish = byIdentifier.get(
      `servicebus|${SERVICE_BUS_NAMESPACE}|invoices-${runId}`,
    )!;
    expect(invoices["messagingSystem"]).toBe("servicebus");
    expect(invoices["brokerScope"]).toBe(SERVICE_BUS_NAMESPACE);
    // The dead-letter sub-queue folds into its queue: no second row.
    expect(invoices["destinationName"]).toBe(`invoices-${runId}`);

    const emails: JSONish = byIdentifier.get(`aws_sqs||emails-${runId}`)!;
    // The legacy spelling is folded, and the URL's last segment names it.
    expect(emails["messagingSystem"]).toBe("aws_sqs");
    expect(emails["destinationName"]).toBe(`emails-${runId}`);

    const jobs: JSONish = byIdentifier.get(`rabbitmq||jobs-${runId}`)!;
    expect(jobs["destinationName"]).toBe(`jobs-${runId}`);

    const refunds: JSONish = byIdentifier.get(
      `servicebus|${SERVICE_BUS_NAMESPACE}|refunds-${runId}`,
    )!;
    expect(refunds["discoverySource"]).toBe("broker-metrics");
    expect(refunds["brokerMetricsLastSeenAt"]).toBeTruthy();
  });

  test("the Queues list shows the discovered queues, and the Kafka topic's Overview counts both sides", async () => {
    test.setTimeout(420000);
    const page: Page = ctx.page;

    await gotoProjectPage({
      page,
      projectId: ctx.projectId,
      url: urlFor(`/dashboard/${ctx.projectId}/queues`),
      ready: page.getByText(ctx.kafkaTopic, { exact: true }).first(),
    });
    for (const name of [
      `invoices-${runId}`,
      `emails-${runId}`,
      `jobs-${runId}`,
      `refunds-${runId}`,
    ]) {
      await expect(page.getByText(name, { exact: true }).first()).toBeVisible({
        timeout: 30000,
      });
    }

    await page.getByText(ctx.kafkaTopic, { exact: true }).first().click();
    await page.waitForURL(
      new RegExp(`/dashboard/${ctx.projectId}/queues/[0-9a-f-]{36}`),
      { timeout: 30000 },
    );

    const tile: (title: string) => Locator = (title: string): Locator => {
      return page.locator('div[aria-busy="false"]').filter({
        has: page.getByText(title, { exact: true }),
      });
    };
    await expect(
      tile("Published").getByText(String(PUBLISHED), { exact: true }),
    ).toBeVisible({ timeout: 120000 });
    await expect(
      tile("Consumed").getByText(String(CONSUMED), { exact: true }),
    ).toBeVisible({ timeout: 120000 });
    await expect(page.getByTestId("message-queue-producers")).toContainText(
      ctx.producerServiceName,
      { timeout: 60000 },
    );
    await expect(page.getByTestId("message-queue-consumers")).toContainText(
      ctx.consumerServiceName,
      { timeout: 60000 },
    );
  });
});
