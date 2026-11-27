/*
 * What an XCP-ng connection reads, as XcpNgConnection.connectionType stores
 * it. A connection is read by one of the project's probes, with nothing to
 * install (#10996, #10999):
 *
 *   XenOrchestra  a Xen Orchestra and every pool it manages, through its
 *                 OpenMetrics plugin (and, with an API token, its REST API).
 *                 The same plugin the XCP-ng Agent reads.
 *
 *   Xapi          one pool with no Xen Orchestra in front of it, through
 *                 XAPI on its pool master: the same reads Xen Orchestra's
 *                 plugin makes, made by the probe itself.
 *
 * Stored strings: never rename one, only add.
 */
enum XcpNgConnectionType {
  XenOrchestra = "XenOrchestra",
  Xapi = "Xapi",
}

export default XcpNgConnectionType;

export class XcpNgConnectionTypeUtil {
  public static getAll(): Array<XcpNgConnectionType> {
    return [XcpNgConnectionType.XenOrchestra, XcpNgConnectionType.Xapi];
  }

  public static isValid(value: unknown): value is XcpNgConnectionType {
    return (
      typeof value === "string" &&
      (XcpNgConnectionTypeUtil.getAll() as Array<string>).includes(value)
    );
  }

  // How the connection is named where a person picks or reads it.
  public static getLabel(type: XcpNgConnectionType): string {
    switch (type) {
      case XcpNgConnectionType.XenOrchestra:
        return "Xen Orchestra";
      case XcpNgConnectionType.Xapi:
        return "XAPI";
    }
  }
}
