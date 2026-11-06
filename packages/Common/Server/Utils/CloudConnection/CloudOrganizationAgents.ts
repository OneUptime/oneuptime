import CloudAccount from "../../../Models/DatabaseModels/CloudAccount";
import CloudConnection from "../../../Models/DatabaseModels/CloudConnection";
import ResourceAiAgent from "../../../Models/DatabaseModels/ResourceAiAgent";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import {
  CLOUD_ORGANIZATION_MAX_ACCOUNTS,
  CloudOrganizationAccountView,
  CloudOrganizationAgentState,
  CloudOrganizationView,
  NOT_AN_ORGANIZATION,
  getAwsOrganizationManagementAccountId,
} from "../../../Types/CloudConnection/CloudOrganizationAgents";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import AiResourceType from "../../../Types/ResourceAiAgent/AiResourceType";
import CloudAccountService from "../../Services/CloudAccountService";
import CloudConnectionService from "../../Services/CloudConnectionService";
import ResourceAiAgentService from "../../Services/ResourceAiAgentService";
import QueryHelper from "../../Types/Database/QueryHelper";
import CaptureSpan from "../Telemetry/CaptureSpan";

/*
 * WHICH ACCOUNTS OF AN AWS ORGANIZATION A CLOUD AI AGENT COVERS.
 *
 * A cloud account is one of an organization's when the cloud connection
 * that found it reads an AWS Organization: its role is the management
 * account's, and the same role in each member account reads that account
 * (CloudConnectionSetupScope.Organization). Its organization's accounts are
 * the AWS cloud accounts that connection found, and its management account
 * is the account of the connection's role.
 *
 * What the organization's accounts are, and where each one's agent is, is
 * read here for "Let AI fix problems" (Types/CloudConnection/
 * CloudOrganizationAgents): the accounts listed are those the person asking
 * may read - their own read, so nothing they may not see is named - and
 * the connection and the agents are read as OneUptime, in the person's
 * project only.
 */

export interface CloudOrganizationOfAccount {
  connectionId: ObjectID;
  managementAccountId: string;
}

export default class CloudOrganizationAgents {
  /*
   * The organization a cloud account is in, from the connection that found
   * it, or null: not an AWS account, found by no connection, or by one that
   * reads one account alone.
   */
  @CaptureSpan()
  public static async findOrganization(data: {
    projectId: ObjectID;
    cloudAccountId: ObjectID;
  }): Promise<CloudOrganizationOfAccount | null> {
    const account: CloudAccount | null = await CloudAccountService.findOneBy({
      query: {
        _id: data.cloudAccountId.toString(),
        projectId: data.projectId,
        provider: CloudProvider.AWS,
      },
      select: { _id: true, cloudConnectionId: true },
      props: { isRoot: true },
    });

    if (!account || !account.cloudConnectionId) {
      return null;
    }

    const connection: CloudConnection | null =
      await CloudConnectionService.findOneBy({
        query: {
          _id: account.cloudConnectionId.toString(),
          projectId: data.projectId,
          provider: CloudProvider.AWS,
        },
        select: { _id: true, config: true },
        props: { isRoot: true },
      });

    if (!connection || !connection.id) {
      return null;
    }

    const managementAccountId: string | null =
      CloudOrganizationAgents.readManagementAccountId(connection.config);

    return managementAccountId
      ? { connectionId: connection.id, managementAccountId }
      : null;
  }

  /*
   * The management account of a connection that reads an AWS Organization
   * with an IAM role - its role's account - or null for any other.
   */
  public static readManagementAccountId(
    config: JSONObject | null | undefined,
  ): string | null {
    return getAwsOrganizationManagementAccountId(config);
  }

  /*
   * The organization's accounts the caller may read (props), the management
   * account first, then by name, with one more than the limit asked for to
   * tell whether there are more.
   */
  @CaptureSpan()
  public static async findAccounts(data: {
    projectId: ObjectID;
    connectionId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<CloudAccount>> {
    return await CloudAccountService.findBy({
      query: {
        projectId: data.projectId,
        cloudConnectionId: data.connectionId,
        provider: CloudProvider.AWS,
      },
      select: { _id: true, accountId: true, name: true },
      sort: { name: SortOrder.Ascending },
      limit: CLOUD_ORGANIZATION_MAX_ACCOUNTS + 1,
      skip: 0,
      props: data.props,
    });
  }

  // What the dialog shows: the organization, and where each account's agent is.
  @CaptureSpan()
  public static async getView(data: {
    projectId: ObjectID;
    cloudAccountId: ObjectID;
    props: DatabaseCommonInteractionProps;
    now: Date;
  }): Promise<CloudOrganizationView> {
    const organization: CloudOrganizationOfAccount | null =
      await CloudOrganizationAgents.findOrganization(data);

    if (!organization) {
      return NOT_AN_ORGANIZATION;
    }

    const found: Array<CloudAccount> =
      await CloudOrganizationAgents.findAccounts({
        projectId: data.projectId,
        connectionId: organization.connectionId,
        props: data.props,
      });
    const accounts: Array<CloudAccount> = found
      .filter((account: CloudAccount): boolean => {
        return Boolean(account.id && account.accountId);
      })
      .slice(0, CLOUD_ORGANIZATION_MAX_ACCOUNTS);
    const agents: Map<string, ResourceAiAgent> =
      await CloudOrganizationAgents.findAgents({
        projectId: data.projectId,
        cloudAccountIds: accounts.map((account: CloudAccount): ObjectID => {
          return account.id!;
        }),
      });
    const rows: Array<CloudOrganizationAccountView> = accounts.map(
      (account: CloudAccount): CloudOrganizationAccountView => {
        const agent: ResourceAiAgent | undefined = agents.get(
          account.id!.toString(),
        );

        return {
          cloudAccountId: account.id!.toString(),
          accountId: account.accountId || "",
          name: account.name || account.accountId || "",
          isManagementAccount:
            account.accountId === organization.managementAccountId,
          agent: CloudOrganizationAgents.getAgentState(agent, data.now),
          lastSeenAt: agent?.lastAliveAt
            ? new Date(agent.lastAliveAt).toISOString()
            : null,
        };
      },
    );

    // The management account first: the one the command runs in.
    rows.sort(
      (
        left: CloudOrganizationAccountView,
        right: CloudOrganizationAccountView,
      ): number => {
        return (
          Number(right.isManagementAccount) - Number(left.isManagementAccount)
        );
      },
    );

    return {
      isOrganization: true,
      managementAccountId: organization.managementAccountId,
      accounts: rows,
      isTruncated: found.length > CLOUD_ORGANIZATION_MAX_ACCOUNTS,
    };
  }

  // Connected now, connected once and silent since, or never.
  public static getAgentState(
    agent: ResourceAiAgent | undefined,
    now: Date,
  ): CloudOrganizationAgentState {
    if (!agent) {
      return "none";
    }

    return ResourceAiAgentService.isOnline(agent, now)
      ? "connected"
      : "offline";
  }

  // The accounts' agents, by cloud account id, read as OneUptime.
  @CaptureSpan()
  public static async findAgents(data: {
    projectId: ObjectID;
    cloudAccountIds: Array<ObjectID>;
  }): Promise<Map<string, ResourceAiAgent>> {
    const byAccount: Map<string, ResourceAiAgent> = new Map();

    if (data.cloudAccountIds.length === 0) {
      return byAccount;
    }

    const agents: Array<ResourceAiAgent> = await ResourceAiAgentService.findBy({
      query: {
        projectId: data.projectId,
        resourceType: AiResourceType.AwsAccount,
        resourceId: QueryHelper.any(data.cloudAccountIds),
      },
      select: {
        _id: true,
        resourceId: true,
        connectionStatus: true,
        lastAliveAt: true,
      },
      limit: data.cloudAccountIds.length,
      skip: 0,
      props: { isRoot: true },
    });

    for (const agent of agents) {
      if (agent.resourceId) {
        byAccount.set(agent.resourceId.toString(), agent);
      }
    }

    return byAccount;
  }
}
