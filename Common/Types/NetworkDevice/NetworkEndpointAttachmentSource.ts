/*
 * Which SNMP table put an endpoint where it is.
 *
 * A NetworkEndpoint row says "this MAC is attached to this device on this
 * interface", and until now it did not say how we know. Two very different
 * walks can write that sentence:
 *
 *   Fdb  — a switch's bridge forwarding database learned the MAC on a port.
 *          That is a physical statement: the cable from this endpoint lands
 *          in GigabitEthernet1/0/12 of this switch.
 *   Arp  — a router's ipNetToMedia table answered for the MAC. That is a
 *          LAYER 3 statement: the endpoint is somewhere on a subnet this
 *          router routes for, and `attachedInterfaceIndex` names the
 *          router's own SVI, not a port anything is plugged into.
 *
 * `EndpointAttachmentUtil.decideUpsert` has always known which of the two it
 * was applying — the FDB branch and the ARP-only branch are ten lines apart —
 * and then threw the answer away. That was fine while the only consumer drew
 * a leaf node hanging off whatever device the row named. It stops being fine
 * the moment the same row is allowed to draw a CABLE between two managed
 * devices (issue #3489): promoting an ARP-only row would assert that a till
 * is plugged into the core router's Vlan10, which is not a thing that can be
 * true.
 *
 * Stored as free text on the column (the SnmpVersion / NetworkDeviceMonitoringMethod
 * precedent), so read it through `parse` rather than comparing the raw column.
 * Rows written before this existed hold NULL, and NULL is a real answer here:
 * "we do not know which walk wrote this", which must never be read as Fdb.
 */
export enum NetworkEndpointAttachmentSource {
  // A switch's bridge FDB learned this MAC on this port.
  Fdb = "FDB",
  // A router's ARP table answered for this MAC on this L3 interface.
  Arp = "ARP",
}

export class NetworkEndpointAttachmentSourceUtil {
  /*
   * NULL, empty and anything unrecognised return undefined rather than a
   * default. There is no safe default: guessing Fdb invents a physical
   * cable, and guessing Arp would silently stop drawing correct ones. A
   * caller that needs certainty must ask for it explicitly, which is what
   * `isFdb` is for.
   */
  public static parse(
    value: string | undefined | null,
  ): NetworkEndpointAttachmentSource | undefined {
    const normalized: string = (value || "").trim().toUpperCase();
    if (normalized === NetworkEndpointAttachmentSource.Fdb) {
      return NetworkEndpointAttachmentSource.Fdb;
    }
    if (normalized === NetworkEndpointAttachmentSource.Arp) {
      return NetworkEndpointAttachmentSource.Arp;
    }
    return undefined;
  }

  /*
   * True ONLY for a row a switch's forwarding database wrote. An unknown
   * source is not an FDB source: rows that predate the column, and rows a
   * future walk writes with a value nothing here recognises, both answer
   * false, which is the direction that refuses to draw rather than the
   * direction that draws something wrong.
   */
  public static isFdb(value: string | undefined | null): boolean {
    return (
      NetworkEndpointAttachmentSourceUtil.parse(value) ===
      NetworkEndpointAttachmentSource.Fdb
    );
  }
}

export default NetworkEndpointAttachmentSource;
