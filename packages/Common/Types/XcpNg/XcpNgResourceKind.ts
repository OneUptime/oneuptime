/*
 * The kinds of object an XCP-ng pool's inventory holds (XcpNgResource.kind),
 * in singular PascalCase like ProxmoxResource's `Node` / `Guest` / `Storage`.
 * Stored as plain strings, so adding a kind never needs a migration.
 *
 * A control domain (dom0) is a VM whose `isControlDomain` is set: XAPI
 * reports it as one, Xen Orchestra labels its series
 * is_control_domain="true", and the VMs page hides it unless asked.
 */
enum XcpNgResourceKind {
  Host = "Host",
  VM = "VM",
  StorageRepository = "StorageRepository",
  VDI = "VDI",
}

const KIND_LABELS: Record<
  XcpNgResourceKind,
  { singular: string; plural: string }
> = {
  [XcpNgResourceKind.Host]: { singular: "Host", plural: "Hosts" },
  [XcpNgResourceKind.VM]: { singular: "VM", plural: "VMs" },
  [XcpNgResourceKind.StorageRepository]: {
    singular: "Storage Repository",
    plural: "Storage Repositories",
  },
  [XcpNgResourceKind.VDI]: {
    singular: "Virtual Disk",
    plural: "Virtual Disks",
  },
};

export class XcpNgResourceKindUtil {
  public static getAllKinds(): Array<XcpNgResourceKind> {
    return Object.values(XcpNgResourceKind);
  }

  /*
   * `kind` is a plain string column, so a row written by a newer build (a
   * kind this build does not know) reads as not a kind rather than throwing.
   * Own keys only: never a value such as `constructor`.
   */
  public static isKind(value: unknown): value is XcpNgResourceKind {
    return (
      typeof value === "string" &&
      (Object.values(XcpNgResourceKind) as Array<string>).includes(value)
    );
  }

  public static getSingularLabel(kind: XcpNgResourceKind): string {
    return KIND_LABELS[kind].singular;
  }

  public static getPluralLabel(kind: XcpNgResourceKind): string {
    return KIND_LABELS[kind].plural;
  }
}

export default XcpNgResourceKind;
