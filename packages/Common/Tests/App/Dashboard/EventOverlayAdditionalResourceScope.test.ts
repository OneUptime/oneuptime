import { describe, expect, test } from "@jest/globals";
import {
  EventOverlayScope,
  getEventOverlayScope,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/EventOverlayScope";
import Includes from "../../../Types/BaseDatabase/Includes";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";

type Attributes = Record<string, string | number | Includes>;

const RESOURCE_ID: string = "11111111-0000-4000-8000-000000000001";
const MACHINE_ID: string = "machine-id-from-the-otel-agent";
const HOST_ID_ATTRIBUTES: Array<string> = ["host.id", "resource.host.id"];
const VMWARE_CHILD_ATTRIBUTES: Array<string> = [
  "vcenter.vm_template.id",
  "resource.vcenter.vm_template.id",
  "vcenter.vm_template.name",
  "resource.vcenter.vm_template.name",
  "vcenter.resource_pool.inventory_path",
  "resource.vcenter.resource_pool.inventory_path",
];
const SERIES_ATTRIBUTES: Array<string> = [
  "container.image.name",
  "resource.container.image.name",
  "service.instance.id",
  "resource.service.instance.id",
];
const PROCESS_ATTRIBUTES: Array<string> = [
  "process.pid",
  "resource.process.pid",
  "process.start_time",
  "resource.process.start_time",
];

function scope(
  attributes: Attributes,
  eventScope?: Attributes,
): EventOverlayScope {
  const config: MetricQueryConfigData = {
    metricQueryData: {
      filterData: {
        metricName: "system.cpu.utilization",
        attributes: attributes,
      },
    },
    ...(eventScope === undefined ? {} : { eventScope: eventScope }),
  };
  return getEventOverlayScope([config]);
}

function expectDatabaseQueries(
  result: EventOverlayScope,
  expected: Array<Record<string, unknown>>,
): void {
  expect(result.incidentQueries).toEqual(expected);
  expect(result.alertQueries).toEqual(expected);
}

describe("OpenTelemetry host machine identity", (): void => {
  test.each(HOST_ID_ATTRIBUTES)(
    "%s selects Host.hostId for an arbitrary machine identifier",
    (attribute: string): void => {
      const result: EventOverlayScope = scope({ [attribute]: MACHINE_ID });

      expectDatabaseQueries(result, [{ hosts: { hostId: MACHINE_ID } }]);
      expect(result.changeEventQueries).toEqual([
        { attributes: { [attribute]: MACHINE_ID } },
      ]);
    },
  );

  test.each(HOST_ID_ATTRIBUTES)(
    "%s keeps a UUID-shaped machine identifier separate from the database ID",
    (attribute: string): void => {
      expectDatabaseQueries(scope({ [attribute]: RESOURCE_ID }), [
        { hosts: { hostId: RESOURCE_ID } },
      ]);
    },
  );

  test.each(HOST_ID_ATTRIBUTES)(
    "%s expands machine membership into exact hostId queries",
    (attribute: string): void => {
      const result: EventOverlayScope = scope({
        [attribute]: new Includes(["machine-b", "machine-a", "machine-b"]),
      });

      expectDatabaseQueries(result, [
        { hosts: { hostId: "machine-a" } },
        { hosts: { hostId: "machine-b" } },
      ]);
      expect(result.changeEventQueries).toEqual([
        { attributes: { [attribute]: "machine-a" } },
        { attributes: { [attribute]: "machine-b" } },
      ]);
    },
  );

  test.each(HOST_ID_ATTRIBUTES)(
    "%s intersects the hostname on the same Host relation",
    (attribute: string): void => {
      const attributes: Attributes = {
        [attribute]: MACHINE_ID,
        "resource.host.name": "checkout-prod",
      };
      const result: EventOverlayScope = scope(attributes);

      expectDatabaseQueries(result, [
        { hosts: { hostId: MACHINE_ID, hostIdentifier: "checkout-prod" } },
      ]);
      expect(result.changeEventQueries).toEqual([{ attributes: attributes }]);
    },
  );
});

describe("VMware child resource identity", (): void => {
  test.each(VMWARE_CHILD_ATTRIBUTES)(
    "%s constrains the breaching series without a parent filter",
    (attribute: string): void => {
      const attributes: Attributes = { [attribute]: "inventory/child-a" };
      const result: EventOverlayScope = scope(attributes);

      expectDatabaseQueries(result, [{ seriesLabels: attributes }]);
      expect(result.changeEventQueries).toEqual([{ attributes: attributes }]);
    },
  );

  test.each(VMWARE_CHILD_ATTRIBUTES)(
    "%s retains both the vCenter and child identity",
    (attribute: string): void => {
      const attributes: Attributes = {
        "resource.vmware.vcenter.name": "vcenter-prod",
        [attribute]: "inventory/child-a",
      };
      const result: EventOverlayScope = scope(attributes);

      expectDatabaseQueries(result, [
        {
          vmwareVCenters: { name: "vcenter-prod" },
          seriesLabels: { [attribute]: "inventory/child-a" },
        },
      ]);
      expect(result.changeEventQueries).toEqual([{ attributes: attributes }]);
    },
  );
});

describe("image and service instance identity", (): void => {
  test.each(SERIES_ATTRIBUTES)(
    "%s narrows events to the exact breaching series",
    (attribute: string): void => {
      const attributes: Attributes = { [attribute]: "checkout-a" };
      const result: EventOverlayScope = scope(attributes);

      expectDatabaseQueries(result, [{ seriesLabels: attributes }]);
      expect(result.changeEventQueries).toEqual([{ attributes: attributes }]);
    },
  );

  test.each(["container.image.name", "resource.container.image.name"])(
    "%s retains Docker runtime and host restrictions",
    (attribute: string): void => {
      const attributes: Attributes = {
        "resource.host.name": "docker-prod",
        "resource.container.runtime": "docker",
        [attribute]: "registry.example/checkout:v2",
      };
      const result: EventOverlayScope = scope(attributes);

      expectDatabaseQueries(result, [
        {
          dockerHosts: { hostIdentifier: "docker-prod" },
          seriesLabels: { [attribute]: "registry.example/checkout:v2" },
        },
      ]);
      expect(result.changeEventQueries).toEqual([{ attributes: attributes }]);
    },
  );

  test.each(["service.instance.id", "resource.service.instance.id"])(
    "%s keeps the selected instance within the selected service",
    (attribute: string): void => {
      const attributes: Attributes = {
        "resource.service.name": "checkout",
        [attribute]: "checkout-instance-a",
      };
      const result: EventOverlayScope = scope(attributes);

      expectDatabaseQueries(result, [
        {
          services: { name: "checkout" },
          seriesLabels: { [attribute]: "checkout-instance-a" },
        },
      ]);
      expect(result.changeEventQueries).toEqual([{ attributes: attributes }]);
    },
  );
});

describe("unsupported child resource scope", (): void => {
  test.each(["serviceId", "hostId", "vmwareVCenterId"])(
    "unknown explicit child identity cannot fall back to its known %s parent",
    (parentAttribute: string): void => {
      const result: EventOverlayScope = scope(
        {},
        {
          [parentAttribute]: RESOURCE_ID,
          "custom.child.id": "child-a",
        },
      );

      expectDatabaseQueries(result, []);
      expect(result.changeEventQueries).toEqual([]);
    },
  );

  test("unknown explicit child metadata cannot use a parent from chart attributes as a fallback", (): void => {
    const result: EventOverlayScope = scope(
      { "resource.service.name": "checkout" },
      { "custom.child.id": "child-a" },
    );

    expectDatabaseQueries(result, []);
    expect(result.changeEventQueries).toEqual([]);
  });

  test.each(PROCESS_ATTRIBUTES)(
    "%s never produces project-wide incident or alert queries",
    (attribute: string): void => {
      const attributes: Attributes = {
        [attribute]: attribute.endsWith("pid") ? 412 : "2026-09-01T10:00:00Z",
      };
      const result: EventOverlayScope = scope(attributes);

      expectDatabaseQueries(result, []);
      expect(result.changeEventQueries).toEqual([
        { attributes: { [attribute]: String(attributes[attribute]) } },
      ]);
    },
  );

  test.each(PROCESS_ATTRIBUTES)(
    "%s keeps its restriction when combined with a known service parent",
    (attribute: string): void => {
      const attributes: Attributes = {
        "resource.service.name": "checkout",
        [attribute]: "process-a",
      };
      const result: EventOverlayScope = scope(attributes);

      expectDatabaseQueries(result, []);
      expect(result.changeEventQueries).toEqual([{ attributes: attributes }]);
    },
  );
});
