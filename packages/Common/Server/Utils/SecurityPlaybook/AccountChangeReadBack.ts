import { JSONObject } from "../../../Types/JSON";
import SecurityEventConnectorProvider from "../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import {
  AccountChange,
  AccountChangeKind,
  AccountChangeProvider,
  AccountChangeSubject,
} from "../../../Utils/SecurityCase/AttackAccountChanges";
import {
  AWS_EVERY_ACCOUNT,
  getAwsTrustedOutsideAccounts,
  isSameAwsPolicy,
  readAwsPolicyDocument,
} from "../../../Utils/SecurityCase/AwsTrustPolicy";
import {
  AwsIamAccessKey,
  AwsIamAccessNotGranted,
  AwsIamAttachedPolicy,
  AwsIamGroup,
  AwsIamLoginProfile,
  AwsIamMfaDevice,
  AwsIamRole,
  AwsIamSession,
  AwsIamUser,
  getAwsIamLoginProfile,
  getAwsIamRole,
  getAwsIamRolePolicyDocument,
  getAwsIamRoleUrl,
  getAwsIamUser,
  getAwsIamUserPolicyDocument,
  getAwsIamUserUrl,
  isAwsIamAccessKeyActive,
  listAwsIamAccessKeys,
  listAwsIamAttachedRolePolicies,
  listAwsIamAttachedUserPolicies,
  listAwsIamGroupsForUser,
  listAwsIamMfaDevices,
  listAwsIamRolePolicyNames,
  listAwsIamUserPolicyNames,
} from "../CloudConnection/Aws/AwsIamUsers";
import DataSourceHttpFetch from "../DataSource/HttpFetch";
import {
  ConnectorTransport,
  SecurityConnectorSettings,
  readSettingString,
} from "../SecurityEvent/Connectors/Types";
import GoogleWorkspaceResponseClient, {
  GoogleWorkspaceAccessNotGranted,
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
 *                       2-Step Verification, an account made, and a group
 *                       (one membership, with the group member scope,
 *                       #10901)
 *   AWS IAM             an access key, a console password, a managed or
 *                       inline policy, a group, an MFA device, a user made
 *                       - through the AWS cloud connection that reads the
 *                       account, with its Security case checks (#10900) -
 *                       and a role's: a role made, a trust policy set, a
 *                       managed or inline policy (#11038), naming the
 *                       outside accounts the role trusts now; an inline
 *                       policy by its document, held to the ones the
 *                       attack wrote (#11377)
 *
 * A change the product cannot say anything of, or one the connection was
 * not given the access to read (NotGranted: a delegation without the
 * group member scope, an AWS connection whose Security case checks are
 * off), is one OneUptime cannot read back, and a person confirms it. Never
 * a guess: where the account still holds something of the kind and the
 * product does not say which, OneUptime cannot tell.
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
  /*
   * The connection was not given the access this read takes: a Google
   * Workspace delegation without the group member scope (#10901), an AWS
   * connection whose Security case checks are off (#10900). Its step says
   * what to grant.
   */
  NotGranted = "NotGranted",
}

/*
 * An inline policy's document beside the ones the case's CloudTrail events
 * show written to it (#11377). PutRolePolicy and PutUserPolicy rewrite a
 * policy of the name they write, so a policy the attack rewrote keeps its
 * name after its old document is put back: only the document says whether
 * what the attack wrote is still there.
 */
export enum AccountChangePolicyDocument {
  // The last one the attack wrote, as IAM reads it: still there.
  Attack = "Attack",
  /*
   * An earlier one the case's events show written to it: the old one put
   * back, or one the attack wrote first - a person's to tell apart.
   */
  Earlier = "Earlier",
  // None the case's events show, each read whole: what the attack wrote is gone.
  Changed = "Changed",
  /*
   * There is no telling: CloudTrail cut one of them short (OneUptime keeps
   * an attribute's first 1,000 characters), or it or the one IAM has now
   * is not a whole policy.
   */
  NotComparable = "NotComparable",
}

export interface AccountChangeFacts {
  // The product, as it names itself.
  provider: string;
  state: AccountChangeState;
  reason?: AccountChangeUnknownReason | undefined;
  /*
   * An inline policy's, once its document was read (#11377): how it stands
   * beside the documents the case's events show written to it.
   */
  policyDocument?: AccountChangePolicyDocument | undefined;
  // The account no longer exists there: what it was given went with it.
  isAccountGone?: boolean | undefined;
  // What the account still holds of the kind, in the product's words, when OneUptime cannot tell which.
  holding?: Array<string> | undefined;
  /*
   * An IAM role's (#11038): the AWS accounts outside its own it trusts now,
   * as its trust policy names them - "*" for every account - that a person
   * is told of. On a trust policy changed since the attack's, only the
   * ones the attack's policies trusted too.
   */
  trusted?: Array<string> | undefined;
  // The account's page in the product, https.
  url?: string | undefined;
}

/*
 * The security event connections that read each product's changes back.
 * AWS's are read through the project's AWS cloud connections instead, the
 * ones that read the account a change was made in (AwsAccountChanges).
 */
export const ACCOUNT_CHANGE_CONNECTION_PROVIDERS: Record<
  AccountChangeProvider,
  SecurityEventConnectorProvider | null
> = {
  [AccountChangeProvider.Okta]: SecurityEventConnectorProvider.OktaSystemLog,
  [AccountChangeProvider.EntraId]:
    SecurityEventConnectorProvider.MicrosoftEntraId,
  [AccountChangeProvider.GoogleWorkspace]:
    SecurityEventConnectorProvider.GoogleWorkspace,
  [AccountChangeProvider.Aws]: null,
};

/*
 * A console password set up again this long after the attack set one is
 * another: the attack's went with the profile it made. CloudTrail's clock
 * and IAM's are AWS's own.
 */
export const AWS_LOGIN_PROFILE_LEEWAY_MS: number = 5 * 60 * 1000;

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

/*
 * An inline policy's document now, held to the ones the case's events show
 * written to it, oldest first - the last is what the attack left (#11377):
 * each read as IAM reads it (isSameAwsPolicy), however it is written. The
 * last one is the attack's still there; an earlier one may be the old one
 * put back; none of them, each read whole, is the attack's gone. Anything
 * OneUptime cannot read whole is no telling, never gone.
 */
export function compareInlinePolicyDocument(data: {
  // As IAM answers it: URL-encoded.
  now: string;
  // As CloudTrail recorded them, oldest first.
  written: Array<string>;
}): AccountChangePolicyDocument {
  const now: JSONObject | null = readAwsPolicyDocument(data.now);
  const written: Array<JSONObject | null> = data.written.map(
    (document: string): JSONObject | null => {
      return readAwsPolicyDocument(document);
    },
  );
  const isNow: (policy: JSONObject | null) => boolean = (
    policy: JSONObject | null,
  ): boolean => {
    return Boolean(now && policy && isSameAwsPolicy(now, policy));
  };

  if (!now || written.length === 0) {
    return AccountChangePolicyDocument.NotComparable;
  }

  if (isNow(written[written.length - 1] || null)) {
    return AccountChangePolicyDocument.Attack;
  }

  if (written.slice(0, -1).some(isNow)) {
    return AccountChangePolicyDocument.Earlier;
  }

  return written.every((policy: JSONObject | null): boolean => {
    return policy !== null;
  })
    ? AccountChangePolicyDocument.Changed
    : AccountChangePolicyDocument.NotComparable;
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
        const isThere: boolean = roles.some((role: OktaUserObject): boolean => {
          return granted.some((label: string): boolean => {
            return sameText(role.name, label);
          });
        });

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
          change.ownerType === "Application"
            ? "Application"
            : "ServicePrincipal",
        id: change.accountId,
      });

      if (keyIds === null) {
        return {
          provider,
          state: AccountChangeState.Undone,
          isAccountGone: true,
        };
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

      /*
       * A group, by the address the Admin audit log names: one membership,
       * read with the group member scope (#10901). A delegation without it
       * leaves the change a person's to confirm, saying what to grant.
       */
      case AccountChangeKind.Group: {
        if (!change.objectName) {
          return facts(AccountChangeState.Unknown, {
            reason: AccountChangeUnknownReason.NotNamed,
          });
        }

        try {
          return facts(
            (await client.isGroupMember({
              groupKey: change.objectName,
              memberKey: user.id,
            }))
              ? AccountChangeState.StillThere
              : AccountChangeState.Undone,
          );
        } catch (error) {
          if (error instanceof GoogleWorkspaceAccessNotGranted) {
            return facts(AccountChangeState.Unknown, {
              reason: AccountChangeUnknownReason.NotGranted,
            });
          }

          throw error;
        }
      }

      default:
        return facts(AccountChangeState.Unknown, {
          reason: AccountChangeUnknownReason.NotReadBack,
        });
    }
  }

  // ---------- AWS IAM ----------

  /*
   * Whether a change an attack made to an IAM user (#10900) or role
   * (#11038) is still there, through a session signed in to the account it
   * was made in: the user or the role first - deleted, it took everything
   * it was given with it - then the one list the change is in. A read the
   * connection was not given (its Security case checks off, its setup
   * command not run again) leaves the change a person's to confirm, saying
   * what to grant. Throws when IAM could not be read.
   */
  public static async readInAws(data: {
    session: AwsIamSession;
    change: AccountChange;
  }): Promise<AccountChangeFacts> {
    const { session, change } = data;
    const provider: string = AccountChangeProvider.Aws;

    try {
      return change.subject === AccountChangeSubject.Role
        ? await AccountChangeReadBack.readIamRole({ session, change })
        : await AccountChangeReadBack.readIamUser({ session, change });
    } catch (error) {
      if (error instanceof AwsIamAccessNotGranted) {
        return {
          provider,
          state: AccountChangeState.Unknown,
          reason: AccountChangeUnknownReason.NotGranted,
        };
      }

      throw error;
    }
  }

  private static async readIamUser(data: {
    session: AwsIamSession;
    change: AccountChange;
  }): Promise<AccountChangeFacts> {
    const { session, change } = data;
    const provider: string = AccountChangeProvider.Aws;
    const gone: AccountChangeFacts = {
      provider,
      state: AccountChangeState.Undone,
      isAccountGone: true,
    };
    const user: AwsIamUser | null = await getAwsIamUser(
      session,
      change.account,
    );

    if (!user) {
      return gone;
    }

    const url: string = getAwsIamUserUrl(session.partition, user.userName);
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
    const notNamed: AccountChangeFacts = facts(AccountChangeState.Unknown, {
      reason: AccountChangeUnknownReason.NotNamed,
    });

    switch (change.kind) {
      // The user the attack made: still there until it is deleted.
      case AccountChangeKind.Account:
        return facts(AccountChangeState.StillThere);

      // An access key: still there while it is, and active.
      case AccountChangeKind.Key: {
        const keys: Array<AwsIamAccessKey> | null = await listAwsIamAccessKeys(
          session,
          user.userName,
        );

        if (!keys) {
          return gone;
        }

        if (!change.objectId) {
          const active: Array<AwsIamAccessKey> = keys.filter(
            isAwsIamAccessKeyActive,
          );

          return active.length === 0
            ? facts(AccountChangeState.Undone)
            : facts(AccountChangeState.Unknown, {
                reason: AccountChangeUnknownReason.CannotTellWhich,
                holding: active
                  .map((key: AwsIamAccessKey): string => {
                    return key.accessKeyId;
                  })
                  .slice(0, 5),
              });
        }

        const key: AwsIamAccessKey | undefined = keys.find(
          (candidate: AwsIamAccessKey): boolean => {
            return candidate.accessKeyId === change.objectId;
          },
        );

        return has(Boolean(key && isAwsIamAccessKeyActive(key)));
      }

      /*
       * A console password: undone once the user has none, or one set up
       * again since. One still there may have had its password changed,
       * which IAM does not say: a person confirms it.
       */
      case AccountChangeKind.Password: {
        const profile: AwsIamLoginProfile | null = await getAwsIamLoginProfile(
          session,
          user.userName,
        );

        if (!profile) {
          return facts(AccountChangeState.Undone);
        }

        const changedAt: number = Date.parse(change.time);

        if (
          profile.createdAt &&
          !Number.isNaN(changedAt) &&
          profile.createdAt.getTime() > changedAt + AWS_LOGIN_PROFILE_LEEWAY_MS
        ) {
          return facts(AccountChangeState.Undone);
        }

        return facts(AccountChangeState.Unknown, {
          reason: AccountChangeUnknownReason.CannotTellWhich,
        });
      }

      // A managed policy, by its ARN; an inline one, by its document (#11377).
      case AccountChangeKind.Policy: {
        if (change.eventName === "AttachUserPolicy" || change.objectId) {
          if (!change.objectId) {
            return notNamed;
          }

          const attached: Array<AwsIamAttachedPolicy> | null =
            await listAwsIamAttachedUserPolicies(session, user.userName);

          return attached
            ? has(
                attached.some((policy: AwsIamAttachedPolicy): boolean => {
                  return sameText(policy.policyArn, change.objectId);
                }),
              )
            : gone;
        }

        if (!change.objectName) {
          return notNamed;
        }

        return await AccountChangeReadBack.readInlinePolicy({
          change,
          facts,
          gone,
          listNames: async (): Promise<Array<string> | null> => {
            return await listAwsIamUserPolicyNames(session, user.userName);
          },
          readDocument: async (policyName: string): Promise<string | null> => {
            return await getAwsIamUserPolicyDocument(session, {
              userName: user.userName,
              policyName,
            });
          },
        });
      }

      // A group, by its name: IAM's are unique case aside.
      case AccountChangeKind.Group: {
        if (!change.objectName) {
          return notNamed;
        }

        const groups: Array<AwsIamGroup> | null = await listAwsIamGroupsForUser(
          session,
          user.userName,
        );

        return groups
          ? has(
              groups.some((group: AwsIamGroup): boolean => {
                return sameText(group.groupName, change.objectName);
              }),
            )
          : gone;
      }

      // An MFA device, by the serial number or ARN the event names.
      case AccountChangeKind.MfaDevice: {
        const devices: Array<AwsIamMfaDevice> | null =
          await listAwsIamMfaDevices(session, user.userName);

        if (!devices) {
          return gone;
        }

        if (change.objectId) {
          return has(
            devices.some((device: AwsIamMfaDevice): boolean => {
              return device.serialNumber === change.objectId;
            }),
          );
        }

        return devices.length === 0
          ? facts(AccountChangeState.Undone)
          : facts(AccountChangeState.Unknown, {
              reason: AccountChangeUnknownReason.CannotTellWhich,
            });
      }

      default:
        return facts(AccountChangeState.Unknown, {
          reason: AccountChangeUnknownReason.NotReadBack,
        });
    }
  }

  /*
   * A change an attack made to an IAM role (#11038): the role first, by its
   * name - deleted, it took everything it was given with it, and a role
   * of its name made since (another id) is not the attack's - then:
   *
   *   a role made      still there until it is deleted
   *   a trust policy   readIamTrust: the policy now, held to the ones the
   *                    attack set
   *   a policy         a managed one by its ARN, an inline one by its
   *                    document (readInlinePolicy, #11377)
   *
   * Each names the outside accounts the role trusts now where a person
   * acts on it: a role still there, a trust policy to confirm.
   */
  private static async readIamRole(data: {
    session: AwsIamSession;
    change: AccountChange;
  }): Promise<AccountChangeFacts> {
    const { session, change } = data;
    const provider: string = AccountChangeProvider.Aws;
    const gone: AccountChangeFacts = {
      provider,
      state: AccountChangeState.Undone,
      isAccountGone: true,
    };
    const role: AwsIamRole | null = await getAwsIamRole(
      session,
      change.account,
    );

    if (
      !role ||
      (change.accountId && role.roleId && role.roleId !== change.accountId)
    ) {
      return gone;
    }

    const url: string = getAwsIamRoleUrl(session.partition, role.roleName);
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
    const notNamed: AccountChangeFacts = facts(AccountChangeState.Unknown, {
      reason: AccountChangeUnknownReason.NotNamed,
    });
    const trustsNow: JSONObject | null = readAwsPolicyDocument(
      role.trustPolicy,
    );
    const outsideNow: Array<string> = trustsNow
      ? getAwsTrustedOutsideAccounts(trustsNow, change.cloudAccountId)
      : [];

    switch (change.kind) {
      case AccountChangeKind.Account:
        return facts(AccountChangeState.StillThere, trustedOf(outsideNow));

      case AccountChangeKind.Trust:
        return AccountChangeReadBack.readIamTrust({
          change,
          trustsNow,
          outsideNow,
          facts,
        });

      case AccountChangeKind.Policy: {
        if (change.eventName === "AttachRolePolicy" || change.objectId) {
          if (!change.objectId) {
            return notNamed;
          }

          const attached: Array<AwsIamAttachedPolicy> | null =
            await listAwsIamAttachedRolePolicies(session, role.roleName);

          return attached
            ? has(
                attached.some((policy: AwsIamAttachedPolicy): boolean => {
                  return sameText(policy.policyArn, change.objectId);
                }),
              )
            : gone;
        }

        if (!change.objectName) {
          return notNamed;
        }

        return await AccountChangeReadBack.readInlinePolicy({
          change,
          facts,
          gone,
          listNames: async (): Promise<Array<string> | null> => {
            return await listAwsIamRolePolicyNames(session, role.roleName);
          },
          readDocument: async (policyName: string): Promise<string | null> => {
            return await getAwsIamRolePolicyDocument(session, {
              roleName: role.roleName,
              policyName,
            });
          },
        });
      }

      default:
        return facts(AccountChangeState.Unknown, {
          reason: AccountChangeUnknownReason.NotReadBack,
        });
    }
  }

  /*
   * An inline policy the attack wrote to a user or a role (PutUserPolicy,
   * PutRolePolicy), read by its document (#11377). The call rewrites a
   * policy of its name, so the name alone says nothing once a person has
   * put the old document back:
   *
   *   undone        the policy is gone - its list, which every connection
   *                 with Security case checks on may read, says so - or
   *                 its document is none the case's events show written to
   *                 it, each read whole;
   *   still there   its document is the last one the attack wrote;
   *   to confirm    it is an earlier one the case's events show (the old
   *                 one, or the attack's first), one of theirs CloudTrail
   *                 cut short, or no policy - never undone on a document
   *                 OneUptime could not compare - or AWS refused the
   *                 document's read: a connection whose command was run
   *                 before it was granted, which the step says to run
   *                 again. The user's or role's page stays linked.
   */
  private static async readInlinePolicy(data: {
    change: AccountChange;
    facts: (
      state: AccountChangeState,
      extra?: Partial<AccountChangeFacts>,
    ) => AccountChangeFacts;
    // The user or the role gone since it was read.
    gone: AccountChangeFacts;
    // Its inline policies' names, or null once it is gone.
    listNames: () => Promise<Array<string> | null>;
    // One's document, by the name IAM lists it under, or null once it is gone.
    readDocument: (policyName: string) => Promise<string | null>;
  }): Promise<AccountChangeFacts> {
    const { change, facts } = data;
    const names: Array<string> | null = await data.listNames();

    if (!names) {
      return data.gone;
    }

    const name: string | undefined = names.find((listed: string): boolean => {
      return sameText(listed, change.objectName);
    });

    if (!name) {
      return facts(AccountChangeState.Undone);
    }

    // With no document the events show, there is nothing to hold it to.
    if (change.policyDocuments.length === 0) {
      return facts(AccountChangeState.Unknown, {
        reason: AccountChangeUnknownReason.CannotTellWhich,
        policyDocument: AccountChangePolicyDocument.NotComparable,
      });
    }

    let document: string | null;

    try {
      document = await data.readDocument(name);
    } catch (error) {
      if (error instanceof AwsIamAccessNotGranted) {
        return facts(AccountChangeState.Unknown, {
          reason: AccountChangeUnknownReason.NotGranted,
        });
      }

      throw error;
    }

    // Deleted between the list and the read.
    if (document === null) {
      return facts(AccountChangeState.Undone);
    }

    const reading: AccountChangePolicyDocument = compareInlinePolicyDocument({
      now: document,
      written: change.policyDocuments,
    });

    switch (reading) {
      case AccountChangePolicyDocument.Attack:
        return facts(AccountChangeState.StillThere, {
          policyDocument: reading,
        });
      case AccountChangePolicyDocument.Changed:
        return facts(AccountChangeState.Undone, { policyDocument: reading });
      default:
        return facts(AccountChangeState.Unknown, {
          reason: AccountChangeUnknownReason.CannotTellWhich,
          policyDocument: reading,
        });
    }
  }

  /*
   * A role's trust policy the attack set (UpdateAssumeRolePolicy, #11038):
   * reading alone cannot undo it, so the policy now is held to the ones the
   * case's events set, oldest first.
   *
   *   still there  it is the last policy the attack set, as IAM reads it -
   *                however either is written - naming whom it trusts
   *                outside the account;
   *   undone       it trusts none of the outside accounts any of the
   *                attack's policies trusted - each read whole;
   *   to confirm   anything else: changed since, but still trusting an
   *                outside account one of them trusted (it may have been
   *                trusted before the attack), a policy that trusted no
   *                outside account changed since, or one CloudTrail cut
   *                short - never undone on what OneUptime could not read.
   *                It names what the person checks: the outside accounts
   *                trusted now that the attack's trusted too, or, past
   *                telling, every one trusted now.
   */
  private static readIamTrust(data: {
    change: AccountChange;
    trustsNow: JSONObject | null;
    outsideNow: Array<string>;
    facts: (
      state: AccountChangeState,
      extra?: Partial<AccountChangeFacts>,
    ) => AccountChangeFacts;
  }): AccountChangeFacts {
    const { change, trustsNow, outsideNow, facts } = data;
    const cannotTell: (trusted: Array<string>) => AccountChangeFacts = (
      trusted: Array<string>,
    ): AccountChangeFacts => {
      return facts(AccountChangeState.Unknown, {
        reason: AccountChangeUnknownReason.CannotTellWhich,
        ...trustedOf(trusted),
      });
    };

    if (!trustsNow) {
      return cannotTell([]);
    }

    const set: Array<JSONObject | null> = change.policyDocuments.map(
      (policy: string): JSONObject | null => {
        return readAwsPolicyDocument(policy);
      },
    );
    const latest: JSONObject | null = set[set.length - 1] || null;

    if (latest && isSameAwsPolicy(trustsNow, latest)) {
      return facts(AccountChangeState.StillThere, trustedOf(outsideNow));
    }

    const isWhole: boolean =
      set.length > 0 &&
      set.every((policy: JSONObject | null): boolean => {
        return policy !== null;
      });

    if (!isWhole) {
      return cannotTell(outsideNow);
    }

    // Each outside account an attack's policy let in: any may be its way back.
    const attackOutside: Array<string> = Array.from(
      new Set(
        set.flatMap((policy: JSONObject | null): Array<string> => {
          return getAwsTrustedOutsideAccounts(policy!, change.cloudAccountId);
        }),
      ),
    );

    if (attackOutside.length === 0) {
      return cannotTell(outsideNow);
    }

    // Every account, now, is each of the attack's too.
    const stillTrusted: Array<string> = outsideNow.includes(AWS_EVERY_ACCOUNT)
      ? [AWS_EVERY_ACCOUNT]
      : outsideNow.filter((account: string): boolean => {
          return attackOutside.includes(account);
        });

    return stillTrusted.length === 0
      ? facts(AccountChangeState.Undone)
      : cannotTell(stillTrusted);
  }
}

// The outside accounts a role trusts, as facts carry them: none said when there are none.
function trustedOf(accounts: Array<string>): Partial<AccountChangeFacts> {
  return accounts.length > 0 ? { trusted: accounts } : {};
}
