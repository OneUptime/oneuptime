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
import {
  INCOMING_REQUEST_SECRET_DEFAULT_ACCESS,
  INCOMING_REQUEST_SECRET_HEADER,
  INCOMING_REQUEST_SIGNATURE_HEADER,
  INCOMING_REQUEST_SIGNATURE_TOLERANCE_SECONDS,
  IncomingRequestSecretProblem,
} from "../../../Types/Monitor/IncomingMonitor/IncomingRequestSecret";
import MonitorSecretAccess, {
  MonitorSecretAccessUtil,
} from "../../../Types/Monitor/MonitorSecretAccess";
import ObjectID from "../../../Types/ObjectID";

/*
 * Whether a project's Incoming Request monitors require one of its incoming
 * request secrets (Types/Monitor/IncomingMonitor/IncomingRequestSecret), and
 * which secrets those are - and the decision for one request.
 *
 * Read on every request to an Incoming Request monitor, by the ingest
 * endpoint and again by the worker, so it is kept in Redis for a minute
 * rather than read from Postgres each time: the project's switch, and the
 * SHA-256 of each of its secrets with the secret's id and which monitors it
 * covers (issue #8501). Never a secret itself. Turning the switch, or
 * creating, changing or deleting a secret, forgets it at once (forget, from
 * ProjectService and IncomingRequestSecretService), so a change applies to
 * the next request; the minute is the bound for the rare read that raced the
 * change, and for a Redis that could not be told.
 *
 * The secrets are read whether or not the project requires one yet: a
 * request is checked against them either way, so a monitor's senders that do
 * not send one yet are known before the requirement is turned on (issue
 * #8498, IncomingRequestSecretActivity).
 *
 * A request is accepted with a secret only when that secret covers the
 * request's monitor: one of the project's secrets that is limited to other
 * monitors is refused as a wrong one is, so tenant A's secret never opens
 * tenant B's monitors (issue #8501). Which of the two it was is kept on the
 * monitor (SecretNotForMonitor), for the people who manage the secrets; the
 * sender is told only that it is not one this monitor accepts.
 *
 * A Redis that cannot be reached is a miss: the policy is read from Postgres.
 * A project that requires a secret and has none refuses every request - the
 * switch cannot be turned on without one, nor the last one deleted while it
 * is on, so that only happens to a project changed outside OneUptime.
 */

export enum IncomingRequestSecretVerdict {
  // The project does not require a secret: the request goes on as before.
  NotRequired = "NotRequired",
  // The request presented one of the project's secrets that covers its monitor.
  Accepted = "Accepted",
  // The project requires a secret and the request presented none.
  Missing = "Missing",
  /*
   * The request presented a secret, and none was one of the project's that
   * covers its monitor - or a signature that could not be accepted.
   */
  NotRecognized = "NotRecognized",
}

export interface IncomingRequestSecretOfPolicy {
  secretId: string;
  // The SHA-256 (hex) of the secret (IncomingRequestSecretRequest.hashSecret).
  secretHash: string;
  /*
   * Which monitors accept it (MonitorSecretAccess) and the list its mode
   * reads. A policy kept before #8501 has none of these: All Monitors, as
   * every secret then was.
   */
  monitorAccess?: string | undefined;
  monitorIds?: Array<string> | undefined;
  labelIds?: Array<string> | undefined;
}

export interface IncomingRequestSecretPolicyValue {
  isRequired: boolean;
  // The project's secrets, whether or not it requires one yet.
  secrets: Array<IncomingRequestSecretOfPolicy>;
}

// The monitor a request is for, as far as which secrets cover it goes.
export interface IncomingRequestSecretMonitor {
  monitorId: string | undefined;
  // Its labels' ids: read only when a secret of the project is label-scoped.
  labelIds: Array<string>;
}

export interface IncomingRequestSecretDecision {
  verdict: IncomingRequestSecretVerdict;
  // The secret the request presented, when it presented one that covers its monitor.
  matchedSecretId?: string | undefined;
  /*
   * Whatever the project requires: whether the request sent one of the
   * project's secrets that covers its monitor - for the monitor's record of
   * requests with and without one (IncomingRequestSecretActivity).
   * Undefined while the project has no secret: there is nothing to have
   * sent.
   */
  sentValidSecret?: boolean | undefined;
  // Why it did not, when it did not.
  problem?: IncomingRequestSecretProblem | undefined;
  /*
   * The SHA-256 of each presented secret that matched none of the project's
   * secrets covering the monitor: what a refused request counts as its wrong
   * guesses (WrongIncomingRequestSecretLimit).
   */
  wrongSecretHashes: Array<string>;
}

export const INCOMING_REQUEST_SECRET_MISSING_MESSAGE: string = `This project requires a secret on every incoming request. Send one of the project's incoming request secrets in the ${INCOMING_REQUEST_SECRET_HEADER} header or as a Bearer token in the Authorization header, or sign the request with one (${INCOMING_REQUEST_SIGNATURE_HEADER}). Whoever manages them finds them under Monitors > Settings > Incoming Request Secrets.`;

export const INCOMING_REQUEST_SECRET_NOT_RECOGNIZED_MESSAGE: string = `The secret sent with this request is not one of this project's incoming request secrets that this monitor accepts, or its signature was not made with one. Check the value in the ${INCOMING_REQUEST_SECRET_HEADER} header, the Authorization header or the signature against Monitors > Settings > Incoming Request Secrets, where whoever manages them can also create a new one.`;

export const INCOMING_REQUEST_SIGNATURE_EXPIRED_MESSAGE: string = `This request's signature was made more than ${INCOMING_REQUEST_SIGNATURE_TOLERANCE_SECONDS / 60} minutes away from OneUptime's clock, so it is refused: a request someone captured cannot be sent again later. Sign each request when you send it, with the current time, and check the sender's clock.`;

export const INCOMING_REQUEST_SIGNATURE_REPLAYED_MESSAGE: string =
  "A request with this signature was already received, so this one is refused: a signed request is accepted once. Sign each request again when you send it.";

export default class IncomingRequestSecretPolicy {
  /*
   * "-v3": a policy kept by a server from before #8501 has no monitor access
   * for its secrets, and must not be read as one whose secrets cover every
   * monitor; "-v2" before it, for #8498's secrets read before the
   * requirement.
   */
  public static readonly NAMESPACE: string =
    "incoming-request-secret-policy-v3";

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

  // Whether any of the policy's secrets is limited to monitors with labels.
  public static hasLabelScopedSecret(
    policy: IncomingRequestSecretPolicyValue,
  ): boolean {
    return policy.secrets.some(
      (secret: IncomingRequestSecretOfPolicy): boolean => {
        return secret.monitorAccess === MonitorSecretAccess.MonitorsWithLabels;
      },
    );
  }

  /*
   * Whether a secret of the policy covers a monitor, by the rule monitor
   * secrets keep. A request whose monitor is not known (a test, a caller
   * from before #8501) is judged as a monitor nobody listed, with no labels.
   */
  public static coversMonitor(data: {
    secret: IncomingRequestSecretOfPolicy;
    monitor: IncomingRequestSecretMonitor | undefined;
  }): boolean {
    // Both are the policy's project: the policy is read per project.
    const projectId: string = "policy";

    return MonitorSecretAccessUtil.canMonitorUseSecret({
      secret: {
        projectId: projectId,
        monitorAccess:
          data.secret.monitorAccess || INCOMING_REQUEST_SECRET_DEFAULT_ACCESS,
        monitorIds: data.secret.monitorIds || [],
        labelIds: data.secret.labelIds || [],
      },
      monitor: {
        monitorId: data.monitor?.monitorId,
        projectId: projectId,
        labelIds: data.monitor?.labelIds || [],
      },
    });
  }

  /*
   * What a request that presented these secrets gets under this policy, for
   * this monitor. `signatureProblem` is why a signature it presented was not
   * accepted before its secrets were compared (an expired one), when it
   * presented one.
   */
  public static decide(data: {
    policy: IncomingRequestSecretPolicyValue;
    presentedSecretHashes: ReadonlyArray<string> | undefined;
    monitor?: IncomingRequestSecretMonitor | undefined;
    signatureProblem?: IncomingRequestSecretProblem | undefined;
  }): IncomingRequestSecretDecision {
    const presented: ReadonlyArray<string> = data.presentedSecretHashes || [];

    const covering: Array<IncomingRequestSecretOfPolicy> =
      data.policy.secrets.filter(
        (secret: IncomingRequestSecretOfPolicy): boolean => {
          return this.coversMonitor({ secret, monitor: data.monitor });
        },
      );

    /*
     * Compared in constant time for every pair: first with the secrets that
     * cover the monitor, then - only for a request none of those accepts -
     * with every one of the project's, so a secret the monitor does not
     * accept is told apart from a wrong one on the monitor's record.
     */
    const matchedHash: string | null =
      presented.length === 0
        ? null
        : IncomingRequestSecretRequest.findMatchingHash({
            presentedSecretHashes: presented,
            projectSecretHashes: this.getHashes(covering),
          });

    const matched: IncomingRequestSecretOfPolicy | undefined = matchedHash
      ? covering.find((secret: IncomingRequestSecretOfPolicy): boolean => {
          return secret.secretHash === matchedHash;
        })
      : undefined;

    const isProjectSecretForOtherMonitors: boolean =
      !matched &&
      presented.length > 0 &&
      IncomingRequestSecretRequest.findMatchingHash({
        presentedSecretHashes: presented,
        projectSecretHashes: this.getHashes(data.policy.secrets),
      }) !== null;

    const problem: IncomingRequestSecretProblem | undefined = matched
      ? undefined
      : isProjectSecretForOtherMonitors
        ? IncomingRequestSecretProblem.SecretNotForMonitor
        : presented.length > 0
          ? IncomingRequestSecretProblem.WrongSecret
          : data.signatureProblem || IncomingRequestSecretProblem.NoSecret;

    // None of them was one the monitor accepts: each was a wrong guess.
    const wrongSecretHashes: Array<string> = matched ? [] : [...presented];

    const presentation: Pick<
      IncomingRequestSecretDecision,
      "sentValidSecret" | "problem"
    > =
      data.policy.secrets.length > 0
        ? { sentValidSecret: !problem, problem: problem }
        : {};

    if (!data.policy.isRequired) {
      return {
        verdict: IncomingRequestSecretVerdict.NotRequired,
        matchedSecretId: matched?.secretId,
        wrongSecretHashes: [],
        ...presentation,
      };
    }

    if (problem === IncomingRequestSecretProblem.NoSecret) {
      return {
        verdict: IncomingRequestSecretVerdict.Missing,
        wrongSecretHashes: [],
        ...presentation,
      };
    }

    if (problem) {
      return {
        verdict: IncomingRequestSecretVerdict.NotRecognized,
        wrongSecretHashes: wrongSecretHashes,
        ...presentation,
      };
    }

    return {
      verdict: IncomingRequestSecretVerdict.Accepted,
      matchedSecretId: matched?.secretId,
      wrongSecretHashes: [],
      ...presentation,
    };
  }

  public static isRefused(verdict: IncomingRequestSecretVerdict): boolean {
    return (
      verdict === IncomingRequestSecretVerdict.Missing ||
      verdict === IncomingRequestSecretVerdict.NotRecognized
    );
  }

  /*
   * What the sender is told when its request is refused. A secret the
   * monitor does not accept is worded as a wrong one: the sender is not told
   * that it is one of the project's.
   */
  public static getRefusalMessage(
    verdict: IncomingRequestSecretVerdict,
    problem?: IncomingRequestSecretProblem | undefined,
  ): string {
    if (verdict !== IncomingRequestSecretVerdict.NotRecognized) {
      return INCOMING_REQUEST_SECRET_MISSING_MESSAGE;
    }

    return problem === IncomingRequestSecretProblem.ExpiredSignature
      ? INCOMING_REQUEST_SIGNATURE_EXPIRED_MESSAGE
      : INCOMING_REQUEST_SECRET_NOT_RECOGNIZED_MESSAGE;
  }

  /*
   * A request sent this secret - accepted, or one that would be once the
   * project requires a secret: stamp its lastUsedAt, at most
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

    if (!project) {
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
          monitorAccess: true,
          monitors: {
            _id: true,
          },
          labels: {
            _id: true,
          },
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    return {
      isRequired: Boolean(project.requireIncomingRequestSecret),
      secrets: secrets
        .filter((secret: IncomingRequestSecret): boolean => {
          return Boolean(secret.id && secret.secretValue?.trim());
        })
        .map((secret: IncomingRequestSecret): IncomingRequestSecretOfPolicy => {
          const access: string =
            secret.monitorAccess || INCOMING_REQUEST_SECRET_DEFAULT_ACCESS;

          return {
            secretId: secret.id!.toString(),
            secretHash: IncomingRequestSecretRequest.hashSecret(
              secret.secretValue!,
            ),
            monitorAccess: access,
            // Only the list the mode reads: the other grants nothing.
            monitorIds:
              access === MonitorSecretAccess.SpecificMonitors
                ? this.getIds(secret.monitors)
                : [],
            labelIds:
              access === MonitorSecretAccess.MonitorsWithLabels
                ? this.getIds(secret.labels)
                : [],
          };
        }),
    };
  }

  private static getHashes(
    secrets: Array<IncomingRequestSecretOfPolicy>,
  ): Array<string> {
    return secrets.map((secret: IncomingRequestSecretOfPolicy): string => {
      return secret.secretHash;
    });
  }

  private static getIds(
    items: Array<{ id: ObjectID | null }> | undefined,
  ): Array<string> {
    const ids: Array<string> = [];

    for (const item of items || []) {
      if (item.id) {
        ids.push(item.id.toString().toLowerCase());
      }
    }

    return ids;
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
      const monitorAccess: unknown = (keptSecret as JSONObject)?.[
        "monitorAccess"
      ];
      const monitorIds: unknown = (keptSecret as JSONObject)?.["monitorIds"];
      const labelIds: unknown = (keptSecret as JSONObject)?.["labelIds"];

      if (
        typeof secretId !== "string" ||
        typeof secretHash !== "string" ||
        typeof monitorAccess !== "string" ||
        !this.isListOfStrings(monitorIds) ||
        !this.isListOfStrings(labelIds)
      ) {
        return null;
      }

      secrets.push({
        secretId,
        secretHash,
        monitorAccess,
        monitorIds: monitorIds as Array<string>,
        labelIds: labelIds as Array<string>,
      });
    }

    return {
      isRequired: kept["isRequired"] as boolean,
      secrets,
    };
  }

  private static isListOfStrings(value: unknown): boolean {
    return (
      Array.isArray(value) &&
      value.every((item: unknown): boolean => {
        return typeof item === "string";
      })
    );
  }
}
