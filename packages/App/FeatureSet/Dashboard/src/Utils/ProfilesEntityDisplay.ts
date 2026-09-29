import ServiceType from "Common/Types/Telemetry/ServiceType";
import { ActiveFilter } from "Common/UI/Components/TelemetryViewer/types";
import {
  ResolvedTelemetryEntity,
  TELEMETRY_ENTITY_TYPES,
  TelemetryEntityNameMap,
  getTelemetryEntityTypeLabel,
} from "Common/UI/Utils/Telemetry/TelemetryEntityNames";

/*
 * Names for the resource a performance profile came from.
 *
 * A profile's `primaryEntityId` is only a Service id when
 * `primaryEntityType` says so: host-level eBPF agents stamp a Host id,
 * container collectors a DockerHost / KubernetesCluster id, a RUM
 * application its RumApplication id, and so on. The profiles list and the
 * profile page used to name Services and Hosts only and print everything
 * else as a type label over a truncated uuid (the page printed the whole
 * uuid). These helpers turn the (id, type) pair into a name via the shared
 * telemetry entity resolver, and keep the label vocabulary in one place.
 *
 * React-free so App/Tests/Dashboard can pin the behaviour directly.
 */

export const UNKNOWN_PROFILE_SOURCE_LABEL: string = "Unknown source";

export interface ProfileEntityRow {
  primaryEntityId?: { toString: () => string } | string | null | undefined;
  primaryEntityType?: ServiceType | string | null | undefined;
}

export interface ProfileEntityRef {
  id: string;
  entityType?: ServiceType | undefined;
}

/*
 * Whether a discriminator names a type the resolver has a label for.
 */
export const isKnownProfileEntityType: (
  entityType: ServiceType | string | null | undefined,
) => entityType is ServiceType = (
  entityType: ServiceType | string | null | undefined,
): entityType is ServiceType => {
  if (!entityType) {
    return false;
  }
  return Object.prototype.hasOwnProperty.call(
    TELEMETRY_ENTITY_TYPES,
    entityType.toString(),
  );
};

const readId: (
  value: { toString: () => string } | string | null | undefined,
) => string = (
  value: { toString: () => string } | string | null | undefined,
): string => {
  return value ? value.toString().trim() : "";
};

/*
 * Distinct (id, type) pairs across a page of profiles, skipping ids the
 * caller can already name (the loaded Service / Host lists). Sorted by id so
 * the resolver's input is stable across refetches of the same page.
 */
export const collectProfileEntityRefs: (data: {
  profiles: Array<ProfileEntityRow>;
  knownIds?: Set<string> | undefined;
}) => Array<ProfileEntityRef> = (data: {
  profiles: Array<ProfileEntityRow>;
  knownIds?: Set<string> | undefined;
}): Array<ProfileEntityRef> => {
  const byId: Map<string, ProfileEntityRef> = new Map<
    string,
    ProfileEntityRef
  >();

  for (const profile of data.profiles) {
    const id: string = readId(profile.primaryEntityId);
    if (!id || data.knownIds?.has(id)) {
      continue;
    }

    const rawType: ServiceType | string | null | undefined =
      profile.primaryEntityType;
    const entityType: ServiceType | undefined = isKnownProfileEntityType(
      rawType,
    )
      ? rawType
      : undefined;

    const existing: ProfileEntityRef | undefined = byId.get(id);
    if (existing && existing.entityType) {
      continue;
    }

    byId.set(id, entityType ? { id, entityType } : { id });
  }

  return Array.from(byId.values()).sort(
    (a: ProfileEntityRef, b: ProfileEntityRef): number => {
      return a.id.localeCompare(b.id);
    },
  );
};

/*
 * Resolver type hints for the refs: every typed id goes straight to its own
 * table in one targeted request per type.
 */
export const buildProfileEntityTypeHints: (
  refs: Array<ProfileEntityRef>,
) => Record<string, ServiceType> = (
  refs: Array<ProfileEntityRef>,
): Record<string, ServiceType> => {
  const hints: Record<string, ServiceType> = {};
  for (const ref of refs) {
    if (ref.entityType) {
      hints[ref.id] = ref.entityType;
    }
  }
  return hints;
};

/*
 * A stable string for a ref list, so a table refetch returning the same
 * sources does not replace state (and re-render) for nothing.
 */
export const getProfileEntityRefsKey: (
  refs: Array<ProfileEntityRef>,
) => string = (refs: Array<ProfileEntityRef>): string => {
  return refs
    .map((ref: ProfileEntityRef): string => {
      return `${ref.id}:${ref.entityType || ""}`;
    })
    .join(",");
};

export const shortenProfileEntityId: (id: string) => string = (
  id: string,
): string => {
  return id.length > 12 ? `${id.substring(0, 8)}…` : id;
};

export interface ProfileEntityDisplay {
  // The entity's name when known, else the type label.
  primary: string;
  // What kind of thing it is ("RUM Application"), or the unknown label.
  typeLabel: string;
  // Whether `primary` is a real name rather than a label.
  isResolved: boolean;
  // Truncated id, shown under an unresolved label. Empty when resolved.
  shortId: string;
}

/*
 * Source cell / summary display for one profile.
 *
 * - A resolved entity reads "<name>" over its type label.
 * - An unresolved entity of a known type reads "<type label>" over its short
 *   id — never "Unknown", because the source is perfectly valid.
 * - "Unknown source" is reserved for a discriminator nothing recognises and
 *   an id nothing could resolve.
 */
export const getProfileEntityDisplay: (data: {
  entityId: string;
  entityType: ServiceType | string | null | undefined;
  nameMap: TelemetryEntityNameMap | undefined;
}) => ProfileEntityDisplay = (data: {
  entityId: string;
  entityType: ServiceType | string | null | undefined;
  nameMap: TelemetryEntityNameMap | undefined;
}): ProfileEntityDisplay => {
  const entityId: string = (data.entityId || "").trim();
  const resolved: ResolvedTelemetryEntity | undefined = entityId
    ? data.nameMap?.[entityId]
    : undefined;

  if (resolved) {
    return {
      primary: resolved.name,
      typeLabel: resolved.typeLabel,
      isResolved: true,
      shortId: "",
    };
  }

  const typeLabel: string = isKnownProfileEntityType(data.entityType)
    ? getTelemetryEntityTypeLabel(data.entityType)
    : UNKNOWN_PROFILE_SOURCE_LABEL;

  return {
    primary: typeLabel,
    typeLabel,
    isResolved: false,
    shortId: shortenProfileEntityId(entityId),
  };
};

/*
 * The `?serviceId=` deep-link chip. The overview links here for any source a
 * profile can have, so the key follows what the id resolved to rather than
 * always claiming "Service"; the value is a name as soon as one is known.
 *
 * `serviceName` / `hostName` are the names the table's own loaded Service and
 * Host lists give the id. The table skips the resolver for any id those lists
 * contain, so the chip must be able to name a loaded Host by itself — else a
 * deep link to a host-level (eBPF) source reads "Service: 1f0c1a2b…" forever.
 */
export const getProfileServiceFilterChipDisplay: (data: {
  serviceId: string;
  serviceName?: string | undefined;
  hostName?: string | undefined;
  nameMap: TelemetryEntityNameMap | undefined;
}) => { key: string; value: string; isResolved: boolean } = (data: {
  serviceId: string;
  serviceName?: string | undefined;
  hostName?: string | undefined;
  nameMap: TelemetryEntityNameMap | undefined;
}): { key: string; value: string; isResolved: boolean } => {
  const serviceId: string = (data.serviceId || "").trim();

  if (data.serviceName) {
    return {
      key: getTelemetryEntityTypeLabel(ServiceType.OpenTelemetry),
      value: data.serviceName,
      isResolved: true,
    };
  }

  if (data.hostName) {
    return {
      key: getTelemetryEntityTypeLabel(ServiceType.Host),
      value: data.hostName,
      isResolved: true,
    };
  }

  const resolved: ResolvedTelemetryEntity | undefined = serviceId
    ? data.nameMap?.[serviceId]
    : undefined;

  if (resolved) {
    return {
      key: resolved.typeLabel,
      value: resolved.name,
      isResolved: true,
    };
  }

  return {
    key: getTelemetryEntityTypeLabel(ServiceType.OpenTelemetry),
    value: shortenProfileEntityId(serviceId),
    isResolved: false,
  };
};

/*
 * Whether the profiles table shows its pill row above the list.
 *
 * The row used to exist only for the removable deep-link pills (`?traceId=`,
 * `?serviceId=`, `?profileType=`). An Inventory item's Profiles page scopes
 * the table by entity key instead, with no deep link at all — so the list was
 * filtered while nothing above it said so. A locked entity-key chip now opens
 * the row by itself. Display only: the answer never reaches the query.
 */
export interface ProfileTableFilterRowInput {
  /** The table's locked chips (its entity-key scope), rendered first. */
  lockedChips?: ReadonlyArray<ActiveFilter> | undefined;
  traceIdFilter?: string | null | undefined;
  serviceIdFilter?: string | null | undefined;
  profileTypeFilter?: string | null | undefined;
}

type HasProfileTableFilterRowFunction = (
  input: ProfileTableFilterRowInput,
) => boolean;

export const hasProfileTableFilterRow: HasProfileTableFilterRowFunction = (
  input: ProfileTableFilterRowInput,
): boolean => {
  if (input.lockedChips && input.lockedChips.length > 0) {
    return true;
  }

  /*
   * Truthiness, exactly as the pills themselves test it: an empty
   * `?traceId=` renders no pill, so it must not open an empty row either.
   */
  return Boolean(
    input.traceIdFilter || input.serviceIdFilter || input.profileTypeFilter,
  );
};
