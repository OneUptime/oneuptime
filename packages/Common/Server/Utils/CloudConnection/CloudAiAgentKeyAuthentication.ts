import CloudAccount from "../../../Models/DatabaseModels/CloudAccount";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import {
  CLOUD_AI_AGENT_KEY_REFUSED_MESSAGE,
  CloudAiAgentKeyMatch,
  CloudAiAgentKeys,
  getLiveCloudAiAgentKeyHashes,
  parseCloudAiAgentKey,
} from "../../../Types/CloudConnection/CloudAiAgentKey";
import ObjectID from "../../../Types/ObjectID";
import GlobalCache from "../../Infrastructure/GlobalCache";
import CloudAccountService from "../../Services/CloudAccountService";
import logger from "../Logger";
import CloudAiAgentKeyHashing from "./CloudAiAgentKeyHashing";

/*
 * WHO A CLOUD AI AGENT'S REGISTRATION IS FROM.
 *
 * A Cloud AI agent set up since agents have keys of their own registers
 * (POST /resource-ai-agent-ingest/register) with its account's key in
 * x-oneuptime-token, where an ingestion key would be. The key names its
 * account (Types/CloudConnection/CloudAiAgentKey), so the account it may
 * register for, and the project that account is in, come from the key:
 * nothing the request says can change them. A key is taken when its SHA-256
 * matches the account's agent key, or a key made for a setup command that
 * still works.
 *
 * Wrong keys are not counted per client, as a probe's or a Runner's are
 * (WrongComponentKeyLimit): like an AI agent's own key, this one is made by
 * the server from 32 random bytes nobody chooses and kept only as a hash
 * nobody may read, so trying one after another never finds one. A right key
 * is held to CLOUD_AI_AGENT_REGISTRATIONS_PER_MINUTE registrations a minute
 * for its account, counted only once it is right: a stranger who knows an
 * account's id cannot use up its agent's registrations.
 */

// What an agent registers with, about a minute's restarts at most.
export const CLOUD_AI_AGENT_REGISTRATIONS_PER_MINUTE: number = 30;

const REGISTRATION_NAMESPACE: string = "cloud-ai-agent-registration";
const WINDOW_MS: number = 60 * 1000;

export const CLOUD_AI_AGENT_REGISTRATIONS_THROTTLED_MESSAGE: string = `This Cloud AI agent registered more than ${CLOUD_AI_AGENT_REGISTRATIONS_PER_MINUTE} times in the last minute, so OneUptime refuses it for now. Wait for the time in the Retry-After header; if it lasts, check that only one agent runs for the account.`;

export interface CloudAiAgentKeyAuthorized {
  isAuthorized: true;
  projectId: ObjectID;
  cloudAccountId: ObjectID;
  provider: CloudProvider;
  // The cloud's own id of the account.
  accountId: string;
  // The SHA-256 of the key presented, and which of the account's keys it is.
  keyHash: string;
  match: CloudAiAgentKeyMatch;
}

export interface CloudAiAgentKeyRefused {
  isAuthorized: false;
  // 401: not the account's key. 429: too many registrations.
  status: 401 | 429;
  message: string;
  retryAfterSeconds?: number | undefined;
}

export type CloudAiAgentKeyAuthentication =
  | CloudAiAgentKeyAuthorized
  | CloudAiAgentKeyRefused;

export default class CloudAiAgentKeyAuthenticator {
  public static async authenticate(data: {
    key: unknown;
    now: Date;
  }): Promise<CloudAiAgentKeyAuthentication> {
    const parsed: { cloudAccountId: string; secret: string } | null =
      parseCloudAiAgentKey(data.key);

    if (!parsed) {
      return CloudAiAgentKeyAuthenticator.refused();
    }

    const cloudAccountId: ObjectID = new ObjectID(parsed.cloudAccountId);
    const found: {
      account: CloudAccount;
      keys: CloudAiAgentKeys | null;
    } | null = await CloudAccountService.findAccountOfAgentKey(cloudAccountId);

    const match: { hash: string; match: CloudAiAgentKeyMatch } | null =
      CloudAiAgentKeyHashing.findMatch(
        data.key,
        getLiveCloudAiAgentKeyHashes({
          keys: found ? found.keys : null,
          now: data.now,
        }),
      );

    if (!found || !match || !found.account.projectId) {
      return CloudAiAgentKeyAuthenticator.refused();
    }

    if (
      !(await CloudAiAgentKeyAuthenticator.takeRegistration({
        cloudAccountId,
        now: data.now,
      }))
    ) {
      return {
        isAuthorized: false,
        status: 429,
        message: CLOUD_AI_AGENT_REGISTRATIONS_THROTTLED_MESSAGE,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((WINDOW_MS - (data.now.getTime() % WINDOW_MS)) / 1000),
        ),
      };
    }

    return {
      isAuthorized: true,
      projectId: found.account.projectId,
      cloudAccountId,
      provider: found.account.provider as CloudProvider,
      accountId: (found.account.accountId || "").trim(),
      keyHash: match.hash,
      match: match.match,
    };
  }

  /*
   * One registration of the account's minute, counted in the shared cache
   * (GlobalCache.incrementIfBelow: one atomic evaluation that adds one only
   * while the count is below the limit). A cache that cannot be reached
   * counts nothing: the key was right, and registering is how the account's
   * agent connects at all.
   */
  public static async takeRegistration(data: {
    cloudAccountId: ObjectID;
    now: Date;
  }): Promise<boolean> {
    try {
      const count: number | null = await GlobalCache.incrementIfBelow(
        REGISTRATION_NAMESPACE,
        `${data.cloudAccountId.toString()}:${Math.floor(
          data.now.getTime() / WINDOW_MS,
        )}`,
        {
          limit: CLOUD_AI_AGENT_REGISTRATIONS_PER_MINUTE,
          expiresInSeconds: (2 * WINDOW_MS) / 1000,
        },
      );

      return count !== null;
    } catch (error) {
      logger.debug(
        `Cloud AI agent registrations of account ${data.cloudAccountId.toString()} are not counted: the cache could not be reached (${
          error instanceof Error ? error.message : String(error)
        }).`,
      );

      return true;
    }
  }

  private static refused(): CloudAiAgentKeyRefused {
    return {
      isAuthorized: false,
      status: 401,
      message: CLOUD_AI_AGENT_KEY_REFUSED_MESSAGE,
    };
  }
}
