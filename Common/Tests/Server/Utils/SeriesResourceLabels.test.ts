import SeriesResourceLabels, {
  HostNameLabelKeys,
  SeriesResourceRefs,
} from "../../../Server/Utils/Monitor/SeriesResourceLabels";
import { JSONObject } from "../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * SeriesResourceLabels maps raw telemetry series labels onto OneUptime
 * resource identifiers. The correlation that lights up "which host/cluster/
 * service is this series about" depends entirely on collectLabelValues
 * reading the right keys and deduping — these tests lock that behavior and
 * the deliberate Docker/host key separation documented in the source.
 */

describe("SeriesResourceLabels.collectLabelValues", () => {
  test("collects a single string value at a matching key", () => {
    const labels: JSONObject = { "host.name": "web-1" };
    expect(
      SeriesResourceLabels.collectLabelValues(labels, HostNameLabelKeys),
    ).toEqual(["web-1"]);
  });

  test("flattens array-valued labels", () => {
    const labels: JSONObject = {
      "host.name": ["web-1", "web-2"],
    };
    expect(
      SeriesResourceLabels.collectLabelValues(labels, HostNameLabelKeys),
    ).toEqual(["web-1", "web-2"]);
  });

  test("dedupes values that appear under multiple keys", () => {
    const labels: JSONObject = {
      "host.name": "web-1",
      "resource.host.name": "web-1",
      "oneuptime.host.name": "web-2",
    };
    const values: Array<string> = SeriesResourceLabels.collectLabelValues(
      labels,
      HostNameLabelKeys,
    );
    expect(values.sort()).toEqual(["web-1", "web-2"]);
  });

  test("ignores empty strings and non-string scalars", () => {
    const labels: JSONObject = {
      "host.name": "",
      "resource.host.name": 42 as unknown as string,
    };
    expect(
      SeriesResourceLabels.collectLabelValues(labels, HostNameLabelKeys),
    ).toEqual([]);
  });

  test("ignores non-string items within an array", () => {
    const labels: JSONObject = {
      "host.name": ["web-1", 5 as unknown as string, "", "web-3"],
    };
    expect(
      SeriesResourceLabels.collectLabelValues(labels, HostNameLabelKeys),
    ).toEqual(["web-1", "web-3"]);
  });

  test("returns empty array when no key matches", () => {
    const labels: JSONObject = { "unrelated.key": "value" };
    expect(
      SeriesResourceLabels.collectLabelValues(labels, HostNameLabelKeys),
    ).toEqual([]);
  });
});

describe("SeriesResourceLabels.extractResourceRefs", () => {
  test("splits ids and names across resource types", () => {
    const labels: JSONObject = {
      "oneuptime.host.id": "host-id-1",
      "host.name": "web-1",
      "k8s.cluster.name": "prod-cluster",
      "service.name": "checkout",
      "oneuptime.service.id": "svc-id-1",
    };

    const refs: SeriesResourceRefs =
      SeriesResourceLabels.extractResourceRefs(labels);

    expect(refs.hostIds).toEqual(["host-id-1"]);
    expect(refs.hostNames).toEqual(["web-1"]);
    expect(refs.kubernetesClusterNames).toEqual(["prod-cluster"]);
    expect(refs.serviceNames).toEqual(["checkout"]);
    expect(refs.serviceIds).toEqual(["svc-id-1"]);
  });

  test("a docker host label does not leak into host names", () => {
    /*
     * The source deliberately keeps raw host.name out of DockerHost keys and
     * vice versa. A docker-only label must not populate hostNames.
     */
    const labels: JSONObject = {
      "oneuptime.docker.host.name": "docker-box",
    };

    const refs: SeriesResourceRefs =
      SeriesResourceLabels.extractResourceRefs(labels);

    expect(refs.dockerHostNames).toEqual(["docker-box"]);
    expect(refs.hostNames).toEqual([]);
  });

  test("returns all-empty refs for labels with no known keys", () => {
    const refs: SeriesResourceRefs = SeriesResourceLabels.extractResourceRefs({
      "some.random.label": "x",
    });

    const allValues: Array<string> = Object.values(refs).flat();
    expect(allValues).toEqual([]);
  });
});
