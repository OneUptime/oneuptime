import { JSONObject } from "Common/Types/JSON";
import {
  MagnumClusterDetails,
  MagnumClusterRecord,
  OpenStackContainerInfraInventory,
  toMagnumCluster,
  toMagnumClusterDetails,
  toMagnumConductor,
} from "../OpenStackInventory";
import {
  OpenStackJsonAnswer,
  OpenStackListAnswer,
} from "../OpenStackServiceClient";
import { OpenStackCollectorContext } from "./OpenStackCollectorContext";

/*
 * Magnum, which a cloud may not run. What a real cloud taught, recorded on stable/2026.1:
 *
 *   Its list of clusters has no project, no reason and no version. Those are on one cluster's own
 *   read, so that is one more request per cluster, and the exporter never makes it. They hardly ever
 *   change while its status doesn't, so a cluster is read once and again only when its status has
 *   moved, and however many have moved a collection reads this many: the rest wait for the next.
 *
 *   Anything below an admin is shown no other project's clusters, with no error, and is refused its
 *   conductors. A stopped conductor reads `down` here and nowhere else: Magnum's API carries on.
 *
 *   Everything is asked at the microversion the rig read it at. What this file reads from a list is
 *   there at any version a current cloud runs.
 */
export const MAGNUM_CLUSTER_READS_PER_COLLECTION: number = 25;

export const CONTAINER_INFRA_MICROVERSION_HEADERS: Record<string, string> = {
  "OpenStack-API-Version": "container-infra latest",
};

// Long enough that a day's unchanged clusters are not read again, and no more.
const CLUSTER_DETAILS_REMEMBERED_FOR_IN_MS: number = 24 * 60 * 60_000;

export default async function collectContainerInfra(
  context: OpenStackCollectorContext<OpenStackContainerInfraInventory>,
): Promise<void> {
  const { run, inventory, memory, memoryKey } = context;

  run.client.headers = {
    ...run.client.headers,
    ...CONTAINER_INFRA_MICROVERSION_HEADERS,
  };

  const clusters: OpenStackListAnswer | undefined = await run.read({
    name: "clusters",
    isInventory: true,
    run: () => {
      return run.client.list({
        read: "clusters",
        path: "/clusters",
        key: "clusters",
        paging: "next",
        idField: "uuid",
      });
    },
  });

  if (clusters) {
    const records: Array<MagnumClusterRecord> =
      clusters.items.map(toMagnumCluster);
    inventory.clusters = records;

    if (records.length > 0) {
      await readWhatItsListLeavesOut({ context, records });
    }
  }

  const conductors: OpenStackListAnswer | undefined = await run.read({
    name: "services",
    isInventory: false,
    isQuietWhenRefused: true,
    run: () => {
      return run.client.list({
        read: "services",
        path: "/mservices",
        key: "mservices",
        paging: "none",
      });
    },
  });

  if (conductors) {
    inventory.conductors = conductors.items.map(toMagnumConductor);
  }

  async function readWhatItsListLeavesOut(data: {
    context: OpenStackCollectorContext<OpenStackContainerInfraInventory>;
    records: Array<MagnumClusterRecord>;
  }): Promise<void> {
    const key: string = `${memoryKey}/${run.regionName}/magnum-clusters`;
    const now: number = run.client.now();
    const known: Record<string, MagnumClusterDetails> =
      memory.recall<Record<string, MagnumClusterDetails>>(
        key,
        CLUSTER_DETAILS_REMEMBERED_FOR_IN_MS,
        now,
      ) || {};
    // Only what is still there, so what is held never grows past the cloud's own clusters.
    const held: Record<string, MagnumClusterDetails> = {};
    let readsLeft: number = MAGNUM_CLUSTER_READS_PER_COLLECTION;
    let canRead: boolean = true;

    for (const cluster of data.records) {
      const uuid: string = cluster.uuid || "";
      if (!uuid) {
        continue;
      }
      let details: MagnumClusterDetails | undefined = known[uuid];

      if (canRead && readsLeft > 0 && details?.status !== cluster.status) {
        readsLeft--;
        const answer: OpenStackJsonAnswer | undefined = await run.read({
          name: "cluster",
          isInventory: false,
          isQuietWhenRefused: true,
          run: () => {
            return run.client.get({
              read: "cluster",
              path: `/clusters/${encodeURIComponent(uuid)}`,
            });
          },
        });
        if (answer) {
          details = toMagnumClusterDetails(answer.body as JSONObject);
        } else {
          // Refused or failing, it will be the same for the next: that is for another collection.
          canRead = false;
        }
      }

      if (details) {
        held[uuid] = details;
        cluster.projectId = details.projectId;
        cluster.statusReason = details.statusReason;
        cluster.coeVersion = details.coeVersion;
        cluster.apiAddress = details.apiAddress;
      }
    }

    memory.remember(key, held, now);

    const templates: OpenStackListAnswer | undefined = await run.read({
      name: "cluster templates",
      isInventory: false,
      isQuietWhenRefused: true,
      run: () => {
        return run.client.list({
          read: "cluster templates",
          path: "/clustertemplates",
          key: "clustertemplates",
          paging: "next",
          idField: "uuid",
        });
      },
    });

    if (templates) {
      const names: Map<string, string> = new Map();
      for (const template of templates.items) {
        if (
          typeof template["uuid"] === "string" &&
          typeof template["name"] === "string"
        ) {
          names.set(template["uuid"], template["name"]);
        }
      }
      for (const cluster of data.records) {
        cluster.clusterTemplateName = names.get(
          cluster.clusterTemplateId || "",
        );
      }
    }
  }
}
