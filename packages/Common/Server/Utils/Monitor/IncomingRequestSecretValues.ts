import IncomingRequestSecretService from "../../Services/IncomingRequestSecretService";
import IncomingRequestSecretRequest from "./IncomingRequestSecretRequest";
import {
  IncomingRequestSecretOfPolicy,
  IncomingRequestSecretPolicyValue,
} from "./IncomingRequestSecretPolicy";
import { SigningSecret } from "./IncomingRequestSignature";
import IncomingRequestSecret from "../../../Models/DatabaseModels/IncomingRequestSecret";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import OldestKeyMap from "../../../Utils/OldestKeyMap";

/*
 * The values of a project's incoming request secrets, for checking a
 * request's signature with (IncomingRequestSignature, issue #8500).
 *
 * A signature is an HMAC made with the secret itself, so it cannot be checked
 * with the SHA-256 the policy keeps (IncomingRequestSecretPolicy). The values
 * are read from Postgres - decrypted as any read of the column is - and kept
 * in this process alone, for a minute at most: never in Redis, never in a
 * log, and only for a project a signed request came for.
 *
 * What is kept answers only for the secrets the policy lists, and only while
 * a value's SHA-256 is the one the policy has for it: a secret deleted is
 * gone from the policy at once (it is forgotten on every change), and one
 * created since is read on the first signed request that needs it.
 */

interface KeptValues {
  readAt: number;
  // By secret id: the value, and the SHA-256 the policy compares it as.
  values: Map<string, { value: string; hash: string }>;
}

export default class IncomingRequestSecretValues {
  public static readonly KEEP_FOR_MS: number = 60 * 1000;

  // At most this many projects' values at once: the oldest go first.
  public static readonly MAX_PROJECTS: number = 1000;

  private static kept: OldestKeyMap<string, KeptValues> = new OldestKeyMap();

  // The values of the policy's secrets: from this process, else Postgres.
  public static async getSigningSecrets(data: {
    projectId: ObjectID;
    policy: IncomingRequestSecretPolicyValue;
  }): Promise<Array<SigningSecret>> {
    if (data.policy.secrets.length === 0) {
      return [];
    }

    const key: string = data.projectId.toString();
    const now: number = Date.now();

    let kept: KeptValues | undefined = this.kept.get(key);

    if (
      !kept ||
      now - kept.readAt > this.KEEP_FOR_MS ||
      !this.hasEvery(kept, data.policy.secrets)
    ) {
      kept = await this.read(data.projectId);
      this.keep(key, kept);
    }

    const secrets: Array<SigningSecret> = [];

    for (const secret of data.policy.secrets) {
      const value: { value: string; hash: string } | undefined =
        kept.values.get(secret.secretId);

      if (value && value.hash === secret.secretHash) {
        secrets.push({ secretId: secret.secretId, value: value.value });
      }
    }

    return secrets;
  }

  // Forgets every value this process keeps: for tests.
  public static forgetAll(): void {
    this.kept.clear();
  }

  private static hasEvery(
    kept: KeptValues,
    secrets: Array<IncomingRequestSecretOfPolicy>,
  ): boolean {
    return secrets.every((secret: IncomingRequestSecretOfPolicy): boolean => {
      return kept.values.get(secret.secretId)?.hash === secret.secretHash;
    });
  }

  private static async read(projectId: ObjectID): Promise<KeptValues> {
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

    const values: Map<string, { value: string; hash: string }> = new Map();

    for (const secret of secrets) {
      const value: string = secret.secretValue?.trim() || "";

      if (!secret.id || !value) {
        continue;
      }

      values.set(secret.id.toString(), {
        value: value,
        hash: IncomingRequestSecretRequest.hashSecret(value),
      });
    }

    return { readAt: Date.now(), values };
  }

  private static keep(key: string, kept: KeptValues): void {
    this.kept.delete(key);
    this.kept.set(key, kept);

    while (this.kept.size > this.MAX_PROJECTS) {
      const oldest: string | undefined = this.kept.oldestKey();

      if (oldest === undefined) {
        break;
      }

      this.kept.delete(oldest);
    }
  }
}
