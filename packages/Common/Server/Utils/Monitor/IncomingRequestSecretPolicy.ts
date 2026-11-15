import GlobalCache from "../../Infrastructure/GlobalCache";
import IncomingRequestSecretService from "../../Services/IncomingRequestSecretService";
import ProjectService from "../../Services/ProjectService";
import logger from "../Logger";
import IncomingRequestSecretRequest from "./IncomingRequestSecretRequest";
import IncomingRequestSecret from "../../../Models/DatabaseModels/IncomingRequestSecret";
import Project from "../../../Models/DatabaseModels/Project";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import { INCOMING_REQUEST_SECRET_HEADER } from "../../../Types/Monitor/IncomingMonitor/IncomingRequestSecret";
import ObjectID from "../../../Types/ObjectID";

/*
 * Whether a project's Incoming Request monitors require one of its incoming
 * request secrets (Types/Monitor/IncomingMonitor/IncomingRequestSecret), and
 * which secrets those are - and the decision for one request.
 *
 * Read on every request to an Incoming Request monitor, by the ingest
 * endpoint and again by the worker, so it is kept in Redis for a minute
 * rather than read from Postgres each time: the project's switch, and the
 * SHA-256 of each of its secrets with the secret's id. Never a secret itself.
 * Turning the switch, or creating or deleting a secret, forgets it at once
 * (forget, from ProjectService and IncomingRequestSecretService), so a change
 * applies to the next request; the minute is the bound for the rare read that
 * raced the change, and for a Redis that could not be told.
 *
 * A Redis that cannot be reached is a miss: the policy is read from Postgres.
 * A project that requires a secret and has none refuses every request - the
 * switch cannot be turned on without one, nor the last one deleted while it
 * is on, so that only happens to a project changed outside OneUptime.
 */

export enum IncomingRequestSecretVerdict {
  // The project does not require a secret: the request goes on as before.
  NotRequired = "NotRequired",
  // The request presented one of the project's secrets.
  Accepted = "Accepted",
  // The project requires a secret and the request presented none.
  Missing = "Missing",
  // The request presented a secret, and none was one of the project's.
  NotRecognized = "NotRecognized",
}

export interface IncomingRequestSecretOfPolicy {
  secretId: string;
  // The SHA-256 (hex) of the secret (IncomingRequestSecretRequest.hashSecret).
  secretHash: string;
}

export interface IncomingRequestSecretPolicyValue {
  isRequired: boolean;
  // The project's secrets while it requires one; empty otherwise.
  secrets: Array<IncomingRequestSecretOfPolicy>;
}

export interface IncomingRequestSecretDecision {
  verdict: IncomingRequestSecretVerdict;
  // The secret the request presented, when the verdict is Accepted.
  matchedSecretId?: string | undefined;
}

export const INCOMING_REQUEST_SECRET_MISSING_MESSAGE: string = `This project requires a secret on every incoming request. Send one of the project's incoming request secrets in the ${INCOMING_REQUEST_SECRET_HEADER} header, or as a Bearer token in the Authorization header. A project owner or admin finds them under Monitors > Settings > Incoming Request Secrets.`;

export const INCOMING_REQUEST_SECRET_NOT_RECOGNIZED_MESSAGE: string = `The secret sent with this request is not one of this project's incoming request secrets. Check the value in the ${INCOMING_REQUEST_SECRET_HEADER} header or the Authorization header against Monitors > Settings > Incoming Request Secrets, where a project owner or admin can also create a new one.`;

export default class IncomingRequestSecretPolicy {
  public static readonly NAMESPACE: string = "incoming-request-secret-policy";

  public static readonly EXPIRES_IN_SECONDS: number = 60;

  /*
   * lastUsedAt answers "is anything still sending this secret, so can I
   * delete it?" - written at most every five minutes per secret, across
   * every pod, so a sender calling every second costs one write in five
   * minutes, not three hundred.
   */
  public static readonly LAST_USED_NAMESPACE: string =
    "incoming-request-secret-used";

  public static readonly LAST_USED_EVERY_SECONDS: number = 5 * 60;

  // The project's policy: from Redis when it is kept there, else Postgres.
  public static async getPolicy(
    projectId: ObjectID,
  ): Promise<IncomingRequestSecretPolicyValue> {
    const key: string = projectId.toString();

    try {
      const kept: JSONObject | null = await GlobalCache.getJSONObject(
        this.NAMESPACE,
        key,
      );

      const policy: IncomingRequestSecretPolicyValue | null =
        this.fromKept(kept);

      if (policy) {
        return policy;
      }
    } catch (err) {
      logger.debug(
        "Could not read a project's incoming request secret policy from the cache. Reading it from the database.",
      );
      logger.debug(err);
    }

    const policy: IncomingRequestSecretPolicyValue =
      await this.loadPolicy(projectId);

    try {
      await GlobalCache.setJSON(
        this.NAMESPACE,
        key,
        policy as unknown as JSONObject,
        {
          expiresInSeconds: this.EXPIRES_IN_SECONDS,
        },
      );
    } catch (err) {
      logger.debug(
        "Could not keep a project's incoming request secret policy in the cache.",
      );
      logger.debug(err);
    }

    return policy;
  }

  // The project's switch or secrets changed: read them again next time.
  public static async forget(projectId: ObjectID | string): Promise<void> {
    try {
      await GlobalCache.deleteKey(this.NAMESPACE, projectId.toString());
    } catch (err) {
      logger.error(
        "Could not forget a project's incoming request secret policy. The change applies within a minute.",
      );
      logger.error(err);
    }
  }

  // What a request that presented these secrets gets under this policy.
  public static decide(data: {
    policy: IncomingRequestSecretPolicyValue;
    presentedSecretHashes: ReadonlyArray<string> | undefined;
  }): IncomingRequestSecretDecision {
    if (!data.policy.isRequired) {
      return { verdict: IncomingRequestSecretVerdict.NotRequired };
    }

    const presented: ReadonlyArray<string> = data.presentedSecretHashes || [];

    if (presented.length === 0) {
      return { verdict: IncomingRequestSecretVerdict.Missing };
    }

    const matchedHash: string | null =
      IncomingRequestSecretRequest.findMatchingHash({
        presentedSecretHashes: presented,
        projectSecretHashes: data.policy.secrets.map(
          (secret: IncomingRequestSecretOfPolicy): string => {
            return secret.secretHash;
          },
        ),
      });

    if (!matchedHash) {
      return { verdict: IncomingRequestSecretVerdict.NotRecognized };
    }

    const matched: IncomingRequestSecretOfPolicy | undefined =
      data.policy.secrets.find(
        (secret: IncomingRequestSecretOfPolicy): boolean => {
          return secret.secretHash === matchedHash;
        },
      );

    return {
      verdict: IncomingRequestSecretVerdict.Accepted,
      matchedSecretId: matched?.secretId,
    };
  }

  public static isRefused(verdict: IncomingRequestSecretVerdict): boolean {
    return (
      verdict === IncomingRequestSecretVerdict.Missing ||
      verdict === IncomingRequestSecretVerdict.NotRecognized
    );
  }

  // What the sender is told when its request is refused.
  public static getRefusalMessage(
    verdict: IncomingRequestSecretVerdict,
  ): string {
    return verdict === IncomingRequestSecretVerdict.NotRecognized
      ? INCOMING_REQUEST_SECRET_NOT_RECOGNIZED_MESSAGE
      : INCOMING_REQUEST_SECRET_MISSING_MESSAGE;
  }

  /*
   * A request was accepted with this secret: stamp its lastUsedAt, at most
   * every LAST_USED_EVERY_SECONDS. Never throws - it is bookkeeping, and must
   * never fail the request that was accepted.
   */
  public static async recordUse(secretId: string | undefined): Promise<void> {
    if (!secretId || !ObjectID.isValidUUID(secretId)) {
      return;
    }

    try {
      const isFirstInWindow: boolean = await GlobalCache.setStringIfNotExists(
        this.LAST_USED_NAMESPACE,
        secretId,
        "1",
        { expiresInSeconds: this.LAST_USED_EVERY_SECONDS },
      );

      if (!isFirstInWindow) {
        return;
      }

      /*
       * One hook-free UPDATE of the one column, as an ingestion key's stamp
       * is: no hooks, so a passive stamp does not forget the cached policy,
       * and no updatedAt, so it never reads as someone changing the secret.
       */
      await IncomingRequestSecretService.updateColumnsByIdWithoutHooks({
        id: new ObjectID(secretId),
        data: {
          lastUsedAt: OneUptimeDate.getCurrentDate(),
        },
        skipUpdateDateColumn: true,
      });
    } catch (err) {
      logger.debug(
        "Could not record when an incoming request secret was used.",
      );
      logger.debug(err);
    }
  }

  // The policy as Postgres has it.
  public static async loadPolicy(
    projectId: ObjectID,
  ): Promise<IncomingRequestSecretPolicyValue> {
    const project: Project | null = await ProjectService.findOneById({
      id: projectId,
      select: {
        requireIncomingRequestSecret: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!project?.requireIncomingRequestSecret) {
      return { isRequired: false, secrets: [] };
    }

    const secrets: Array<IncomingRequestSecret> =
      await IncomingRequestSecretService.findBy({
        query: {
          projectId: projectId,
        },
        select: {
          _id: true,
          secretValue: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    return {
      isRequired: true,
      secrets: secrets
        .filter((secret: IncomingRequestSecret): boolean => {
          return Boolean(secret.id && secret.secretValue?.trim());
        })
        .map((secret: IncomingRequestSecret): IncomingRequestSecretOfPolicy => {
          return {
            secretId: secret.id!.toString(),
            secretHash: IncomingRequestSecretRequest.hashSecret(
              secret.secretValue!,
            ),
          };
        }),
    };
  }

  // A policy as it was kept, or null when what was kept is not one.
  private static fromKept(
    kept: JSONObject | null,
  ): IncomingRequestSecretPolicyValue | null {
    if (!kept || typeof kept["isRequired"] !== "boolean") {
      return null;
    }

    const keptSecrets: unknown = kept["secrets"];

    if (!Array.isArray(keptSecrets)) {
      return null;
    }

    const secrets: Array<IncomingRequestSecretOfPolicy> = [];

    for (const keptSecret of keptSecrets) {
      const secretId: unknown = (keptSecret as JSONObject)?.["secretId"];
      const secretHash: unknown = (keptSecret as JSONObject)?.["secretHash"];

      if (typeof secretId !== "string" || typeof secretHash !== "string") {
        return null;
      }

      secrets.push({ secretId, secretHash });
    }

    return {
      isRequired: kept["isRequired"] as boolean,
      secrets,
    };
  }
}
