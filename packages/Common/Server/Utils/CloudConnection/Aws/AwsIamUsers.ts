import { CloudConnectionAuthMethod } from "../../../../Types/CloudConnection/CloudConnectionCatalog";
import { CloudConnectionFailureKind } from "../../../../Types/CloudConnection/CloudConnectionTest";
import Dictionary from "../../../../Types/Dictionary";
import ObjectID from "../../../../Types/ObjectID";
import DataSourceHttpFetch from "../../DataSource/HttpFetch";
import LlmProviderError from "../../LlmObservability/LlmProviderError";
import {
  CLOUD_DEFAULT_SLEEP,
  CloudConnectionSettings,
  CloudConnectorTransport,
  CloudReadBudget,
  readCloudSetting,
} from "../CloudConnectorTypes";
import {
  AwsCredentials,
  AwsPartition,
  awsErrorCodeOf,
  getAwsPartition,
  readXmlChildren,
  readXmlTag,
  sendAwsRequest,
} from "./AwsApi";
import AwsCloudConnector from "./AwsCloudConnector";
import { getIamEndpoint } from "./AwsInventory";

/*
 * WHAT AN IAM USER HOLDS, READ FOR A SECURITY CASE (#10900): whether what an
 * attack gave a user - the case's CloudTrail events name each - is still
 * there, asked of IAM through the project's AWS cloud connection with the
 * reads its "Security case checks" setting grants
 * (AWS_SECURITY_CASE_CHECKS_ACTIONS), and nothing else:
 *
 *   GetUser                    the user, or NoSuchEntity once it is deleted
 *   ListAccessKeys             each access key's id and whether it is active
 *   GetLoginProfile            whether the user has a console password, and
 *                              since when - NoSuchEntity when it has none
 *   ListAttachedUserPolicies   the managed policies attached to the user
 *   ListUserPolicies           the names of the user's inline policies
 *   ListGroupsForUser          the groups the user is in
 *   ListMFADevices             the MFA devices the user has enabled
 *
 * IAM is global: one endpoint a partition (getIamEndpoint), signed for its
 * Region, through the query protocol, answered in XML. A connection that
 * reads an organization signs in to the member account's role, by the name
 * its StackSet gave it, as every other read of a member account does.
 *
 * A refusal is AwsIamAccessNotGranted: the connection was not given the
 * read - its setting is off, or its setup command was not run again - and
 * the change is a person's to confirm. Any other failure is thrown as AWS
 * answered it, and never read as undone.
 */

export const AWS_IAM_PROVIDER_TITLE: string = "AWS IAM";

const IAM_VERSION: string = "2010-05-08";

// The most items one list asks for, and the pages one list reads at most.
const IAM_PAGE_SIZE: number = 1000;
export const AWS_IAM_MAX_LIST_PAGES: number = 5;

/*
 * One case's read of one account: two calls a change at most, twenty
 * changes a case (ACCOUNT_CHANGES_MAX), and the sign-in.
 */
const DEFAULT_MAX_REQUESTS: number = 60;
const DEFAULT_MAX_DURATION_MS: number = 60 * 1000;

// IAM's code for a user, or a user's login profile, that is not there.
const NO_SUCH_ENTITY: string = "NoSuchEntity";

// One read's way into one account's IAM.
export interface AwsIamSession {
  transport: CloudConnectorTransport;
  credentials: AwsCredentials;
  budget: CloudReadBudget;
  now?: (() => Date) | undefined;
  sleep: (milliseconds: number) => Promise<void>;
  partition: AwsPartition;
  // The account it reads.
  accountId: string;
  // "The role" or "The access key": who a refusal is about.
  subject: string;
}

export interface AwsIamCallOptions {
  transport?: CloudConnectorTransport | undefined;
  now?: (() => Date) | undefined;
  sleep?: ((milliseconds: number) => Promise<void>) | undefined;
  budget?: CloudReadBudget | undefined;
}

/*
 * AWS refused a read the connection was not given: the action, and who may
 * not call it.
 */
export class AwsIamAccessNotGranted extends Error {
  public readonly action: string;

  public constructor(data: { action: string; subject: string }) {
    super(
      `AWS refused ${data.action}: ${data.subject.toLowerCase()} may not call it. Turn on Security case checks for the connection, and run its setup command again.`,
    );
    this.name = "AwsIamAccessNotGranted";
    this.action = data.action;
  }
}

// The code IAM answered a failed call with, or "".
export function getAwsIamErrorCode(error: unknown): string {
  return error instanceof LlmProviderError
    ? awsErrorCodeOf(error.responseBody || "")
    : "";
}

/*
 * The partition a connection's account is in: its role's ARN says so
 * ("arn:aws-us-gov:..."); an access key's, the Regions it reads.
 */
export function getAwsIamPartition(
  settings: CloudConnectionSettings,
): AwsPartition {
  const roleArn: string = readCloudSetting(settings.config, "roleArn");
  const partition: string = roleArn.startsWith("arn:")
    ? roleArn.split(":")[1] || ""
    : "";

  if (partition === "aws-us-gov" || partition === "aws-cn") {
    return partition;
  }

  if (partition === "aws") {
    return "aws";
  }

  const regions: Array<string> = new AwsCloudConnector().getConfiguredRegions(
    settings,
  );

  return getAwsPartition(regions[0] || "us-east-1");
}

/*
 * Signs in to the account a change was made in: the connection's own
 * account, or - for a connection that reads an organization - the member
 * account's role, by the name the organization's StackSet gave it.
 */
export async function openAwsIamSession(
  settings: CloudConnectionSettings,
  options: AwsIamCallOptions & {
    connectionId: ObjectID;
    accountId: string;
  },
): Promise<AwsIamSession> {
  const connector: AwsCloudConnector = new AwsCloudConnector();

  connector.validateSettings(settings);

  const accountSettings: CloudConnectionSettings =
    connector.isOrganization(settings) && options.accountId
      ? connector.settingsForAccount(settings, options.accountId)
      : settings;
  const transport: CloudConnectorTransport =
    options.transport || DataSourceHttpFetch.fetch.bind(DataSourceHttpFetch);
  const budget: CloudReadBudget =
    options.budget ||
    new CloudReadBudget({
      maxRequests: DEFAULT_MAX_REQUESTS,
      maxDurationMs: DEFAULT_MAX_DURATION_MS,
    });
  const credentials: AwsCredentials = await connector.getCredentials(
    accountSettings,
    {
      transport,
      now: options.now,
      sleep: options.sleep,
      connectionId: options.connectionId.toString(),
      budget,
    },
  );

  return {
    transport,
    credentials,
    budget,
    now: options.now,
    sleep: options.sleep || CLOUD_DEFAULT_SLEEP,
    partition: getAwsIamPartition(settings),
    accountId: options.accountId,
    subject:
      connector.getAuthMethod(settings) === CloudConnectionAuthMethod.AwsRole
        ? "The role"
        : "The access key",
  };
}

/*
 * One IAM read: the XML IAM answered, or null for NoSuchEntity when the
 * caller reads that as "not there". A refusal is AwsIamAccessNotGranted.
 */
async function iamRead(
  session: AwsIamSession,
  data: {
    action: string;
    body: Dictionary<string>;
    step: string;
    missingIsNull?: boolean | undefined;
  },
): Promise<string | null> {
  const endpoint: { host: string; region: string } = getIamEndpoint(
    session.partition,
  );

  try {
    const answer: { text: string } = await sendAwsRequest({
      transport: session.transport,
      credentials: session.credentials,
      service: "iam",
      region: endpoint.region,
      host: endpoint.host,
      body: { Action: data.action, ...data.body, Version: IAM_VERSION },
      step: data.step,
      providerTitle: AWS_IAM_PROVIDER_TITLE,
      now: session.now,
      sleep: session.sleep,
      budget: session.budget,
    });

    return answer.text;
  } catch (error) {
    if (data.missingIsNull && getAwsIamErrorCode(error) === NO_SUCH_ENTITY) {
      return null;
    }

    if (
      error instanceof LlmProviderError &&
      error.kind === CloudConnectionFailureKind.Permission
    ) {
      throw new AwsIamAccessNotGranted({
        action: `iam:${data.action}`,
        subject: session.subject,
      });
    }

    throw error;
  }
}

/*
 * Every page of one list, each read with the Marker the last one ended
 * at: the items of each page, as `read` takes them from its XML. A list
 * longer than AWS_IAM_MAX_LIST_PAGES pages throws, rather than say
 * something is missing that may be on a page not read. Null when the user
 * is not there.
 */
async function iamList<T>(
  session: AwsIamSession,
  data: {
    action: string;
    userName: string;
    step: string;
    read: (xml: string) => Array<T>;
  },
): Promise<Array<T> | null> {
  const items: Array<T> = [];
  let marker: string = "";

  for (let page: number = 0; page < AWS_IAM_MAX_LIST_PAGES; page++) {
    const text: string | null = await iamRead(session, {
      action: data.action,
      body: {
        UserName: data.userName,
        MaxItems: String(IAM_PAGE_SIZE),
        ...(marker ? { Marker: marker } : {}),
      },
      step: data.step,
      missingIsNull: true,
    });

    if (text === null) {
      return null;
    }

    items.push(...data.read(text));

    const next: string = readXmlTag(text, "Marker");

    if (
      readXmlTag(text, "IsTruncated").toLowerCase() !== "true" ||
      !next ||
      next === marker
    ) {
      return items;
    }

    marker = next;
  }

  throw new Error(
    `${AWS_IAM_PROVIDER_TITLE} listed more for ${data.userName} than OneUptime reads, so it could not tell whether the change is still there.`,
  );
}

// The <member> elements directly inside a list's own element: one of each item.
function readMembers(xml: string, list: string): Array<string> {
  return readXmlChildren(readXmlTag(xml, list), "member");
}

export interface AwsIamUser {
  userName: string;
  userId: string;
  arn: string;
}

// The user, or null once IAM has none by that name.
export async function getAwsIamUser(
  session: AwsIamSession,
  userName: string,
): Promise<AwsIamUser | null> {
  const text: string | null = await iamRead(session, {
    action: "GetUser",
    body: { UserName: userName },
    step: "IAM user lookup",
    missingIsNull: true,
  });

  if (text === null) {
    return null;
  }

  const user: string = readXmlTag(text, "User");

  return {
    userName: readXmlTag(user, "UserName") || userName,
    userId: readXmlTag(user, "UserId"),
    arn: readXmlTag(user, "Arn"),
  };
}

export interface AwsIamAccessKey {
  accessKeyId: string;
  // "Active" or "Inactive", as IAM says it.
  status: string;
}

export function isAwsIamAccessKeyActive(key: AwsIamAccessKey): boolean {
  return key.status.toLowerCase() === "active";
}

// The user's access keys, or null when the user is not there.
export async function listAwsIamAccessKeys(
  session: AwsIamSession,
  userName: string,
): Promise<Array<AwsIamAccessKey> | null> {
  return await iamList<AwsIamAccessKey>(session, {
    action: "ListAccessKeys",
    userName,
    step: "IAM access key list",
    read: (xml: string): Array<AwsIamAccessKey> => {
      return readMembers(xml, "AccessKeyMetadata").map(
        (member: string): AwsIamAccessKey => {
          return {
            accessKeyId: readXmlTag(member, "AccessKeyId"),
            status: readXmlTag(member, "Status"),
          };
        },
      );
    },
  });
}

export interface AwsIamLoginProfile {
  // When the console password was set up: the profile's, kept by a password change.
  createdAt: Date | null;
}

/*
 * The user's console password, or null when it has none. Call it for a
 * user known to be there: IAM says NoSuchEntity either way.
 */
export async function getAwsIamLoginProfile(
  session: AwsIamSession,
  userName: string,
): Promise<AwsIamLoginProfile | null> {
  const text: string | null = await iamRead(session, {
    action: "GetLoginProfile",
    body: { UserName: userName },
    step: "IAM console password lookup",
    missingIsNull: true,
  });

  if (text === null) {
    return null;
  }

  const created: number = Date.parse(
    readXmlTag(readXmlTag(text, "LoginProfile"), "CreateDate"),
  );

  return { createdAt: Number.isNaN(created) ? null : new Date(created) };
}

export interface AwsIamAttachedPolicy {
  policyName: string;
  policyArn: string;
}

// The managed policies attached to the user, or null when the user is not there.
export async function listAwsIamAttachedUserPolicies(
  session: AwsIamSession,
  userName: string,
): Promise<Array<AwsIamAttachedPolicy> | null> {
  return await iamList<AwsIamAttachedPolicy>(session, {
    action: "ListAttachedUserPolicies",
    userName,
    step: "IAM attached policy list",
    read: (xml: string): Array<AwsIamAttachedPolicy> => {
      return readMembers(xml, "AttachedPolicies").map(
        (member: string): AwsIamAttachedPolicy => {
          return {
            policyName: readXmlTag(member, "PolicyName"),
            policyArn: readXmlTag(member, "PolicyArn"),
          };
        },
      );
    },
  });
}

// The names of the user's inline policies, or null when the user is not there.
export async function listAwsIamUserPolicyNames(
  session: AwsIamSession,
  userName: string,
): Promise<Array<string> | null> {
  return await iamList<string>(session, {
    action: "ListUserPolicies",
    userName,
    step: "IAM inline policy list",
    read: (xml: string): Array<string> => {
      return readMembers(xml, "PolicyNames").filter((name: string) => {
        return Boolean(name);
      });
    },
  });
}

export interface AwsIamGroup {
  groupName: string;
  groupId: string;
}

// The groups the user is in, or null when the user is not there.
export async function listAwsIamGroupsForUser(
  session: AwsIamSession,
  userName: string,
): Promise<Array<AwsIamGroup> | null> {
  return await iamList<AwsIamGroup>(session, {
    action: "ListGroupsForUser",
    userName,
    step: "IAM group list",
    read: (xml: string): Array<AwsIamGroup> => {
      return readMembers(xml, "Groups").map((member: string): AwsIamGroup => {
        return {
          groupName: readXmlTag(member, "GroupName"),
          groupId: readXmlTag(member, "GroupId"),
        };
      });
    },
  });
}

export interface AwsIamMfaDevice {
  // A virtual device's ARN, or a hardware device's serial number.
  serialNumber: string;
}

// The MFA devices the user has enabled, or null when the user is not there.
export async function listAwsIamMfaDevices(
  session: AwsIamSession,
  userName: string,
): Promise<Array<AwsIamMfaDevice> | null> {
  return await iamList<AwsIamMfaDevice>(session, {
    action: "ListMFADevices",
    userName,
    step: "IAM MFA device list",
    read: (xml: string): Array<AwsIamMfaDevice> => {
      return readMembers(xml, "MFADevices").map(
        (member: string): AwsIamMfaDevice => {
          return { serialNumber: readXmlTag(member, "SerialNumber") };
        },
      );
    },
  });
}

/*
 * A user's page in the AWS console, in the partition's own console, where a
 * person removes what the attack gave.
 */
export function getAwsIamUserUrl(
  partition: AwsPartition,
  userName: string,
): string {
  const host: string =
    partition === "aws-us-gov"
      ? "console.amazonaws-us-gov.com"
      : partition === "aws-cn"
        ? "console.amazonaws.cn"
        : "console.aws.amazon.com";

  return `https://${host}/iam/home#/users/details/${encodeURIComponent(userName)}`;
}
