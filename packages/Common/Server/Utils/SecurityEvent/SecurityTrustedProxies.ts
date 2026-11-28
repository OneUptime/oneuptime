import Project from "../../../Models/DatabaseModels/Project";
import ObjectID from "../../../Types/ObjectID";
import NetworkAddressBlockUtil, {
  NetworkAddressBlock,
} from "../../../Utils/NetworkTraffic/NetworkAddressBlock";
import {
  TrustedProxies,
  toTrustedProxies,
} from "../../../Utils/SecurityEvent/ClientAddressTrust";
import { readAccessLogFormat } from "../../../Utils/SecurityEvent/LogParsers/AccessLogFormat";
import {
  NO_TRUSTED_PROXY_SOURCES,
  TrustedEdgeRanges,
  TrustedProxySources,
  UNREAD_TRUSTED_PROXY_SOURCES,
  trustedProxiesOf,
} from "../../../Utils/SecurityEvent/TrustedProxySources";
import InMemoryTTLCache from "../../Infrastructure/InMemoryTTLCache";
import ProjectService from "../../Services/ProjectService";
import logger from "../Logger";
import SecurityEdgeRanges, {
  SecurityEdge,
} from "../SecurityBlocklist/SecurityEdgeRanges";
import SecurityOwnLoadBalancers, {
  SecurityOwnLoadBalancerBlocks,
} from "./SecurityOwnLoadBalancers";

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
 *     name any client;
 *   - with them, Google's front ends, which a connected Google Cloud
 *     project's global external Application Load Balancer reaches the app
 *     from, unless something of the project's that passes a client's
 *     request on as sent connects from them too (#11047,
 *     SecurityOwnLoadBalancers.readGoogleFrontEnds);
 *   - private addresses, unlisted, unless the project turned that off
 *     (Project.securityTrustPrivateAddresses, #11389): on for every project
 *     from before the switch, off for a new one.
 *
 * Never trusted, whatever lists them: where the project's load balancers
 * that pass on what a client wrote connect from (#11389,
 * SecurityOwnLoadBalancers, Utils/SecurityEvent/PassOnLoadBalancers) - a
 * Google Cloud proxy Network Load Balancer's proxy-only subnet, an AWS
 * Network Load Balancer's subnets while it does not keep the client's
 * address, Google's front ends while a TCP or SSL proxy load balancer
 * connects from them. Read whether or not the project trusts its own load
 * balancers.
 *
 * With them, whether its access logs end with X-Forwarded-For
 * (Project.securityReadAccessLogForwardedFor, #10548), and the format they
 * are written in, when it gave it (Project.securityAccessLogFormat,
 * #11048), which only the project can say.
 *
 * Read as OneUptime, once a minute a project - a person's change reaches
 * the scans within a minute - and failure-tolerant toward trusting less: a
 * read that fails is logged, the scan trusts what could be read, and the
 * next scan reads again; a project that cannot be read at all trusts no
 * proxy, not even a private one (UNREAD_TRUSTED_PROXY_SOURCES). So an
 * address a proxy forwarded is claimed rather than verified: nothing a
 * sender wrote is blamed because a read failed.
 *
 * Check a log line reads the same sources the same way (readSources), as
 * they are now rather than as a scan kept them, and turns them into what
 * the parsers read with the same function (trustedProxiesOf), so what it
 * shows is what a scan stores (#11046).
 */

export const TRUSTED_PROXIES_CACHE_TTL_MS: number = 60 * 1000;

const MAX_CACHED_PROJECTS: number = 10_000;

const cache: InMemoryTTLCache<TrustedProxies> =
  new InMemoryTTLCache<TrustedProxies>(MAX_CACHED_PROJECTS);

export interface TrustedProxySourcesRead {
  sources: TrustedProxySources;
  /*
   * False when a source could not be read and was left out: what was read
   * is trusted, and nothing of it is kept, so the next scan reads again.
   */
  isComplete: boolean;
}

export default class SecurityTrustedProxies {
  public static async getForProject(
    projectId: ObjectID,
  ): Promise<TrustedProxies> {
    const key: string = projectId.toString();
    const cached: TrustedProxies | undefined = cache.get(key);

    if (cached) {
      return cached;
    }

    const read: TrustedProxySourcesRead | null =
      await SecurityTrustedProxies.readSources(projectId);

    // A project that cannot be read trusts no proxy, not even a private one (#11389).
    if (!read) {
      return trustedProxiesOf(UNREAD_TRUSTED_PROXY_SOURCES);
    }

    const proxies: TrustedProxies = trustedProxiesOf(read.sources);

    if (read.isComplete) {
      cache.set(key, proxies, TRUSTED_PROXIES_CACHE_TTL_MS);
    }

    return proxies;
  }

  /*
   * Each source of the project's trusted proxies, read now; null when the
   * project itself cannot be read, which trusts no proxy at all. A source
   * that fails is left out, and private addresses with it (#11389), toward
   * trusting less, and the read says it is not complete.
   */
  public static async readSources(
    projectId: ObjectID,
  ): Promise<TrustedProxySourcesRead | null> {
    const key: string = projectId.toString();
    let project: Project | null;

    try {
      project = await ProjectService.findOneById({
        id: projectId,
        select: {
          securityTrustedProxies: true,
          securityTrustOwnLoadBalancers: true,
          securityTrustPrivateAddresses: true,
          securityReadAccessLogForwardedFor: true,
          securityAccessLogFormat: true,
        },
        props: { isRoot: true },
      });
    } catch (error) {
      logger.warn(
        `SecurityTrustedProxies: could not read the trusted proxies of project ${key}; its scans trust no proxy until they can.`,
      );
      logger.warn(error);
      return null;
    }

    /*
     * Only a project that said so has its access logs read for the header:
     * its lines' last field (#10548), or where its own format puts it
     * (#11048). A format the server would refuse now is read as none.
     */
    const listed: TrustedProxySources = {
      ...NO_TRUSTED_PROXY_SOURCES,
      listed: toTrustedProxies(project?.securityTrustedProxies).blocks,
      /*
       * Private addresses are trusted unlisted unless the project turned
       * that off (#11389): a project that never said - one from before the
       * switch, which the migration left on - trusts them as it did. A new
       * project starts with it off.
       */
      trustsPrivateAddresses: project?.securityTrustPrivateAddresses !== false,
      readsAccessLogForwardedFor:
        project?.securityReadAccessLogForwardedFor === true,
      accessLogFormat: readAccessLogFormat(project?.securityAccessLogFormat)
        .format,
    };

    let edges: Array<TrustedEdgeRanges>;

    try {
      edges = await SecurityTrustedProxies.readEdges(projectId);
    } catch (error) {
      logger.warn(
        `SecurityTrustedProxies: could not read the edges project ${key} sits behind; its scans trust its Trusted Proxies alone until they can.`,
      );
      logger.warn(error);

      /*
       * Not kept: the next scan reads the edges again. Nor are private
       * addresses trusted meanwhile (#11389): what of them a load balancer
       * that passes on what a client wrote connects from was not read.
       */
      return {
        sources: { ...listed, trustsPrivateAddresses: false },
        isComplete: false,
      };
    }

    const withEdges: TrustedProxySources = { ...listed, edges };

    try {
      /*
       * Their own addresses, and Google's front ends when a Google Cloud
       * Application Load Balancer of the project's brings them (#11047):
       * the same switch turns both off - on unless the project turned it
       * off, so a project that never said is on. Where the ones that pass
       * on what a client wrote connect from is never trusted, whatever the
       * switch says (#11389): read either way.
       */
      const own: SecurityOwnLoadBalancerBlocks =
        await SecurityOwnLoadBalancers.getTrusted(projectId);
      const trustsOwn: boolean =
        project?.securityTrustOwnLoadBalancers !== false;

      return {
        sources: {
          ...withEdges,
          ownLoadBalancers: trustsOwn ? own.loadBalancers : [],
          googleFrontEnds: trustsOwn ? own.googleFrontEnds : [],
          untrusted: own.untrusted,
        },
        isComplete: true,
      };
    } catch (error) {
      logger.warn(
        `SecurityTrustedProxies: could not read the load balancers of project ${key}; its scans trust its Trusted Proxies and its edges until they can.`,
      );
      logger.warn(error);

      /*
       * Not kept: the next scan reads the load balancers again. Nor are
       * private addresses trusted meanwhile (#11389): where its load
       * balancers that pass on what a client wrote connect from is what
       * could not be read, and trusting less is what a failed read does.
       */
      return {
        sources: { ...withEdges, trustsPrivateAddresses: false },
        isComplete: false,
      };
    }
  }

  // The published ranges of the edges the project has connected, by edge.
  public static async readEdges(
    projectId: ObjectID,
  ): Promise<Array<TrustedEdgeRanges>> {
    const read: Array<TrustedEdgeRanges> = [];
    const edges: Array<SecurityEdge> =
      await SecurityEdgeRanges.findConnectedEdges(projectId);

    for (const edge of edges) {
      const blocks: Array<NetworkAddressBlock> = [];

      for (const range of await SecurityEdgeRanges.getRanges(edge)) {
        const block: NetworkAddressBlock | null =
          NetworkAddressBlockUtil.parse(range);

        if (block) {
          blocks.push(block);
        }
      }

      read.push({ name: edge.name, blocks });
    }

    return read;
  }

  // The published ranges of the edges the project has connected.
  public static async readEdgeBlocks(
    projectId: ObjectID,
  ): Promise<Array<NetworkAddressBlock>> {
    return (await SecurityTrustedProxies.readEdges(projectId)).flatMap(
      (edge: TrustedEdgeRanges): ReadonlyArray<NetworkAddressBlock> => {
        return edge.blocks;
      },
    );
  }

  // Forget what was read, so a test reads the proxies it set up.
  public static clearCache(): void {
    cache.clear();
    SecurityOwnLoadBalancers.clearCache();
  }
}
