import SecurityEventConnection from "../../../../../Models/DatabaseModels/SecurityEventConnection";
import ObjectID from "../../../../../Types/ObjectID";
import SecurityEventConnectorProvider from "../../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import SecurityEventConnectionService from "../../../../Services/SecurityEventConnectionService";
import QueryHelper from "../../../../Types/Database/QueryHelper";
import {
  ConnectorTransport,
  SecurityConnectorSettings,
} from "../../../SecurityEvent/Connectors/Types";
import SecurityPlaybookContainment, {
  AccountFixFacts,
  PRODUCT_NAMES,
  USER_STATE_PROVIDERS,
} from "../../../SecurityPlaybook/SecurityPlaybookContainment";

/*
 * WHAT THE FIX STEPS ABOUT AN ACCOUNT READ BACK (#10347): whether its
 * password was reset and its sessions ended since the case opened, and
 * whether it has MFA, in Okta, Microsoft Entra ID and Google Workspace,
 * through the playbooks' own read-back path (SecurityPlaybookContainment) -
 * so a reset made by a playbook, by hand in the product or by the account's
 * owner is seen alike.
 *
 * Every connection of those products the project has switched on is asked.
 * A product that cannot be read says why, and is never taken to mean "not
 * done".
 */

// What one product answered, or why it could not.
export interface AccountProductAnswer {
  provider: string;
  // The account as the product holds it; null when it has none.
  facts?: AccountFixFacts | null | undefined;
  // Why it could not be read, in the product's or the client's words.
  error?: string | undefined;
}

export interface AccountFixReading {
  // Empty when the project has no connection to a product that can read it.
  answers: Array<AccountProductAnswer>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : String(error || "unknown error");
}

export default class AccountFixState {
  public static async readCredentials(data: {
    projectId: ObjectID;
    value: string;
    since: Date;
    now: Date;
    transport?: ConnectorTransport | undefined;
  }): Promise<AccountFixReading> {
    return await this.read({
      projectId: data.projectId,
      read: (
        provider: SecurityEventConnectorProvider,
        settings: SecurityConnectorSettings,
      ): Promise<AccountFixFacts | null> => {
        return SecurityPlaybookContainment.readAccountCredentials({
          provider,
          settings,
          value: data.value,
          since: data.since,
          now: data.now,
          transport: data.transport,
        });
      },
    });
  }

  public static async readMfa(data: {
    projectId: ObjectID;
    value: string;
    transport?: ConnectorTransport | undefined;
  }): Promise<AccountFixReading> {
    return await this.read({
      projectId: data.projectId,
      read: (
        provider: SecurityEventConnectorProvider,
        settings: SecurityConnectorSettings,
      ): Promise<AccountFixFacts | null> => {
        return SecurityPlaybookContainment.readAccountMfa({
          provider,
          settings,
          value: data.value,
          transport: data.transport,
        });
      },
    });
  }

  private static async read(data: {
    projectId: ObjectID;
    read: (
      provider: SecurityEventConnectorProvider,
      settings: SecurityConnectorSettings,
    ) => Promise<AccountFixFacts | null>;
  }): Promise<AccountFixReading> {
    const connections: Array<SecurityEventConnection> =
      await SecurityEventConnectionService.findBy({
        query: {
          projectId: data.projectId,
          provider: QueryHelper.any([...USER_STATE_PROVIDERS]),
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
    const answers: Array<AccountProductAnswer> = [];

    for (const connection of connections) {
      if (!connection.provider) {
        continue;
      }

      const provider: string =
        PRODUCT_NAMES[connection.provider] || connection.provider;

      try {
        answers.push({
          provider,
          facts: await data.read(
            connection.provider,
            await SecurityEventConnectionService.getConnectorSettings(
              connection,
            ),
          ),
        });
      } catch (error) {
        answers.push({ provider, error: errorMessage(error) });
      }
    }

    return { answers };
  }
}
