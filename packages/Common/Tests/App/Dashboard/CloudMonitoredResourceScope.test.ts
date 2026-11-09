import { describe, expect, test } from "@jest/globals";
import {
  CLOUD_RESOURCE_AVERAGED_ROW_CAPTION,
  CLOUD_RESOURCE_SUMMED_ROW_CAPTION,
  CloudMonitoredResourceRowAggregation,
  getCloudMonitoredResourceAttributeDisplayKeys,
  getCloudMonitoredResourceAttributeFilters,
  getCloudMonitoredResourceRowAggregation,
  isCloudMonitoredResourceScoped,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Cloud/Utils/CloudMonitoredResourceScope";
import {
  AWS_CLOUDWATCH_DIMENSION_PREFIX,
  CloudMonitoredResource,
  resolveCloudMonitoredResource,
} from "../../../Types/Cloud/CloudMonitoredResource";
import { CloudResourceKind } from "../../../Types/Cloud/CloudResourceKind";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import { CLOUD_ALERT_WINDOWS } from "../../../Types/Monitor/CloudAlertTemplates";
import RollingTimeUtil from "../../../Types/RollingTime/RollingTimeUtil";
import { MetricRowAggregation } from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/MetricRowScope";
import { getCloudResourceTypeDescriptor } from "../../../Types/Cloud/CloudResourceCatalog";
import fs from "fs";
import path from "path";

/*
 * Every page of a Cloud Resource - one IaaS or PaaS resource discovered
 * from Azure Monitor, CloudWatch or Cloud Monitoring - scopes its metrics
 * through this helper, and the monitors created from those pages inherit
 * the scope. The behaviour that matters most is the negative one: a row
 * with no usable recorded attributes must report itself as unscoped, never
 * produce an empty filter, which would be "every metric in the project".
 */

const SUBSCRIPTION: string = "7c4a1f2e-9d3b-4e5f-8a6b-1c2d3e4f5a6b";
const ARM_ID: string = `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg-prod/providers/Microsoft.Compute/virtualMachines/vm-1`;

function resource(telemetryAttributes: unknown): {
  cloudResourceKind: string;
  telemetryAttributes: unknown;
} {
  return {
    cloudResourceKind: CloudResourceKind.Resource,
    telemetryAttributes: telemetryAttributes,
  };
}

describe("getCloudMonitoredResourceAttributeFilters", () => {
  test("a resource's filter is its recorded attributes, exactly", () => {
    expect(
      getCloudMonitoredResourceAttributeFilters(
        resource({
          Namespace: "AWS/EC2",
          "Dimensions.InstanceId": "i-0abc",
          "resource.cloud.account.id": "123456789012",
          "resource.cloud.region": "us-east-1",
        }),
      ),
    ).toEqual({
      Namespace: "AWS/EC2",
      "Dimensions.InstanceId": "i-0abc",
      "resource.cloud.account.id": "123456789012",
      "resource.cloud.region": "us-east-1",
    });
  });

  test("values are kept as recorded, not trimmed or re-cased", () => {
    expect(
      getCloudMonitoredResourceAttributeFilters(
        resource({ "azuremonitor.resource_id": ` ${ARM_ID} ` }),
      ),
    ).toEqual({ "azuremonitor.resource_id": ` ${ARM_ID} ` });
  });

  test("drops empty, blank and non-string values", () => {
    expect(
      getCloudMonitoredResourceAttributeFilters(
        resource({
          "azuremonitor.resource_id": ARM_ID,
          empty: "",
          blank: "   ",
          number: 5,
          flag: true,
          missing: null,
          nested: { a: "b" },
          list: ["a"],
        }),
      ),
    ).toEqual({ "azuremonitor.resource_id": ARM_ID });
  });

  test.each([
    ["no attributes", undefined],
    ["null", null],
    ["an empty object", {}],
    ["only empty values", { a: "", b: "  " }],
    ["an array", ["azuremonitor.resource_id"]],
    ["a string", "azuremonitor.resource_id"],
    ["a number", 7],
  ])(
    "a resource with %s has no filter and is unscoped",
    (_label: string, telemetryAttributes: unknown) => {
      expect(
        getCloudMonitoredResourceAttributeFilters(
          resource(telemetryAttributes),
        ),
      ).toEqual({});
      expect(
        isCloudMonitoredResourceScoped(resource(telemetryAttributes)),
      ).toBe(false);
    },
  );

  test("an environment never gets a resource filter, whatever it carries", () => {
    const environment: {
      cloudResourceKind: string;
      telemetryAttributes: unknown;
    } = {
      cloudResourceKind: CloudResourceKind.Environment,
      telemetryAttributes: { "azuremonitor.resource_id": ARM_ID },
    };

    expect(getCloudMonitoredResourceAttributeFilters(environment)).toEqual({});
    expect(isCloudMonitoredResourceScoped(environment)).toBe(false);
  });

  test("a row read without its kind is an environment", () => {
    expect(
      getCloudMonitoredResourceAttributeFilters({
        telemetryAttributes: { "azuremonitor.resource_id": ARM_ID },
      }),
    ).toEqual({});
  });

  test("no row is unscoped", () => {
    expect(getCloudMonitoredResourceAttributeFilters(null)).toEqual({});
    expect(getCloudMonitoredResourceAttributeFilters(undefined)).toEqual({});
    expect(isCloudMonitoredResourceScoped(null)).toBe(false);
    expect(isCloudMonitoredResourceScoped(undefined)).toBe(false);
  });

  test("a resource with one usable attribute is scoped", () => {
    expect(
      isCloudMonitoredResourceScoped(
        resource({ "azuremonitor.resource_id": ARM_ID, other: "" }),
      ),
    ).toBe(true);
  });

  test("never mutates the row", () => {
    const attributes: Record<string, unknown> = {
      "azuremonitor.resource_id": ARM_ID,
      empty: "",
    };
    const filters: Record<string, string> =
      getCloudMonitoredResourceAttributeFilters(resource(attributes));

    filters["added"] = "x";

    expect(attributes).toEqual({
      "azuremonitor.resource_id": ARM_ID,
      empty: "",
    });
  });
});

describe("getCloudMonitoredResourceAttributeDisplayKeys", () => {
  test("names the receivers' fixed keys in words", () => {
    expect(
      getCloudMonitoredResourceAttributeDisplayKeys({
        "azuremonitor.resource_id": ARM_ID,
        Namespace: "AWS/EC2",
        "resource.service.namespace": "AWS",
        "resource.service.name": "EC2",
        "resource.cloud.account.id": "123456789012",
        "resource.cloud.region": "us-east-1",
        "resource.gcp.resource_type": "gce_instance",
        "resource.project_id": "acme-prod",
      }),
    ).toEqual({
      "azuremonitor.resource_id": "Azure resource",
      Namespace: "CloudWatch namespace",
      "resource.service.namespace": "CloudWatch namespace",
      "resource.service.name": "CloudWatch service",
      "resource.cloud.account.id": "Account",
      "resource.cloud.region": "Region",
      "resource.gcp.resource_type": "Resource type",
      "resource.project_id": "Project",
    });
  });

  test("a CloudWatch dimension reads as its own name", () => {
    expect(
      getCloudMonitoredResourceAttributeDisplayKeys({
        "Dimensions.InstanceId": "i-0abc",
        "Dimensions.Cluster Name": "orders",
        // The JSON stream's spelling of InstanceId, and its flat dimensions.
        "service.instance.id": "i-0abc",
        LoadBalancer: "app/web/50dc6c495c0c9188",
      }),
    ).toEqual({
      "Dimensions.InstanceId": "InstanceId",
      "Dimensions.Cluster Name": "Cluster Name",
      "service.instance.id": "InstanceId",
      LoadBalancer: "LoadBalancer",
    });
  });

  test("a Cloud Monitoring label reads as its own name", () => {
    expect(
      getCloudMonitoredResourceAttributeDisplayKeys({
        "resource.zone": "us-central1-a",
        "resource.instance_id": "1234567890",
      }),
    ).toEqual({
      "resource.zone": "zone",
      "resource.instance_id": "instance_id",
    });
  });

  test("an empty filter has no chips", () => {
    expect(getCloudMonitoredResourceAttributeDisplayKeys({})).toEqual({});
  });
});

/*
 * What ingest records for a resource (CloudMonitoredResource
 * .telemetryAttributes) is what this helper filters on. A round trip from a
 * stored row of each receiver shape through the resolver and the helper
 * proves the filter selects that row, and that no chip reads as a raw
 * stored key.
 */
describe("from a stored metric row to the Metrics tab's filter", () => {
  const cases: Array<{
    label: string;
    metricName: string;
    attributes: Record<string, unknown>;
  }> = [
    {
      label: "Azure Monitor",
      metricName: "azure_percentage_cpu_average",
      attributes: {
        "resource.azuremonitor.subscription_id": SUBSCRIPTION,
        "resource.azuremonitor.tenant_id": "tenant",
        "azuremonitor.resource_id": ARM_ID,
        name: "vm-1",
        type: "Microsoft.Compute/virtualMachines",
        resource_group: "rg-prod",
        location: "westeurope",
        metadata_LUN: "0",
      },
    },
    {
      label: "CloudWatch, OpenTelemetry 1.0",
      metricName: "amazonaws.com/aws/ec2/cpuutilization",
      attributes: {
        Namespace: "AWS/EC2",
        MetricName: "CPUUtilization",
        "Dimensions.InstanceId": "i-0abc",
        "resource.cloud.provider": "aws",
        "resource.cloud.account.id": "123456789012",
        "resource.cloud.region": "us-east-1",
      },
    },
    {
      label: "CloudWatch, JSON stream",
      metricName: "cpuutilization",
      attributes: {
        "resource.aws.cloudwatch.metric_stream_name": "all",
        "resource.service.namespace": "AWS",
        "resource.service.name": "EC2",
        "resource.cloud.account.id": "123456789012",
        "resource.cloud.region": "us-east-1",
        "service.instance.id": "i-0abc",
      },
    },
    {
      label: "Cloud Monitoring",
      metricName: "compute.googleapis.com/instance/cpu/utilization",
      attributes: {
        "resource.gcp.resource_type": "gce_instance",
        "resource.project_id": "acme-prod",
        "resource.zone": "us-central1-a",
        "resource.instance_id": "1234567890",
        "resource.name": 'string_value:"web-1"',
        instance_name: "web-1",
      },
    },
  ];

  test.each(cases)(
    "$label: the filter is a subset of the row, and every chip is readable",
    (testCase: {
      label: string;
      metricName: string;
      attributes: Record<string, unknown>;
    }) => {
      const resolved: CloudMonitoredResource | null =
        resolveCloudMonitoredResource({
          metricName: testCase.metricName,
          attributes: testCase.attributes,
        });
      expect(resolved).not.toBeNull();

      const filters: Record<string, string> =
        getCloudMonitoredResourceAttributeFilters(
          resource(resolved!.telemetryAttributes),
        );

      expect(filters).toEqual(resolved!.telemetryAttributes);
      expect(Object.keys(filters).length).toBeGreaterThan(0);
      for (const [key, value] of Object.entries(filters)) {
        expect(testCase.attributes[key]).toBe(value);
      }

      const displayKeys: Record<string, string> =
        getCloudMonitoredResourceAttributeDisplayKeys(filters);

      expect(Object.keys(displayKeys).sort()).toEqual(
        Object.keys(filters).sort(),
      );
      for (const displayKey of Object.values(displayKeys)) {
        expect(displayKey.startsWith(AWS_CLOUDWATCH_DIMENSION_PREFIX)).toBe(
          false,
        );
        expect(displayKey.startsWith("resource.")).toBe(false);
        expect(displayKey.length).toBeGreaterThan(0);
      }
    },
  );

  test("two resources of one account never share a filter", () => {
    const filtersOf: (instanceId: string) => Record<string, string> = (
      instanceId: string,
    ): Record<string, string> => {
      const resolved: CloudMonitoredResource | null =
        resolveCloudMonitoredResource({
          metricName: "amazonaws.com/aws/ec2/cpuutilization",
          attributes: {
            Namespace: "AWS/EC2",
            "Dimensions.InstanceId": instanceId,
            "resource.cloud.account.id": "123456789012",
            "resource.cloud.region": "us-east-1",
          },
        });
      return getCloudMonitoredResourceAttributeFilters(
        resource(resolved!.telemetryAttributes),
      );
    };

    expect(filtersOf("i-0abc")).not.toEqual(filtersOf("i-0def"));
    expect(filtersOf("i-0abc")["Dimensions.InstanceId"]).toBe("i-0abc");
  });
});

/*
 * How a resource's metric rows read (#6410). A Service Bus or Event Hubs
 * namespace's metrics arrive once per queue, topic and event hub, so their
 * average is the average queue: each row whose series add up reads as their
 * total and says so, and every other resource's rows read as they did.
 */
describe("getCloudMonitoredResourceRowAggregation", () => {
  const SERVICE_BUS: string = "Microsoft.ServiceBus/namespaces";
  const EVENT_HUBS: string = "Microsoft.EventHub/namespaces";

  function rowsOf(
    provider: unknown,
    type: unknown,
  ): CloudMonitoredResourceRowAggregation | undefined {
    return getCloudMonitoredResourceRowAggregation({
      cloudProvider: provider,
      cloudResourceType: type,
    });
  }

  const HOUR_MS: number = 60 * 60 * 1000;
  const END: Date = new Date("2026-11-09T12:00:00.000Z");
  // How long Azure's monitors read: its points arrive within it.
  const AZURE_WINDOW_MS: number = RollingTimeUtil.getWindowInMs(
    CLOUD_ALERT_WINDOWS[CloudProvider.Azure],
  );

  // A range the list reads: the past hours up to END.
  function pastHours(hours: number): InBetween<Date> {
    return new InBetween<Date>(new Date(END.getTime() - hours * HOUR_MS), END);
  }

  function readOf(
    rows: CloudMonitoredResourceRowAggregation | undefined,
    metricName: string,
    range: InBetween<Date> = pastHours(1),
  ): MetricRowAggregation | undefined {
    expect(rows).toBeDefined();
    return rows!.getRowAggregation(metricName, range);
  }

  test("a Service Bus namespace's queue metrics read as their total, the rest as their average", () => {
    const rows: CloudMonitoredResourceRowAggregation | undefined = rowsOf(
      CloudProvider.Azure,
      SERVICE_BUS,
    );

    for (const name of [
      "azure_activemessages_average",
      "azure_deadletteredmessages_average",
      "azure_incomingmessages_total",
      "azure_outgoingmessages_total",
      "azure_servererrors_total",
      "azure_throttledrequests_total",
      // The receiver's, beside the connection's six.
      "azure_scheduledmessages_average",
      "azure_completemessage_total",
    ]) {
      expect([name, readOf(rows, name)]).toEqual([
        name,
        {
          aggregationType: AggregationType.Sum,
          caption: CLOUD_RESOURCE_SUMMED_ROW_CAPTION,
        },
      ]);
    }

    // A send's latency is per send; a metric of another kind is unknown.
    expect(readOf(rows, "azure_serversendlatency_average")).toBeUndefined();
    expect(readOf(rows, "my.own.metric")).toBeUndefined();
    expect(rows!.defaultRowValueCaption).toBe(
      CLOUD_RESOURCE_AVERAGED_ROW_CAPTION,
    );
  });

  test("an Event Hubs namespace's event hub metrics read as their total", () => {
    const rows: CloudMonitoredResourceRowAggregation | undefined = rowsOf(
      CloudProvider.Azure,
      EVENT_HUBS,
    );

    expect(readOf(rows, "azure_incomingmessages_total")?.aggregationType).toBe(
      AggregationType.Sum,
    );
    expect(readOf(rows, "azure_size_average")?.aggregationType).toBe(
      AggregationType.Sum,
    );
    expect(readOf(rows, "azure_activeconnections_average")).toBeUndefined();
  });

  /*
   * The aggregate API reads up to 3 hours by the minute, and a longer range
   * in longer intervals (AggregationIntervalUtil): there a Sum of messages
   * waiting would add up each queue's every minute.
   */
  test("over a range read by the minute, messages waiting read as the queues' total; over a longer one, as their average", () => {
    const rows: CloudMonitoredResourceRowAggregation | undefined = rowsOf(
      CloudProvider.Azure,
      SERVICE_BUS,
    );
    const SUMMED: MetricRowAggregation = {
      aggregationType: AggregationType.Sum,
      caption: CLOUD_RESOURCE_SUMMED_ROW_CAPTION,
    };

    for (const hours of [0.25, 1, 2, 3]) {
      expect([
        hours,
        readOf(rows, "azure_activemessages_average", pastHours(hours)),
      ]).toEqual([hours, SUMMED]);
    }

    for (const hours of [3.5, 12, 24, 24 * 7, 24 * 90]) {
      expect([
        hours,
        readOf(rows, "azure_activemessages_average", pastHours(hours)),
        readOf(rows, "azure_deadletteredmessages_average", pastHours(hours)),
      ]).toEqual([hours, undefined, undefined]);
      // A count adds up over any range (and waits for Azure, below).
      expect([
        hours,
        readOf(rows, "azure_incomingmessages_total", pastHours(hours)),
      ]).toEqual([hours, { ...SUMMED, settleMs: AZURE_WINDOW_MS }]);
    }
  });

  /*
   * A total counts what had arrived in an interval, and Azure's points
   * arrive minutes late: a connection reads them every five minutes, four
   * minutes behind. So over intervals of several minutes a summed row
   * counts an interval whole only once Azure's monitors' window
   * (CLOUD_ALERT_WINDOWS) has passed since it ended; a minute holds one
   * point of each queue, read together, and does not wait.
   */
  test("a total read in intervals of several minutes waits for Azure's late points; read by the minute it does not", () => {
    expect(AZURE_WINDOW_MS).toBe(15 * 60 * 1000);
    const rows: CloudMonitoredResourceRowAggregation | undefined = rowsOf(
      CloudProvider.Azure,
      SERVICE_BUS,
    );

    for (const hours of [0.25, 1, 2, 3]) {
      for (const name of [
        "azure_incomingmessages_total",
        "azure_activemessages_average",
      ]) {
        const read: MetricRowAggregation | undefined = readOf(
          rows,
          name,
          pastHours(hours),
        );
        expect([hours, name, read?.aggregationType, read?.settleMs]).toEqual([
          hours,
          name,
          AggregationType.Sum,
          undefined,
        ]);
      }
    }

    for (const hours of [3.5, 24, 24 * 7, 24 * 90]) {
      expect([
        hours,
        readOf(rows, "azure_servererrors_total", pastHours(hours))?.settleMs,
      ]).toEqual([hours, AZURE_WINDOW_MS]);
    }

    // An Event Hubs namespace's totals wait as long.
    expect(
      readOf(
        rowsOf(CloudProvider.Azure, EVENT_HUBS),
        "azure_incomingmessages_total",
        pastHours(24),
      )?.settleMs,
    ).toBe(AZURE_WINDOW_MS);
  });

  test("the row reads the type as the catalog stores it on the row", () => {
    for (const type of [SERVICE_BUS, EVENT_HUBS]) {
      const stored: string | undefined = getCloudResourceTypeDescriptor(
        CloudProvider.Azure,
        type,
      )?.type;
      expect(stored).toBe(type);
      expect(rowsOf(CloudProvider.Azure, stored)).toBeDefined();
    }
  });

  test.each([
    [CloudProvider.Azure, "Microsoft.Compute/virtualMachines"],
    [CloudProvider.Azure, "Microsoft.Storage/storageAccounts"],
    [CloudProvider.Azure, "Microsoft.EventGrid/namespaces"],
    [CloudProvider.AWS, "AWS::SQS::Queue"],
    [CloudProvider.AWS, SERVICE_BUS],
    [CloudProvider.GCP, "pubsub_subscription"],
  ])(
    "%s type %s: its rows read as they did, with no aggregation or caption",
    (provider: string, type: string) => {
      expect(rowsOf(provider, type)).toBeUndefined();
    },
  );

  test("a row read without its provider or type reads as before", () => {
    expect(getCloudMonitoredResourceRowAggregation(null)).toBeUndefined();
    expect(getCloudMonitoredResourceRowAggregation(undefined)).toBeUndefined();
    expect(getCloudMonitoredResourceRowAggregation({})).toBeUndefined();
    expect(rowsOf(CloudProvider.Azure, undefined)).toBeUndefined();
    expect(rowsOf(undefined, SERVICE_BUS)).toBeUndefined();
    expect(rowsOf(CloudProvider.Azure, { type: SERVICE_BUS })).toBeUndefined();
  });

  test("both captions are the Dashboard's own words, in every language it ships", () => {
    const localesDir: string = path.join(
      __dirname,
      "..",
      "..",
      "..",
      "..",
      "App",
      "FeatureSet",
      "Dashboard",
      "src",
      "Locales",
    );
    const files: Array<string> = fs
      .readdirSync(localesDir)
      .filter((file: string): boolean => {
        return file.endsWith(".json");
      });

    expect(files.length).toBe(17);

    for (const file of files) {
      const locale: Record<string, string> = JSON.parse(
        fs.readFileSync(path.join(localesDir, file), "utf8"),
      ) as Record<string, string>;

      for (const caption of [
        CLOUD_RESOURCE_SUMMED_ROW_CAPTION,
        CLOUD_RESOURCE_AVERAGED_ROW_CAPTION,
      ]) {
        expect([file, caption, typeof locale[caption]]).toEqual([
          file,
          caption,
          "string",
        ]);
        expect(locale[caption]!.trim().length).toBeGreaterThan(0);

        if (file !== "en.json") {
          expect([file, locale[caption]]).not.toEqual([file, caption]);
        }
      }
    }
  });
});
