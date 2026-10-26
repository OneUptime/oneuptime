import API from "Common/Utils/API";
import URL from "Common/Types/API/URL";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import logger from "Common/Server/Utils/Logger";

/*
 * THE GITHUB TOKENS A CODE-FIX RUN WAS HANDED END WITH THE RUN.
 *
 * The server mints a GitHub repository's token for the one repository a fix
 * works in (GitHubUtil.getRepositoryAccessToken), and GitHub keeps it good
 * for an hour from then. A fix rarely takes that long, and for the rest of
 * the hour the token would still push to the repository from wherever it
 * was read - on a global Runner, a host that runs every project's
 * JavaScript steps beside the fix. So the Runner remembers every GitHub
 * token it is handed for the run it works on (BackendAPI.getRepositoryToken)
 * and revokes each when the run ends, however it ends
 * (PollCodeFixWork.executeTask): GitHub's DELETE /installation/token, which
 * a token may call on itself. Every Runner does, not only a global one.
 *
 * Best effort: a token GitHub could not be asked about runs out within its
 * hour, as it always did, and the attempt is logged - never the token.
 *
 * A repository on GitLab, Forgejo, Gitea or a Git server is reached with its
 * connection's own token, which is the connection's to keep and is never
 * revoked here (BackendAPI remembers only GitHub's).
 *
 * The code-fix loop works on one run at a time, so the tokens remembered are
 * that run's alone.
 */

export const GITHUB_REVOKE_TOKEN_URL: string =
  "https://api.github.com/installation/token";

// How long one revocation may take: the run's final report waits on it.
export const REVOKE_TIMEOUT_IN_MS: number = 10 * 1000;

// What revokes one token: the request GitHub is sent. A test seam.
export type RevokeTokenFunction = (
  token: string,
) => Promise<HTTPResponse<JSONObject> | HTTPErrorResponse>;

const revokeWithGitHub: RevokeTokenFunction = async (
  token: string,
): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
  return await API.delete<JSONObject>({
    url: URL.fromString(GITHUB_REVOKE_TOKEN_URL),
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    options: {
      timeout: REVOKE_TIMEOUT_IN_MS,
      retries: 0,
      // The token rides in the request: never followed off GitHub's API.
      sameServerRedirectsOnly: true,
    },
  });
};

export default class RepositoryTokenRevocation {
  private static tokens: Set<string> = new Set<string>();

  private static revokeToken: RevokeTokenFunction = revokeWithGitHub;

  // A GitHub token this run was handed: revoked when the run ends.
  public static remember(token: string): void {
    if (token) {
      RepositoryTokenRevocation.tokens.add(token);
    }
  }

  // How many tokens are waiting to be revoked.
  public static getRememberedCount(): number {
    return RepositoryTokenRevocation.tokens.size;
  }

  /*
   * Revoke every GitHub token this run was handed, and forget them all,
   * whether or not GitHub answered. The number GitHub revoked (204); never
   * throws.
   */
  public static async revokeAll(): Promise<number> {
    const tokens: Array<string> = Array.from(RepositoryTokenRevocation.tokens);

    RepositoryTokenRevocation.tokens.clear();

    let revoked: number = 0;

    for (const token of tokens) {
      try {
        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await RepositoryTokenRevocation.revokeToken(token);

        if (response.statusCode === 204) {
          revoked++;
          continue;
        }

        logger.warn(
          `GitHub did not revoke a repository token this run was handed (HTTP ${response.statusCode}); it ends on its own within the hour it was minted for.`,
        );
      } catch (error) {
        logger.warn(
          `Could not ask GitHub to revoke a repository token this run was handed (${
            error instanceof Error ? error.name : "request failed"
          }); it ends on its own within the hour it was minted for.`,
        );
      }
    }

    return revoked;
  }

  // For tests: what revokes a token, or GitHub again when left out.
  public static setRevokeTokenFunction(
    revokeToken?: RevokeTokenFunction | undefined,
  ): void {
    RepositoryTokenRevocation.revokeToken = revokeToken || revokeWithGitHub;
  }

  // For tests: forget every token without revoking it.
  public static reset(): void {
    RepositoryTokenRevocation.tokens.clear();
    RepositoryTokenRevocation.revokeToken = revokeWithGitHub;
  }
}
