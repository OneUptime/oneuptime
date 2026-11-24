import SecurityEventConnectorProvider from "../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import {
  AccountChange,
  AccountChangeKind,
  AccountChangeProvider,
} from "../../../Utils/SecurityCase/AttackAccountChanges";
import DataSourceHttpFetch from "../DataSource/HttpFetch";
import {
  ConnectorTransport,
  SecurityConnectorSettings,
  readSettingString,
} from "../SecurityEvent/Connectors/Types";
import GoogleWorkspaceResponseClient, {
  GoogleWorkspaceUser,
} from "../SecurityEvent/Response/GoogleWorkspaceResponseClient";
import MicrosoftEntraIdResponseClient, {
  ENTRA_ID_MFA_METHOD_TYPES,
  EntraIdDirectoryObject,
  EntraIdUser,
} from "../SecurityEvent/Response/MicrosoftEntraIdResponseClient";
import OktaResponseClient, {
  OktaUser,
  OktaUserObject,
} from "../SecurityEvent/Response/OktaResponseClient";
import {
  PRODUCT_NAMES,
  getEntraIdUserUrl,
  getOktaUserUrl,
} from "./SecurityPlaybookContainment";

/*
 * WHETHER A CHANGE AN ATTACK MADE TO AN ACCOUNT IS STILL THERE (#10603),
 * read back from the identity product it was made in, without changing
 * anything - beside the other Fix steps' read-backs
 * (SecurityPlaybookContainment.readAccountCredentials, readAccountMfa):
 *
 *   Okta                a group (the user's groups), an admin role (its
 *                       roles), a factor (its factors), an app (the app's
 *                       assignment), an API token, an account made
 *   Microsoft Entra ID  a directory role and a group (memberOf), an app role
 *                       (appRoleAssignments), security info (authentication
 *                       methods, by when each was added), an app's key, an
 *                       account made
 *   Google Workspace    an admin role (isAdmin, isDelegatedAdmin), an app
 *                       given access to the account's data (its token),
 *                       2-Step Verification, an account made
 *
 * A change the product cannot say anything of - a Google Workspace group,
 * anything in AWS - is one OneUptime cannot read back, and a person
 * confirms it. Never a guess: where the account still holds something of
 * the kind and the product does not say which, OneUptime cannot tell.
 */

export enum AccountChangeState {
  // Gone: what the attack gave is no longer there.
  Undone = "Undone",
  StillThere = "StillThere",
  // OneUptime cannot tell, and says why (AccountChangeUnknownReason).
  Unknown = "Unknown",
}

export enum AccountChangeUnknownReason {
  // The product's API says nothing of this kind of change.
  NotReadBack = "NotReadBack",
  /*
   * The account still holds something of the kind, and the product does
   * not say whether it is what the attack gave: an admin role, a factor, a
   * method with no date.
   */
  CannotTellWhich = "CannotTellWhich",
  // The event does not name what it gave, so there is nothing to look for.
  NotNamed = "NotNamed",
}

export interface AccountChangeFacts {
  // The product, as it names itself.
  provider: string;
  state: AccountChangeState;
  reason?: AccountChangeUnknownReason | undefined;
  // The account no longer exists there: what it was given went with it.
  isAccountGone?: boolean | undefined;
  // What the account still holds of the kind, in the product's words, when OneUptime cannot tell which.
  holding?: Array<string> | undefined;
  // The account's page in the product, https.
  url?: string | undefined;
}

// The connections that read each product's changes back.
export const ACCOUNT_CHANGE_CONNECTION_PROVIDERS: Record<
  AccountChangeProvider,
  SecurityEventConnectorProvider | null
> = {
  [AccountChangeProvider.Okta]: SecurityEventConnectorProvider.OktaSystemLog,
  [AccountChangeProvider.EntraId]:
    SecurityEventConnectorProvider.MicrosoftEntraId,
  [AccountChangeProvider.GoogleWorkspace]:
    SecurityEventConnectorProvider.GoogleWorkspace,
  // No identity connection reads AWS IAM back yet.
  [AccountChangeProvider.Aws]: null,
};

/*
 * An Entra ID method added this long before its audit says it was is still
 * the one the audit is about: the two clocks are Microsoft's own.
 */
export const ENTRA_ID_METHOD_ADDED_LEEWAY_MS: number = 5 * 60 * 1000;

// Okta's account states an account the attack made can no longer sign in from.
const OKTA_GONE_STATUSES: ReadonlyArray<string> = [
  "DEPROVISIONED",
  "SUSPENDED",
];

function sameText(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function names(items: Array<{ name: string }>): Array<string> {
  return items
    .map((item: { name: string }): string => {
      return item.name;
    })
    .filter((name: string): boolean => {
      return Boolean(name);
    })
    .slice(0, 5);
}

export default class AccountChangeReadBack {
  /*
   * Whether a change is still there, in one connection of its product. Null
   * when the product has no such account and never had: the change is not
   * this connection's. Throws when the product cannot be read.
   */
  public static async read(data: {
    provider: SecurityEventConnectorProvider;
    settings: SecurityConnectorSettings;
    change: AccountChange;
    transport?: ConnectorTransport | undefined;
  }): Promise<AccountChangeFacts | null> {
    const transport: ConnectorTransport =
      data.transport || DataSourceHttpFetch.fetch;

    switch (data.provider) {
      case SecurityEventConnectorProvider.OktaSystemLog:
        return await AccountChangeReadBack.readInOkta({
          settings: data.settings,
          change: data.change,
          transport,
        });
      case SecurityEventConnectorProvider.MicrosoftEntraId:
        return await AccountChangeReadBack.readInEntraId({
          settings: data.settings,
          change: data.change,
          transport,
        });
      case SecurityEventConnectorProvider.GoogleWorkspace:
        return await AccountChangeReadBack.readInGoogleWorkspace({
          settings: data.settings,
          change: data.change,
          transport,
        });
      default:
        throw new Error(
          `OneUptime cannot read an account's changes in ${PRODUCT_NAMES[data.provider] || data.provider}.`,
        );
    }
  }

  // ---------- Okta ----------

  private static async readInOkta(data: {
    settings: SecurityConnectorSettings;
    change: AccountChange;
    transport: ConnectorTransport;
  }): Promise<AccountChangeFacts | null> {
    const { change } = data;
    const provider: string = AccountChangeProvider.Okta;
    const orgUrl: string = readSettingString(data.settings.config, "orgUrl");
    const client: OktaResponseClient = new OktaResponseClient({
      orgUrl,
      apiToken: readSettingString(data.settings.secrets, "apiToken"),
      transport: data.transport,
    });
    // By the id the event names, which is the account's for good; else by its sign-in name.
    const user: OktaUser | null =
      (change.accountId ? await client.findUser(change.accountId) : null) ||
      (await client.findUser(change.account));

    if (!user) {
      return change.accountId
        ? { provider, state: AccountChangeState.Undone, isAccountGone: true }
        : null;
    }

    const url: string | undefined = getOktaUserUrl(orgUrl, user.id);
    const facts: (
      state: AccountChangeState,
      extra?: Partial<AccountChangeFacts>,
    ) => AccountChangeFacts = (
      state: AccountChangeState,
      extra?: Partial<AccountChangeFacts>,
    ): AccountChangeFacts => {
      return { provider, state, url, ...(extra || {}) };
    };

    switch (change.kind) {
      case AccountChangeKind.Account:
        return facts(
          OKTA_GONE_STATUSES.includes(user.status.toUpperCase())
            ? AccountChangeState.Undone
            : AccountChangeState.StillThere,
        );

      case AccountChangeKind.Group: {
        if (!change.objectId && !change.objectName) {
          return facts(AccountChangeState.Unknown, {
            reason: AccountChangeUnknownReason.NotNamed,
          });
        }

        const groups: Array<OktaUserObject> = await client.listGroups(user);
        const isThere: boolean = groups.some(
          (group: OktaUserObject): boolean => {
            return change.objectId
              ? group.id === change.objectId
              : sameText(group.name, change.objectName);
          },
        );

        return facts(
          isThere ? AccountChangeState.StillThere : AccountChangeState.Undone,
        );
      }

      case AccountChangeKind.AdminRole: {
        const roles: Array<OktaUserObject> = await client.listRoles(user);

        if (roles.length === 0) {
          return facts(AccountChangeState.Undone);
        }

        // The privilege the System Log names, by its label: "Super administrator".
        const granted: Array<string> = change.objectName
          .split(",")
          .map((label: string): string => {
            return label.trim();
          })
          .filter((label: string): boolean => {
            return Boolean(label);
          });
        const isThere: boolean = roles.some(
          (role: OktaUserObject): boolean => {
            return granted.some((label: string): boolean => {
              return sameText(role.name, label);
            });
          },
        );

        return isThere
          ? facts(AccountChangeState.StillThere)
          : facts(AccountChangeState.Unknown, {
              reason: AccountChangeUnknownReason.CannotTellWhich,
              holding: names(roles),
            });
      }

      case AccountChangeKind.MfaDevice: {
        const active: Array<OktaUserObject> = (
          await client.listFactors(user)
        ).filter((factor: OktaUserObject): boolean => {
          return factor.status.toUpperCase() === "ACTIVE";
        });

        if (change.objectId) {
          return facts(
            active.some((factor: OktaUserObject): boolean => {
              return factor.id === change.objectId;
            })
              ? AccountChangeState.StillThere
              : AccountChangeState.Undone,
          );
        }

        return active.length === 0
          ? facts(AccountChangeState.Undone)
          : facts(AccountChangeState.Unknown, {
              reason: AccountChangeUnknownReason.CannotTellWhich,
              holding: names(active),
            });
      }

      case AccountChangeKind.App:
        if (!change.objectId) {
          return facts(AccountChangeState.Unknown, {
            reason: AccountChangeUnknownReason.NotNamed,
          });
        }

        return facts(
          (await client.isAppAssigned({ appId: change.objectId, user }))
            ? AccountChangeState.StillThere
            : AccountChangeState.Undone,
        );

      case AccountChangeKind.Key:
        if (!change.objectId) {
          return facts(AccountChangeState.Unknown, {
            reason: AccountChangeUnknownReason.NotNamed,
          });
        }

        return facts(
          (await client.hasApiToken(change.objectId))
            ? AccountChangeState.StillThere
            : AccountChangeState.Undone,
        );

      default:
        return facts(AccountChangeState.Unknown, {
          reason: AccountChangeUnknownReason.NotReadBack,
        });
    }
  }

  // ---------- Microsoft Entra ID ----------

  private static async readInEntraId(data: {
    settings: SecurityConnectorSettings;
    change: AccountChange;
    transport: ConnectorTransport;
  }): Promise<AccountChangeFacts | null> {
    const { change } = data;
    const provider: string = AccountChangeProvider.EntraId;
    const cloud: string =
      readSettingString(data.settings.config, "cloud") || "public";
    const client: MicrosoftEntraIdResponseClient =
      new MicrosoftEntraIdResponseClient({
        tenantId: readSettingString(data.settings.config, "tenantId"),
        clientId: readSettingString(data.settings.config, "clientId"),
        clientSecret: readSettingString(data.settings.secrets, "clientSecret"),
        cloud,
        transport: data.transport,
      });

    // An app's key is the app's: read on the app, not on an account.
    if (change.kind === AccountChangeKind.Key) {
      if (!change.accountId) {
        return {
          provider,
          state: AccountChangeState.Unknown,
          reason: AccountChangeUnknownReason.NotNamed,
        };
      }

      const keyIds: Array<string> | null = await client.readAppKeyIds({
        ownerType:
          change.ownerType === "Application" ? "Application" : "ServicePrincipal",
        id: change.accountId,
      });

      if (keyIds === null) {
        return { provider, state: AccountChangeState.Undone, isAccountGone: true };
      }

      if (!change.objectId) {
        return keyIds.length === 0
          ? { provider, state: AccountChangeState.Undone }
          : {
              provider,
              state: AccountChangeState.Unknown,
              reason: AccountChangeUnknownReason.CannotTellWhich,
            };
      }

      return {
        provider,
        state: keyIds.includes(change.objectId.toLowerCase())
          ? AccountChangeState.StillThere
          : AccountChangeState.Undone,
      };
    }

    const user: EntraIdUser | null =
      (change.accountId ? await client.findUser(change.accountId) : null) ||
      (await client.findUser(change.account));

    if (!user) {
      return change.accountId
        ? { provider, state: AccountChangeState.Undone, isAccountGone: true }
        : null;
    }

    const url: string | undefined = getEntraIdUserUrl(cloud, user.id);
    const facts: (
      state: AccountChangeState,
      extra?: Partial<AccountChangeFacts>,
    ) => AccountChangeFacts = (
      state: AccountChangeState,
      extra?: Partial<AccountChangeFacts>,
    ): AccountChangeFacts => {
      return { provider, state, url, ...(extra || {}) };
    };
    const has: (isThere: boolean) => AccountChangeFacts = (
      isThere: boolean,
    ): AccountChangeFacts => {
      return facts(
        isThere ? AccountChangeState.StillThere : AccountChangeState.Undone,
      );
    };

    switch (change.kind) {
      case AccountChangeKind.Account:
        return has(user.accountEnabled);

      case AccountChangeKind.AdminRole: {
        if (!change.objectId && !change.objectName) {
          return facts(AccountChangeState.Unknown, {
            reason: AccountChangeUnknownReason.NotNamed,
          });
        }

        const roles: Array<EntraIdDirectoryObject> =
          await client.listDirectoryRoles(user);

        return has(
          roles.some((role: EntraIdDirectoryObject): boolean => {
            const id: string = change.objectId.toLowerCase();

            return id
              ? role.templateId === id || role.id === id
              : sameText(role.name, change.objectName);
          }),
        );
      }

      case AccountChangeKind.Group: {
        if (!change.objectId && !change.objectName) {
          return facts(AccountChangeState.Unknown, {
            reason: AccountChangeUnknownReason.NotNamed,
          });
        }

        const groups: Array<EntraIdDirectoryObject> =
          await client.listGroups(user);

        return has(
          groups.some((group: EntraIdDirectoryObject): boolean => {
            return change.objectId
              ? group.id === change.objectId.toLowerCase()
              : sameText(group.name, change.objectName);
          }),
        );
      }

      case AccountChangeKind.App: {
        if (!change.objectId) {
          return facts(AccountChangeState.Unknown, {
            reason: AccountChangeUnknownReason.NotNamed,
          });
        }

        const assignments: Array<EntraIdDirectoryObject> =
          await client.listAppRoleAssignments(user);

        return has(
          assignments.some((assignment: EntraIdDirectoryObject): boolean => {
            return (
              assignment.templateId === change.objectId.toLowerCase() &&
              (!change.detailId ||
                assignment.appRoleId === change.detailId.toLowerCase())
            );
          }),
        );
      }

      case AccountChangeKind.MfaDevice: {
        /*
         * The audit names no method, so the methods are read by when each
         * was added: one added at the audit's time, or since, is still
         * there; with none, a method Graph gives no date (a phone, an OATH
         * token) may be the one.
         */
        const changedAt: number = Date.parse(change.time);
        const methods: Array<EntraIdDirectoryObject> = (
          await client.listAuthenticationMethods(user)
        ).filter((method: EntraIdDirectoryObject): boolean => {
          return ENTRA_ID_MFA_METHOD_TYPES.includes(method.type);
        });
        const added: Array<EntraIdDirectoryObject> = methods.filter(
          (method: EntraIdDirectoryObject): boolean => {
            return Boolean(
              method.createdAt &&
                !Number.isNaN(changedAt) &&
                method.createdAt.getTime() >=
                  changedAt - ENTRA_ID_METHOD_ADDED_LEEWAY_MS,
            );
          },
        );

        if (added.length > 0) {
          return facts(AccountChangeState.StillThere, {
            holding: names(added),
          });
        }

        const undated: Array<EntraIdDirectoryObject> = methods.filter(
          (method: EntraIdDirectoryObject): boolean => {
            return !method.createdAt;
          },
        );

        return undated.length > 0 || Number.isNaN(changedAt)
          ? facts(AccountChangeState.Unknown, {
              reason: AccountChangeUnknownReason.CannotTellWhich,
              holding: names(undated),
            })
          : facts(AccountChangeState.Undone);
      }

      default:
        return facts(AccountChangeState.Unknown, {
          reason: AccountChangeUnknownReason.NotReadBack,
        });
    }
  }

  // ---------- Google Workspace ----------

  private static async readInGoogleWorkspace(data: {
    settings: SecurityConnectorSettings;
    change: AccountChange;
    transport: ConnectorTransport;
  }): Promise<AccountChangeFacts | null> {
    const { change } = data;
    const provider: string = AccountChangeProvider.GoogleWorkspace;
    const client: GoogleWorkspaceResponseClient =
      new GoogleWorkspaceResponseClient({
        serviceAccountJson: readSettingString(
          data.settings.secrets,
          "serviceAccountJson",
        ),
        adminEmail: readSettingString(data.settings.config, "adminEmail"),
        transport: data.transport,
      });
    const user: GoogleWorkspaceUser | null = await client.findUser(
      change.account,
    );

    if (!user) {
      return null;
    }

    const url: string = `https://admin.google.com/ac/users/${encodeURIComponent(user.id)}`;
    const facts: (
      state: AccountChangeState,
      extra?: Partial<AccountChangeFacts>,
    ) => AccountChangeFacts = (
      state: AccountChangeState,
      extra?: Partial<AccountChangeFacts>,
    ): AccountChangeFacts => {
      return { provider, state, url, ...(extra || {}) };
    };

    switch (change.kind) {
      case AccountChangeKind.Account:
        return facts(
          user.suspended
            ? AccountChangeState.Undone
            : AccountChangeState.StillThere,
        );

      case AccountChangeKind.AdminRole:
        // A super admin is its own flag: said for certain.
        if (change.objectId === "SUPER_ADMIN") {
          return facts(
            user.isAdmin
              ? AccountChangeState.StillThere
              : AccountChangeState.Undone,
          );
        }

        return user.isAdmin || user.isDelegatedAdmin
          ? facts(AccountChangeState.Unknown, {
              reason: AccountChangeUnknownReason.CannotTellWhich,
            })
          : facts(AccountChangeState.Undone);

      case AccountChangeKind.App:
        if (!change.objectId) {
          return facts(AccountChangeState.Unknown, {
            reason: AccountChangeUnknownReason.NotNamed,
          });
        }

        return facts(
          (await client.hasToken({ user, clientId: change.objectId }))
            ? AccountChangeState.StillThere
            : AccountChangeState.Undone,
        );

      case AccountChangeKind.MfaDevice:
        return user.isEnrolledIn2Sv
          ? facts(AccountChangeState.Unknown, {
              reason: AccountChangeUnknownReason.CannotTellWhich,
            })
          : facts(AccountChangeState.Undone);

      // The Directory API reads groups only with a scope the connection is not given.
      default:
        return facts(AccountChangeState.Unknown, {
          reason: AccountChangeUnknownReason.NotReadBack,
        });
    }
  }
}
