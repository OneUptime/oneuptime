/*
 * How an XCP-ng pool's data reaches OneUptime, as XcpNgPool.collectionMethod
 * stores it.
 *
 *   Agent  the OneUptime XCP-ng Agent, beside the Xen Orchestra that manages
 *          the pool, sends it with a telemetry ingestion key. Every pool
 *          registered before probe collection existed is an Agent pool.
 *
 *   Probe  one of the project's probes reads it through an XCP-ng
 *          connection (XcpNgPool.xcpNgConnectionId): a Xen Orchestra, or
 *          the pool's own XAPI. Nothing to install.
 *
 * A pool is read by one of the two, never both: a probe connection's data
 * for a pool someone switched back to the agent is dropped before it is
 * stored (XcpNgPoolAssignment). The pool's row, and so its history, stays
 * the same whichever reads it.
 *
 * Stored strings: never rename one, only add.
 */
enum XcpNgCollectionMethod {
  Agent = "Agent",
  Probe = "Probe",
}

export default XcpNgCollectionMethod;

export class XcpNgCollectionMethodUtil {
  public static getAll(): Array<XcpNgCollectionMethod> {
    return [XcpNgCollectionMethod.Agent, XcpNgCollectionMethod.Probe];
  }

  public static isValid(value: unknown): value is XcpNgCollectionMethod {
    return (
      typeof value === "string" &&
      (XcpNgCollectionMethodUtil.getAll() as Array<string>).includes(value)
    );
  }
}
