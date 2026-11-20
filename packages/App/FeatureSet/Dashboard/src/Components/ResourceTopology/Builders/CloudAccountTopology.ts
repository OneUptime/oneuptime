import {
  CloudRelationshipKind,
  CloudResourceRelationship,
} from "Common/Types/Cloud/CloudInventory";
import {
  CloudLinkedResource,
  CloudResourceLink,
  getCloudResourceLinks,
} from "Common/Types/Cloud/CloudResourceIndex";
import {
  CloudResourceTypeDescriptor,
  getCloudResourceTypeDescriptor,
  getCloudResourceTypeDisplayName,
} from "Common/Types/Cloud/CloudResourceCatalog";
import {
  CloudHeadlineFormat,
  CloudHeadlineReading,
  CloudHealthAssessment,
  CloudHealthText,
  CloudResourceReading,
  CloudResourceReadings,
  assessCloudResourceHealth,
  getCloudHeadlineReadingOf,
  getCloudHeadlineReadings,
  getCloudReadingPeriodSeconds,
  readCloudResourceReadings,
} from "Common/Types/Cloud/CloudResourceHealth";
import ObjectID from "Common/Types/ObjectID";
import {
  getGlobalTranslator,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import {
  formatDurationInUnit,
  formatMilliseconds,
} from "../../../Utils/Milliseconds";
import PageMap from "../../../Utils/PageMap";
import { CLOUD_RELATIONSHIP_WORDS } from "../../Cloud/CloudRelationshipWords";
import {
  ResourceTopologyFact,
  ResourceTopologyGraph,
  ResourceTopologyHealth,
  ResourceTopologyNodeInput,
  ResourceTopologyRelation,
  ResourceTopologyText,
  ResourceTopologyTruncation,
  buildResourceTopologyGraph,
} from "../ResourceTopologyModel";
import { OpenIssueRecord, attachOpenIssues } from "../ResourceTopologyIssues";
import {
  formatTopologyBytes,
  formatTopologyPercent,
  isRecent,
} from "../ResourceTopologyFormat";

/*
 * A cloud account's topology: its regions, and in each its resources the
 * way its inventory relates them - a subnet in its network, an instance in
 * its subnet, the members of a scaling group or a cluster under it - with
 * what crosses the tree drawn as relations: a load balancer to its targets,
 * a security group to what it protects, a disk to its machine, a queue to
 * its dead-letter queue.
 *
 * A resource's parent is the resource it runs in, else the one it is part
 * of, when the account holds it (CloudResourceIndex's rules: never a guess,
 * never another type); otherwise its region, or the account for a resource
 * that is in none. Every relationship, the ones that make a parent too, is
 * also the graph's connections, which the Connections view draws.
 *
 * A resource is judged as its own page judges it (CloudResourceHealth):
 * Unhealthy or Degraded by what its type's rules find in its last read,
 * with their reasons; Healthy when they found nothing; Reporting while it
 * is listed or reporting with nothing to judge; Not reporting once it is
 * neither. Open incidents and alerts linked to it make it worse. A card
 * carries the first two numbers its page leads with (its CPU, its
 * requests), from a read of the last hour.
 */

export const CLOUD_ACCOUNT_ROOT_ID: string = "account";
export const CLOUD_ACCOUNT_REGION_PREFIX: string = "region:";
// A resource listed or reporting this recently is live; inventory lists every 30 minutes.
export const CLOUD_ACCOUNT_RESOURCE_STALE_MS: number = 2 * 60 * 60 * 1000;
// An account read this recently is being read.
export const CLOUD_ACCOUNT_STALE_MS: number = 60 * 60 * 1000;
// The numbers a resource's card carries at most.
export const CLOUD_TOPOLOGY_FACTS_MAX: number = 2;

// The kinds that make a resource another's parent, the first found winning.
const PARENT_KINDS: ReadonlyArray<CloudRelationshipKind> = [
  CloudRelationshipKind.RunsIn,
  CloudRelationshipKind.PartOf,
];

export interface CloudAccountTopologyResource {
  id: string;
  name: string;
  type: string;
  providerResourceId: string;
  region: string;
  relationships: Array<CloudResourceRelationship>;
  lastSeenAt: Date | null;
  isReporting: boolean;
  // Its last read's readings, as the row keeps them (CloudResource.cloudReadings).
  readings?: unknown;
  // When they were written: older than an hour, they are not judged.
  readingsAt?: Date | string | null | undefined;
  // What its inventory says of it: a rule may read a database's storage.
  properties?: unknown;
}

export interface CloudAccountTopologyInput {
  account: {
    id: string;
    name: string;
    provider: string;
    lastSeenAt: Date | null;
  };
  resources: Array<CloudAccountTopologyResource>;
  issues?: Array<OpenIssueRecord> | undefined;
  now: Date;
  truncations?: Array<ResourceTopologyTruncation> | undefined;
}

function text(value: string): ResourceTopologyText {
  return { text: value };
}

export function cloudRegionNodeId(region: string): string {
  return `${CLOUD_ACCOUNT_REGION_PREFIX}${region.trim().toLowerCase()}`;
}

// The kind of a resource's card: its catalog category, or a plain resource.
export function cloudResourceTopologyKind(
  provider: string,
  type: string,
): string {
  const descriptor: CloudResourceTypeDescriptor | null =
    getCloudResourceTypeDescriptor(provider, type);

  return descriptor ? `cloud.${descriptor.category}` : "cloud.resource";
}

/*
 * Each resource's parent among the others, by the link that makes it so:
 * its first RunsIn link, else its first PartOf. A parent that would make a
 * loop is dropped, so the resource sits in its region instead.
 */
export function getCloudResourceParents(
  links: Array<CloudResourceLink>,
): Map<string, CloudResourceLink> {
  const parents: Map<string, CloudResourceLink> = new Map<
    string,
    CloudResourceLink
  >();

  for (const kind of PARENT_KINDS) {
    for (const link of links) {
      if (link.kind === kind && !parents.has(link.fromId)) {
        parents.set(link.fromId, link);
      }
    }
  }

  // Cut every loop where it closes.
  const settled: Set<string> = new Set<string>();

  for (const start of Array.from(parents.keys())) {
    const onPath: Set<string> = new Set<string>();
    let cursor: string | undefined = start;

    while (cursor && !settled.has(cursor)) {
      if (onPath.has(cursor)) {
        parents.delete(cursor);
        break;
      }

      onPath.add(cursor);
      cursor = parents.get(cursor)?.toId;
    }

    for (const id of onPath) {
      settled.add(id);
    }
  }

  return parents;
}

/*
 * A count as a card shows it: whole under a thousand (one decimal under
 * ten), then "12.4k", "3.1M", "2B". Written as code writes numbers, as
 * every topology's figures are.
 */
export function formatCloudTopologyCount(value: number): string {
  const magnitude: number = Math.abs(value);
  const scaled: Array<[number, string]> = [
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "k"],
  ];

  for (const [size, suffix] of scaled) {
    if (magnitude >= size) {
      const amount: number = value / size;
      return `${Math.abs(amount) >= 100 ? Math.round(amount) : Math.round(amount * 10) / 10}${suffix}`;
    }
  }

  return String(
    magnitude >= 10 ? Math.round(value) : Math.round(value * 10) / 10,
  );
}

/*
 * A time from seconds: "230 ms" under a second, then "1.8 s", "12 min",
 * "3.5 h" - each in the reader's words and digits ("۲۳۰ میلی‌ثانیه", "۱٫۸
 * ثانیه"; issues #7418, #8348).
 */
export function formatCloudTopologySeconds(
  seconds: number,
  translator: Translator = getGlobalTranslator(),
): string {
  const magnitude: number = Math.abs(seconds);
  const milliseconds: number = seconds * 1000;

  if (magnitude < 1) {
    return formatMilliseconds(translator, milliseconds, {
      maximumFractionDigits: 0,
    });
  }

  if (magnitude < 120) {
    return formatDurationInUnit(translator, seconds, "second", {
      decimals: 1,
      dropTrailingZeros: true,
    });
  }

  if (magnitude < 2 * 3600) {
    return formatDurationInUnit(translator, seconds / 60, "minute", {
      decimals: 0,
      dropTrailingZeros: true,
    });
  }

  return formatDurationInUnit(translator, seconds / 3600, "hour", {
    decimals: 1,
    dropTrailingZeros: true,
  });
}

/*
 * One reading as a card's figure, in the format its page's tile uses: a
 * percent, a size, a count, a time, or a rate per minute or per second.
 */
export function formatCloudTopologyFigure(data: {
  format: CloudHeadlineFormat;
  value: number;
  periodSeconds: number;
}): string {
  const value: number = data.value;

  switch (data.format) {
    case "percent":
      return formatTopologyPercent(Math.max(0, value));
    case "ratio":
      return formatTopologyPercent(Math.max(0, value * 100));
    case "bytes":
      return formatTopologyBytes(Math.max(0, value));
    case "count":
      return formatCloudTopologyCount(Math.max(0, Math.round(value)));
    case "seconds":
      return formatCloudTopologySeconds(value);
    case "milliseconds":
      return formatCloudTopologySeconds(value / 1000);
    case "perPeriod":
      return `${formatCloudTopologyCount(
        (Math.max(0, value) * 60) / Math.max(1, data.periodSeconds),
      )}/min`;
    case "perSecond":
      return `${formatCloudTopologyCount(Math.max(0, value))}/s`;
    case "bytesPerPeriod":
      return `${formatTopologyBytes(
        (Math.max(0, value) * 60) / Math.max(1, data.periodSeconds),
      )}/min`;
    case "bytesPerSecond":
      return `${formatTopologyBytes(Math.max(0, value))}/s`;
    case "bitsPerSecond":
      return `${formatTopologyBytes(Math.max(0, value) / 8)}/s`;
    default:
      return formatCloudTopologyCount(value);
  }
}

/*
 * The numbers a resource's card carries: the first CLOUD_TOPOLOGY_FACTS_MAX
 * readings its page leads with that its last read kept, in its page's
 * order. None for a type its page leads with nothing for.
 */
export function getCloudTopologyFacts(data: {
  provider: string;
  type: string;
  readings: CloudResourceReadings;
}): Array<ResourceTopologyFact> {
  const facts: Array<ResourceTopologyFact> = [];

  for (const headline of getCloudHeadlineReadings(data.provider, data.type)) {
    if (facts.length >= CLOUD_TOPOLOGY_FACTS_MAX) {
      break;
    }

    // Its own reading, else the first of its fallbacks the resource has.
    const found: { key: string; reading: CloudResourceReading } | null =
      getCloudHeadlineReadingOf(headline, data.readings);

    if (!found) {
      continue;
    }

    facts.push({
      label: headline.label,
      value: formatCloudTopologyFigure({
        format: headline.format,
        value: found.reading.value,
        periodSeconds: getCloudReadingPeriodSeconds(
          data.provider,
          found.key,
          data.type,
        ),
      }),
    });
  }

  return facts;
}

// For tests: the readings a type's card can carry, in order.
export function getCloudTopologyFactKeys(
  provider: string,
  type: string,
): Array<string> {
  return getCloudHeadlineReadings(provider, type).map(
    (headline: CloudHeadlineReading): string => {
      return headline.key;
    },
  );
}

// A reason or a status in the map's words: the same English, values and plural.
function toTopologyText(value: CloudHealthText): ResourceTopologyText {
  return {
    text: value.text,
    values: value.values,
    plural: value.plural,
  };
}

const HEALTH_OF_STATE: Record<
  CloudHealthAssessment["state"],
  ResourceTopologyHealth
> = {
  unhealthy: "critical",
  degraded: "warning",
  healthy: "healthy",
  reporting: "healthy",
  "not-reporting": "unknown",
};

/*
 * How one resource is doing on the map, as its own page says it: a
 * resource neither listed nor reporting lately is Not reporting, never a
 * problem; one that is, is judged by its type's rules on a read of the
 * last hour.
 */
export function assessCloudTopologyResource(data: {
  provider: string;
  resource: CloudAccountTopologyResource;
  now: Date;
}): {
  health: ResourceTopologyHealth;
  status: ResourceTopologyText;
  reasons: Array<ResourceTopologyText>;
  facts: Array<ResourceTopologyFact>;
} {
  const resource: CloudAccountTopologyResource = data.resource;
  const live: boolean =
    resource.isReporting ||
    isRecent(resource.lastSeenAt, data.now, CLOUD_ACCOUNT_RESOURCE_STALE_MS);
  const assessment: CloudHealthAssessment = assessCloudResourceHealth(
    {
      cloudProvider: data.provider,
      cloudResourceType: resource.type,
      // Listed lately counts as reporting: inventory reads every 30 minutes.
      otelCollectorStatus: live ? "connected" : "disconnected",
      cloudReadings: resource.readings,
      cloudReadingsAt: resource.readingsAt,
      cloudProperties: resource.properties,
    },
    { now: data.now },
  );

  return {
    health: HEALTH_OF_STATE[assessment.state],
    status: toTopologyText(assessment.status),
    reasons: assessment.reasons.map(toTopologyText),
    facts:
      live && assessment.hasFreshReadings
        ? getCloudTopologyFacts({
            provider: data.provider,
            type: resource.type,
            readings: readCloudResourceReadings(resource.readings),
          })
        : [],
  };
}

export function buildCloudAccountTopology(
  input: CloudAccountTopologyInput,
): ResourceTopologyGraph {
  const provider: string = input.account.provider;
  const isRead: boolean = isRecent(
    input.account.lastSeenAt,
    input.now,
    CLOUD_ACCOUNT_STALE_MS,
  );

  const nodes: Array<ResourceTopologyNodeInput> = [
    {
      id: CLOUD_ACCOUNT_ROOT_ID,
      parentId: null,
      kind: "cloud.account",
      name: input.account.name || translationKey("Cloud Account"),
      health: isRead
        ? "healthy"
        : input.account.lastSeenAt
          ? "warning"
          : "unknown",
      status: isRead
        ? text(translationKey("Reading"))
        : input.account.lastSeenAt
          ? text(translationKey("Not read lately"))
          : text(translationKey("No data yet")),
      link: { page: PageMap.CLOUD_ACCOUNT_VIEW, modelId: input.account.id },
    },
  ];

  const linked: Array<CloudLinkedResource> = input.resources.map(
    (resource: CloudAccountTopologyResource): CloudLinkedResource => {
      return {
        id: new ObjectID(resource.id),
        name: resource.name,
        providerResourceId: resource.providerResourceId,
        type: resource.type,
        relationships: resource.relationships,
      };
    },
  );
  const links: Array<CloudResourceLink> = getCloudResourceLinks(linked);
  const parents: Map<string, CloudResourceLink> =
    getCloudResourceParents(links);
  const regions: Set<string> = new Set<string>();
  const resourceIds: Set<string> = new Set<string>();

  for (const resource of input.resources) {
    resourceIds.add(resource.id);
  }

  for (const resource of input.resources) {
    const region: string = resource.region.trim();
    const regionId: string | null = region ? cloudRegionNodeId(region) : null;

    if (region && regionId && !regions.has(regionId)) {
      regions.add(regionId);
      nodes.push({
        id: regionId,
        parentId: CLOUD_ACCOUNT_ROOT_ID,
        kind: "cloud.region",
        name: region,
        health: "healthy",
        keywords: [region],
      });
    }

    const typeLabel: string = getCloudResourceTypeDisplayName(
      provider,
      resource.type,
    );
    const assessed: {
      health: ResourceTopologyHealth;
      status: ResourceTopologyText;
      reasons: Array<ResourceTopologyText>;
      facts: Array<ResourceTopologyFact>;
    } = assessCloudTopologyResource({ provider, resource, now: input.now });

    nodes.push({
      id: resource.id,
      parentId:
        parents.get(resource.id)?.toId || regionId || CLOUD_ACCOUNT_ROOT_ID,
      kind: cloudResourceTopologyKind(provider, resource.type),
      name: resource.name || resource.providerResourceId || typeLabel,
      health: assessed.health,
      status: assessed.status,
      reasons: assessed.reasons,
      facts: assessed.facts,
      context: typeLabel || undefined,
      keywords: [resource.providerResourceId, resource.type, region].filter(
        (keyword: string): boolean => {
          return Boolean(keyword);
        },
      ),
      link: { page: PageMap.CLOUD_RESOURCE_VIEW, modelId: resource.id },
    });
  }

  // What crosses the tree: every link but the one that makes a part's parent.
  const relations: Array<ResourceTopologyRelation> = [];
  // What the Connections view draws: every link, the parent's too.
  const connections: Array<ResourceTopologyRelation> = [];

  for (const link of links) {
    const relation: ResourceTopologyRelation = {
      from: link.fromId,
      to: link.toId,
      label: CLOUD_RELATIONSHIP_WORDS[link.kind].label,
      inverseLabel: CLOUD_RELATIONSHIP_WORDS[link.kind].inverseLabel,
    };

    connections.push(relation);

    if (parents.get(link.fromId) !== link) {
      relations.push(relation);
    }
  }

  return buildResourceTopologyGraph({
    rootId: CLOUD_ACCOUNT_ROOT_ID,
    nodes: nodes,
    relations: relations,
    connections: connections,
    issues: attachOpenIssues({
      records: input.issues || [],
      rootId: CLOUD_ACCOUNT_ROOT_ID,
      // On the resource it is linked to; on the account when it names none here.
      locate: (record: OpenIssueRecord): string | null => {
        for (const id of record.relatedIds["cloudResources"] || []) {
          if (resourceIds.has(id)) {
            return id;
          }
        }

        return null;
      },
    }),
    truncations: input.truncations,
  });
}
