import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, waitFor } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import { getJestSpyOn } from "../../Spy";

/*
 * The queue page's "Create monitor" link, opened in the REAL Monitor Create
 * page: what the monitor form is pre-seeded with is what the link is for.
 * The page reads the link's metric-explorer params (metricQueries,
 * metricFormulas, the window) and description the way it reads the
 * Database chart's and the explorer's; ModelForm is replaced by a stub that
 * captures its initial values, as in MonitorCreateFromMonitorBackedDevice.
 *
 * What must arrive: a Metrics monitor named after the queue's metric, the
 * exact queue filters and fold, the formula of a series total, a criteria
 * on the link's starting threshold (warning, or critical for a Critical
 * template), and the rolling time the link's window stands for — thirty
 * minutes for a CloudWatch metric, fifteen for Cloud Monitoring. And for
 * every catalog gauge, the hint beside the link states exactly the criteria
 * the page built from it — none for a threshold on a formula, which the
 * page does not read — and a dead-letter queue holding one message fires it.
 */

type CapturedFormProps = {
  initialValues: Record<string, unknown>;
};

let capturedForm: CapturedFormProps | null = null;

jest.mock("../../../UI/Components/Forms/ModelForm", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Components/Forms/ModelForm",
  ) as Record<string, unknown>;

  return {
    __esModule: true,
    ...actual,
    default: (props: CapturedFormProps): React.ReactElement => {
      capturedForm = props;
      return <div data-testid="model-form" />;
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorSteps",
  () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => {
        return <div data-testid="monitor-steps" />;
      },
    };
  },
);

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/Probe", () => {
  return {
    __esModule: true,
    default: {
      getAllProbes: (): Promise<Array<Record<string, unknown>>> => {
        return Promise.resolve([]);
      },
    },
  };
});

const ONLINE_STATUS_ID: string = "44444444-4444-4444-8444-444444444444";

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (): Promise<unknown> => {
        return Promise.resolve({
          doNotAddGlobalProbesByDefaultOnNewMonitors: false,
        });
      },
      getList: (request: {
        modelType: { name?: string };
      }): Promise<unknown> => {
        const { default: MonitorStatusType } = jest.requireActual(
          "../../../Models/DatabaseModels/MonitorStatus",
        ) as {
          default: new () => { id?: unknown; isOperationalState?: boolean };
        };
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        if ((request.modelType as unknown) === MonitorStatusType) {
          const status: { id?: unknown; isOperationalState?: boolean } =
            new MonitorStatusType();
          status.id = new ObjectIDType("44444444-4444-4444-8444-444444444444");
          status.isOperationalState = true;
          return Promise.resolve({
            data: [status],
            count: 1,
            skip: 0,
            limit: 1,
          });
        }
        return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
      },
    },
  };
});

import MonitorCreate, {
  MONITOR_DESCRIPTION_QUERY_PARAM,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/Create";
import {
  MESSAGE_QUEUE_METRIC_MONITOR_DESCRIPTION_PARAM,
  MessageQueueMetricMonitorLink,
  buildMessageQueueMetricMonitorLink,
  getMessageQueueMetricMonitorHint,
  getMessageQueueRollingTimeAdjective,
  getMessageQueueRollingTimeWords,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MessageQueue/MessageQueueMetricMonitorLink";
import CompareCriteria from "../../../Server/Utils/Monitor/Criteria/CompareCriteria";
import Project from "../../../Models/DatabaseModels/Project";
import Route from "../../../Types/API/Route";
import Includes from "../../../Types/BaseDatabase/Includes";
import {
  MessageQueueIdentity,
  parseMessageQueueIdentifier,
  toMessageQueueIdentity,
} from "../../../Types/MessageQueue/MessageQueueIdentity";
import {
  MESSAGE_QUEUE_METRICS,
  MessageQueueMetricDescriptor,
  getMessageQueueMetricDescriptorsByName,
  getMessageQueueMetricId,
} from "../../../Types/MessageQueue/MessageQueueMetricCatalog";
import {
  ResolvedMessagingDestination,
  resolveMessagingMetricDatapoint,
} from "../../../Types/MessageQueue/MessagingTelemetryResolver";
import {
  CriteriaFilter,
  FilterType,
} from "../../../Types/Monitor/CriteriaFilter";
import {
  MessageQueueAlertTemplate,
  getMessageQueueAlertTemplateForMetric,
  getMessageQueueMetricFilterAttributeKeys,
} from "../../../Types/Monitor/MessageQueueAlertTemplates";
import {
  FixtureAttributes,
  METRIC_FIXTURES,
  MetricFixture,
  toStoredColumns,
} from "../../Types/MessageQueue/MessagingTelemetryFixtures";
import MetricFormulaConfigData from "../../../Types/Metrics/MetricFormulaConfigData";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import UiAnalytics from "../../../UI/Utils/Analytics";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

function descriptorOf(
  system: string,
  metricName: string,
): MessageQueueMetricDescriptor {
  return getMessageQueueMetricDescriptorsByName(metricName).find(
    (candidate: MessageQueueMetricDescriptor): boolean => {
      return candidate.system === system;
    },
  )!;
}

function linkOf(data: {
  system: string;
  metricName: string;
  identifier: string;
  observedSeries: Array<Record<string, string>>;
}): MessageQueueMetricMonitorLink {
  const link: MessageQueueMetricMonitorLink | null =
    buildMessageQueueMetricMonitorLink({
      descriptor: descriptorOf(data.system, data.metricName),
      observedSeries: data.observedSeries,
      identity: parseMessageQueueIdentifier(data.identifier),
      queueName: "orders",
    });
  expect(link).not.toBeNull();
  return link!;
}

// Opens Monitor Create on the link, and returns the form's initial values.
async function openLink(
  link: MessageQueueMetricMonitorLink,
): Promise<Record<string, unknown>> {
  const search: URLSearchParams = new URLSearchParams(
    link.route.toString().split("?")[1] || "",
  );
  jest
    .spyOn(Navigation, "getQueryStringByName")
    .mockImplementation((paramName: string): string | null => {
      return search.get(paramName);
    });

  const project: Project = new Project();
  project.id = PROJECT_ID;

  render(
    <MemoryRouter>
      <MonitorCreate
        pageRoute={new Route("/dashboard/monitors/create")}
        currentProject={project}
        hasPaymentMethod={true}
      />
    </MemoryRouter>,
  );

  await waitFor(() => {
    expect(capturedForm).not.toBeNull();
    expect(capturedForm!.initialValues["monitorSteps"]).toBeDefined();
  });

  return capturedForm!.initialValues;
}

function stepOf(initialValues: Record<string, unknown>): MonitorStep {
  const steps: MonitorSteps = MonitorSteps.fromJSON(
    initialValues["monitorSteps"] as JSONObject,
  );
  return steps.data!.monitorStepsInstanceArray[0]!;
}

function queriesOf(step: MonitorStep): Array<MetricQueryConfigData> {
  return step.data!.metricMonitor!.metricViewConfig.queryConfigs;
}

function formulasOf(step: MonitorStep): Array<MetricFormulaConfigData> {
  return step.data!.metricMonitor!.metricViewConfig.formulaConfigs || [];
}

function criteriaOf(step: MonitorStep): Array<MonitorCriteriaInstance> {
  return step.data?.monitorCriteria?.data?.monitorCriteriaInstanceArray || [];
}

function thresholdCriteria(
  step: MonitorStep,
): Array<{ name: string; value: unknown; alias: unknown; type: unknown }> {
  return criteriaOf(step)
    .filter((instance: MonitorCriteriaInstance): boolean => {
      return (
        instance.data?.name === "Warning" || instance.data?.name === "Critical"
      );
    })
    .map(
      (
        instance: MonitorCriteriaInstance,
      ): { name: string; value: unknown; alias: unknown; type: unknown } => {
        const filter: {
          value?: unknown;
          filterType?: unknown;
          metricMonitorOptions?: { metricAlias?: unknown };
        } = instance.data!.filters[0] as {
          value?: unknown;
          filterType?: unknown;
          metricMonitorOptions?: { metricAlias?: unknown };
        };
        return {
          name: instance.data!.name || "",
          value: filter.value,
          alias: filter.metricMonitorOptions?.metricAlias,
          type: filter.filterType,
        };
      },
    );
}

// The Warning / Critical criteria filters the page built, as it built them.
function thresholdFilters(
  step: MonitorStep,
): Array<{ name: string; filter: CriteriaFilter }> {
  return criteriaOf(step)
    .filter((instance: MonitorCriteriaInstance): boolean => {
      return (
        instance.data?.name === "Warning" || instance.data?.name === "Critical"
      );
    })
    .map(
      (
        instance: MonitorCriteriaInstance,
      ): { name: string; filter: CriteriaFilter } => {
        expect(instance.data!.filters).toHaveLength(1);
        return {
          name: instance.data!.name || "",
          filter: instance.data!.filters[0]!,
        };
      },
    );
}

function getter(attributes: FixtureAttributes): (key: string) => unknown {
  return (key: string): unknown => {
    return Object.prototype.hasOwnProperty.call(attributes, key)
      ? attributes[key]
      : undefined;
  };
}

/*
 * A gauge's link built from the realistic stored datapoint the resolver,
 * catalog and template suites share: its series read back the way the
 * observed-series query returns it, and the queue that datapoint resolves
 * to.
 */
function fixtureLinkOf(
  descriptor: MessageQueueMetricDescriptor,
): MessageQueueMetricMonitorLink {
  const fixture: MetricFixture | undefined = METRIC_FIXTURES.find(
    (candidate: MetricFixture): boolean => {
      return (
        candidate.metricName === descriptor.metricName &&
        candidate.expected?.system === descriptor.system
      );
    },
  );
  expect(fixture).toBeDefined();
  const resolved: ResolvedMessagingDestination | null =
    resolveMessagingMetricDatapoint({
      metricName: descriptor.metricName,
      getAttribute: getter(fixture!.attributes),
    });
  const identity: MessageQueueIdentity | null = resolved
    ? toMessageQueueIdentity({
        system: resolved.system,
        brokerScope: resolved.brokerScope,
        destination: resolved.destination,
      })
    : null;
  const link: MessageQueueMetricMonitorLink | null =
    buildMessageQueueMetricMonitorLink({
      descriptor: descriptor,
      observedSeries: [
        toStoredColumns(
          fixture!.attributes,
          getMessageQueueMetricFilterAttributeKeys(descriptor),
        ),
      ],
      identity: identity,
      queueName: "orders",
    });
  expect(link).not.toBeNull();
  return link!;
}

const GAUGE_CASES: Array<[string, MessageQueueMetricDescriptor]> =
  MESSAGE_QUEUE_METRICS.filter(
    (descriptor: MessageQueueMetricDescriptor): boolean => {
      return descriptor.kind === "gauge";
    },
  ).map(
    (
      descriptor: MessageQueueMetricDescriptor,
    ): [string, MessageQueueMetricDescriptor] => {
      return [getMessageQueueMetricId(descriptor), descriptor];
    },
  );

// Every gauge whose template alerts on any dead-lettered message.
const DEAD_LETTER_CASES: Array<[string, MessageQueueMetricDescriptor]> =
  GAUGE_CASES.filter(
    ([, descriptor]: [string, MessageQueueMetricDescriptor]): boolean => {
      return (
        descriptor.signal === "deadLetter" &&
        getMessageQueueAlertTemplateForMetric(descriptor) !== undefined
      );
    },
  );

describe("Monitor Create opened from a queue's Create monitor link", () => {
  beforeEach(() => {
    capturedForm = null;
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
    getJestSpyOn(UiAnalytics, "captureRevenueEvent").mockImplementation(
      (): void => {},
    );
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("the link sends its description in the parameter the page reads", () => {
    expect(MESSAGE_QUEUE_METRIC_MONITOR_DESCRIPTION_PARAM).toBe(
      MONITOR_DESCRIPTION_QUERY_PARAM,
    );
  });

  test("Kafka consumer lag: the topic filter, Max, a warning at 10,000 on 'a', ten minutes", async () => {
    const initialValues: Record<string, unknown> = await openLink(
      linkOf({
        system: "kafka",
        metricName: "kafka.consumer_group.lag_sum",
        identifier: "kafka||orders",
        observedSeries: [{ topic: "orders" }],
      }),
    );

    expect(initialValues["monitorType"]).toBe(MonitorType.Metrics);
    expect(initialValues["name"]).toBe("orders: Consumer lag Monitor");
    expect(initialValues["description"]).toBe("Created from queue orders.");
    // The operational status the steps need, fetched by the page.
    expect(
      MonitorSteps.fromJSON(
        initialValues["monitorSteps"] as JSONObject,
      ).data!.defaultMonitorStatusId?.toString(),
    ).toBe(ONLINE_STATUS_ID);

    const step: MonitorStep = stepOf(initialValues);
    expect(step.data!.metricMonitor!.rollingTime).toBe(
      RollingTime.Past10Minutes,
    );
    const queries: Array<MetricQueryConfigData> = queriesOf(step);
    expect(queries).toHaveLength(1);
    expect(queries[0]!.metricAliasData?.metricVariable).toBe("a");
    expect(queries[0]!.metricQueryData.filterData).toEqual(
      expect.objectContaining({
        metricName: "kafka.consumer_group.lag_sum",
        attributes: { topic: "orders" },
        aggegationType: MetricsAggregationType.Max,
      }),
    );
    expect(formulasOf(step)).toEqual([]);
    expect(thresholdCriteria(step)).toEqual([
      {
        name: "Warning",
        value: 10000,
        alias: "a",
        type: FilterType.GreaterThan,
      },
    ]);
  });

  test("SQS messages visible from CloudWatch: the queue's dimension, thirty minutes", async () => {
    const initialValues: Record<string, unknown> = await openLink(
      linkOf({
        system: "aws_sqs",
        metricName: "amazonaws.com/aws/sqs/approximatenumberofmessagesvisible",
        identifier: "aws_sqs||orders",
        observedSeries: [{ "Dimensions.QueueName": "orders" }],
      }),
    );

    const step: MonitorStep = stepOf(initialValues);
    expect(step.data!.metricMonitor!.rollingTime).toBe(
      RollingTime.Past30Minutes,
    );
    expect(queriesOf(step)[0]!.metricQueryData.filterData.attributes).toEqual({
      "Dimensions.QueueName": "orders",
    });
    expect(thresholdCriteria(step)).toEqual([
      {
        name: "Warning",
        value: 1000,
        alias: "a",
        type: FilterType.GreaterThan,
      },
    ]);
  });

  test("SQS messages in flight: a critical criteria near the quota", async () => {
    const initialValues: Record<string, unknown> = await openLink(
      linkOf({
        system: "aws_sqs",
        metricName:
          "amazonaws.com/aws/sqs/approximatenumberofmessagesnotvisible",
        identifier: "aws_sqs||orders",
        observedSeries: [{ "Dimensions.QueueName": "orders" }],
      }),
    );

    const step: MonitorStep = stepOf(initialValues);
    expect(thresholdCriteria(step)).toEqual([
      {
        name: "Critical",
        value: 108000,
        alias: "a",
        type: FilterType.GreaterThan,
      },
    ]);
    expect(step.data!.metricMonitor!.rollingTime).toBe(
      RollingTime.Past30Minutes,
    );
  });

  test("Pub/Sub acknowledged messages: no starting threshold, fifteen minutes", async () => {
    const initialValues: Record<string, unknown> = await openLink(
      linkOf({
        system: "gcp_pubsub",
        metricName: "pubsub.googleapis.com/subscription/ack_message_count",
        identifier: "gcp_pubsub||orders-sub",
        observedSeries: [{ "resource.subscription_id": "orders-sub" }],
      }),
    );

    const step: MonitorStep = stepOf(initialValues);
    expect(step.data!.metricMonitor!.rollingTime).toBe(
      RollingTime.Past15Minutes,
    );
    expect(queriesOf(step)[0]!.metricQueryData.filterData).toEqual(
      expect.objectContaining({
        attributes: { "resource.subscription_id": "orders-sub" },
        aggegationType: MetricsAggregationType.Sum,
      }),
    );
    expect(thresholdCriteria(step)).toEqual([]);
  });

  test("RabbitMQ queue depth: one query per state and the formula adding them", async () => {
    const initialValues: Record<string, unknown> = await openLink(
      linkOf({
        system: "rabbitmq",
        metricName: "rabbitmq.message.current",
        identifier: "rabbitmq||orders",
        observedSeries: [{ "resource.rabbitmq.queue.name": "orders" }],
      }),
    );

    const step: MonitorStep = stepOf(initialValues);
    expect(
      queriesOf(step).map((query: MetricQueryConfigData): unknown => {
        return {
          variable: query.metricAliasData?.metricVariable,
          attributes: query.metricQueryData.filterData.attributes,
          aggregation: query.metricQueryData.filterData.aggegationType,
        };
      }),
    ).toEqual([
      {
        variable: "a_ready",
        attributes: {
          "resource.rabbitmq.queue.name": "orders",
          state: "ready",
        },
        aggregation: MetricsAggregationType.Avg,
      },
      {
        variable: "a_unacknowledged",
        attributes: {
          "resource.rabbitmq.queue.name": "orders",
          state: "unacknowledged",
        },
        aggregation: MetricsAggregationType.Avg,
      },
    ]);
    const formulas: Array<MetricFormulaConfigData> = formulasOf(step);
    expect(formulas).toHaveLength(1);
    expect(formulas[0]!.metricAliasData.metricVariable).toBe("a");
    expect(formulas[0]!.metricFormulaData.metricFormula).toBe(
      "a_ready + a_unacknowledged",
    );
    // The link puts the starting threshold on the formula, never on a part.
    expect(formulas[0]!.warningThreshold).toBe(1000);
    for (const query of queriesOf(step)) {
      expect(query.warningThreshold).toBeUndefined();
    }
    expect(step.data!.metricMonitor!.rollingTime).toBe(
      RollingTime.Past10Minutes,
    );
  });

  test("RabbitMQ queue depth: the page builds no criteria from the formula's threshold, and the link promises none", async () => {
    const link: MessageQueueMetricMonitorLink = linkOf({
      system: "rabbitmq",
      metricName: "rabbitmq.message.current",
      identifier: "rabbitmq||orders",
      observedSeries: [{ "resource.rabbitmq.queue.name": "orders" }],
    });

    const step: MonitorStep = stepOf(await openLink(link));

    expect(thresholdCriteria(step)).toEqual([]);
    expect(link.criteria).toBeNull();
    expect(getMessageQueueMetricMonitorHint(link)).toBe(
      "No starting threshold · 10-minute window",
    );
    // What to add instead is said.
    expect(link.criteriaNote).toContain("above 1,000 messages");
  });

  test.each(GAUGE_CASES)(
    "%s: the hint states exactly the criteria the page builds from the link",
    async (_id: string, descriptor: MessageQueueMetricDescriptor) => {
      const link: MessageQueueMetricMonitorLink = fixtureLinkOf(descriptor);

      const step: MonitorStep = stepOf(await openLink(link));
      const built: Array<{ name: string; filter: CriteriaFilter }> =
        thresholdFilters(step);
      const hint: string = getMessageQueueMetricMonitorHint(link);

      if (!link.criteria) {
        expect(built).toEqual([]);
        expect(hint).toBe(
          `No starting threshold · ${getMessageQueueRollingTimeAdjective(
            link.rollingTime,
          )} window`,
        );
        return;
      }

      expect(built).toHaveLength(1);
      const filter: CriteriaFilter = built[0]!.filter;
      expect(built[0]!.name).toBe(link.criteria.severity);
      expect(filter.filterType).toBe(link.criteria.filterType);
      expect(filter.value).toBe(link.criteria.value);
      expect(filter.metricMonitorOptions?.metricAggregationType).toBe(
        link.criteria.evaluation,
      );
      expect(filter.metricMonitorOptions?.metricAlias).toBe(
        link.criteria.alias,
      );
      expect(step.data!.metricMonitor!.rollingTime).toBe(link.rollingTime);
      expect(hint).toBe(
        `${link.criteria.severity} when any point in the last ${getMessageQueueRollingTimeWords(
          link.rollingTime,
        )} is above ${link.criteria.valueLabel}`,
      );
    },
  );

  test.each(DEAD_LETTER_CASES)(
    "%s: a dead-letter queue holding one message fires the criteria the page builds",
    async (_id: string, descriptor: MessageQueueMetricDescriptor) => {
      const template: MessageQueueAlertTemplate =
        getMessageQueueAlertTemplateForMetric(descriptor)!;
      // The template alerts at or above one message: "any".
      expect(template.threshold).toBe(1);
      expect(template.filterType).toBe(FilterType.GreaterThanOrEqualTo);

      const step: MonitorStep = stepOf(
        await openLink(fixtureLinkOf(descriptor)),
      );
      const built: Array<{ name: string; filter: CriteriaFilter }> =
        thresholdFilters(step);
      expect(built).toHaveLength(1);
      const filter: CriteriaFilter = built[0]!.filter;

      // The monitor's own comparison, on a window whose every point is 1.
      expect(
        CompareCriteria.compareCriteriaNumbers({
          value: [1, 1, 1],
          threshold: Number(filter.value),
          criteriaFilter: filter,
        }),
      ).not.toBeNull();
      // An empty dead-letter queue does not.
      expect(
        CompareCriteria.compareCriteriaNumbers({
          value: [0, 0, 0],
          threshold: Number(filter.value),
          criteriaFilter: filter,
        }),
      ).toBeNull();
    },
  );

  test("a partitioned Pulsar topic keeps every partition in its filter", async () => {
    const initialValues: Record<string, unknown> = await openLink(
      linkOf({
        system: "pulsar",
        metricName: "pulsar_subscription_back_log",
        identifier: "pulsar||persistent://public/default/orders",
        observedSeries: [
          { topic: "persistent://public/default/orders-partition-0" },
          { topic: "persistent://public/default/orders-partition-1" },
        ],
      }),
    );

    const filter: unknown = (
      queriesOf(stepOf(initialValues))[0]!.metricQueryData.filterData
        .attributes as Record<string, unknown>
    )["topic"];
    expect(filter).toBeInstanceOf(Includes);
    expect((filter as Includes).values).toEqual([
      "persistent://public/default/orders-partition-0",
      "persistent://public/default/orders-partition-1",
    ]);
  });
});
