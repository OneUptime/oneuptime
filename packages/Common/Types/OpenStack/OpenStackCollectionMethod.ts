/*
 * How a cloud's data reaches OneUptime. Stored in OpenStackCloud.collectionMethod.
 *
 *   Agent  the OneUptime OpenStack agent (a collector and openstack-exporter)
 *          runs on a machine of the customer's and sends the data with a
 *          telemetry ingestion key. Every cloud the agent registers on its own
 *          is an Agent cloud.
 *
 *   Probe  a OneUptime probe that can reach the cloud's APIs logs in with the
 *          credential saved on the cloud and reads the same series itself: no
 *          agent, and no machine of its own to run.
 */
enum OpenStackCollectionMethod {
  Agent = "Agent",
  Probe = "Probe",
}

export default OpenStackCollectionMethod;

export class OpenStackCollectionMethodUtil {
  public static getAll(): Array<OpenStackCollectionMethod> {
    return [OpenStackCollectionMethod.Agent, OpenStackCollectionMethod.Probe];
  }

  public static isValid(value: unknown): value is OpenStackCollectionMethod {
    return (
      typeof value === "string" &&
      (OpenStackCollectionMethodUtil.getAll() as Array<string>).includes(value)
    );
  }
}
