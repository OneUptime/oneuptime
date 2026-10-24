import CodeHostHttp, {
  CODE_HOST_MAX_FAILURE_RETRIES,
  CODE_HOST_REQUEST_TIMEOUT_MS,
  CodeHostHttpError,
  CodeHostHttpErrorKind,
  CodeHostHttpResponse,
  CodeHostTransport,
} from "./CodeHostHttp";
import { CodeHostBranch, CodeHostBranchNames } from "./CodeHostTypes";
import CodeHostText from "./CodeHostText";

/*
 * A PLAIN GIT REPOSITORY, READ WITH GIT'S OWN PROTOCOL OVER HTTPS.
 *
 * A Git server that is not GitHub, GitLab, Forgejo or Gitea has no API
 * OneUptime knows, but every one that serves Git over HTTPS answers the
 * request every clone starts with: GET <repository>/info/refs?service=
 * git-upload-pack, with the repository's branches and the one HEAD points
 * at ("smart HTTP"). That one request is enough to check the address and
 * the credentials when the repository is connected, and to list its
 * branches for Code's branch picker - read through the same guarded
 * transport as every other Git server, so it reaches nothing an API client
 * could not.
 *
 * The answer is pkt-lines (Git's protocol v0): a 4-hex-digit length, then
 * that many bytes; "0000" ends a section. The first ref line carries the
 * capabilities after a NUL, "symref=HEAD:refs/heads/main" among them. Read
 * with a loop and indexOf, never a pattern: the server wrote it.
 */

export interface GitRefAdvertisement {
  // The branch HEAD points at, when the server says (most do).
  defaultBranch: string | null;
  // Every branch, in the server's order, with its head commit.
  branches: Array<{ name: string; sha: string }>;
}

const BRANCH_REF_PREFIX: string = "refs/heads/";
const SYMREF_HEAD_PREFIX: string = "symref=HEAD:";

export const GIT_UPLOAD_PACK_ADVERTISEMENT: string =
  "application/x-git-upload-pack-advertisement";

/*
 * What git clients send: some servers answer smart HTTP only to a client
 * that names itself as git.
 */
const GIT_USER_AGENT: string = "git/2.47.0 (OneUptime)";

export default class GitSmartHttp {
  private cloneUrl: string;
  private username: string;
  private password: string;
  private transport: CodeHostTransport;
  private backOff: (retry: number) => Promise<void>;

  public constructor(data: {
    cloneUrl: string;
    username: string;
    password: string;
    transport: CodeHostTransport;
    backOff?: ((retry: number) => Promise<void>) | undefined;
  }) {
    this.cloneUrl = data.cloneUrl;
    this.username = data.username;
    this.password = data.password;
    this.transport = data.transport;
    this.backOff =
      data.backOff ||
      ((retry: number): Promise<void> => {
        return CodeHostHttp.backOff(retry);
      });
  }

  /*
   * The repository's refs, as its server advertises them to a clone -
   * which also checks the address and the credentials.
   */
  public async getRefs(): Promise<GitRefAdvertisement> {
    const response: CodeHostHttpResponse = await this.request();
    const host: string = this.getHost();

    if (response.statusCode === 401) {
      throw new CodeHostHttpError({
        kind: CodeHostHttpErrorKind.Unauthorized,
        statusCode: 401,
        message: `${host} refused the username and password or token. Check them, and that the token may read and write the repository.`,
      });
    }

    if (response.statusCode === 403) {
      throw new CodeHostHttpError({
        kind: CodeHostHttpErrorKind.Forbidden,
        statusCode: 403,
        message: `${host} did not let these credentials read the repository.`,
      });
    }

    if (response.statusCode === 404) {
      throw new CodeHostHttpError({
        kind: CodeHostHttpErrorKind.NotFound,
        statusCode: 404,
        message: `${host} has no repository at this address that these credentials can read. Check the address, and use the one you clone it with.`,
      });
    }

    if (response.statusCode >= 300 && response.statusCode < 400) {
      throw new CodeHostHttpError({
        kind: CodeHostHttpErrorKind.Rejected,
        statusCode: response.statusCode,
        message: `${host} answered with a redirect, which OneUptime does not follow. Use the address you clone the repository with.`,
      });
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new CodeHostHttpError({
        kind:
          response.statusCode >= 500
            ? CodeHostHttpErrorKind.Unavailable
            : CodeHostHttpErrorKind.Rejected,
        statusCode: response.statusCode,
        message: `${host} answered HTTP ${response.statusCode} to Git.`,
      });
    }

    const contentType: string = (
      response.headers["content-type"] || ""
    ).toLowerCase();

    if (contentType.startsWith(GIT_UPLOAD_PACK_ADVERTISEMENT)) {
      return GitSmartHttp.parseSmartAdvertisement(response.bodyText);
    }

    /*
     * A "dumb" Git server serves the info/refs file as it is: one
     * "<sha>\t<ref>" line per ref, and nothing about HEAD.
     */
    const dumb: GitRefAdvertisement | null =
      GitSmartHttp.parseDumbAdvertisement(response.bodyText);

    if (dumb) {
      return dumb;
    }

    throw new CodeHostHttpError({
      kind: CodeHostHttpErrorKind.BadResponse,
      statusCode: response.statusCode,
      message: `${host} did not answer as a Git repository does. Use the address you clone the repository with (it often ends in .git).`,
    });
  }

  public async listBranchNames(data: {
    search?: string | undefined;
    limit: number;
  }): Promise<CodeHostBranchNames & { defaultBranch: string | null }> {
    const refs: GitRefAdvertisement = await this.getRefs();
    const search: string = (data.search || "").trim();
    const limit: number = Math.max(1, Math.min(100, Math.floor(data.limit)));

    const matching: Array<string> = refs.branches
      .map((branch: { name: string; sha: string }): string => {
        return branch.name;
      })
      .filter((name: string): boolean => {
        return !search || name.startsWith(search);
      });

    return {
      names: matching.slice(0, limit),
      isComplete: matching.length <= limit,
      defaultBranch: refs.defaultBranch,
    };
  }

  public async getBranch(branchName: string): Promise<CodeHostBranch | null> {
    const refs: GitRefAdvertisement = await this.getRefs();
    const branch: { name: string; sha: string } | undefined =
      refs.branches.find((candidate: { name: string; sha: string }) => {
        return candidate.name === branchName;
      });

    return branch
      ? { name: branch.name, headSha: branch.sha, isProtected: false }
      : null;
  }

  /*
   * The refs of a smart HTTP advertisement (protocol v0): the service line
   * and its flush, then one pkt-line per ref, the first carrying the
   * capabilities after a NUL.
   */
  public static parseSmartAdvertisement(body: string): GitRefAdvertisement {
    const advertisement: GitRefAdvertisement = {
      defaultBranch: null,
      branches: [],
    };
    const seen: Set<string> = new Set<string>();

    // Lengths count bytes, not characters.
    const bytes: Buffer = Buffer.from(body, "utf8");
    let offset: number = 0;

    while (offset + 4 <= bytes.length) {
      const length: number = GitSmartHttp.readHexLength(
        bytes.subarray(offset, offset + 4).toString("latin1"),
      );

      if (length < 0) {
        break;
      }

      // 0000 (flush), 0001 (delim) and 0002 (response end) carry nothing.
      if (length < 4) {
        offset += 4;
        continue;
      }

      if (offset + length > bytes.length) {
        break;
      }

      const line: string = bytes
        .subarray(offset + 4, offset + length)
        .toString("utf8");
      offset += length;

      GitSmartHttp.readRefLine(line, advertisement, seen);
    }

    return advertisement;
  }

  /*
   * A dumb server's info/refs: "<sha>\t<ref>" a line. Null for a body with
   * no such line - an HTML page, say.
   */
  public static parseDumbAdvertisement(
    body: string,
  ): GitRefAdvertisement | null {
    const advertisement: GitRefAdvertisement = {
      defaultBranch: null,
      branches: [],
    };
    let lines: number = 0;

    for (const rawLine of body.split("\n")) {
      const tab: number = rawLine.indexOf("\t");

      if (tab <= 0) {
        continue;
      }

      const sha: string = rawLine.substring(0, tab).trim();
      const ref: string = rawLine.substring(tab + 1).trim();

      if (!CodeHostText.isCommitSha(sha)) {
        continue;
      }

      lines++;

      if (ref.startsWith(BRANCH_REF_PREFIX)) {
        advertisement.branches.push({
          name: ref.substring(BRANCH_REF_PREFIX.length),
          sha,
        });
      }
    }

    return lines > 0 ? advertisement : null;
  }

  // A pkt-line's four hex digits, or -1 for anything else.
  private static readHexLength(text: string): number {
    if (text.length !== 4) {
      return -1;
    }

    let value: number = 0;

    for (let index: number = 0; index < 4; index++) {
      const code: number = text.charCodeAt(index);
      let digit: number = -1;

      if (code >= 48 && code <= 57) {
        digit = code - 48;
      } else if (code >= 97 && code <= 102) {
        digit = code - 87;
      } else if (code >= 65 && code <= 70) {
        digit = code - 55;
      }

      if (digit < 0) {
        return -1;
      }

      value = value * 16 + digit;
    }

    return value;
  }

  // One "<sha> <ref>[\0<capabilities>]\n" line.
  private static readRefLine(
    rawLine: string,
    advertisement: GitRefAdvertisement,
    seen: Set<string>,
  ): void {
    let line: string = rawLine.endsWith("\n")
      ? rawLine.substring(0, rawLine.length - 1)
      : rawLine;

    if (line.startsWith("#")) {
      // "# service=git-upload-pack"
      return;
    }

    const nul: number = line.indexOf("\0");

    if (nul >= 0) {
      const capabilities: string = line.substring(nul + 1);
      line = line.substring(0, nul);

      for (const capability of capabilities.split(" ")) {
        if (capability.startsWith(SYMREF_HEAD_PREFIX)) {
          const target: string = capability.substring(
            SYMREF_HEAD_PREFIX.length,
          );

          if (target.startsWith(BRANCH_REF_PREFIX)) {
            advertisement.defaultBranch = target.substring(
              BRANCH_REF_PREFIX.length,
            );
          }
        }
      }
    }

    const space: number = line.indexOf(" ");

    if (space <= 0) {
      return;
    }

    const sha: string = line.substring(0, space);
    const ref: string = line.substring(space + 1);

    if (!CodeHostText.isCommitSha(sha) || !ref.startsWith(BRANCH_REF_PREFIX)) {
      return;
    }

    const name: string = ref.substring(BRANCH_REF_PREFIX.length);

    if (name && !seen.has(name)) {
      seen.add(name);
      advertisement.branches.push({ name, sha });
    }
  }

  private async request(): Promise<CodeHostHttpResponse> {
    const url: string = `${this.cloneUrl}/info/refs?service=git-upload-pack`;
    let failureRetries: number = 0;

    for (;;) {
      try {
        return await this.transport({
          method: "GET",
          url,
          headers: {
            Accept: GIT_UPLOAD_PACK_ADVERTISEMENT,
            "User-Agent": GIT_USER_AGENT,
            ...(this.username || this.password
              ? {
                  Authorization: `Basic ${Buffer.from(
                    `${this.username}:${this.password}`,
                  ).toString("base64")}`,
                }
              : {}),
          },
          timeoutInMs: CODE_HOST_REQUEST_TIMEOUT_MS,
        });
      } catch (error) {
        const isRetryable: boolean =
          !(error instanceof CodeHostHttpError) ||
          error.kind === CodeHostHttpErrorKind.Unavailable;

        if (isRetryable && failureRetries < CODE_HOST_MAX_FAILURE_RETRIES) {
          await this.backOff(failureRetries);
          failureRetries++;
          continue;
        }

        if (error instanceof CodeHostHttpError) {
          throw new CodeHostHttpError({
            kind: error.kind,
            statusCode: error.statusCode,
            message: CodeHostHttp.clean(error.message, [this.password]),
          });
        }

        throw new CodeHostHttpError({
          kind: CodeHostHttpErrorKind.Unavailable,
          message: `${this.getHost()} could not be reached.`,
        });
      }
    }
  }

  private getHost(): string {
    try {
      return new URL(this.cloneUrl).host;
    } catch {
      return "The Git server";
    }
  }
}
