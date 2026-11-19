import { describe, expect, test } from "@jest/globals";
import {
  ALL_DATA_STORE_RESOURCE_KINDS,
  DATABASE_PLATFORM_KINDS,
  DataStoreResourceKind,
  DataStoreResourceRef,
  doesDataStoreBelongTo,
  getDataStoreComplianceOwner,
  getDataStoreResourceKey,
  getDataStoreResources,
  getDatabasePlatform,
  isDataStoreResourceKind,
  isSameDataStoreResource,
} from "../../../Types/DataSecurity/DataStoreResource";

/*
 * THE RESOURCES A DATA STORE BELONGS TO (#9547, #9555).
 *
 * A store is shown on the pages of the resources it came from - a cloud
 * resource, a service's telemetry, a monitored database and the cluster or
 * container host that database runs on - and its compliance is set on
 * exactly one of them, so two resources never disagree about one store.
 */

const CLUSTER: string = "11111111-1111-4111-8111-111111111111";
const DOCKER_HOST: string = "22222222-2222-4222-8222-222222222222";
const PODMAN_HOST: string = "33333333-3333-4333-8333-333333333333";
const DATABASE: string = "44444444-4444-4444-8444-444444444444";
const BUCKET: string = "55555555-5555-4555-8555-555555555555";
const SERVICE: string = "66666666-6666-4666-8666-666666666666";

function ref(kind: DataStoreResourceKind, id: string): DataStoreResourceRef {
  return { kind, id };
}

describe("the kinds of resource a store belongs to", () => {
  test("six kinds, and the platforms a database runs on are three of them", () => {
    expect([...ALL_DATA_STORE_RESOURCE_KINDS]).toEqual([
      DataStoreResourceKind.KubernetesCluster,
      DataStoreResourceKind.DockerHost,
      DataStoreResourceKind.PodmanHost,
      DataStoreResourceKind.DatabaseServer,
      DataStoreResourceKind.CloudResource,
      DataStoreResourceKind.Service,
    ]);
    expect([...DATABASE_PLATFORM_KINDS]).toEqual([
      DataStoreResourceKind.KubernetesCluster,
      DataStoreResourceKind.DockerHost,
      DataStoreResourceKind.PodmanHost,
    ]);
  });

  test("a kind is known by its stored name, and nothing else is one", () => {
    for (const kind of ALL_DATA_STORE_RESOURCE_KINDS) {
      expect(isDataStoreResourceKind(kind)).toBe(true);
    }

    for (const value of ["Host", "kubernetescluster", "", null, 7, {}]) {
      expect(isDataStoreResourceKind(value)).toBe(false);
    }
  });

  test("a host is none of them: nothing records the host a store is on", () => {
    expect(isDataStoreResourceKind("Host")).toBe(false);
  });
});

describe("where a database runs", () => {
  test("its cluster first, then its Docker host, then its Podman host", () => {
    expect(
      getDatabasePlatform({
        kubernetesClusterId: CLUSTER,
        dockerHostId: DOCKER_HOST,
        podmanHostId: PODMAN_HOST,
      }),
    ).toEqual(ref(DataStoreResourceKind.KubernetesCluster, CLUSTER));
    expect(
      getDatabasePlatform({
        dockerHostId: DOCKER_HOST,
        podmanHostId: PODMAN_HOST,
      }),
    ).toEqual(ref(DataStoreResourceKind.DockerHost, DOCKER_HOST));
    expect(getDatabasePlatform({ podmanHostId: PODMAN_HOST })).toEqual(
      ref(DataStoreResourceKind.PodmanHost, PODMAN_HOST),
    );
  });

  test("a database known only by its address runs nowhere OneUptime monitors", () => {
    expect(getDatabasePlatform({})).toBeNull();
    expect(getDatabasePlatform(null)).toBeNull();
    expect(getDatabasePlatform(undefined)).toBeNull();
    expect(
      getDatabasePlatform({ kubernetesClusterId: "  ", dockerHostId: null }),
    ).toBeNull();
  });
});

describe("the resources a store belongs to", () => {
  test("a cloud store is its cloud resource's", () => {
    expect(getDataStoreResources({ cloudResourceId: BUCKET })).toEqual([
      ref(DataStoreResourceKind.CloudResource, BUCKET),
    ]);
  });

  test("a telemetry store is its service's", () => {
    expect(getDataStoreResources({ serviceId: SERVICE })).toEqual([
      ref(DataStoreResourceKind.Service, SERVICE),
    ]);
  });

  test("a monitored database's store is the database's, and the cluster's it runs on", () => {
    expect(
      getDataStoreResources({
        databaseServerId: DATABASE,
        databaseServer: { kubernetesClusterId: CLUSTER },
      }),
    ).toEqual([
      ref(DataStoreResourceKind.DatabaseServer, DATABASE),
      ref(DataStoreResourceKind.KubernetesCluster, CLUSTER),
    ]);
  });

  test("a database on a container host is the host's too", () => {
    expect(
      getDataStoreResources({
        databaseServerId: DATABASE,
        databaseServer: { dockerHostId: DOCKER_HOST },
      }),
    ).toEqual([
      ref(DataStoreResourceKind.DatabaseServer, DATABASE),
      ref(DataStoreResourceKind.DockerHost, DOCKER_HOST),
    ]);
  });

  test("a database that runs on nothing monitored is its own alone", () => {
    expect(getDataStoreResources({ databaseServerId: DATABASE })).toEqual([
      ref(DataStoreResourceKind.DatabaseServer, DATABASE),
    ]);
  });

  test("a store found on the service map, or added by hand, is no resource's", () => {
    expect(getDataStoreResources({})).toEqual([]);
    expect(
      getDataStoreResources({
        cloudResourceId: " ",
        serviceId: null,
        databaseServerId: undefined,
      }),
    ).toEqual([]);
  });

  test("a store is shown on each of its resources' pages, and only theirs", () => {
    const store: {
      databaseServerId: string;
      databaseServer: { kubernetesClusterId: string };
    } = {
      databaseServerId: DATABASE,
      databaseServer: { kubernetesClusterId: CLUSTER },
    };

    expect(
      doesDataStoreBelongTo(
        store,
        ref(DataStoreResourceKind.KubernetesCluster, CLUSTER),
      ),
    ).toBe(true);
    expect(
      doesDataStoreBelongTo(
        store,
        ref(DataStoreResourceKind.DatabaseServer, DATABASE),
      ),
    ).toBe(true);
    expect(
      doesDataStoreBelongTo(
        store,
        ref(DataStoreResourceKind.DockerHost, CLUSTER),
      ),
    ).toBe(false);
    expect(
      doesDataStoreBelongTo(
        store,
        ref(DataStoreResourceKind.KubernetesCluster, DOCKER_HOST),
      ),
    ).toBe(false);
  });
});

describe("the one resource a store's compliance is set on", () => {
  test("the cluster or container host its database runs on", () => {
    expect(
      getDataStoreComplianceOwner({
        databaseServerId: DATABASE,
        databaseServer: { kubernetesClusterId: CLUSTER },
      }),
    ).toEqual(ref(DataStoreResourceKind.KubernetesCluster, CLUSTER));
    expect(
      getDataStoreComplianceOwner({
        databaseServerId: DATABASE,
        databaseServer: { podmanHostId: PODMAN_HOST },
      }),
    ).toEqual(ref(DataStoreResourceKind.PodmanHost, PODMAN_HOST));
  });

  test("else the store's own resource", () => {
    expect(getDataStoreComplianceOwner({ databaseServerId: DATABASE })).toEqual(
      ref(DataStoreResourceKind.DatabaseServer, DATABASE),
    );
    expect(getDataStoreComplianceOwner({ cloudResourceId: BUCKET })).toEqual(
      ref(DataStoreResourceKind.CloudResource, BUCKET),
    );
    expect(getDataStoreComplianceOwner({ serviceId: SERVICE })).toEqual(
      ref(DataStoreResourceKind.Service, SERVICE),
    );
  });

  test("none for a store no resource holds", () => {
    expect(getDataStoreComplianceOwner({})).toBeNull();
  });
});

describe("naming a resource", () => {
  test("one key per resource, whatever the case of its id", () => {
    expect(
      getDataStoreResourceKey(
        ref(
          DataStoreResourceKind.KubernetesCluster,
          ` ${CLUSTER.toUpperCase()}`,
        ),
      ),
    ).toBe(`KubernetesCluster:${CLUSTER}`);
  });

  test("the same id of two kinds is two resources", () => {
    expect(
      isSameDataStoreResource(
        ref(DataStoreResourceKind.DockerHost, DOCKER_HOST),
        ref(DataStoreResourceKind.PodmanHost, DOCKER_HOST),
      ),
    ).toBe(false);
    expect(
      isSameDataStoreResource(
        ref(DataStoreResourceKind.DockerHost, DOCKER_HOST),
        ref(DataStoreResourceKind.DockerHost, DOCKER_HOST.toUpperCase()),
      ),
    ).toBe(true);
    expect(
      isSameDataStoreResource(
        null,
        ref(DataStoreResourceKind.DockerHost, DOCKER_HOST),
      ),
    ).toBe(false);
  });
});
