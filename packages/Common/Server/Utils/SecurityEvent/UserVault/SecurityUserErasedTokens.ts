import InMemoryTTLCache from "../../../Infrastructure/InMemoryTTLCache";
import SecurityUserErasureRequestService from "../../../Services/SecurityUserErasureRequestService";
import ObjectID from "../../../../Types/ObjectID";
import logger from "../../Logger";

/*
 * THE TOKENS THE USER VAULT REFUSES (#10908).
 *
 * Once a person is erased from Security Events' user vault, the vault
 * never names them again - not when a later event carries their token, not
 * when a scan reads telemetry from before the erasure. A token is refused,
 * not kept again, from the moment the request is filed:
 *
 *   - ingest's writer never writes it to the vault again
 *     (SecurityUserVaultWriter), so the person's identity is not stored
 *     again only to go unused, and a write in flight when the erasure ran
 *     cannot bring them back;
 *   - and the scans never name it (SecurityUserVaultLookup), whatever the
 *     vault holds - so even a row that slipped in, written by a process
 *     that had not heard of the request yet, names nobody.
 *
 * The refused tokens are every token of the project's erasure requests
 * (SecurityUserErasureRequestService.getErasedTokensOfProject), read once a
 * minute a project and kept here. So a process refuses a token at most
 * ERASED_TOKENS_CACHE_TTL_MS after its request was filed, and the erasure
 * worker waits at least that long before it deletes the person's rows
 * (SecurityUserErasure.SUPPRESSION_SETTLE_MS).
 *
 * FAIL TOWARD PRIVACY: a read that fails refuses everything (null), and
 * the callers name nobody and keep nobody for the minute after.
 */

// How long a project's refused tokens are kept before they are read again.
export const ERASED_TOKENS_CACHE_TTL_MS: number = 60 * 1000;

// How long a read that failed refuses everything before it is tried again.
export const ERASED_TOKENS_FAILURE_TTL_MS: number = 10 * 1000;

// The most projects whose refused tokens one process keeps.
export const MAX_PROJECTS_WITH_ERASED_TOKENS: number = 10_000;

/*
 * A project's refused tokens, or null when they could not be read: every
 * token is then refused.
 */
export type ErasedTokens = ReadonlySet<string> | null;

const cache: InMemoryTTLCache<{ tokens: ErasedTokens }> = new InMemoryTTLCache<{
  tokens: ErasedTokens;
}>(MAX_PROJECTS_WITH_ERASED_TOKENS);

// The reads of a project's refused tokens on their way, by project.
const reads: Map<string, Promise<ErasedTokens>> = new Map<
  string,
  Promise<ErasedTokens>
>();

// Whether a token is refused: always, when the refused tokens could not be read.
export function isTokenErased(token: string, erased: ErasedTokens): boolean {
  return erased === null || erased.has(token);
}

export default class SecurityUserErasedTokens {
  /*
   * The tokens the vault refuses in a project: those of every erasure
   * request filed in it. Null when they could not be read. Never throws.
   */
  public static async getErasedTokens(
    projectId: ObjectID,
  ): Promise<ErasedTokens> {
    const key: string = projectId.toString();
    const cached: { tokens: ErasedTokens } | undefined = cache.get(key);

    if (cached) {
      return cached.tokens;
    }

    /*
     * One read a project at a time: the batches of a busy project that
     * miss the cache together wait for the same read, rather than each
     * asking Postgres the same question.
     */
    const reading: Promise<ErasedTokens> | undefined = reads.get(key);

    if (reading) {
      return await reading;
    }

    const read: Promise<ErasedTokens> = this.read(projectId).finally(
      (): void => {
        reads.delete(key);
      },
    );

    reads.set(key, read);

    return await read;
  }

  private static async read(projectId: ObjectID): Promise<ErasedTokens> {
    const key: string = projectId.toString();

    try {
      const tokens: Set<string> =
        await SecurityUserErasureRequestService.getErasedTokensOfProject(
          projectId,
        );

      cache.set(key, { tokens }, ERASED_TOKENS_CACHE_TTL_MS);

      return tokens;
    } catch (error) {
      logger.warn(
        `SecurityUserErasedTokens: could not read the erased users of project ${key}; the user vault names and keeps nobody of the project for now.`,
      );
      logger.warn(error);

      cache.set(key, { tokens: null }, ERASED_TOKENS_FAILURE_TTL_MS);

      return null;
    }
  }

  // Read a project's refused tokens again on the next ask: a request was just filed.
  public static forgetProject(projectId: ObjectID): void {
    cache.delete(projectId.toString());
  }

  // Forget every project's, so a test reads the requests it set up.
  public static clearCache(): void {
    cache.clear();
    reads.clear();
  }
}
