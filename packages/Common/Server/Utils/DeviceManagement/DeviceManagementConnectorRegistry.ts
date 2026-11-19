import BadDataException from "../../../Types/Exception/BadDataException";
import DeviceManagementProvider from "../../../Types/DeviceManagement/DeviceManagementProvider";
import EsperConnector from "./Esper/EsperConnector";
import { DeviceManagementConnector } from "./DeviceManagementTypes";

/*
 * One stateless connector per device management service
 * (DeviceManagementTypes): the read runner and "Test" both find theirs here.
 */
const CONNECTORS: Record<DeviceManagementProvider, DeviceManagementConnector> =
  {
    [DeviceManagementProvider.Esper]: new EsperConnector(),
  };

export default class DeviceManagementConnectorRegistry {
  public static getConnector(
    provider: DeviceManagementProvider | string,
  ): DeviceManagementConnector {
    const connector: DeviceManagementConnector | undefined =
      CONNECTORS[provider as DeviceManagementProvider];

    if (!connector) {
      throw new BadDataException("Service must be 'esper'.");
    }

    return connector;
  }
}
