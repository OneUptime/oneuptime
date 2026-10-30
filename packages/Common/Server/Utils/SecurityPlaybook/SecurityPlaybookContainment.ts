import SecurityEventConnection from "../../../Models/DatabaseModels/SecurityEventConnection";
import { SecurityCaseFeedEventType } from "../../../Models/DatabaseModels/SecurityCaseFeed";
import { SecurityEntityType } from "../../../Types/SecurityCase/SecurityEntity";
import SecurityEventConnectorProvider from "../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import {
  SecurityPlaybookActionDefinition,
  SecurityPlaybookActionType,
  getSecurityPlaybookAction,
  getSecurityPlaybookUndoAction,
} from "../../../Types/SecurityPlaybook/SecurityPlaybookAction";
import { SecurityPlaybookStepStatus } from "../../../Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import { DefenderIsolationType } from "../../../Types/SecurityPlaybook/SecurityPlaybookStep";
import {
  SecurityPlaybookTarget,
  SecurityPlaybookTargetReason,
  SecurityPlaybookTargetState,
} from "../../../Types/SecurityPlaybook/SecurityPlaybookStepResult";
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
import GoogleWorkspaceResponseClient, {
  GoogleWorkspaceContainmentOutcome,
  GoogleWorkspaceUser,
} from "../SecurityEvent/Response/GoogleWorkspaceResponseClient";
import MicrosoftDefenderEndpointClient, {
  DefenderMachine,
} from "../SecurityEvent/Response/MicrosoftDefenderEndpointClient";
import MicrosoftEntraIdResponseClient, {
  EntraIdContainmentOutcome,
  EntraIdUser,
} from "../SecurityEvent/Response/MicrosoftEntraIdResponseClient";
import OktaResponseClient, {
  OktaContainmentOutcome,
  OktaUser,
} from "../SecurityEvent/Response/OktaResponseClient";
import type { PlaybookStepOutcome } from "./SecurityPlaybookActions";

// The most users or hosts one containment step acts on.
export const CONTAINMENT_ENTITY_LIMIT: number = 10;

// What became of one target in the product.
export interface ContainmentTargetOutcome {
  state:
    | SecurityPlaybookTargetState.Done
    | SecurityPlaybookTargetState.AlreadyDone
    | SecurityPlaybookTargetState.NotFound
    | SecurityPlaybookTargetState.Failed;
  // In a few words: "suspended", "already suspended", "not found in Okta".
  detail: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : String(error || "unknown error");
}

function nounFor(entityType: SecurityEntityType | undefined): string {
  return entityType === SecurityEntityType.User ? "user" : "host";
}

// What the step result says of a target, after its value.
export function describeTarget(target: SecurityPlaybookTarget): string {
  switch (target.state) {
    case SecurityPlaybookTargetState.Protected:
      return target.protectedBy &&
        target.protectedBy.toLowerCase() !== target.value.toLowerCase()
        ? `protected (matches ${target.protectedBy})`
        : "protected";
    case SecurityPlaybookTargetState.LeftOut:
      return "left out by the approver";
    case SecurityPlaybookTargetState.Proposed:
      return target.reason === SecurityPlaybookTargetReason.ThreatIntel
        ? "known to threat intel"
        : "what the case is grouped on";
    default:
      return target.detail || target.state.toLowerCase();
  }
}

/*
 * The containment steps and their undos: suspending and unsuspending
 * accounts and ending their sessions in Okta, disabling and enabling them
 * and signing them out in Microsoft Entra ID, suspending and unsuspending
 * them and signing them out in Google Workspace, network-containing hosts
 * and lifting it in CrowdStrike Falcon, isolating devices and releasing them
 * in Microsoft Defender. Each acts through one of the project's security event
 * connections - the credential its settings hold - on the targets the step
 * picked (SecurityPlaybookTargets) that are still to act on, and says what
 * it did with each: done, already done, not found in the product, or failed
 * and why. A protected target, or one the approver left out, is reported as
 * such and never sent to the product.
 *
 * A step succeeds when it acted on everything it found; it fails when any
 * target failed, or when it found none of them in the product at all - an
 * analyst reading "Succeeded" must be able to trust that the account is
 * suspended.
 */
export default class SecurityPlaybookContainment {
  public static async run(data: {
    action: SecurityPlaybookActionType;
    connection: SecurityEventConnection;
    settings: SecurityConnectorSettings;
    targets: Array<SecurityPlaybookTarget>;
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

    const toActOn: Array<SecurityPlaybookTarget> = data.targets.filter(
      (target: SecurityPlaybookTarget): boolean => {
        return target.state === SecurityPlaybookTargetState.Proposed;
      },
    );

    if (toActOn.length === 0) {
      return {
        status: SecurityPlaybookStepStatus.Skipped,
        summary: this.describeNothingToActOn({
          entityType: definition.entityType,
          targets: data.targets,
        }),
        targets: data.targets,
      };
    }

    let outcomes: Map<string, ContainmentTargetOutcome>;

    try {
      outcomes = await this.act({
        definition,
        settings: data.settings,
        values: toActOn.map((target: SecurityPlaybookTarget): string => {
          return target.value;
        }),
        transport: data.transport || DataSourceHttpFetch.fetch,
        isolationType: data.isolationType,
        caseNumber: data.caseNumber,
      });
    } catch (error) {
      // A failure before any target: the token, the connection's settings.
      return { ...this.failure(errorMessage(error)), targets: data.targets };
    }

    const targets: Array<SecurityPlaybookTarget> = data.targets.map(
      (target: SecurityPlaybookTarget): SecurityPlaybookTarget => {
        const outcome: ContainmentTargetOutcome | undefined =
          target.state === SecurityPlaybookTargetState.Proposed
            ? outcomes.get(target.value)
            : undefined;

        return outcome
          ? { ...target, state: outcome.state, detail: outcome.detail }
          : target;
      },
    );

    return this.summarize({ definition, targets });
  }

  /*
   * Releases one contained target of a containment step with the step's
   * undo - unsuspends the account, lifts the containment, releases the
   * device - through the same connection: the one-click on a contained
   * target's row. Throws when nothing undoes the step.
   */
  public static async undo(data: {
    action: SecurityPlaybookActionType;
    connection: SecurityEventConnection;
    settings: SecurityConnectorSettings;
    value: string;
    caseNumber: string;
    transport?: ConnectorTransport | undefined;
  }): Promise<ContainmentTargetOutcome> {
    const undo: SecurityPlaybookActionDefinition | undefined =
      getSecurityPlaybookUndoAction(data.action);

    if (!undo?.connectionProvider) {
      throw new Error(`Nothing undoes "${data.action}".`);
    }

    if (data.connection.provider !== undo.connectionProvider) {
      throw new Error(
        `The connection "${data.connection.name || ""}" is not a connection to the product this step acted through.`,
      );
    }

    const outcomes: Map<string, ContainmentTargetOutcome> = await this.act({
      definition: undo,
      settings: data.settings,
      values: [data.value],
      transport: data.transport || DataSourceHttpFetch.fetch,
      isolationType: DefenderIsolationType.Full,
      caseNumber: data.caseNumber,
    });

    return (
      outcomes.get(data.value) || {
        state: SecurityPlaybookTargetState.Failed,
        detail: "the product said nothing about it",
      }
    );
  }

  // What a step with nothing left to act on says: why there is nothing.
  public static describeNothingToActOn(data: {
    entityType: SecurityEntityType;
    targets: Array<SecurityPlaybookTarget>;
  }): MarkdownText {
    const noun: string = nounFor(data.entityType);
    const kept: Array<SecurityPlaybookTarget> = data.targets.filter(
      (target: SecurityPlaybookTarget): boolean => {
        return (
          target.state === SecurityPlaybookTargetState.Protected ||
          target.state === SecurityPlaybookTargetState.LeftOut
        );
      },
    );

    if (kept.length === 0) {
      return mdText`No ${noun} to act on: no detection of the case is grouped on a ${noun}, and threat intel knows none of its ${noun}s.`;
    }

    return mdText`No ${noun} to act on: ${FeedMarkdown.join(
      kept.map((target: SecurityPlaybookTarget): MarkdownText => {
        return mdText`${FeedMarkdown.code(target.value)} is ${describeTarget(target)}`;
      }),
    )}.`;
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
    targets: Array<SecurityPlaybookTarget>;
  }): PlaybookStepOutcome {
    const actedOn: Array<SecurityPlaybookTarget> = data.targets.filter(
      (target: SecurityPlaybookTarget): boolean => {
        return (
          target.state === SecurityPlaybookTargetState.Done ||
          target.state === SecurityPlaybookTargetState.AlreadyDone
        );
      },
    );
    const failures: Array<SecurityPlaybookTarget> = data.targets.filter(
      (target: SecurityPlaybookTarget): boolean => {
        return target.state === SecurityPlaybookTargetState.Failed;
      },
    );
    const notFound: Array<SecurityPlaybookTarget> = data.targets.filter(
      (target: SecurityPlaybookTarget): boolean => {
        return target.state === SecurityPlaybookTargetState.NotFound;
      },
    );

    const details: MarkdownText = FeedMarkdown.bulletList(
      data.targets.map((target: SecurityPlaybookTarget): MarkdownValue => {
        return mdText`${FeedMarkdown.code(target.value)}: ${describeTarget(target)}`;
      }),
    );

    const summary: MarkdownText =
      actedOn.length > 0
        ? mdText`${data.definition.title}: done for ${FeedMarkdown.join(
            actedOn.map((target: SecurityPlaybookTarget): MarkdownText => {
              return FeedMarkdown.code(target.value);
            }),
          )}${failures.length > 0 ? mdText`; ${String(failures.length)} could not be` : FeedMarkdown.empty()}.`
        : mdText`${data.definition.title}: no ${nounFor(data.definition.entityType)} of the case could be acted on.`;

    if (failures.length > 0 || actedOn.length === 0) {
      return {
        status: SecurityPlaybookStepStatus.Failed,
        summary,
        detailsInMarkdown: details,
        feedEventType: SecurityCaseFeedEventType.ResponseAction,
        targets: data.targets,
        error: [...failures, ...notFound]
          .map((target: SecurityPlaybookTarget): string => {
            return `${target.value}: ${describeTarget(target)}`;
          })
          .join(" "),
      };
    }

    return {
      status: SecurityPlaybookStepStatus.Succeeded,
      summary,
      detailsInMarkdown: details,
      feedEventType: SecurityCaseFeedEventType.ResponseAction,
      targets: data.targets,
    };
  }

  // Acts on each value in the action's product, by value.
  private static async act(data: {
    definition: SecurityPlaybookActionDefinition;
    settings: SecurityConnectorSettings;
    values: Array<string>;
    transport: ConnectorTransport;
    isolationType: DefenderIsolationType;
    caseNumber: string;
  }): Promise<Map<string, ContainmentTargetOutcome>> {
    switch (data.definition.connectionProvider) {
      case SecurityEventConnectorProvider.OktaSystemLog:
        return await this.actInOkta(data);
      case SecurityEventConnectorProvider.CrowdStrikeFalcon:
        return await this.actInCrowdStrike(data);
      case SecurityEventConnectorProvider.MicrosoftDefenderXdr:
        return await this.actInDefender(data);
      case SecurityEventConnectorProvider.MicrosoftEntraId:
        return await this.actInEntraId(data);
      case SecurityEventConnectorProvider.GoogleWorkspace:
        return await this.actInGoogleWorkspace(data);
      default:
        throw new Error("This product cannot contain anything yet.");
    }
  }

  /*
   * A user's account in Microsoft Entra ID, found by its sign-in name or
   * mail address: disabled or enabled (accountEnabled), or signed out of
   * every session (revokeSignInSessions).
   */
  private static async actInEntraId(data: {
    definition: SecurityPlaybookActionDefinition;
    settings: SecurityConnectorSettings;
    values: Array<string>;
    transport: ConnectorTransport;
  }): Promise<Map<string, ContainmentTargetOutcome>> {
    const client: MicrosoftEntraIdResponseClient =
      new MicrosoftEntraIdResponseClient({
        tenantId: readSettingString(data.settings.config, "tenantId"),
        clientId: readSettingString(data.settings.config, "clientId"),
        clientSecret: readSettingString(data.settings.secrets, "clientSecret"),
        cloud: readSettingString(data.settings.config, "cloud") || "public",
        transport: data.transport,
      });

    const outcomes: Map<string, ContainmentTargetOutcome> = new Map();

    for (const value of data.values) {
      try {
        const user: EntraIdUser | null = await client.findUser(value);

        if (!user) {
          outcomes.set(value, {
            state: SecurityPlaybookTargetState.NotFound,
            detail: "not found in Microsoft Entra ID",
          });
          continue;
        }

        let outcome: EntraIdContainmentOutcome;
        let done: string;
        let already: string;

        switch (data.definition.type) {
          case SecurityPlaybookActionType.DisableEntraIdUser:
            outcome = await client.disableUser(user);
            done = "disabled";
            already = "already disabled";
            break;
          case SecurityPlaybookActionType.EnableEntraIdUser:
            outcome = await client.enableUser(user);
            done = "enabled";
            already = "not disabled";
            break;
          default:
            outcome = await client.signOut(user);
            done = "signed out everywhere";
            already = done;
        }

        outcomes.set(
          value,
          outcome === EntraIdContainmentOutcome.AlreadyDone
            ? {
                state: SecurityPlaybookTargetState.AlreadyDone,
                detail: already,
              }
            : { state: SecurityPlaybookTargetState.Done, detail: done },
        );
      } catch (error) {
        outcomes.set(value, {
          state: SecurityPlaybookTargetState.Failed,
          detail: errorMessage(error),
        });
      }
    }

    return outcomes;
  }

  /*
   * A user's account in Google Workspace, found by its primary email or an
   * alias: suspended or unsuspended, or signed out of every session.
   */
  private static async actInGoogleWorkspace(data: {
    definition: SecurityPlaybookActionDefinition;
    settings: SecurityConnectorSettings;
    values: Array<string>;
    transport: ConnectorTransport;
  }): Promise<Map<string, ContainmentTargetOutcome>> {
    const outcomes: Map<string, ContainmentTargetOutcome> = new Map();
    let client: GoogleWorkspaceResponseClient;

    try {
      client = new GoogleWorkspaceResponseClient({
        serviceAccountJson: readSettingString(
          data.settings.secrets,
          "serviceAccountJson",
        ),
        adminEmail: readSettingString(data.settings.config, "adminEmail"),
        transport: data.transport,
      });
    } catch (error) {
      // The connection's key no longer reads: every target fails the same way.
      for (const value of data.values) {
        outcomes.set(value, {
          state: SecurityPlaybookTargetState.Failed,
          detail: errorMessage(error),
        });
      }

      return outcomes;
    }

    for (const value of data.values) {
      try {
        const user: GoogleWorkspaceUser | null = await client.findUser(value);

        if (!user) {
          outcomes.set(value, {
            state: SecurityPlaybookTargetState.NotFound,
            detail: "not found in Google Workspace",
          });
          continue;
        }

        let outcome: GoogleWorkspaceContainmentOutcome;
        let done: string;
        let already: string;

        switch (data.definition.type) {
          case SecurityPlaybookActionType.SuspendGoogleWorkspaceUser:
            outcome = await client.suspendUser(user);
            done = "suspended";
            already = "already suspended";
            break;
          case SecurityPlaybookActionType.UnsuspendGoogleWorkspaceUser:
            outcome = await client.unsuspendUser(user);
            done = "unsuspended";
            already = "not suspended";
            break;
          default:
            outcome = await client.signOut(user);
            done = "signed out everywhere";
            already = done;
        }

        outcomes.set(
          value,
          outcome === GoogleWorkspaceContainmentOutcome.AlreadyDone
            ? {
                state: SecurityPlaybookTargetState.AlreadyDone,
                detail: already,
              }
            : { state: SecurityPlaybookTargetState.Done, detail: done },
        );
      } catch (error) {
        outcomes.set(value, {
          state: SecurityPlaybookTargetState.Failed,
          detail: errorMessage(error),
        });
      }
    }

    return outcomes;
  }

  private static async actInOkta(data: {
    definition: SecurityPlaybookActionDefinition;
    settings: SecurityConnectorSettings;
    values: Array<string>;
    transport: ConnectorTransport;
  }): Promise<Map<string, ContainmentTargetOutcome>> {
    const client: OktaResponseClient = new OktaResponseClient({
      orgUrl: readSettingString(data.settings.config, "orgUrl"),
      apiToken: readSettingString(data.settings.secrets, "apiToken"),
      transport: data.transport,
    });

    const outcomes: Map<string, ContainmentTargetOutcome> = new Map();

    for (const value of data.values) {
      try {
        const user: OktaUser | null = await client.findUser(value);

        if (!user) {
          outcomes.set(value, {
            state: SecurityPlaybookTargetState.NotFound,
            detail: "not found in Okta",
          });
          continue;
        }

        let outcome: OktaContainmentOutcome;
        let done: string;
        let already: string;

        switch (data.definition.type) {
          case SecurityPlaybookActionType.SuspendOktaUser:
            outcome = await client.suspendUser(user);
            done = "suspended";
            already = "already suspended";
            break;
          case SecurityPlaybookActionType.UnsuspendOktaUser:
            outcome = await client.unsuspendUser(user);
            done = "unsuspended";
            already = "not suspended";
            break;
          default:
            outcome = await client.endSessions(user);
            done = "signed out everywhere";
            already = done;
        }

        outcomes.set(
          value,
          outcome === OktaContainmentOutcome.AlreadyDone
            ? {
                state: SecurityPlaybookTargetState.AlreadyDone,
                detail: already,
              }
            : { state: SecurityPlaybookTargetState.Done, detail: done },
        );
      } catch (error) {
        outcomes.set(value, {
          state: SecurityPlaybookTargetState.Failed,
          detail: errorMessage(error),
        });
      }
    }

    return outcomes;
  }

  private static async actInCrowdStrike(data: {
    definition: SecurityPlaybookActionDefinition;
    settings: SecurityConnectorSettings;
    values: Array<string>;
    transport: ConnectorTransport;
  }): Promise<Map<string, ContainmentTargetOutcome>> {
    const client: CrowdStrikeFalconResponseClient =
      new CrowdStrikeFalconResponseClient({
        cloud: readSettingString(data.settings.config, "cloud") || "us-1",
        clientId: readSettingString(data.settings.config, "clientId"),
        clientSecret: readSettingString(data.settings.secrets, "clientSecret"),
        transport: data.transport,
      });

    const isLift: boolean =
      data.definition.type ===
      SecurityPlaybookActionType.LiftCrowdStrikeContainment;
    const done: string = isLift ? "containment lifted" : "contained";
    const outcomes: Map<string, ContainmentTargetOutcome> = new Map();

    for (const value of data.values) {
      try {
        const deviceIds: Array<string> = await client.findDeviceIds(value);

        if (deviceIds.length === 0) {
          outcomes.set(value, {
            state: SecurityPlaybookTargetState.NotFound,
            detail: "not found in CrowdStrike Falcon",
          });
          continue;
        }

        if (isLift) {
          await client.liftContainment(deviceIds);
        } else {
          await client.containDevices(deviceIds);
        }

        outcomes.set(value, {
          state: SecurityPlaybookTargetState.Done,
          detail:
            deviceIds.length === 1
              ? done
              : `${done} (${deviceIds.length} devices with this hostname)`,
        });
      } catch (error) {
        outcomes.set(value, {
          state: SecurityPlaybookTargetState.Failed,
          detail: errorMessage(error),
        });
      }
    }

    return outcomes;
  }

  private static async actInDefender(data: {
    definition: SecurityPlaybookActionDefinition;
    settings: SecurityConnectorSettings;
    values: Array<string>;
    transport: ConnectorTransport;
    isolationType: DefenderIsolationType;
    caseNumber: string;
  }): Promise<Map<string, ContainmentTargetOutcome>> {
    const client: MicrosoftDefenderEndpointClient =
      new MicrosoftDefenderEndpointClient({
        tenantId: readSettingString(data.settings.config, "tenantId"),
        clientId: readSettingString(data.settings.config, "clientId"),
        clientSecret: readSettingString(data.settings.secrets, "clientSecret"),
        cloud: readSettingString(data.settings.config, "cloud") || "public",
        transport: data.transport,
      });

    const isRelease: boolean =
      data.definition.type === SecurityPlaybookActionType.ReleaseDefenderDevice;
    const outcomes: Map<string, ContainmentTargetOutcome> = new Map();

    for (const value of data.values) {
      try {
        const machines: Array<DefenderMachine> =
          await client.findMachines(value);

        if (machines.length === 0) {
          outcomes.set(value, {
            state: SecurityPlaybookTargetState.NotFound,
            detail: "not found in Microsoft Defender",
          });
          continue;
        }

        for (const machine of machines) {
          if (isRelease) {
            await client.releaseMachine({
              machineId: machine.id,
              comment: `Released by OneUptime for security case ${data.caseNumber}.`,
            });
          } else {
            await client.isolateMachine({
              machineId: machine.id,
              isolationType: data.isolationType,
              comment: `Isolated by a OneUptime playbook for security case ${data.caseNumber}.`,
            });
          }
        }

        outcomes.set(value, {
          state: SecurityPlaybookTargetState.Done,
          detail: isRelease
            ? "released from isolation"
            : `isolated (${data.isolationType.toLowerCase()})`,
        });
      } catch (error) {
        outcomes.set(value, {
          state: SecurityPlaybookTargetState.Failed,
          detail: errorMessage(error),
        });
      }
    }

    return outcomes;
  }
}
