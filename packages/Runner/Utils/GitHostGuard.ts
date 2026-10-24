import DataSourceEgressGuard, {
  EgressGuardOptions,
  ResolvedAddress,
} from "Common/Server/Utils/DataSource/EgressGuard";
import CodeHostHttp, {
  CodeHostTransport,
} from "Common/Server/Utils/CodeRepository/CodeHost/CodeHostHttp";
import { CodeHostRunnerInfo } from "Common/Types/CodeRepository/CodeHost";
import GlobalRunnerMode from "./GlobalRunnerMode";
import net from "net";

/*
 * WHERE A RUNNER MAY TAKE A REPOSITORY THAT IS NOT ON GITHUB.
 *
 * A GitLab, Forgejo, Gitea or Git server is an address a project member
 * typed, so a Runner reaches it the way OneUptime's server reaches any such
 * address (Common's EgressGuard):
 *
 *   - never loopback, link-local (the 169.254.169.254 cloud metadata
 *     address), reserved or multicast addresses - on any Runner, whose own
 *     host and cloud credentials are not the repository's to reach;
 *   - a global Runner, which works for every project, reaches the internet
 *     only - never a private network address, and never plain http - unless
 *     the server says it may (CodeHostRunnerInfo.isPrivateNetworkAllowed):
 *     a self-hosted OneUptime's global Runner runs on its operator's own
 *     network, as the server does, and reaches what the server reaches. On
 *     OneUptime Cloud a repository on a private network is worked in by
 *     one of the project's own Runners on that network;
 *   - git is pinned to the addresses that were checked (http.curloptResolve),
 *     so a name that resolves elsewhere a moment later is not followed, and
 *     follows no redirect (http.followRedirects).
 *
 * The pull and merge request APIs are called through the same rules
 * (getTransport).
 */

export const GLOBAL_RUNNER_PRIVATE_GIT_SERVER_HINT: string =
  " A global Runner reaches Git servers on the internet only. Pick one of your own Runners on the repository's network for it in Code.";

export default class GitHostGuard {
  /*
   * Whether this Runner may reach a private network for the repository: a
   * project's own Runner always; a global one only when the server says so
   * with the repository's token (a self-hosted OneUptime).
   */
  public static mayReachPrivateNetwork(
    codeHost?: CodeHostRunnerInfo | null | undefined,
  ): boolean {
    return (
      !GlobalRunnerMode.isActive() || codeHost?.isPrivateNetworkAllowed === true
    );
  }

  /*
   * The egress rules for this Runner: a global one reaches no private
   * address, unless the server allows it for the repository.
   */
  public static getEgressOptions(
    codeHost?: CodeHostRunnerInfo | null | undefined,
  ): EgressGuardOptions {
    const mayReachPrivate: boolean =
      GitHostGuard.mayReachPrivateNetwork(codeHost);

    return {
      blockPrivateAddresses: !mayReachPrivate,
      targetLabel: "Git server",
      ...(!mayReachPrivate
        ? { privateNetworkHint: GLOBAL_RUNNER_PRIVATE_GIT_SERVER_HINT }
        : {}),
    };
  }

  // Whether a Git server may be named by http: where private addresses may be.
  public static isHttpAllowed(
    codeHost?: CodeHostRunnerInfo | null | undefined,
  ): boolean {
    return GitHostGuard.mayReachPrivateNetwork(codeHost);
  }

  // The transport the pull and merge request APIs are called through.
  public static getTransport(
    codeHost?: CodeHostRunnerInfo | null | undefined,
  ): CodeHostTransport {
    return CodeHostHttp.createTransport({
      egressOptions: GitHostGuard.getEgressOptions(codeHost),
      allowHttp: GitHostGuard.isHttpAllowed(codeHost),
    });
  }

  /*
   * The `git -c` options that pin a remote to the addresses the guard
   * checked and refuse redirects - or a refusal, thrown, for an address the
   * Runner may not reach.
   */
  public static async getGitOptions(
    remoteUrl: string,
    codeHost?: CodeHostRunnerInfo | null | undefined,
  ): Promise<Array<string>> {
    let url: URL;

    try {
      url = new URL(remoteUrl);
    } catch {
      throw new Error("The repository's address is not a web address.");
    }

    if (url.protocol === "http:" && !GitHostGuard.isHttpAllowed(codeHost)) {
      throw new Error(
        `A global Runner reaches Git servers over https only, and this repository's address is http.${GLOBAL_RUNNER_PRIVATE_GIT_SERVER_HINT}`,
      );
    }

    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error(
        "OneUptime works in Git repositories over https (or http on your own network).",
      );
    }

    const hostname: string = url.hostname;
    const bareHostname: string =
      hostname.startsWith("[") && hostname.endsWith("]")
        ? hostname.substring(1, hostname.length - 1)
        : hostname;

    const addresses: Array<ResolvedAddress> =
      await DataSourceEgressGuard.assertHostnameAllowed(
        bareHostname,
        GitHostGuard.getEgressOptions(codeHost),
      );

    const options: Array<string> = ["-c", "http.followRedirects=false"];

    // An address typed as itself needs no pin: nothing is looked up.
    if (net.isIP(bareHostname) === 0 && addresses.length > 0) {
      const port: string =
        url.port || (url.protocol === "https:" ? "443" : "80");

      options.push(
        "-c",
        `http.curloptResolve=${bareHostname}:${port}:${addresses
          .map((resolved: ResolvedAddress): string => {
            return resolved.family === 6
              ? `[${resolved.address}]`
              : resolved.address;
          })
          .join(",")}`,
      );
    }

    return options;
  }
}
