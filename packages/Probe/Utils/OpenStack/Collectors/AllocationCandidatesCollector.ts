import OpenStackCollectorMemory from "../OpenStackCollectorMemory";
import {
  NovaAggregateRecord,
  NovaFlavorRecord,
  NovaServiceRecord,
  OpenStackComputeInventory,
  OpenStackPlacementInventory,
  PlacementFlavorAnswer,
  PlacementProviderRecord,
} from "../OpenStackInventory";
import OpenStackReadTurns from "../OpenStackReadTurns";
import OpenStackServiceClient, {
  OpenStackJsonAnswer,
} from "../OpenStackServiceClient";
import { OpenStackCollectorContext } from "./OpenStackCollectorContext";
import { JSONValue } from "Common/Types/JSON";
import {
  OpenStackCandidateFit,
  OpenStackCandidateHost,
  OpenStackFlavorRequest,
  OpenStackPlacementAnswer,
  getOpenStackCandidatesQuery,
  getOpenStackCapacityHostState,
  getOpenStackPlacementAnswer,
  readOpenStackAllocationCandidates,
} from "Common/Types/OpenStack/OpenStackCapacity";
import { getOpenStackShortHostName } from "Common/Types/OpenStack/OpenStackHealthRules";
import {
  OPENSTACK_CANDIDATE_READS_PER_COLLECTION,
  OPENSTACK_CANDIDATE_RESULT_LIMIT,
} from "Common/Types/OpenStack/OpenStackScale";

/*
 * HOW MANY MORE OF EACH FLAVOR FIT, IN PLACEMENT'S OWN WORDS.
 *
 * Inventories can count this too, and the server does, for every cloud. What they can't see is
 * what only Placement knows: which hosts hold a required trait, and how a nested provider is laid
 * out. So a probe, which can ask, asks what Nova's scheduler asks: GET /allocation_candidates, as
 * StackHPC's os-capacity does.
 *
 * It is the one read here that makes Placement work, so it is asked as gently as a read can be:
 *
 *   - One shape of flavor at a time, and two flavors that ask for the same thing are one question.
 *   - At most OPENSTACK_CANDIDATE_READS_PER_COLLECTION of them a collection, in turns, however
 *     many flavors there are, each answer at most Nova's own limit long.
 *   - Only once everything else this collection reads from Placement has been read.
 *   - Not at all when Placement has already been told to wait this collection, and not again for a
 *     while once a credential has been refused, which is no news: it reads inventories instead.
 *   - Not on a first collection, because what to ask about comes from the collection before. The
 *     two services are read side by side, so one that hangs costs the other nothing, and this
 *     keeps that true.
 *
 * What was not asked this time is sent as it last stood, so no series has a gap, and the row says
 * when it was asked.
 */

/*
 * The first microversion that names each provider's root, which is what says which host a nested
 * provider is on. Forbidden traits (1.22) and limit (1.16) came before it.
 */
export const OPENSTACK_CANDIDATES_MICROVERSION: string = "placement 1.29";

const FACTS_REMEMBERED_FOR_IN_MS: number = 24 * 60 * 60_000;
const REFUSED_REMEMBERED_FOR_IN_MS: number = 60 * 60_000;

export interface OpenStackCapacityFacts {
  flavors: ReadonlyArray<NovaFlavorRecord>;
  hostsByShortName: ReadonlyMap<string, OpenStackCandidateHost>;
}

function factsKey(memoryKey: string, regionName: string): string {
  return `${memoryKey}/${regionName}/capacity-facts`;
}

/*
 * What a collection learned of flavors and hosts, for the next one to ask about. A Nova that could
 * not be read this time leaves the last answer standing. Only what isn't known is left out: a host
 * in no aggregate still has its nova-compute's zone.
 */
export function getOpenStackCapacityFacts(
  compute: OpenStackComputeInventory,
): OpenStackCapacityFacts | null {
  if (!compute.flavors) {
    return null;
  }

  const aggregatesOfHost: Map<string, Array<string>> = new Map();

  for (const aggregate of (compute.aggregates ||
    []) as Array<NovaAggregateRecord>) {
    if (aggregate.isZoneOnly || !aggregate.name) {
      continue;
    }

    for (const host of aggregate.hosts) {
      const short: string = getOpenStackShortHostName(host);
      const names: Array<string> = aggregatesOfHost.get(short) || [];
      names.push(aggregate.name);
      aggregatesOfHost.set(short, names);
    }
  }

  const hostsByShortName: Map<string, OpenStackCandidateHost> = new Map();

  for (const service of (compute.services || []) as Array<NovaServiceRecord>) {
    if (service.binary !== "nova-compute" || !service.host) {
      continue;
    }

    const short: string = getOpenStackShortHostName(service.host);

    hostsByShortName.set(short, {
      name: service.host,
      zone: service.zone,
      aggregates: aggregatesOfHost.get(short) || [],
      state: getOpenStackCapacityHostState({
        status: service.state,
        adminState: service.status,
      }),
    });
  }

  return {
    flavors: compute.flavors as Array<NovaFlavorRecord>,
    hostsByShortName,
  };
}

export function rememberOpenStackCapacityFacts(data: {
  memory: OpenStackCollectorMemory;
  memoryKey: string;
  regionName: string;
  compute: OpenStackComputeInventory | undefined;
  now: number;
}): void {
  const facts: OpenStackCapacityFacts | null = data.compute
    ? getOpenStackCapacityFacts(data.compute)
    : null;

  if (facts) {
    data.memory.remember(
      factsKey(data.memoryKey, data.regionName),
      facts,
      data.now,
    );
  }
}

// One question: flavors that would be told the same thing, whatever they are called.
interface FlavorShape {
  key: string;
  query: Record<string, string>;
}

// A disabled flavor is one nobody can ask for, and one that asks for nothing can't be asked about.
function isAskable(flavor: NovaFlavorRecord): boolean {
  return (
    !flavor.isDisabled &&
    Boolean(flavor.id) &&
    Object.keys(flavor.request.resources).length > 0
  );
}

function shapeOf(request: OpenStackFlavorRequest): FlavorShape {
  const query: Record<string, string> = getOpenStackCandidatesQuery(request);

  return { key: `${query["resources"]}|${query["required"]}`, query };
}

interface AskedAnswer {
  askedAt: string;
  answer: OpenStackPlacementAnswer;
}

export default async function collectAllocationCandidates(
  context: OpenStackCollectorContext<OpenStackPlacementInventory>,
): Promise<void> {
  const { run, inventory, memory, memoryKey } = context;
  const client: OpenStackServiceClient = run.client;
  const now: number = client.now();
  const providers: Array<PlacementProviderRecord> = inventory.providers || [];

  const facts: OpenStackCapacityFacts | undefined =
    memory.recall<OpenStackCapacityFacts>(
      factsKey(memoryKey, run.regionName),
      FACTS_REMEMBERED_FOR_IN_MS,
      now,
    );

  if (!facts) {
    return;
  }

  const shapes: Map<string, FlavorShape> = new Map();
  const flavors: Array<NovaFlavorRecord> = facts.flavors.filter(isAskable);

  for (const flavor of flavors) {
    const shape: FlavorShape = shapeOf(flavor.request);
    if (!shapes.has(shape.key)) {
      shapes.set(shape.key, shape);
    }
  }

  const turns: OpenStackReadTurns<AskedAnswer> =
    new OpenStackReadTurns<AskedAnswer>({
      memory,
      memoryKey: `${memoryKey}/${run.regionName}/candidates`,
      now,
    });

  const refusedKey: string = `${memoryKey}/${run.regionName}/candidates/refused`;
  const isRefused: boolean =
    memory.recall<boolean>(refusedKey, REFUSED_REMEMBERED_FOR_IN_MS, now) ===
    true;

  // Being told to wait is no time to ask the most of it.
  if (!isRefused && !client.hasBeenSlow()) {
    const providerNames: Map<string, string> = new Map();

    for (const provider of providers) {
      if (provider.name) {
        providerNames.set(provider.uuid, provider.name);
      }
    }

    const headers: Record<string, string> = client.headers;
    client.headers = {
      ...headers,
      "OpenStack-API-Version": OPENSTACK_CANDIDATES_MICROVERSION,
    };

    const readsBefore: number = run.reads.length;

    await run.read({
      name: "allocation candidates",
      isInventory: false,
      isQuietWhenRefused: true,
      run: async (): Promise<void> => {
        await turns.read<FlavorShape>({
          items: Array.from(shapes.values()),
          limit: OPENSTACK_CANDIDATE_READS_PER_COLLECTION,
          idOf: (shape: FlavorShape): string => {
            return shape.key;
          },
          read: async (shape: FlavorShape): Promise<AskedAnswer> => {
            const answer: OpenStackJsonAnswer = await client.get({
              read: "allocation candidates",
              path: "/allocation_candidates",
              query: {
                ...shape.query,
                limit: String(OPENSTACK_CANDIDATE_RESULT_LIMIT),
              },
            });
            const requests: JSONValue | undefined =
              answer.body["allocation_requests"];
            const candidates: Array<OpenStackCandidateFit> =
              readOpenStackAllocationCandidates(answer.body);

            return {
              askedAt: new Date(client.now()).toISOString(),
              answer: getOpenStackPlacementAnswer({
                candidates,
                providerNames,
                hostsByShortName: facts.hostsByShortName,
                candidateLimit: OPENSTACK_CANDIDATE_RESULT_LIMIT,
                requestCount: Array.isArray(requests) ? requests.length : 0,
              }),
            };
          },
        });
      },
    });

    client.headers = headers;

    if (run.reads[readsBefore]?.state === "refused") {
      memory.remember(refusedKey, true, client.now());
    }
  }

  // What has gone is forgotten here, so memory doesn't grow on a cloud that retires flavors.
  turns.getRecords<FlavorShape>({
    items: Array.from(shapes.values()),
    idOf: (shape: FlavorShape): string => {
      return shape.key;
    },
  });

  const answers: Array<PlacementFlavorAnswer> = [];

  for (const flavor of flavors) {
    const record: AskedAnswer | undefined = turns.getRecord(
      shapeOf(flavor.request).key,
    );

    if (record) {
      answers.push({
        ...record.answer,
        flavorId: flavor.id as string,
        flavorName: flavor.name,
        askedAt: record.askedAt,
      });
    }
  }

  if (answers.length > 0) {
    inventory.flavorAnswers = answers;
  }
}
