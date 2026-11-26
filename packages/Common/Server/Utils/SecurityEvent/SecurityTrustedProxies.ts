import Project from "../../../Models/DatabaseModels/Project";
import ObjectID from "../../../Types/ObjectID";
import NetworkAddressBlockUtil, {
  NetworkAddressBlock,
} from "../../../Utils/NetworkTraffic/NetworkAddressBlock";
import {
  NO_TRUSTED_PROXIES,
  TrustedProxies,
  toTrustedProxies,
} from "../../../Utils/SecurityEvent/ClientAddressTrust";
import InMemoryTTLCache from "../../Infrastructure/InMemoryTTLCache";
import ProjectService from "../../Services/ProjectService";
import logger from "../Logger";
import SecurityEdgeRanges, {
  SecurityEdge,
} from "../SecurityBlocklist/SecurityEdgeRanges";
import SecurityOwnLoadBalancers from "./SecurityOwnLoadBalancers";

/*
 * THE PROXIES A PROJECT TRUSTS TO SAY WHO ITS CLIENT WAS (#10416), as the
 * scans read them:
 *
 *   - its Trusted Proxies (Project.securityTrustedProxies, Security Events
 *     > Connections, under More settings);
 *   - the published ranges of the edges it has connected - the edge in
 *     front of its apps, which #10338 works out (SecurityEdgeRanges: a
 *     project with a Cloudflare connection, enabled or paused, is behind
 *     Cloudflare, #10565). Behind such an edge every request comes from one
 *     of its addresses, and the client is the one it forwards;
 *   - the public addresses of its own application load balancers, which
 *     add the client they forward to X-Forwarded-For (#10546,
 *     SecurityOwnLoadBalancers), unless it turned that off
 *     (Project.securityTrustOwnLoadBalancers). Never its hosts, nodes or
 *     probes: they forward nobody, and trusted, whatever ran on them could
 *     name any client.
 *
 * With them, whether its access logs end with X-Forwarded-For
 * (Project.securityReadAccessLogForwardedFor, #10548), which only the
 * project can say.
 *
 * The private addresses every project trusts need no reading
 * (Utils/SecurityEvent/ClientAddressTrust.isTrustedProxy).
 *
 * Read as OneUptime, once a minute a project - a person's change reaches
 * the scans within a minute - and failure-tolerant toward trusting less: a
 * read that fails is logged, the scan trusts what could be read (the
 * private addresses at least), and the next scan reads again. So an
 * address a proxy forwarded is claimed rather than verified: nothing a
 * sender wrote is blamed because a read failed.
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
        select: {
          securityTrustedProxies: true,
          securityTrustOwnLoadBalancers: true,
          securityReadAccessLogForwardedFor: true,
        },
        props: { isRoot: true },
      });
    } catch (error) {
      logger.warn(
        `SecurityTrustedProxies: could not read the trusted proxies of project ${key}; its scans trust only private addresses until they can.`,
      );
      logger.warn(error);
      return NO_TRUSTED_PROXIES;
    }

    // Only a project that said so has its access logs read for the header.
    const readsAccessLogForwardedFor: boolean =
      project?.securityReadAccessLogForwardedFor === true;

    const listed: TrustedProxies = {
      ...toTrustedProxies(project?.securityTrustedProxies),
      readsAccessLogForwardedFor,
    };

    let edgeBlocks: Array<NetworkAddressBlock>;

    try {
      edgeBlocks = await SecurityTrustedProxies.readEdgeBlocks(projectId);
    } catch (error) {
      logger.warn(
        `SecurityTrustedProxies: could not read the edges project ${key} sits behind; its scans trust its Trusted Proxies and private addresses until they can.`,
      );
      logger.warn(error);

      // Not kept: the next scan reads the edges again.
      return listed;
    }

    const withEdges: TrustedProxies = {
      blocks: [...listed.blocks, ...edgeBlocks],
      readsAccessLogForwardedFor,
    };

    // On unless the project turned it off: a project that never said is on.
    let ownBlocks: Array<NetworkAddressBlock> = [];

    if (project?.securityTrustOwnLoadBalancers !== false) {
      try {
        ownBlocks = await SecurityOwnLoadBalancers.getTrustedBlocks(projectId);
      } catch (error) {
        logger.warn(
          `SecurityTrustedProxies: could not read the load balancers of project ${key}; its scans trust its Trusted Proxies, its edges and private addresses until they can.`,
        );
        logger.warn(error);

        // Not kept: the next scan reads the load balancers again.
        return withEdges;
      }
    }

    const proxies: TrustedProxies = {
      blocks: [...withEdges.blocks, ...ownBlocks],
      readsAccessLogForwardedFor,
    };

    cache.set(key, proxies, TRUSTED_PROXIES_CACHE_TTL_MS);

    return proxies;
  }

  // The published ranges of the edges the project has connected.
  public static async readEdgeBlocks(
    projectId: ObjectID,
  ): Promise<Array<NetworkAddressBlock>> {
    const blocks: Array<NetworkAddressBlock> = [];
    const edges: Array<SecurityEdge> =
      await SecurityEdgeRanges.findConnectedEdges(projectId);

    for (const edge of edges) {
      for (const range of await SecurityEdgeRanges.getRanges(edge)) {
        const block: NetworkAddressBlock | null =
          NetworkAddressBlockUtil.parse(range);

        if (block) {
          blocks.push(block);
        }
      }
    }

    return blocks;
  }

  // Forget what was read, so a test reads the proxies it set up.
  public static clearCache(): void {
    cache.clear();
    SecurityOwnLoadBalancers.clearCache();
  }
}
