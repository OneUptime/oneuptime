import SeriesResourceLabels, {
  AllResourceIdentityLabelKeys,
  DatabaseServerIdLabelKeys,
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

  /*
   * Ingest stamps `oneuptime.service.name` next to `oneuptime.service.id`
   * on every row, exactly as it does for hosts. It was missing from the
   * service key list, so a monitor grouped by that spelling linked no
   * service at all.
   */
  test("reads the oneuptime-stamped service name", () => {
    const refs: SeriesResourceRefs = SeriesResourceLabels.extractResourceRefs({
      "oneuptime.service.name": "checkout",
    });

    expect(refs.serviceNames).toEqual(["checkout"]);
  });

  test("reads the resource-prefixed oneuptime service name", () => {
    const refs: SeriesResourceRefs = SeriesResourceLabels.extractResourceRefs({
      "resource.oneuptime.service.name": "checkout",
    });

    expect(refs.serviceNames).toEqual(["checkout"]);
  });

  test("reads the docker swarm cluster name in both spellings", () => {
    expect(
      SeriesResourceLabels.extractResourceRefs({
        "docker.swarm.cluster.name": "swarm-prod",
      }).dockerSwarmClusterNames,
    ).toEqual(["swarm-prod"]);

    expect(
      SeriesResourceLabels.extractResourceRefs({
        "resource.docker.swarm.cluster.name": "swarm-prod",
      }).dockerSwarmClusterNames,
    ).toEqual(["swarm-prod"]);
  });

  /*
   * A swarm cluster label is the Swarm cluster's territory only: it must
   * not be mistaken for a Docker host, and a Docker host label must not
   * be read as a swarm cluster.
   */
  test("swarm cluster and docker host labels stay separate", () => {
    const swarmRefs: SeriesResourceRefs =
      SeriesResourceLabels.extractResourceRefs({
        "docker.swarm.cluster.name": "swarm-prod",
      });
    expect(swarmRefs.dockerHostNames).toEqual([]);

    const dockerRefs: SeriesResourceRefs =
      SeriesResourceLabels.extractResourceRefs({
        "oneuptime.docker.host.name": "docker-box",
      });
    expect(dockerRefs.dockerSwarmClusterNames).toEqual([]);
  });
});

describe("SeriesResourceLabels — databases", () => {
  test("the database id keys are the stamp and its resource.-prefixed twin", () => {
    expect([...DatabaseServerIdLabelKeys].sort()).toEqual([
      "oneuptime.database.server.id",
      "resource.oneuptime.database.server.id",
    ]);
  });

  test("every database id key is a reserved resource identity key", () => {
    /*
     * AllResourceIdentityLabelKeys is what the custom-code metric guard
     * refuses to let a script stamp; a script must not be able to claim
     * a series belongs to a database.
     */
    for (const key of DatabaseServerIdLabelKeys) {
      expect(AllResourceIdentityLabelKeys).toContain(key);
    }
    expect(AllResourceIdentityLabelKeys).not.toContain(
      "oneuptime.database.server.name",
    );
  });

  test("reads the database id in both spellings, deduped", () => {
    const refs: SeriesResourceRefs = SeriesResourceLabels.extractResourceRefs({
      "oneuptime.database.server.id": "d0000000-0000-4000-8000-000000000001",
      "resource.oneuptime.database.server.id": [
        "d0000000-0000-4000-8000-000000000001",
        "d0000000-0000-4000-8000-000000000002",
      ],
    });

    expect(refs.databaseServerIds.sort()).toEqual([
      "d0000000-0000-4000-8000-000000000001",
      "d0000000-0000-4000-8000-000000000002",
    ]);
  });

  test("drops a database id that is not a UUID", () => {
    /*
     * The resource-prefixed value is the agent's DATABASE_SERVER_ID, typed
     * by a user; a malformed one must not reach the uuid primary-key
     * lookup, where it would throw out of alert / incident creation.
     */
    const refs: SeriesResourceRefs = SeriesResourceLabels.extractResourceRefs({
      "resource.oneuptime.database.server.id": [
        "prod-postgres",
        "d0000000-0000-4000-8000-000000000001",
        "",
      ],
    });

    expect(refs.databaseServerIds).toEqual([
      "d0000000-0000-4000-8000-000000000001",
    ]);
  });

  test("a database label does not leak into any other resource type", () => {
    const refs: SeriesResourceRefs = SeriesResourceLabels.extractResourceRefs({
      "oneuptime.database.server.id": "d0000000-0000-4000-8000-000000000001",
      "oneuptime.database.server.name": "PostgreSQL db.prod:5432",
    });

    const { databaseServerIds, ...others } = refs;
    expect(databaseServerIds).toEqual(["d0000000-0000-4000-8000-000000000001"]);
    expect(Object.values(others).flat()).toEqual([]);
  });
});
