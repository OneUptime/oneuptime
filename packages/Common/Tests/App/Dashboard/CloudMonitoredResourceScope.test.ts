import { describe, expect, test } from "@jest/globals";
import {
  getCloudMonitoredResourceAttributeDisplayKeys,
  getCloudMonitoredResourceAttributeFilters,
  isCloudMonitoredResourceScoped,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Cloud/Utils/CloudMonitoredResourceScope";
import {
  AWS_CLOUDWATCH_DIMENSION_PREFIX,
  CloudMonitoredResource,
  resolveCloudMonitoredResource,
} from "../../../Types/Cloud/CloudMonitoredResource";
import { CloudResourceKind } from "../../../Types/Cloud/CloudResourceKind";

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
