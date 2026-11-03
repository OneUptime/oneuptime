/*
 * How a network topology map arranges its devices - the five buttons under
 * Map options -> Arrange the map, by the ids the map, its saved
 * arrangements and the project's default (Project.defaultNetworkTopologyLayout,
 * issue #5378) all use:
 *
 *   force        Automatic         groups connected devices together
 *   tiered       By network layer  core, distribution and access in rows
 *   radial       Concentric        rings around the network core
 *   star         Hub and spoke     each connected group around its hub
 *   parentChild  Parent and child  every device beneath its own parent
 *
 * The ids are stored - in a browser's saved arrangements and in the
 * project's default - so they are never renamed: a new layout adds an id
 * here and nowhere else decides which ids exist.
 */
export type NetworkTopologyLayout =
  | "force"
  | "tiered"
  | "radial"
  | "star"
  | "parentChild";

// Every layout, in the order the map offers them.
export const NETWORK_TOPOLOGY_LAYOUTS: ReadonlyArray<NetworkTopologyLayout> = [
  "force",
  "tiered",
  "radial",
  "star",
  "parentChild",
];

export class NetworkTopologyLayoutUtil {
  public static isLayout(value: unknown): value is NetworkTopologyLayout {
    return (
      typeof value === "string" &&
      (NETWORK_TOPOLOGY_LAYOUTS as ReadonlyArray<string>).includes(value)
    );
  }

  /*
   * A stored default, read back: the layout it names, or null for none.
   * NULL, blank and anything unrecognised - a layout a later version
   * removed, a value written by hand - read as none, so the map opens on
   * its own default rather than on nothing.
   */
  public static parse(value: unknown): NetworkTopologyLayout | null {
    if (typeof value !== "string") {
      return null;
    }

    const trimmed: string = value.trim();

    return NetworkTopologyLayoutUtil.isLayout(trimmed) ? trimmed : null;
  }

  /*
   * Why a value cannot be stored as a project's default layout, or null
   * when it can: one of the layouts' ids, or nothing (null or blank text),
   * which clears it.
   */
  public static getProblem(value: unknown): string | null {
    if (value === null) {
      return null;
    }

    if (typeof value !== "string") {
      return "The default network topology layout must be text.";
    }

    if (
      value.trim().length === 0 ||
      NetworkTopologyLayoutUtil.isLayout(value.trim())
    ) {
      return null;
    }

    return `The default network topology layout must be one of ${NETWORK_TOPOLOGY_LAYOUTS.join(", ")}.`;
  }
}

export default NetworkTopologyLayout;
