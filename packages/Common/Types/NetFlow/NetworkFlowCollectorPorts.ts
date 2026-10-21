/*
 * The UDP ports a probe's flow collector listens on unless its operator
 * changes them: the port each format conventionally uses. The collector
 * reads whatever arrives on ANY of them by its first bytes, so a device can
 * send NetFlow to the sFlow port and it still works - but pointing each
 * format at its own port is what device defaults and firewall rules expect.
 *
 * Read by the probe (its listeners), the dashboard (the set-up steps on the
 * Traffic pages) and the docs tests, so the three can never disagree.
 */
export const DEFAULT_NETFLOW_COLLECTOR_PORT: number = 2055;
export const DEFAULT_IPFIX_COLLECTOR_PORT: number = 4739;
export const DEFAULT_SFLOW_COLLECTOR_PORT: number = 6343;

export interface NetworkFlowCollectorPortSettings {
  netFlowPort: number;
  ipfixPort: number;
  sFlowPort: number;
}

export class NetworkFlowCollectorPortsUtil {
  /*
   * The ports to listen on: each configured one once, in the order NetFlow,
   * IPFIX, sFlow. A port of 0 (or anything not a UDP port) is off.
   */
  public static getListeningPorts(
    settings: NetworkFlowCollectorPortSettings,
  ): Array<number> {
    const ports: Array<number> = [];

    for (const port of [
      settings.netFlowPort,
      settings.ipfixPort,
      settings.sFlowPort,
    ]) {
      if (
        Number.isInteger(port) &&
        port > 0 &&
        port <= 65535 &&
        !ports.includes(port)
      ) {
        ports.push(port);
      }
    }

    return ports;
  }
}
