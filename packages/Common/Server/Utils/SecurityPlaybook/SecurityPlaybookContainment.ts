import SecurityEventConnection from "../../../Models/DatabaseModels/SecurityEventConnection";
import { SecurityCaseFeedEventType } from "../../../Models/DatabaseModels/SecurityCaseFeed";
import {
  SecurityEntity,
  SecurityEntityType,
} from "../../../Types/SecurityCase/SecurityEntity";
import SecurityEventConnectorProvider from "../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import {
  SecurityPlaybookActionDefinition,
  SecurityPlaybookActionType,
  getSecurityPlaybookAction,
} from "../../../Types/SecurityPlaybook/SecurityPlaybookAction";
import { SecurityPlaybookStepStatus } from "../../../Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import { DefenderIsolationType } from "../../../Types/SecurityPlaybook/SecurityPlaybookStep";
import FeedMarkdown, {
  MarkdownText,
  MarkdownValue,
  mdText,
} from "../../../Utils/Markdown/FeedMarkdown";
import DataSourceHttpFetch from "../DataSource/HttpFetch";
import {
  ConnectorTransport,
  SecurityConnectorSettings,
  readSettingString,
} from "../SecurityEvent/Connectors/Types";
import CrowdStrikeFalconResponseClient from "../SecurityEvent/Response/CrowdStrikeFalconResponseClient";
import MicrosoftDefenderEndpointClient, {
  DefenderMachine,
} from "../SecurityEvent/Response/MicrosoftDefenderEndpointClient";
import OktaResponseClient, {
  OktaContainmentOutcome,
  OktaUser,
} from "../SecurityEvent/Response/OktaResponseClient";
import type { PlaybookStepOutcome } from "./SecurityPlaybookActions";

// The most users or hosts one containment step acts on.
export const CONTAINMENT_ENTITY_LIMIT: number = 10;

interface EntityResult {
  value: string;
  // What happened to it, in a few words: "suspended", "already suspended", "not found in Okta".
  result: string;
  isFailure: boolean;
  // The entity was acted on (or already was).
  isContained: boolean;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : String(error || "unknown error");
}

/*
 * The containment steps: suspending accounts and ending their sessions in
 * Okta, network-containing hosts in CrowdStrike Falcon, isolating devices in
 * Microsoft Defender. Each acts through one of the project's security event
 * connections - the credential its settings hold - on the case's users or
 * hosts, at most CONTAINMENT_ENTITY_LIMIT of them, and says what it did with
 * each: done, already done, not found in the product, or failed and why.
 *
 * A step succeeds when it contained everything it found; it fails when any
 * entity failed, or when it found none of them in the product at all - an
 * analyst reading "Succeeded" must be able to trust that the account is
 * suspended.
 */
export default class SecurityPlaybookContainment {
  public static async run(data: {
    action: SecurityPlaybookActionType;
    connection: SecurityEventConnection;
    settings: SecurityConnectorSettings;
    entities: Array<SecurityEntity>;
    caseNumber: string;
    isolationType: DefenderIsolationType;
    transport?: ConnectorTransport | undefined;
  }): Promise<PlaybookStepOutcome> {
    const definition: SecurityPlaybookActionDefinition | undefined =
      getSecurityPlaybookAction(data.action);

    if (!definition?.connectionProvider || !definition.entityType) {
      return this.failure(`"${data.action}" is not a containment action.`);
    }

    if (data.connection.provider !== definition.connectionProvider) {
      return this.failure(
        `The connection "${data.connection.name || ""}" is not a connection to the product this step acts through.`,
      );
    }

    const targets: Array<string> = data.entities
      .filter((entity: SecurityEntity): boolean => {
        return entity.type === definition.entityType;
      })
      .map((entity: SecurityEntity): string => {
        return entity.value;
      })
      .slice(0, CONTAINMENT_ENTITY_LIMIT);

    const noun: string =
      definition.entityType === SecurityEntityType.User ? "user" : "host";

    if (targets.length === 0) {
      return {
        status: SecurityPlaybookStepStatus.Skipped,
        summary: mdText`The case names no ${noun} to act on.`,
      };
    }

    const transport: ConnectorTransport =
      data.transport || DataSourceHttpFetch.fetch;

    let results: Array<EntityResult>;

    try {
      switch (definition.connectionProvider) {
        case SecurityEventConnectorProvider.OktaSystemLog:
          results = await this.runOkta({
            action: data.action,
            settings: data.settings,
            targets,
            transport,
          });
          break;
        case SecurityEventConnectorProvider.CrowdStrikeFalcon:
          results = await this.runCrowdStrike({
            settings: data.settings,
            targets,
            transport,
          });
          break;
        case SecurityEventConnectorProvider.MicrosoftDefenderXdr:
          results = await this.runDefender({
            settings: data.settings,
            targets,
            transport,
            isolationType: data.isolationType,
            comment: `Isolated by a OneUptime playbook for security case ${data.caseNumber}.`,
          });
          break;
        default:
          return this.failure("This product cannot contain anything yet.");
      }
    } catch (error) {
      // A failure before any entity: the token, the connection's settings.
      return this.failure(errorMessage(error));
    }

    return this.summarize({ definition, results, noun });
  }

  private static failure(error: string): PlaybookStepOutcome {
    return {
      status: SecurityPlaybookStepStatus.Failed,
      summary: FeedMarkdown.empty(),
      error,
    };
  }

  private static summarize(data: {
    definition: SecurityPlaybookActionDefinition;
    results: Array<EntityResult>;
    noun: string;
  }): PlaybookStepOutcome {
    const contained: Array<EntityResult> = data.results.filter(
      (item: EntityResult): boolean => {
        return item.isContained;
      },
    );
    const failures: Array<EntityResult> = data.results.filter(
      (item: EntityResult): boolean => {
        return item.isFailure;
      },
    );

    const details: MarkdownText = FeedMarkdown.bulletList(
      data.results.map((item: EntityResult): MarkdownValue => {
        return mdText`${FeedMarkdown.code(item.value)}: ${item.result}`;
      }),
    );

    const summary: MarkdownText =
      contained.length > 0
        ? mdText`${data.definition.title}: done for ${FeedMarkdown.join(
            contained.map((item: EntityResult): MarkdownText => {
              return FeedMarkdown.code(item.value);
            }),
          )}${failures.length > 0 ? mdText`; ${String(failures.length)} could not be` : FeedMarkdown.empty()}.`
        : mdText`${data.definition.title}: no ${data.noun} of the case could be acted on.`;

    if (failures.length > 0 || contained.length === 0) {
      return {
        status: SecurityPlaybookStepStatus.Failed,
        summary,
        detailsInMarkdown: details,
        feedEventType: SecurityCaseFeedEventType.ResponseAction,
        error: data.results
          .filter((item: EntityResult): boolean => {
            return !item.isContained;
          })
          .map((item: EntityResult): string => {
            return `${item.value}: ${item.result}`;
          })
          .join(" "),
      };
    }

    return {
      status: SecurityPlaybookStepStatus.Succeeded,
      summary,
      detailsInMarkdown: details,
      feedEventType: SecurityCaseFeedEventType.ResponseAction,
    };
  }

  private static async runOkta(data: {
    action: SecurityPlaybookActionType;
    settings: SecurityConnectorSettings;
    targets: Array<string>;
    transport: ConnectorTransport;
  }): Promise<Array<EntityResult>> {
    const client: OktaResponseClient = new OktaResponseClient({
      orgUrl: readSettingString(data.settings.config, "orgUrl"),
      apiToken: readSettingString(data.settings.secrets, "apiToken"),
      transport: data.transport,
    });

    const isSuspend: boolean =
      data.action === SecurityPlaybookActionType.SuspendOktaUser;
    const results: Array<EntityResult> = [];

    for (const target of data.targets) {
      try {
        const user: OktaUser | null = await client.findUser(target);

        if (!user) {
          results.push({
            value: target,
            result: "not found in Okta",
            isFailure: false,
            isContained: false,
          });
          continue;
        }

        const outcome: OktaContainmentOutcome = isSuspend
          ? await client.suspendUser(user)
          : await client.endSessions(user);

        results.push({
          value: target,
          result:
            outcome === OktaContainmentOutcome.AlreadyDone
              ? "already suspended"
              : isSuspend
                ? "suspended"
                : "signed out everywhere",
          isFailure: false,
          isContained: true,
        });
      } catch (error) {
        results.push({
          value: target,
          result: errorMessage(error),
          isFailure: true,
          isContained: false,
        });
      }
    }

    return results;
  }

  private static async runCrowdStrike(data: {
    settings: SecurityConnectorSettings;
    targets: Array<string>;
    transport: ConnectorTransport;
  }): Promise<Array<EntityResult>> {
    const client: CrowdStrikeFalconResponseClient =
      new CrowdStrikeFalconResponseClient({
        cloud: readSettingString(data.settings.config, "cloud") || "us-1",
        clientId: readSettingString(data.settings.config, "clientId"),
        clientSecret: readSettingString(data.settings.secrets, "clientSecret"),
        transport: data.transport,
      });

    const results: Array<EntityResult> = [];

    for (const target of data.targets) {
      try {
        const deviceIds: Array<string> = await client.findDeviceIds(target);

        if (deviceIds.length === 0) {
          results.push({
            value: target,
            result: "not found in CrowdStrike Falcon",
            isFailure: false,
            isContained: false,
          });
          continue;
        }

        await client.containDevices(deviceIds);

        results.push({
          value: target,
          result:
            deviceIds.length === 1
              ? "contained"
              : `contained (${deviceIds.length} devices with this hostname)`,
          isFailure: false,
          isContained: true,
        });
      } catch (error) {
        results.push({
          value: target,
          result: errorMessage(error),
          isFailure: true,
          isContained: false,
        });
      }
    }

    return results;
  }

  private static async runDefender(data: {
    settings: SecurityConnectorSettings;
    targets: Array<string>;
    transport: ConnectorTransport;
    isolationType: DefenderIsolationType;
    comment: string;
  }): Promise<Array<EntityResult>> {
    const client: MicrosoftDefenderEndpointClient =
      new MicrosoftDefenderEndpointClient({
        tenantId: readSettingString(data.settings.config, "tenantId"),
        clientId: readSettingString(data.settings.config, "clientId"),
        clientSecret: readSettingString(data.settings.secrets, "clientSecret"),
        cloud: readSettingString(data.settings.config, "cloud") || "public",
        transport: data.transport,
      });

    const results: Array<EntityResult> = [];

    for (const target of data.targets) {
      try {
        const machines: Array<DefenderMachine> =
          await client.findMachines(target);

        if (machines.length === 0) {
          results.push({
            value: target,
            result: "not found in Microsoft Defender",
            isFailure: false,
            isContained: false,
          });
          continue;
        }

        for (const machine of machines) {
          await client.isolateMachine({
            machineId: machine.id,
            isolationType: data.isolationType,
            comment: data.comment,
          });
        }

        results.push({
          value: target,
          result: `isolated (${data.isolationType.toLowerCase()})`,
          isFailure: false,
          isContained: true,
        });
      } catch (error) {
        results.push({
          value: target,
          result: errorMessage(error),
          isFailure: true,
          isContained: false,
        });
      }
    }

    return results;
  }
}
