import SecurityEventConnection from "../../../../Models/DatabaseModels/SecurityEventConnection";
import SecurityEventConnectionService from "../../../Services/SecurityEventConnectionService";
import DataSourceHttpFetch from "../../DataSource/HttpFetch";
import {
  ConnectorTransport,
  SecurityConnectorSettings,
  readSettingString,
} from "../../SecurityEvent/Connectors/Types";
import CrowdStrikeFalconResponseClient from "../../SecurityEvent/Response/CrowdStrikeFalconResponseClient";
import MicrosoftDefenderEndpointClient from "../../SecurityEvent/Response/MicrosoftDefenderEndpointClient";
import SecurityBlockDestination from "../SecurityBlockDestination";
import { SecurityBlockDestinationSource } from "../SecurityBlockDestinations";
import { LIMIT_PER_PROJECT } from "../../../../Types/Database/LimitMax";
import ObjectID from "../../../../Types/ObjectID";
import { SecurityBlockDestinationProvider } from "../../../../Types/SecurityBlocklist/SecurityBlockEnforcement";
import { isBlockingTurnedOn } from "../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import SecurityEventConnectorProvider from "../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import CrowdStrikeBlockDestination from "./CrowdStrikeBlockDestination";
import MicrosoftDefenderBlockDestination from "./MicrosoftDefenderBlockDestination";

/*
 * WHERE A PROJECT'S BLOCKLIST IS ENFORCED ON EVERY MACHINE (#10346): one
 * destination per Microsoft Defender XDR connection, and per CrowdStrike
 * Falcon connection, whose blocking switch is on - Block domains, addresses
 * and files with Defender, Block files with CrowdStrike. A connection with
 * it off is never written to: the switch is the opt-in, with the
 * permission it takes, and a connection made to import alerts only reads.
 *
 * A destination is named by its product - "Microsoft Defender" - and by
 * its connection's name too when the project blocks through more than one
 * of that product.
 */

// The transport every destination's client calls through, which tests replace.
let transport: ConnectorTransport = DataSourceHttpFetch.fetch;

export function setEndpointBlockTransportForTests(
  replacement: ConnectorTransport,
): void {
  transport = replacement;
}

export function resetEndpointBlockTransportForTests(): void {
  transport = DataSourceHttpFetch.fetch;
}

// The project's connections to a product with blocking on.
async function findBlockingConnections(data: {
  projectId: ObjectID;
  provider: SecurityEventConnectorProvider;
}): Promise<Array<SecurityEventConnection>> {
  const connections: Array<SecurityEventConnection> =
    await SecurityEventConnectionService.findBy({
      query: { projectId: data.projectId, provider: data.provider },
      select: {
        _id: true,
        name: true,
        provider: true,
        config: true,
        secrets: true,
        alertingOnly: true,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: { isRoot: true },
    });

  return connections.filter((connection: SecurityEventConnection): boolean => {
    return Boolean(connection.id) && isBlockingTurnedOn(connection.config);
  });
}

// A destination's name: its product's, and its connection's when there is more than one.
function nameOf(data: {
  product: string;
  connection: SecurityEventConnection;
  count: number;
}): string {
  const connectionName: string = (data.connection.name || "").trim();

  return data.count > 1 && connectionName
    ? `${data.product} (${connectionName})`
    : data.product;
}

export const MicrosoftDefenderBlockDestinationSource: SecurityBlockDestinationSource =
  {
    provider: SecurityBlockDestinationProvider.MicrosoftDefender,
    findForProject: async (
      projectId: ObjectID,
    ): Promise<Array<SecurityBlockDestination>> => {
      const connections: Array<SecurityEventConnection> =
        await findBlockingConnections({
          projectId,
          provider: SecurityEventConnectorProvider.MicrosoftDefenderXdr,
        });

      const destinations: Array<SecurityBlockDestination> = [];

      for (const connection of connections) {
        const settings: SecurityConnectorSettings =
          await SecurityEventConnectionService.getConnectorSettings(connection);

        destinations.push(
          new MicrosoftDefenderBlockDestination({
            connectionId: connection.id!,
            name: nameOf({
              product: "Microsoft Defender",
              connection,
              count: connections.length,
            }),
            client: new MicrosoftDefenderEndpointClient({
              tenantId: readSettingString(settings.config, "tenantId"),
              clientId: readSettingString(settings.config, "clientId"),
              clientSecret: readSettingString(settings.secrets, "clientSecret"),
              cloud: readSettingString(settings.config, "cloud") || "public",
              transport,
            }),
          }),
        );
      }

      return destinations;
    },
  };

export const CrowdStrikeBlockDestinationSource: SecurityBlockDestinationSource =
  {
    provider: SecurityBlockDestinationProvider.CrowdStrike,
    findForProject: async (
      projectId: ObjectID,
    ): Promise<Array<SecurityBlockDestination>> => {
      const connections: Array<SecurityEventConnection> =
        await findBlockingConnections({
          projectId,
          provider: SecurityEventConnectorProvider.CrowdStrikeFalcon,
        });

      const destinations: Array<SecurityBlockDestination> = [];

      for (const connection of connections) {
        const settings: SecurityConnectorSettings =
          await SecurityEventConnectionService.getConnectorSettings(connection);

        destinations.push(
          new CrowdStrikeBlockDestination({
            connectionId: connection.id!,
            name: nameOf({
              product: "CrowdStrike Falcon",
              connection,
              count: connections.length,
            }),
            client: new CrowdStrikeFalconResponseClient({
              cloud: readSettingString(settings.config, "cloud") || "us-1",
              clientId: readSettingString(settings.config, "clientId"),
              clientSecret: readSettingString(settings.secrets, "clientSecret"),
              transport,
            }),
          }),
        );
      }

      return destinations;
    },
  };
