import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import BadDataException from "../../../Types/Exception/BadDataException";
import AwsCloudConnector from "./Aws/AwsCloudConnector";
import AzureCloudConnector from "./Azure/AzureCloudConnector";
import { CloudConnector } from "./CloudConnectorTypes";
import GcpCloudConnector from "./Gcp/GcpCloudConnector";

/*
 * One stateless connector per cloud (CloudConnectorTypes): the read loop,
 * "Test connection" and the save-time validation all find theirs here.
 */
const CONNECTORS: Record<CloudProvider, CloudConnector> = {
  [CloudProvider.AWS]: new AwsCloudConnector(),
  [CloudProvider.Azure]: new AzureCloudConnector(),
  [CloudProvider.GCP]: new GcpCloudConnector(),
};

export default class CloudConnectorRegistry {
  public static getConnector(provider: CloudProvider | string): CloudConnector {
    const connector: CloudConnector | undefined =
      CONNECTORS[provider as CloudProvider];

    if (!connector) {
      throw new BadDataException(
        "Provider must be AWS, Azure or Google Cloud.",
      );
    }

    return connector;
  }
}
