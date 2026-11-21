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

/*
 * Where an account or a host stands in a product, read back - not acted on
 * - for a Response Plan step's check (#10340): contained, on its way, not
 * contained, or not found there at all.
 */
export enum ProductContainment {
  Contained = "Contained",
  Pending = "Pending",
  NotContained = "NotContained",
  NotFound = "NotFound",
}

// How a product holds an account or a host back.
export enum ProductContainmentHow {
  Suspended = "Suspended",
  Disabled = "Disabled",
  NetworkContained = "NetworkContained",
  Isolated = "Isolated",
}

export interface ProductContainmentReading {
  // The product, as it names itself: "Okta", "CrowdStrike Falcon".
  provider: string;
  containment: ProductContainment;
  how?: ProductContainmentHow | undefined;
  // Since when, when the product says.
  since: Date | null;
  // A Microsoft Entra ID account's sessions were last ended then.
  sessionsEndedAt?: Date | null | undefined;
  // The account's or the host's page in the product, https.
  url?: string | undefined;
}

/*
 * What a Fix step's check reads back of an account (#10347): whether its
 * password was reset and its sessions ended after the case opened, and
 * whether it can sign in with a second factor. A field the read did not
 * ask for is null.
 */
export interface AccountFixFacts {
  // The product, as it names itself.
  provider: string;
  // The product says when a password last changed: Google Workspace does not.
  canTellPassword: boolean;
  passwordChangedAt: Date | null;
  // Since when every earlier session and token of the account is ended.
  sessionsEndedAt: Date | null;
  hasMfa: boolean | null;
  // The account's page in the product, https.
  url?: string | undefined;
}

// An account's page in the Microsoft Entra admin center; none outside the public cloud.
export function getEntraIdUserUrl(
  cloud: string,
  userId: string,
): string | undefined {
  return cloud === "public"
    ? `https://entra.microsoft.com/#view/Microsoft_AAD_UsersAndTenants/UserProfileMenuBlade/~/overview/userId/${encodeURIComponent(userId)}`
    : undefined;
}

// The products a user is read back in, and a host, by the connection's provider.
export const USER_STATE_PROVIDERS: ReadonlyArray<SecurityEventConnectorProvider> =
  [
    SecurityEventConnectorProvider.OktaSystemLog,
    SecurityEventConnectorProvider.MicrosoftEntraId,
    SecurityEventConnectorProvider.GoogleWorkspace,
  ];

export const HOST_STATE_PROVIDERS: ReadonlyArray<SecurityEventConnectorProvider> =
  [
    SecurityEventConnectorProvider.CrowdStrikeFalcon,
    SecurityEventConnectorProvider.MicrosoftDefenderXdr,
  ];

export const PRODUCT_NAMES: Partial<
  Record<SecurityEventConnectorProvider, string>
> = {
  [SecurityEventConnectorProvider.OktaSystemLog]: "Okta",
  [SecurityEventConnectorProvider.MicrosoftEntraId]: "Microsoft Entra ID",
  [SecurityEventConnectorProvider.GoogleWorkspace]: "Google Workspace",
  [SecurityEventConnectorProvider.CrowdStrikeFalcon]: "CrowdStrike Falcon",
  [SecurityEventConnectorProvider.MicrosoftDefenderXdr]: "Microsoft Defender",
};

// An org's own admin console, on Okta's domains: acme.okta.com's is acme-admin.okta.com.
const OKTA_ORG_HOST: RegExp =
  /^([a-z0-9-]+?)(-admin)?\.(okta\.com|oktapreview\.com|okta-emea\.com)$/;

// A user's admin page in Okta, for an org on Okta's own domains.
export function getOktaUserUrl(
  orgUrl: string,
  userId: string,
): string | undefined {
  try {
    const host: string = new URL(orgUrl).hostname.toLowerCase();
    const match: RegExpMatchArray | null = host.match(OKTA_ORG_HOST);

    if (!match) {
      return undefined;
    }

    return `https://${match[1]}-admin.${match[3]}/admin/user/profile/view/${encodeURIComponent(userId)}`;
  } catch {
    return undefined;
  }
}

// The Falcon console of each cloud a connection may be on.
const FALCON_CONSOLES: Record<string, string> = {
  "us-1": "https://falcon.crowdstrike.com",
  "us-2": "https://falcon.us-2.crowdstrike.com",
  "eu-1": "https://falcon.eu-1.crowdstrike.com",
  "us-gov-1": "https://falcon.laggar.gcw.crowdstrike.com",
};

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

  /*
   * Where a user's account or a host stands in the product a connection is
   * to, read back without changing anything: what a Response Plan step's
   * check shows as its evidence (#10340). Through the same clients as the
   * containment steps, so every call OneUptime makes to these products is
   * here. Throws when the product cannot be read.
   */
  public static async readState(data: {
    provider: SecurityEventConnectorProvider;
    settings: SecurityConnectorSettings;
    value: string;
    transport?: ConnectorTransport | undefined;
  }): Promise<ProductContainmentReading> {
    const transport: ConnectorTransport =
      data.transport || DataSourceHttpFetch.fetch;
    const provider: string = PRODUCT_NAMES[data.provider] || data.provider;
    const value: string = data.value.trim();
    const notFound: ProductContainmentReading = {
      provider,
      containment: ProductContainment.NotFound,
      since: null,
    };

    switch (data.provider) {
      case SecurityEventConnectorProvider.OktaSystemLog: {
        const orgUrl: string = readSettingString(
          data.settings.config,
          "orgUrl",
        );
        const client: OktaResponseClient = new OktaResponseClient({
          orgUrl,
          apiToken: readSettingString(data.settings.secrets, "apiToken"),
          transport,
        });
        const state: {
          user: OktaUser;
          statusChangedAt: Date | null;
        } | null = await client.readUserState(value);

        if (!state) {
          return notFound;
        }

        const status: string = state.user.status.toUpperCase();
        const isHeld: boolean =
          status === "SUSPENDED" || status === "DEPROVISIONED";

        return {
          provider,
          containment: isHeld
            ? ProductContainment.Contained
            : ProductContainment.NotContained,
          ...(isHeld ? { how: ProductContainmentHow.Suspended } : {}),
          since: isHeld ? state.statusChangedAt : null,
          url: getOktaUserUrl(orgUrl, state.user.id),
        };
      }

      case SecurityEventConnectorProvider.MicrosoftEntraId: {
        const cloud: string =
          readSettingString(data.settings.config, "cloud") || "public";
        const client: MicrosoftEntraIdResponseClient =
          new MicrosoftEntraIdResponseClient({
            tenantId: readSettingString(data.settings.config, "tenantId"),
            clientId: readSettingString(data.settings.config, "clientId"),
            clientSecret: readSettingString(
              data.settings.secrets,
              "clientSecret",
            ),
            cloud,
            transport,
          });
        const user: EntraIdUser | null = await client.findUser(value);

        if (!user) {
          return notFound;
        }

        const url: string | undefined = getEntraIdUserUrl(cloud, user.id);

        if (user.accountEnabled) {
          return {
            provider,
            containment: ProductContainment.NotContained,
            since: null,
            url,
          };
        }

        return {
          provider,
          containment: ProductContainment.Contained,
          how: ProductContainmentHow.Disabled,
          since: null,
          sessionsEndedAt: await client.readSessionsValidFrom(user),
          url,
        };
      }

      case SecurityEventConnectorProvider.GoogleWorkspace: {
        const client: GoogleWorkspaceResponseClient =
          new GoogleWorkspaceResponseClient({
            serviceAccountJson: readSettingString(
              data.settings.secrets,
              "serviceAccountJson",
            ),
            adminEmail: readSettingString(data.settings.config, "adminEmail"),
            transport,
          });
        const user: GoogleWorkspaceUser | null = await client.findUser(value);

        if (!user) {
          return notFound;
        }

        return {
          provider,
          containment: user.suspended
            ? ProductContainment.Contained
            : ProductContainment.NotContained,
          ...(user.suspended ? { how: ProductContainmentHow.Suspended } : {}),
          since: null,
          url: `https://admin.google.com/ac/users/${encodeURIComponent(user.id)}`,
        };
      }

      case SecurityEventConnectorProvider.CrowdStrikeFalcon: {
        const cloud: string =
          readSettingString(data.settings.config, "cloud") || "us-1";
        const client: CrowdStrikeFalconResponseClient =
          new CrowdStrikeFalconResponseClient({
            cloud,
            clientId: readSettingString(data.settings.config, "clientId"),
            clientSecret: readSettingString(
              data.settings.secrets,
              "clientSecret",
            ),
            transport,
          });
        const deviceIds: Array<string> = await client.findDeviceIds(value);

        if (deviceIds.length === 0) {
          return notFound;
        }

        const statuses: Array<{ id: string; status: string }> =
          await client.getContainmentStatuses(deviceIds);
        const falconConsole: string | undefined = FALCON_CONSOLES[cloud];
        const url: string | undefined =
          falconConsole && deviceIds[0]
            ? `${falconConsole}/hosts/hosts/host/${encodeURIComponent(deviceIds[0])}`
            : undefined;

        // Every device with the hostname contained: one left out is a way in.
        if (
          statuses.length > 0 &&
          statuses.every((device: { status: string }): boolean => {
            return device.status === "contained";
          })
        ) {
          return {
            provider,
            containment: ProductContainment.Contained,
            how: ProductContainmentHow.NetworkContained,
            since: null,
            url,
          };
        }

        return {
          provider,
          containment: statuses.some((device: { status: string }): boolean => {
            return device.status === "containment_pending";
          })
            ? ProductContainment.Pending
            : ProductContainment.NotContained,
          since: null,
          url,
        };
      }

      case SecurityEventConnectorProvider.MicrosoftDefenderXdr: {
        const cloud: string =
          readSettingString(data.settings.config, "cloud") || "public";
        const client: MicrosoftDefenderEndpointClient =
          new MicrosoftDefenderEndpointClient({
            tenantId: readSettingString(data.settings.config, "tenantId"),
            clientId: readSettingString(data.settings.config, "clientId"),
            clientSecret: readSettingString(
              data.settings.secrets,
              "clientSecret",
            ),
            cloud,
            transport,
          });
        const machines: Array<DefenderMachine> =
          await client.findMachines(value);

        if (machines.length === 0) {
          return notFound;
        }

        let since: Date | null = null;
        let isEveryOneIsolated: boolean = true;

        for (const machine of machines) {
          const isolation: { isIsolated: boolean; since: Date | null } | null =
            await client.getIsolation(machine.id);

          if (!isolation?.isIsolated) {
            isEveryOneIsolated = false;
            break;
          }

          if (
            isolation.since &&
            (!since || isolation.since.getTime() > since.getTime())
          ) {
            since = isolation.since;
          }
        }

        const portal: string =
          cloud === "usgov"
            ? "https://security.microsoft.us"
            : "https://security.microsoft.com";

        return {
          provider,
          containment: isEveryOneIsolated
            ? ProductContainment.Contained
            : ProductContainment.NotContained,
          ...(isEveryOneIsolated
            ? { how: ProductContainmentHow.Isolated }
            : {}),
          since: isEveryOneIsolated ? since : null,
          url: `${portal}/machines/${encodeURIComponent(machines[0]!.id)}`,
        };
      }

      default:
        throw new Error(
          `OneUptime cannot read an account or a host in ${provider}.`,
        );
    }
  }

  /*
   * Whether an account's password was reset and its sessions ended, read
   * back without changing anything: the Fix step "reset the password"
   * (#10347). Okta says when the password changed (passwordChanged) and its
   * System Log when every session was cleared (user.session.clear, since
   * `since`); Microsoft Entra ID says both of the account
   * (lastPasswordChangeDateTime, signInSessionsValidFromDateTime). Google
   * Workspace's Directory API says neither: it is read as an account
   * OneUptime cannot tell about. Null when the product has no such account;
   * throws when the product cannot be read.
   */
  public static async readAccountCredentials(data: {
    provider: SecurityEventConnectorProvider;
    settings: SecurityConnectorSettings;
    value: string;
    since: Date;
    now: Date;
    transport?: ConnectorTransport | undefined;
  }): Promise<AccountFixFacts | null> {
    const transport: ConnectorTransport =
      data.transport || DataSourceHttpFetch.fetch;
    const provider: string = PRODUCT_NAMES[data.provider] || data.provider;
    const value: string = data.value.trim();

    switch (data.provider) {
      case SecurityEventConnectorProvider.OktaSystemLog: {
        const orgUrl: string = readSettingString(
          data.settings.config,
          "orgUrl",
        );
        const client: OktaResponseClient = new OktaResponseClient({
          orgUrl,
          apiToken: readSettingString(data.settings.secrets, "apiToken"),
          transport,
        });
        const state: {
          user: OktaUser;
          passwordChangedAt: Date | null;
        } | null = await client.readPasswordChanged(value);

        if (!state) {
          return null;
        }

        return {
          provider,
          canTellPassword: true,
          passwordChangedAt: state.passwordChangedAt,
          sessionsEndedAt: await client.readSessionsClearedAt({
            user: state.user,
            since: data.since,
            until: data.now,
          }),
          hasMfa: null,
          url: getOktaUserUrl(orgUrl, state.user.id),
        };
      }

      case SecurityEventConnectorProvider.MicrosoftEntraId: {
        const cloud: string =
          readSettingString(data.settings.config, "cloud") || "public";
        const client: MicrosoftEntraIdResponseClient =
          SecurityPlaybookContainment.entraIdClient(data.settings, transport);
        const user: EntraIdUser | null = await client.findUser(value);

        if (!user) {
          return null;
        }

        const state: {
          passwordChangedAt: Date | null;
          sessionsValidFrom: Date | null;
        } = await client.readCredentialState(user);

        return {
          provider,
          canTellPassword: true,
          passwordChangedAt: state.passwordChangedAt,
          sessionsEndedAt: state.sessionsValidFrom,
          hasMfa: null,
          url: getEntraIdUserUrl(cloud, user.id),
        };
      }

      case SecurityEventConnectorProvider.GoogleWorkspace: {
        const user: GoogleWorkspaceUser | null =
          await SecurityPlaybookContainment.googleWorkspaceClient(
            data.settings,
            transport,
          ).findUser(value);

        if (!user) {
          return null;
        }

        return {
          provider,
          canTellPassword: false,
          passwordChangedAt: null,
          sessionsEndedAt: null,
          hasMfa: null,
          url: `https://admin.google.com/ac/users/${encodeURIComponent(user.id)}`,
        };
      }

      default:
        throw new Error(`OneUptime cannot read an account in ${provider}.`);
    }
  }

  /*
   * Whether an account can sign in with a second factor, read back: the Fix
   * step "MFA on the accounts it went after" (#10347). Okta: a factor
   * enrolled and active; Microsoft Entra ID: an MFA method registered
   * (ENTRA_ID_MFA_METHOD_TYPES); Google Workspace: enrolled in 2-Step
   * Verification. Null when the product has no such account; throws when
   * the product cannot be read.
   */
  public static async readAccountMfa(data: {
    provider: SecurityEventConnectorProvider;
    settings: SecurityConnectorSettings;
    value: string;
    transport?: ConnectorTransport | undefined;
  }): Promise<AccountFixFacts | null> {
    const transport: ConnectorTransport =
      data.transport || DataSourceHttpFetch.fetch;
    const provider: string = PRODUCT_NAMES[data.provider] || data.provider;
    const value: string = data.value.trim();
    const facts: (hasMfa: boolean, url: string | undefined) => AccountFixFacts =
      (hasMfa: boolean, url: string | undefined): AccountFixFacts => {
        return {
          provider,
          canTellPassword: false,
          passwordChangedAt: null,
          sessionsEndedAt: null,
          hasMfa,
          url,
        };
      };

    switch (data.provider) {
      case SecurityEventConnectorProvider.OktaSystemLog: {
        const orgUrl: string = readSettingString(
          data.settings.config,
          "orgUrl",
        );
        const client: OktaResponseClient = new OktaResponseClient({
          orgUrl,
          apiToken: readSettingString(data.settings.secrets, "apiToken"),
          transport,
        });
        const user: OktaUser | null = await client.findUser(value);

        if (!user) {
          return null;
        }

        return facts(
          await client.hasActiveFactor(user),
          getOktaUserUrl(orgUrl, user.id),
        );
      }

      case SecurityEventConnectorProvider.MicrosoftEntraId: {
        const cloud: string =
          readSettingString(data.settings.config, "cloud") || "public";
        const client: MicrosoftEntraIdResponseClient =
          SecurityPlaybookContainment.entraIdClient(data.settings, transport);
        const user: EntraIdUser | null = await client.findUser(value);

        if (!user) {
          return null;
        }

        return facts(
          (await client.readMfaMethods(user)).length > 0,
          getEntraIdUserUrl(cloud, user.id),
        );
      }

      case SecurityEventConnectorProvider.GoogleWorkspace: {
        const user: GoogleWorkspaceUser | null =
          await SecurityPlaybookContainment.googleWorkspaceClient(
            data.settings,
            transport,
          ).findUser(value);

        if (!user) {
          return null;
        }

        return facts(
          user.isEnrolledIn2Sv,
          `https://admin.google.com/ac/users/${encodeURIComponent(user.id)}`,
        );
      }

      default:
        throw new Error(`OneUptime cannot read an account in ${provider}.`);
    }
  }

  private static entraIdClient(
    settings: SecurityConnectorSettings,
    transport: ConnectorTransport,
  ): MicrosoftEntraIdResponseClient {
    return new MicrosoftEntraIdResponseClient({
      tenantId: readSettingString(settings.config, "tenantId"),
      clientId: readSettingString(settings.config, "clientId"),
      clientSecret: readSettingString(settings.secrets, "clientSecret"),
      cloud: readSettingString(settings.config, "cloud") || "public",
      transport,
    });
  }

  private static googleWorkspaceClient(
    settings: SecurityConnectorSettings,
    transport: ConnectorTransport,
  ): GoogleWorkspaceResponseClient {
    return new GoogleWorkspaceResponseClient({
      serviceAccountJson: readSettingString(
        settings.secrets,
        "serviceAccountJson",
      ),
      adminEmail: readSettingString(settings.config, "adminEmail"),
      transport,
    });
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
    // A key that no longer reads fails each target with the reason, on its first request.
    const client: GoogleWorkspaceResponseClient =
      new GoogleWorkspaceResponseClient({
        serviceAccountJson: readSettingString(
          data.settings.secrets,
          "serviceAccountJson",
        ),
        adminEmail: readSettingString(data.settings.config, "adminEmail"),
        transport: data.transport,
      });
    const outcomes: Map<string, ContainmentTargetOutcome> = new Map();

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
