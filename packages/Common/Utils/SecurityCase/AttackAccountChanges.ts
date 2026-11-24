import { SecurityCaseEventSnapshot } from "../../Types/SecurityCase/SecurityCaseEventEvidence";
import {
  SecurityCaseMatchedDetectionJson,
  SecurityCaseMatchesJson,
} from "../../Types/SecurityCase/SecurityCaseMatches";

/*
 * WHAT AN ATTACK CHANGED ON ACCOUNTS (#10603), read from the events of a
 * case: the identity products' own records of access being given - a role,
 * a group, an app, a second factor, a key - and of accounts being made.
 * Each event names the account and what it gave it, so the Fix step "Undo
 * what changed on the account" can ask the product whether each is still
 * there (Server/Utils/SecurityCase/StepChecks/FixAccountChangesStepCheck).
 *
 *   Okta System Log         group.user_membership.add, user.account.
 *                           privilege.grant, user.mfa.factor.activate,
 *                           application.user_membership.add,
 *                           system.api_token.create, user.lifecycle.create
 *   Microsoft Entra ID      Add member to role, Add member to group, Add
 *   (its audit log)         app role assignment to user, User or Admin
 *                           registered security info, Add service principal
 *                           credentials, Update application - Certificates
 *                           and secrets management, Add user
 *   Google Workspace        GRANT_ADMIN_PRIVILEGE, ASSIGN_ROLE,
 *                           ADD_GROUP_MEMBER, CREATE_USER (admin), authorize
 *                           (token), 2sv_enroll (user accounts)
 *   AWS CloudTrail (IAM)    CreateAccessKey, AttachUserPolicy, PutUserPolicy,
 *                           AddUserToGroup, CreateLoginProfile,
 *                           EnableMFADevice, CreateUser - each with the AWS
 *                           account it was made in, and the cloud
 *                           connection that read it, to read it back
 *                           through (#10900)
 *
 * Only what succeeded: a refused change gave nothing. Pure, so each event's
 * reading is pinned on its own; the products' read-back is the server's.
 */

// The product an account change was made in, as it names itself.
export enum AccountChangeProvider {
  Okta = "Okta",
  EntraId = "Microsoft Entra ID",
  GoogleWorkspace = "Google Workspace",
  Aws = "AWS",
}

// What the change gave.
export enum AccountChangeKind {
  // An admin role or privilege: Okta's admin roles, Entra ID's directory roles, Google's admin roles.
  AdminRole = "AdminRole",
  // A policy put on the account itself: an IAM user's managed policy attached, or inline policy written (#10900).
  Policy = "Policy",
  // A group the account was put in.
  Group = "Group",
  // An app: assigned in Okta, an app role in Entra ID, access to the account's data in Google Workspace.
  App = "App",
  // A second factor: an Okta factor, Entra ID security info, Google 2-Step Verification, an IAM MFA device.
  MfaDevice = "MfaDevice",
  // A key: an Okta API token, an Entra ID app's secret or certificate, an IAM access key.
  Key = "Key",
  // A password to sign in with that the attack set: an IAM user's console password, its login profile (#10900).
  Password = "Password",
  // An account the attack made.
  Account = "Account",
}

export const ACCOUNT_CHANGE_KINDS: ReadonlyArray<AccountChangeKind> = [
  AccountChangeKind.AdminRole,
  AccountChangeKind.Policy,
  AccountChangeKind.Group,
  AccountChangeKind.App,
  AccountChangeKind.MfaDevice,
  AccountChangeKind.Key,
  AccountChangeKind.Password,
  AccountChangeKind.Account,
];

export interface AccountChange {
  provider: AccountChangeProvider;
  kind: AccountChangeKind;
  /*
   * The account it was made to, as the product names it: a sign-in name, a
   * mail address - or, for an Entra ID app's key, the app.
   */
  account: string;
  // The product's own id of the account, when the event names it.
  accountId: string;
  // What it gave: its id in the product, when the event names one, and its name.
  objectId: string;
  objectName: string;
  // A second id the read-back needs: an app role's id (Entra ID).
  detailId: string;
  // An Entra ID key's owner: an app registration ("Application") or its service principal.
  ownerType: string;
  /*
   * The cloud account the change was made in, for a product that has
   * several: the AWS account's 12-digit id (CloudTrail's
   * recipientAccountId). "" for the others.
   */
  cloudAccountId: string;
  /*
   * The project's cloud connection whose read brought the event in, when
   * one did (Cloud audit logs): the connection that reaches that account.
   */
  cloudConnectionId: string;
  // The event that says so: its name in the product, its id and when it happened.
  eventName: string;
  eventUid: string;
  time: string;
}

// The most changes one case's step reads back: each is a product's API call or two.
export const ACCOUNT_CHANGES_MAX: number = 20;

// The product an event came from, by its vendor and product.
const OKTA_PRODUCT: string = "Okta System Log";
const ENTRA_ID_PRODUCT: string = "Microsoft Entra ID";
const GOOGLE_WORKSPACE_PRODUCT: string = "Google Workspace";

// Okta's placeholder for an object with no natural name.
const OKTA_PLACEHOLDER: string = "unknown";

function attribute(event: SecurityCaseEventSnapshot, key: string): string {
  const value: string | undefined = event.attributes[key];

  return typeof value === "string" ? value.trim() : "";
}

// A modified property's value, as Entra ID writes it: "\"Global Administrator\"".
export function readEntraPropertyValue(value: string): string {
  let text: string = value.trim();

  // A list of one ("[\"...\"]") is its value.
  if (text.startsWith("[") && text.endsWith("]")) {
    text = text.slice(1, -1).trim();
  }

  return text.split('"').join("").trim();
}

// The indexed objects of a flattened list: "target.0.id" - { id }, by index.
function readIndexed(
  event: SecurityCaseEventSnapshot,
  prefix: string,
): Array<Record<string, string>> {
  const items: Map<number, Record<string, string>> = new Map();
  const start: string = `${prefix}.`;

  for (const key of Object.keys(event.attributes)) {
    if (!key.startsWith(start)) {
      continue;
    }

    const rest: string = key.slice(start.length);
    const dot: number = rest.indexOf(".");

    if (dot <= 0) {
      continue;
    }

    const index: number = Number(rest.slice(0, dot));

    if (!Number.isInteger(index) || index < 0 || index > 50) {
      continue;
    }

    const field: string = rest.slice(dot + 1);
    const item: Record<string, string> = items.get(index) || {};

    item[field] = attribute(event, key);
    items.set(index, item);
  }

  return Array.from(items.entries())
    .sort(
      (
        left: [number, Record<string, string>],
        right: [number, Record<string, string>],
      ): number => {
        return left[0] - right[0];
      },
    )
    .map((entry: [number, Record<string, string>]): Record<string, string> => {
      return entry[1];
    });
}

function isProduct(event: SecurityCaseEventSnapshot, product: string): boolean {
  return event.productName.trim().toLowerCase() === product.toLowerCase();
}

function change(
  event: SecurityCaseEventSnapshot,
  data: Pick<AccountChange, "provider" | "kind" | "account" | "eventName"> &
    Partial<AccountChange>,
): AccountChange | null {
  const account: string = data.account.trim();

  if (!account) {
    return null;
  }

  return {
    provider: data.provider,
    kind: data.kind,
    account,
    accountId: (data.accountId || "").trim(),
    objectId: (data.objectId || "").trim(),
    objectName: (data.objectName || "").trim(),
    detailId: (data.detailId || "").trim(),
    ownerType: (data.ownerType || "").trim(),
    cloudAccountId: (data.cloudAccountId || "").trim(),
    cloudConnectionId: (data.cloudConnectionId || "").trim(),
    eventName: data.eventName,
    eventUid: event.eventUid,
    time: event.time,
  };
}

// ---------- Okta ----------

interface OktaTarget {
  id: string;
  type: string;
  alternateId: string;
  displayName: string;
}

function oktaTargets(event: SecurityCaseEventSnapshot): Array<OktaTarget> {
  return readIndexed(event, "target").map(
    (item: Record<string, string>): OktaTarget => {
      return {
        id: item["id"] || "",
        type: (item["type"] || "").toLowerCase(),
        alternateId:
          (item["alternateId"] || "").toLowerCase() === OKTA_PLACEHOLDER
            ? ""
            : item["alternateId"] || "",
        displayName: item["displayName"] || "",
      };
    },
  );
}

function oktaName(target: OktaTarget | undefined): string {
  return target ? target.alternateId || target.displayName : "";
}

export function readOktaAccountChange(
  event: SecurityCaseEventSnapshot,
): AccountChange | null {
  const eventType: string = attribute(event, "eventType").toLowerCase();
  const result: string = attribute(event, "outcome.result").toUpperCase();

  if (!eventType || (result && result !== "SUCCESS" && result !== "ALLOW")) {
    return null;
  }

  const targets: Array<OktaTarget> = oktaTargets(event);
  const user: OktaTarget | undefined = targets.find(
    (target: OktaTarget): boolean => {
      return target.type === "user";
    },
  );
  const other: OktaTarget | undefined = targets.find(
    (target: OktaTarget): boolean => {
      return target.type !== "user";
    },
  );
  const account: string = oktaName(user) || event.targetUser;
  const base: Pick<AccountChange, "provider" | "account" | "eventName"> & {
    accountId: string;
  } = {
    provider: AccountChangeProvider.Okta,
    account,
    accountId: user?.id || "",
    eventName: eventType,
  };

  switch (eventType) {
    case "group.user_membership.add":
      return change(event, {
        ...base,
        kind: AccountChangeKind.Group,
        objectId: other?.id || "",
        objectName: other?.displayName || other?.alternateId || "",
      });

    case "user.account.privilege.grant":
      return change(event, {
        ...base,
        kind: AccountChangeKind.AdminRole,
        objectName: attribute(event, "debugContext.debugData.privilegeGranted"),
      });

    case "user.mfa.factor.activate":
      return change(event, {
        ...base,
        kind: AccountChangeKind.MfaDevice,
        objectId: other?.id || "",
        objectName:
          other?.displayName ||
          attribute(event, "debugContext.debugData.factor") ||
          attribute(event, "debugContext.debugData.authenticatorType"),
      });

    case "application.user_membership.add":
      return change(event, {
        ...base,
        kind: AccountChangeKind.App,
        objectId: other?.id || "",
        objectName: other?.displayName || other?.alternateId || "",
      });

    // An API token acts with the rights of the admin who made it: theirs is the change.
    case "system.api_token.create":
      return change(event, {
        ...base,
        account: event.principalUser || account,
        accountId: attribute(event, "actor.id"),
        kind: AccountChangeKind.Key,
        objectId: other?.id || "",
        objectName: other?.displayName || "",
      });

    case "user.lifecycle.create":
      return change(event, { ...base, kind: AccountChangeKind.Account });

    default:
      return null;
  }
}

// ---------- Microsoft Entra ID ----------

interface EntraTarget {
  id: string;
  type: string;
  name: string;
  properties: Record<string, string>;
}

function entraTargets(event: SecurityCaseEventSnapshot): Array<EntraTarget> {
  return readIndexed(event, "targetResources").map(
    (item: Record<string, string>): EntraTarget => {
      const properties: Record<string, string> = {};

      for (let index: number = 0; index < 50; index++) {
        const name: string | undefined =
          item[`modifiedProperties.${index}.displayName`];

        if (name === undefined) {
          continue;
        }

        properties[name] = readEntraPropertyValue(
          item[`modifiedProperties.${index}.newValue`] || "",
        );
      }

      return {
        id: item["id"] || "",
        type: (item["type"] || "").toLowerCase(),
        name: item["userPrincipalName"] || item["displayName"] || "",
        properties,
      };
    },
  );
}

// The audits an Entra ID change is recorded as, by their name, lowercase.
export const ENTRA_ID_ACCOUNT_CHANGE_ACTIVITIES: Record<
  string,
  AccountChangeKind
> = {
  "add member to role": AccountChangeKind.AdminRole,
  "add member to group": AccountChangeKind.Group,
  "add app role assignment to user": AccountChangeKind.App,
  "user registered security info": AccountChangeKind.MfaDevice,
  "admin registered security info": AccountChangeKind.MfaDevice,
  "add service principal credentials": AccountChangeKind.Key,
  "update application – certificates and secrets management":
    AccountChangeKind.Key,
  "update application - certificates and secrets management":
    AccountChangeKind.Key,
  "add user": AccountChangeKind.Account,
};

// A key's id in Entra ID's KeyDescription: "[KeyIdentifier=..., KeyType=...]".
export function readEntraKeyIdentifier(description: string): string {
  const match: RegExpMatchArray | null = description.match(
    /KeyIdentifier=([0-9a-fA-F-]{36})/,
  );

  return match ? match[1]!.toLowerCase() : "";
}

function findProperty(targets: Array<EntraTarget>, name: string): string {
  for (const target of targets) {
    const value: string | undefined = target.properties[name];

    if (value) {
      return value;
    }
  }

  return "";
}

export function readEntraIdAccountChange(
  event: SecurityCaseEventSnapshot,
): AccountChange | null {
  if (
    attribute(event, "entra.log") &&
    attribute(event, "entra.log") !== "AuditLogs"
  ) {
    return null;
  }

  const activity: string = (
    attribute(event, "activityDisplayName") || event.activityName
  )
    .trim()
    .toLowerCase();
  const kind: AccountChangeKind | undefined =
    ENTRA_ID_ACCOUNT_CHANGE_ACTIVITIES[activity];
  const result: string = attribute(event, "result").toLowerCase();

  if (!kind || (result && result !== "success")) {
    return null;
  }

  const targets: Array<EntraTarget> = entraTargets(event);
  const ofType: (type: string) => EntraTarget | undefined = (
    type: string,
  ): EntraTarget | undefined => {
    return targets.find((target: EntraTarget): boolean => {
      return target.type === type;
    });
  };
  const user: EntraTarget | undefined = ofType("user");
  const base: Pick<AccountChange, "provider" | "account" | "eventName"> & {
    accountId: string;
  } = {
    provider: AccountChangeProvider.EntraId,
    account: user?.name || event.targetUser,
    accountId: user?.id || "",
    eventName: attribute(event, "activityDisplayName") || event.activityName,
  };

  switch (kind) {
    case AccountChangeKind.AdminRole: {
      const role: EntraTarget | undefined = ofType("role");

      return change(event, {
        ...base,
        kind,
        // A directory role is known by its template's id in every tenant.
        objectId:
          findProperty(targets, "Role.TemplateId") ||
          findProperty(targets, "Role.ObjectID") ||
          role?.id ||
          "",
        objectName:
          findProperty(targets, "Role.DisplayName") || role?.name || "",
      });
    }

    case AccountChangeKind.Group: {
      const group: EntraTarget | undefined = ofType("group");

      return change(event, {
        ...base,
        kind,
        objectId: group?.id || findProperty(targets, "Group.ObjectID"),
        objectName: group?.name || findProperty(targets, "Group.DisplayName"),
      });
    }

    case AccountChangeKind.App: {
      const servicePrincipal: EntraTarget | undefined =
        ofType("serviceprincipal");

      return change(event, {
        ...base,
        kind,
        objectId:
          servicePrincipal?.id ||
          findProperty(targets, "ServicePrincipal.ObjectID"),
        objectName:
          servicePrincipal?.name ||
          findProperty(targets, "ServicePrincipal.DisplayName"),
        detailId: findProperty(targets, "AppRole.Id"),
      });
    }

    case AccountChangeKind.MfaDevice:
      return change(event, {
        ...base,
        kind,
        objectName: attribute(event, "resultReason"),
      });

    case AccountChangeKind.Key: {
      // The app the key was made for: its registration, or its service principal.
      const owner: EntraTarget | undefined =
        ofType("application") || ofType("serviceprincipal");

      return change(event, {
        ...base,
        kind,
        account: owner?.name || "",
        accountId: owner?.id || "",
        ownerType:
          owner?.type === "application" ? "Application" : "ServicePrincipal",
        objectId: readEntraKeyIdentifier(
          findProperty(targets, "KeyDescription"),
        ),
        objectName:
          findProperty(targets, "KeyDescription")
            .match(/DisplayName=([^\],]+)/)?.[1]
            ?.trim() || "",
      });
    }

    case AccountChangeKind.Account:
      return change(event, { ...base, kind });

    default:
      return null;
  }
}

// ---------- Google Workspace ----------

export function readGoogleWorkspaceAccountChange(
  event: SecurityCaseEventSnapshot,
): AccountChange | null {
  const application: string = attribute(event, "id.applicationName");
  const name: string = attribute(event, "event.name");
  const actor: string = attribute(event, "actor.email") || event.principalUser;
  const userEmail: string = attribute(event, "parameters.USER_EMAIL");
  const base: Pick<AccountChange, "provider" | "eventName"> = {
    provider: AccountChangeProvider.GoogleWorkspace,
    eventName: name,
  };

  if (application === "admin") {
    switch (name) {
      case "GRANT_ADMIN_PRIVILEGE":
        return change(event, {
          ...base,
          kind: AccountChangeKind.AdminRole,
          account: userEmail,
          objectId: "SUPER_ADMIN",
          objectName: "Super Admin",
        });

      case "ASSIGN_ROLE":
        return change(event, {
          ...base,
          kind: AccountChangeKind.AdminRole,
          account: userEmail,
          objectName: attribute(event, "parameters.ROLE_NAME"),
        });

      case "ADD_GROUP_MEMBER":
        return change(event, {
          ...base,
          kind: AccountChangeKind.Group,
          account: userEmail,
          objectName: attribute(event, "parameters.GROUP_EMAIL"),
        });

      case "CREATE_USER":
        return change(event, {
          ...base,
          kind: AccountChangeKind.Account,
          account: userEmail,
        });

      default:
        return null;
    }
  }

  // An app the account gave access to its data: OAuth consent.
  if (application === "token" && name === "authorize") {
    return change(event, {
      ...base,
      kind: AccountChangeKind.App,
      account: actor,
      objectId: attribute(event, "parameters.client_id"),
      objectName:
        attribute(event, "parameters.app_name") ||
        attribute(event, "parameters.client_id"),
    });
  }

  if (application === "user_accounts" && name === "2sv_enroll") {
    return change(event, {
      ...base,
      kind: AccountChangeKind.MfaDevice,
      account: attribute(event, "parameters.affected_email_address") || actor,
    });
  }

  return null;
}

// ---------- AWS CloudTrail ----------

// What each IAM call gives, by its name.
export const AWS_IAM_ACCOUNT_CHANGES: Record<string, AccountChangeKind> = {
  CreateAccessKey: AccountChangeKind.Key,
  CreateLoginProfile: AccountChangeKind.Password,
  AttachUserPolicy: AccountChangeKind.Policy,
  PutUserPolicy: AccountChangeKind.Policy,
  AddUserToGroup: AccountChangeKind.Group,
  EnableMFADevice: AccountChangeKind.MfaDevice,
  CreateUser: AccountChangeKind.Account,
};

// The attributes a CloudTrail event the cloud connection read carries (CloudAuditSecurityEvents).
const CLOUD_AUDIT_ACCOUNT_ATTRIBUTE: string = "oneuptime.cloud.account_id";
const CLOUD_AUDIT_CONNECTION_ATTRIBUTE: string =
  "oneuptime.cloud.connection_id";

// An AWS account's id: twelve digits.
const AWS_ACCOUNT_ID: RegExp = /^\d{12}$/;

// A managed policy's name, the end of its ARN: "AdministratorAccess" of "arn:aws:iam::aws:policy/AdministratorAccess".
export function readAwsPolicyName(policyArn: string): string {
  const name: string = policyArn.slice(policyArn.lastIndexOf("/") + 1).trim();

  return name || policyArn.trim();
}

/*
 * The AWS account an IAM call was made in: the one that received it, as
 * CloudTrail records it, or the one the connection that read it reads.
 */
function readAwsAccountId(event: SecurityCaseEventSnapshot): string {
  for (const key of [
    "recipientAccountId",
    CLOUD_AUDIT_ACCOUNT_ATTRIBUTE,
    "userIdentity.accountId",
  ]) {
    const value: string = attribute(event, key);

    if (AWS_ACCOUNT_ID.test(value)) {
      return value;
    }
  }

  return "";
}

export function readAwsAccountChange(
  event: SecurityCaseEventSnapshot,
): AccountChange | null {
  const eventName: string = attribute(event, "eventName");
  const kind: AccountChangeKind | undefined =
    AWS_IAM_ACCOUNT_CHANGES[eventName];

  if (
    attribute(event, "eventSource") !== "iam.amazonaws.com" ||
    !kind ||
    attribute(event, "errorCode")
  ) {
    return null;
  }

  // The user it was made to; the caller's own user when it names none.
  const user: string =
    attribute(event, "requestParameters.userName") ||
    attribute(event, "userIdentity.userName");
  const policyArn: string = attribute(event, "requestParameters.policyArn");
  // What it gave, by its id in IAM, and its name.
  const objects: Record<AccountChangeKind, { id: string; name: string }> = {
    [AccountChangeKind.Key]: {
      id: attribute(event, "responseElements.accessKey.accessKeyId"),
      name: attribute(event, "responseElements.accessKey.accessKeyId"),
    },
    // A managed policy by its ARN; an inline one has none, only its name.
    [AccountChangeKind.Policy]: policyArn
      ? { id: policyArn, name: readAwsPolicyName(policyArn) }
      : { id: "", name: attribute(event, "requestParameters.policyName") },
    [AccountChangeKind.Group]: {
      id: "",
      name: attribute(event, "requestParameters.groupName"),
    },
    [AccountChangeKind.MfaDevice]: {
      id: attribute(event, "requestParameters.serialNumber"),
      name: attribute(event, "requestParameters.serialNumber"),
    },
    [AccountChangeKind.Password]: { id: "", name: "" },
    [AccountChangeKind.AdminRole]: { id: "", name: "" },
    [AccountChangeKind.App]: { id: "", name: "" },
    [AccountChangeKind.Account]: { id: "", name: "" },
  };

  return change(event, {
    provider: AccountChangeProvider.Aws,
    kind,
    account: user,
    objectId: objects[kind].id,
    objectName: objects[kind].name,
    cloudAccountId: readAwsAccountId(event),
    cloudConnectionId: attribute(event, CLOUD_AUDIT_CONNECTION_ATTRIBUTE),
    eventName,
  });
}

// ---------- A case's events ----------

// The change an event records, or null for one that records none.
export function readAccountChange(
  event: SecurityCaseEventSnapshot,
): AccountChange | null {
  if (isProduct(event, OKTA_PRODUCT) || attribute(event, "eventType")) {
    const okta: AccountChange | null = readOktaAccountChange(event);

    if (okta) {
      return okta;
    }
  }

  if (isProduct(event, ENTRA_ID_PRODUCT)) {
    return readEntraIdAccountChange(event);
  }

  if (isProduct(event, GOOGLE_WORKSPACE_PRODUCT)) {
    return readGoogleWorkspaceAccountChange(event);
  }

  return readAwsAccountChange(event);
}

/*
 * One change of each account and thing, whichever event said it first: a
 * user of one name in two AWS accounts is two accounts.
 */
function getChangeKey(item: AccountChange): string {
  return [
    item.provider,
    item.kind,
    item.cloudAccountId,
    (item.accountId || item.account).toLowerCase(),
    (item.objectId || item.objectName).toLowerCase(),
  ].join("|");
}

/*
 * The changes a case's events record, oldest first, each once: the events
 * its detections matched and the ones kept on it. At most
 * ACCOUNT_CHANGES_MAX.
 */
export function getAttackAccountChanges(data: {
  matches: SecurityCaseMatchesJson | null;
  keptEvents?: Array<SecurityCaseEventSnapshot> | undefined;
}): Array<AccountChange> {
  const events: Array<SecurityCaseEventSnapshot> = [
    ...(data.matches?.detections || []).flatMap(
      (detection: SecurityCaseMatchedDetectionJson) => {
        return detection.events;
      },
    ),
    ...(data.keptEvents || []),
  ];
  const changes: Map<string, AccountChange> = new Map();

  for (const event of events) {
    const found: AccountChange | null = readAccountChange(event);

    if (!found) {
      continue;
    }

    const key: string = getChangeKey(found);
    const known: AccountChange | undefined = changes.get(key);

    if (!known || Date.parse(found.time) < Date.parse(known.time)) {
      changes.set(key, found);
    }
  }

  return Array.from(changes.values())
    .sort((left: AccountChange, right: AccountChange): number => {
      return (Date.parse(left.time) || 0) - (Date.parse(right.time) || 0);
    })
    .slice(0, ACCOUNT_CHANGES_MAX);
}
