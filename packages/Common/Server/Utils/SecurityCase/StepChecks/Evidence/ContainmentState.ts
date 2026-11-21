import SecurityEventConnection from "../../../../../Models/DatabaseModels/SecurityEventConnection";
import ObjectID from "../../../../../Types/ObjectID";
import SecurityEventConnectorProvider from "../../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import SecurityEventConnectionService from "../../../../Services/SecurityEventConnectionService";
import QueryHelper from "../../../../Types/Database/QueryHelper";
import { ConnectorTransport } from "../../../SecurityEvent/Connectors/Types";
import SecurityPlaybookContainment, {
  HOST_STATE_PROVIDERS,
  PRODUCT_NAMES,
  ProductContainmentReading,
  USER_STATE_PROVIDERS,
} from "../../../SecurityPlaybook/SecurityPlaybookContainment";

/*
 * WHERE A CASE'S USER OR HOST STANDS IN THE PRODUCTS THE PROJECT IS
 * CONNECTED TO (#10340): the accounts in Okta, Microsoft Entra ID and Google
 * Workspace, the hosts in CrowdStrike Falcon and Microsoft Defender, read
 * back through the playbooks' own containment path
 * (SecurityPlaybookContainment.readState) - so a suspension made by a
 * playbook, by hand in the product, or by anyone else is seen alike.
 *
 * Every connection of those products the project has switched on is asked,
 * each with the credential its settings hold. A product that cannot be read
 * says why, and is never taken to mean "not contained".
 */

// What one product answered, or why it could not.
export interface ContainmentProductAnswer {
  provider: string;
  reading?: ProductContainmentReading | undefined;
  // Why it could not be read, in the product's or the client's words.
  error?: string | undefined;
}

export interface ContainmentStateReading {
  // Empty when the project has no connection to a product that can read it.
  answers: Array<ContainmentProductAnswer>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : String(error || "unknown error");
}

export default class ContainmentState {
  public static async readUser(data: {
    projectId: ObjectID;
    value: string;
    transport?: ConnectorTransport | undefined;
  }): Promise<ContainmentStateReading> {
    return await this.read({ ...data, providers: USER_STATE_PROVIDERS });
  }

  public static async readHost(data: {
    projectId: ObjectID;
    value: string;
    transport?: ConnectorTransport | undefined;
  }): Promise<ContainmentStateReading> {
    return await this.read({ ...data, providers: HOST_STATE_PROVIDERS });
  }

  private static async read(data: {
    projectId: ObjectID;
    value: string;
    providers: ReadonlyArray<SecurityEventConnectorProvider>;
    transport?: ConnectorTransport | undefined;
  }): Promise<ContainmentStateReading> {
    const connections: Array<SecurityEventConnection> =
      await SecurityEventConnectionService.findBy({
        query: {
          projectId: data.projectId,
          provider: QueryHelper.any([...data.providers]),
          isEnabled: true,
        },
        select: {
          _id: true,
          name: true,
          provider: true,
          config: true,
          secrets: true,
          alertingOnly: true,
        },
        skip: 0,
        limit: 10,
        props: { isRoot: true },
      });
    const answers: Array<ContainmentProductAnswer> = [];

    for (const connection of connections) {
      if (!connection.provider) {
        continue;
      }

      const provider: string =
        PRODUCT_NAMES[connection.provider] || connection.provider;

      try {
        answers.push({
          provider,
          reading: await SecurityPlaybookContainment.readState({
            provider: connection.provider,
            settings:
              await SecurityEventConnectionService.getConnectorSettings(
                connection,
              ),
            value: data.value,
            transport: data.transport,
          }),
        });
      } catch (error) {
        answers.push({ provider, error: errorMessage(error) });
      }
    }

    return { answers };
  }
}
