import EntitySource from "Common/Types/Telemetry/EntitySource";

/*
 * How the Inventory product presents the three ways a row can come to exist.
 *
 * The distinction is not cosmetic. It decides what the user is allowed to
 * expect from a row, and the two things people get wrong about this product
 * both live here:
 *
 *   - Deleting a discovered or mirrored row does not remove the thing. The
 *     source is the authority; the row reappears on the next reconcile or the
 *     next poll. Only a manual row is really gone when you delete it.
 *   - "Last seen" only means anything where something is bumping it. Nothing
 *     bumps it for mirrored or manual rows, so rendering "last seen 6 months
 *     ago" against them reads as an outage when it is just an absence of a
 *     heartbeat that was never going to arrive.
 *
 * Both facts are properties of the source, so both are declared here once and
 * read everywhere instead of being re-derived (and re-mis-derived) per page.
 */

export interface InventorySourceDescriptor {
  source: EntitySource;
  label: string;
  /** One line, written for someone who has never heard the word "entity". */
  description: string;
  /** Tailwind classes for the pill this source renders as. */
  pillClassName: string;
  /**
   * True when something actively re-bumps `lastSeenAt` for rows of this
   * source, which is what makes staleness a real signal rather than noise.
   */
  hasLivenessSignal: boolean;
  /**
   * True when deleting the row deletes the thing for good. False for rows
   * whose lifecycle is owned elsewhere — deleting one of those only clears it
   * until the owning source re-registers it.
   */
  isDeletePermanent: boolean;
  /** Shown next to the delete button for the sources that come back. */
  deleteCaveat?: string | undefined;
}

const DESCRIPTORS: Record<EntitySource, InventorySourceDescriptor> = {
  [EntitySource.Discovered]: {
    source: EntitySource.Discovered,
    label: "Discovered",
    description:
      "Found automatically in the OpenTelemetry data you send us. Appears within minutes of the first signal and keeps itself up to date.",
    pillClassName: "bg-indigo-50 text-indigo-700 ring-indigo-600/20",
    hasLivenessSignal: true,
    isDeletePermanent: false,
    deleteCaveat:
      "This item was discovered from telemetry. Deleting it clears it from the list, but it will be re-created the next time it sends data.",
  },
  [EntitySource.Inventory]: {
    source: EntitySource.Inventory,
    label: "Mirrored",
    description:
      "Mirrored from another part of OneUptime — network devices, cloud resources, IoT devices and the like. The original record owns it; this is a copy so the whole estate is listed in one place.",
    pillClassName: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
    hasLivenessSignal: false,
    isDeletePermanent: false,
    deleteCaveat:
      "This item mirrors a record elsewhere in OneUptime. Delete the original record to remove it for good — deleting it here only clears the copy.",
  },
  [EntitySource.Manual]: {
    source: EntitySource.Manual,
    label: "Added by you",
    description:
      "Registered by hand, for things OneUptime cannot see on its own — a vendor API, a managed database, an appliance. Nothing else will ever change or remove it.",
    pillClassName: "bg-amber-50 text-amber-800 ring-amber-600/20",
    hasLivenessSignal: false,
    isDeletePermanent: true,
  },
};

/**
 * Display order. Discovered first because it is almost always the largest
 * group, and manual last because it is the one a user built themselves.
 */
export const INVENTORY_SOURCE_ORDER: Array<EntitySource> = [
  EntitySource.Discovered,
  EntitySource.Inventory,
  EntitySource.Manual,
];

export type GetInventorySourceDescriptorFunction = (
  source: string | undefined,
) => InventorySourceDescriptor | null;

/**
 * Takes `string` for the same reason the type catalog does: the value comes
 * off a server-written row, so a newer server could send a source this build
 * has no entry for.
 */
export const getInventorySourceDescriptor: GetInventorySourceDescriptorFunction =
  (source: string | undefined): InventorySourceDescriptor | null => {
    if (!source) {
      return null;
    }

    return DESCRIPTORS[source as EntitySource] || null;
  };

export type InventorySourceLabelFunction = (
  source: string | undefined,
) => string;

export const getInventorySourceLabel: InventorySourceLabelFunction = (
  source: string | undefined,
): string => {
  return getInventorySourceDescriptor(source)?.label || source || "Unknown";
};

export type InventorySourcePredicate = (source: string | undefined) => boolean;

/**
 * Whether "last seen" is a meaningful column for this row. Unknown sources
 * answer `false`: showing a staleness warning we cannot justify is worse than
 * showing none.
 */
export const sourceHasLivenessSignal: InventorySourcePredicate = (
  source: string | undefined,
): boolean => {
  return getInventorySourceDescriptor(source)?.hasLivenessSignal === true;
};

/**
 * Whether deleting the row is the end of it. Unknown sources answer `false`,
 * so the UI warns that the row may come back rather than promising a
 * permanence it cannot deliver.
 */
export const isDeletePermanentForSource: InventorySourcePredicate = (
  source: string | undefined,
): boolean => {
  return getInventorySourceDescriptor(source)?.isDeletePermanent === true;
};

export type InventoryDeleteCaveatFunction = (
  source: string | undefined,
) => string | null;

export const getInventoryDeleteCaveat: InventoryDeleteCaveatFunction = (
  source: string | undefined,
): string | null => {
  const descriptor: InventorySourceDescriptor | null =
    getInventorySourceDescriptor(source);

  if (!descriptor) {
    return "This item's source is unknown to this version of OneUptime. Deleting it may not be permanent.";
  }

  return descriptor.deleteCaveat || null;
};
