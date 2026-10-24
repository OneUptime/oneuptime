import BadDataException from "../../../Types/Exception/BadDataException";
import NetworkControllerProvider from "../../../Types/NetworkController/NetworkControllerProvider";
import MerakiConnector from "./Meraki/MerakiConnector";
import { NetworkControllerConnector } from "./NetworkControllerTypes";

/*
 * One stateless connector per controller (NetworkControllerTypes): the read
 * runner and "Test" both find theirs here.
 */
const CONNECTORS: Record<
  NetworkControllerProvider,
  NetworkControllerConnector
> = {
  [NetworkControllerProvider.Meraki]: new MerakiConnector(),
};

export default class NetworkControllerConnectorRegistry {
  public static getConnector(
    provider: NetworkControllerProvider | string,
  ): NetworkControllerConnector {
    const connector: NetworkControllerConnector | undefined =
      CONNECTORS[provider as NetworkControllerProvider];

    if (!connector) {
      throw new BadDataException("Controller must be 'meraki'.");
    }

    return connector;
  }
}
