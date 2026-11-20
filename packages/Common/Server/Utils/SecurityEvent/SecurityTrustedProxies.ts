import Project from "../../../Models/DatabaseModels/Project";
import ObjectID from "../../../Types/ObjectID";
import {
  NO_TRUSTED_PROXIES,
  TrustedProxies,
  toTrustedProxies,
} from "../../../Utils/SecurityEvent/ClientAddressTrust";
import InMemoryTTLCache from "../../Infrastructure/InMemoryTTLCache";
import ProjectService from "../../Services/ProjectService";
import logger from "../Logger";

/*
 * THE PROXIES A PROJECT TRUSTS TO SAY WHO ITS CLIENT WAS (#10416), as the
 * scans read them: its Trusted Proxies (Project.securityTrustedProxies,
 * Security Events > Connections, under More settings). The private
 * addresses every project trusts need no reading
 * (Utils/SecurityEvent/ClientAddressTrust.isTrustedProxy).
 *
 * Read as OneUptime, once a minute a project - a person's change reaches
 * the scans within a minute - and failure-tolerant toward trusting less: a
 * read that fails is logged and the scan trusts only the private
 * addresses, so an address a proxy forwarded is claimed rather than
 * verified. Nothing a sender wrote is blamed because a read failed.
 *
 * The edges a project connects (Cloudflare, #10339) will join here: the
 * ranges of the edges #10338 works out a project sits behind.
 */

export const TRUSTED_PROXIES_CACHE_TTL_MS: number = 60 * 1000;

const MAX_CACHED_PROJECTS: number = 10_000;

const cache: InMemoryTTLCache<TrustedProxies> =
  new InMemoryTTLCache<TrustedProxies>(MAX_CACHED_PROJECTS);

export default class SecurityTrustedProxies {
  public static async getForProject(
    projectId: ObjectID,
  ): Promise<TrustedProxies> {
    const key: string = projectId.toString();
    const cached: TrustedProxies | undefined = cache.get(key);

    if (cached) {
      return cached;
    }

    let project: Project | null;

    try {
      project = await ProjectService.findOneById({
        id: projectId,
        select: { securityTrustedProxies: true },
        props: { isRoot: true },
      });
    } catch (error) {
      logger.warn(
        `SecurityTrustedProxies: could not read the trusted proxies of project ${key}; its scans trust only private addresses until they can.`,
      );
      logger.warn(error);
      return NO_TRUSTED_PROXIES;
    }

    const proxies: TrustedProxies = toTrustedProxies(
      project?.securityTrustedProxies,
    );

    cache.set(key, proxies, TRUSTED_PROXIES_CACHE_TTL_MS);

    return proxies;
  }

  // Forget what was read, so a test reads the proxies it set up.
  public static clearCache(): void {
    cache.clear();
  }
}
