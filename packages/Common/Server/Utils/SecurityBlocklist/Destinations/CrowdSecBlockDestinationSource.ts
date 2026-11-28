import SecurityEventConnection from "../../../../Models/DatabaseModels/SecurityEventConnection";
import SecurityEventConnectionService from "../../../Services/SecurityEventConnectionService";
import DataSourceHttpFetch from "../../DataSource/HttpFetch";
import CrowdSecConnector, {
  CrowdSecLapiSettings,
} from "../../SecurityEvent/Connectors/CrowdSec/CrowdSecConnector";
import {
  ConnectorTransport,
  SecurityConnectorSettings,
} from "../../SecurityEvent/Connectors/Types";
import CrowdSecLapiClient from "../../SecurityEvent/Response/CrowdSecLapiClient";
import SecurityBlockDestination from "../SecurityBlockDestination";
import { SecurityBlockDestinationSource } from "../SecurityBlockDestinations";
import { LIMIT_PER_PROJECT } from "../../../../Types/Database/LimitMax";
import ObjectID from "../../../../Types/ObjectID";
import { SecurityBlockDestinationProvider } from "../../../../Types/SecurityBlocklist/SecurityBlockEnforcement";
import { isBlockingTurnedOn } from "../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import SecurityEventConnectorProvider from "../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import CrowdSecBlockDestination from "./CrowdSecBlockDestination";

/*
 * WHERE A PROJECT'S BLOCKLIST IS ENFORCED IN CROWDSEC (#11158): one
 * destination per CrowdSec connection whose "Block addresses with
 * CrowdSec" is on and that holds its Local API's URL, machine and
 * password. A connection with it off is never written to: the switch is
 * the opt-in, with the permission it takes, and a connection made to
 * receive alerts only never signs in to anything.
 *
 * A destination is named "CrowdSec", and by its connection's name too when
 * the project blocks through more than one CrowdSec - a staging and a
 * production one, say.
 */

// The transport every destination's client calls through, which tests replace.
let transport: ConnectorTransport = DataSourceHttpFetch.fetch;

export function setCrowdSecBlockTransportForTests(
  replacement: ConnectorTransport,
): void {
  transport = replacement;
}

export function resetCrowdSecBlockTransportForTests(): void {
  transport = DataSourceHttpFetch.fetch;
}

export const CROWDSEC_DESTINATION_PRODUCT: string = "CrowdSec";

export const CrowdSecBlockDestinationSource: SecurityBlockDestinationSource = {
  provider: SecurityBlockDestinationProvider.CrowdSec,
  findForProject: async (
    projectId: ObjectID,
  ): Promise<Array<SecurityBlockDestination>> => {
    const connections: Array<SecurityEventConnection> = (
      await SecurityEventConnectionService.findBy({
        query: { projectId, provider: SecurityEventConnectorProvider.CrowdSec },
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
      })
    ).filter((connection: SecurityEventConnection): boolean => {
      return Boolean(connection.id) && isBlockingTurnedOn(connection.config);
    });

    const destinations: Array<SecurityBlockDestination> = [];

    for (const connection of connections) {
      const settings: SecurityConnectorSettings =
        await SecurityEventConnectionService.getConnectorSettings(connection);
      const lapi: CrowdSecLapiSettings | null =
        CrowdSecConnector.readLapiSettings(settings);

      if (!lapi) {
        continue;
      }

      const connectionName: string = (connection.name || "").trim();

      destinations.push(
        new CrowdSecBlockDestination({
          connectionId: connection.id!,
          name:
            connections.length > 1 && connectionName
              ? `${CROWDSEC_DESTINATION_PRODUCT} (${connectionName})`
              : CROWDSEC_DESTINATION_PRODUCT,
          client: new CrowdSecLapiClient({
            lapiUrl: lapi.lapiUrl,
            machineId: lapi.machineId,
            password: lapi.password,
            transport,
          }),
        }),
      );
    }

    return destinations;
  },
};
