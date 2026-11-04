import { OpenStackResourceKind } from "./OpenStackResourceKind";

/*
 * How many of a kind there are by one of what they hold: how many instances use each
 * flavor, which volume types are in use, what each project's snapshots add up to.
 *
 * These are counted on the server in one statement, because the alternatives are reading
 * every row or one count per value, and a cloud can hold hundreds of thousands of them.
 * What can be counted by is a closed list, so nothing a request says reaches the SQL.
 */
export type OpenStackCountBy = "flavor" | "volumeType" | "project";

export const OPENSTACK_COUNTABLE: Partial<
  Record<OpenStackResourceKind, ReadonlyArray<OpenStackCountBy>>
> = {
  [OpenStackResourceKind.Instance]: ["flavor", "project"],
  [OpenStackResourceKind.Volume]: ["volumeType", "project"],
  [OpenStackResourceKind.Snapshot]: ["project"],
  [OpenStackResourceKind.Backup]: ["project"],
  [OpenStackResourceKind.Network]: ["project"],
  [OpenStackResourceKind.Router]: ["project"],
  [OpenStackResourceKind.FloatingIp]: ["project"],
};

export const OPENSTACK_COUNT_LIMIT: number = 500;

export interface OpenStackCountRow {
  // What it was counted by: a flavor's id, a volume type, a project's id.
  value: string | null;
  regionName: string | null;
  count: number;
  // What they add up to: a volume's, a snapshot's or a backup's size.
  sizeBytes: number;
}

export function isOpenStackCountable(
  kind: unknown,
  by: unknown,
): kind is OpenStackResourceKind {
  return (
    typeof kind === "string" &&
    typeof by === "string" &&
    Boolean(
      OPENSTACK_COUNTABLE[kind as OpenStackResourceKind]?.includes(
        by as OpenStackCountBy,
      ),
    )
  );
}
