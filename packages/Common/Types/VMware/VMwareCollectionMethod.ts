/*
 * How a vCenter's data reaches OneUptime. Stored in
 * VMwareVCenter.collectionMethod.
 *
 *   Agent  the OneUptime VMware agent (an OpenTelemetry Collector with the
 *          vcenter receiver) runs on a machine of the customer's and sends
 *          the data with a telemetry ingestion key. Every vCenter created
 *          before probe collection existed is an Agent vCenter, and so is
 *          every vCenter the agent registers on its own.
 *
 *   Probe  a OneUptime probe that can reach vCenter logs in with the
 *          read-only account saved on the vCenter and collects the same data
 *          the agent would - no agent and no machine of its own to run.
 */
enum VMwareCollectionMethod {
  Agent = "Agent",
  Probe = "Probe",
}

export default VMwareCollectionMethod;

export class VMwareCollectionMethodUtil {
  public static getAll(): Array<VMwareCollectionMethod> {
    return [VMwareCollectionMethod.Agent, VMwareCollectionMethod.Probe];
  }

  public static isValid(value: unknown): value is VMwareCollectionMethod {
    return (
      typeof value === "string" &&
      (VMwareCollectionMethodUtil.getAll() as Array<string>).includes(value)
    );
  }
}
