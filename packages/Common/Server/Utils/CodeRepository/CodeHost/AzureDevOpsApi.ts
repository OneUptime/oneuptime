import { JSONObject } from "../../../../Types/JSON";
import {
  AzureDevOpsRepositoryAddress,
  CodeHost,
  CodeHostUrl,
} from "../../../../Types/CodeRepository/CodeHost";
import CodeRepositoryType from "../../../../Types/CodeRepository/CodeRepositoryType";
import CodeHostApiClient, {
  CodeHostApiAnswer,
  CodeHostQuery,
} from "./CodeHostApiClient";
import {
  CodeHostHttpError,
  CodeHostHttpErrorKind,
  CodeHostTransport,
} from "./CodeHostHttp";
import { CodeHostFileContent } from "./CodeHostTypes";
import CodeHostText from "./CodeHostText";

/*
 * A GIT REPOSITORY ON AZURE DEVOPS, READ THROUGH ITS FILE API.
 *
 * A repository connected as a Git repository - the address it is cloned
 * by, a username, and a password or personal access token - is pushed to
 * by a Runner and read for its branches with Git's own protocol
 * (GitSmartHttp). A Git server OneUptime does not know has nothing else to
 * read. Azure DevOps has: Azure DevOps Services (dev.azure.com and its
 * older <organization>.visualstudio.com) and Azure DevOps Server (TFS) on
 * a server of the person's own both serve a Git REST API beside each
 * repository, and take the credentials Git signs in with - HTTP Basic,
 * the username and the token. So there OneUptime reads the code as it
 * does on GitLab: the repository's tree, for the files a stack trace or a
 * profile runs through and OneUptime AI's searches, and one file at a
 * time, for OneUptime AI to read.
 *
 *  - The address is read by CodeHostUrl.readAzureDevOpsRepository: the
 *    API is where the repository's _git is, under its collection and its
 *    project ({collection}/{project}/_apis/git/repositories/{name}).
 *  - api-version 5.0, Azure DevOps Server 2019's: every later Server and
 *    Azure DevOps Services take it too, and Items - List and Items - Get
 *    have taken every parameter read here since then.
 *  - Every request goes through the transport every client of a Git
 *    server a person named does (CodeHostHttp: the egress guard, no
 *    redirects, answers capped) and the rules CodeHostApiClient keeps.
 *  - Azure DevOps lists a tree in one answer: Items - List has no pages.
 *    A tree too large for one answer is read a folder at a time instead -
 *    each folder whole where it fits, one level of it where it does not.
 *  - Nothing it throws or returns carries the token, nor its Basic header.
 */

// The REST API version asked for: Azure DevOps Server 2019's (5.0).
export const AZURE_DEVOPS_API_VERSION: string = "5.0";

// What the token needs, said when Azure DevOps refuses it a read.
export const AZURE_DEVOPS_TOKEN_SCOPE_HINT: string =
  "A personal access token needs the Code (Read & write) scope: OneUptime reads the files with it, and AI pushes its branch.";

// At most this many paths of a tree are read: as many as Forgejo's are.
export const AZURE_DEVOPS_MAX_TREE_PATHS: number = 100000;

/*
 * At most this many listings make up one tree: one for most, more for a
 * tree too large for one answer. A tree past them is cut there, as a
 * GitLab one past its 100 pages is.
 */
export const AZURE_DEVOPS_MAX_TREE_LISTINGS: number = 100;

// How far a listing reaches below its folder (VersionControlRecursionType).
enum AzureDevOpsRecursion {
  // The folder and everything under it.
  Full = "Full",
  // The folder and what is directly in it.
  OneLevel = "OneLevel",
}

// One entry of a listing (GitItem), as read here.
interface AzureDevOpsItem {
  // Its path as Azure DevOps writes it, and a listing of it is scoped by: "/src".
  scopePath: string;
  // Its path in the repository: "src/app.ts" ("" for the root).
  path: string;
  // A file: a blob. A submodule (a commit) is neither a file nor a folder.
  isFile: boolean;
  // A folder: a tree.
  isFolder: boolean;
}

export default class AzureDevOpsApi {
  private client: CodeHostApiClient;
  private repository: AzureDevOpsRepositoryAddress;

  public constructor(data: {
    repository: AzureDevOpsRepositoryAddress;
    // What Git signs in with: any name, with a personal access token.
    username: string;
    password: string;
    transport: CodeHostTransport;
    backOff?: ((retry: number) => Promise<void>) | undefined;
  }) {
    const basic: string = Buffer.from(
      `${data.username}:${data.password}`,
    ).toString("base64");

    this.repository = data.repository;
    this.client = new CodeHostApiClient({
      providerName: data.repository.isServices
        ? "Azure DevOps"
        : "Azure DevOps Server",
      apiBaseUrl: data.repository.apiUrl,
      headers: { Authorization: `Basic ${basic}` },
      // The token, and the header it is in: either would sign in.
      secrets: [data.password, basic],
      transport: data.transport,
      scopeHint: AZURE_DEVOPS_TOKEN_SCOPE_HINT,
      backOff: data.backOff,
    });
  }

  /*
   * The reader of a Git repository by the address it is cloned by, or null
   * where that is not a repository's address on Azure DevOps.
   */
  public static forCloneUrl(data: {
    cloneUrl: string | null | undefined;
    username: string;
    password: string;
    transport: CodeHostTransport;
    backOff?: ((retry: number) => Promise<void>) | undefined;
  }): AzureDevOpsApi | null {
    const repository: AzureDevOpsRepositoryAddress | null =
      CodeHostUrl.readAzureDevOpsRepository(data.cloneUrl);

    if (!repository) {
      return null;
    }

    return new AzureDevOpsApi({
      repository,
      username: data.username,
      password: data.password,
      transport: data.transport,
      backOff: data.backOff,
    });
  }

  public getClient(): CodeHostApiClient {
    return this.client;
  }

  public getRepository(): AzureDevOpsRepositoryAddress {
    return this.repository;
  }

  /*
   * Every file path in the repository's tree at a branch. One listing holds
   * the whole tree where it fits in one answer. A tree too large for one is
   * read a folder at a time: each folder whole where it fits, and where it
   * does not, one level of it - its own files, and its folders, read the
   * same way after. A tree past AZURE_DEVOPS_MAX_TREE_LISTINGS listings or
   * AZURE_DEVOPS_MAX_TREE_PATHS paths is cut there.
   */
  public async getTreePaths(data: { ref: string }): Promise<Array<string>> {
    const paths: Set<string> = new Set<string>();
    const folders: Array<string> = ["/"];
    const queued: Set<string> = new Set<string>(folders);
    let listings: number = 0;

    while (
      folders.length > 0 &&
      paths.size < AZURE_DEVOPS_MAX_TREE_PATHS &&
      listings < AZURE_DEVOPS_MAX_TREE_LISTINGS
    ) {
      const folder: string = folders.shift()!;
      let items: Array<AzureDevOpsItem>;

      listings++;

      try {
        items = await this.listItems({
          scopePath: folder,
          ref: data.ref,
          recursion: AzureDevOpsRecursion.Full,
        });
      } catch (error) {
        if (!AzureDevOpsApi.isTooLarge(error)) {
          throw error;
        }

        if (listings >= AZURE_DEVOPS_MAX_TREE_LISTINGS) {
          break;
        }

        listings++;

        try {
          items = await this.listItems({
            scopePath: folder,
            ref: data.ref,
            recursion: AzureDevOpsRecursion.OneLevel,
          });
        } catch (oneLevelError) {
          /*
           * A folder with more directly in it than one answer holds: the
           * root's means no tree at all; another's is left out, and the
           * rest of the tree is still read.
           */
          if (folder !== "/" && AzureDevOpsApi.isTooLarge(oneLevelError)) {
            continue;
          }

          throw oneLevelError;
        }

        for (const item of items) {
          if (
            item.isFolder &&
            AzureDevOpsApi.isInside(item.scopePath, folder) &&
            !queued.has(item.scopePath)
          ) {
            queued.add(item.scopePath);
            folders.push(item.scopePath);
          }
        }
      }

      for (const item of items) {
        if (paths.size >= AZURE_DEVOPS_MAX_TREE_PATHS) {
          break;
        }

        if (item.isFile && item.path) {
          paths.add(item.path);
        }
      }
    }

    return Array.from(paths);
  }

  /*
   * One file's text at a branch, or null when there is no such file - or
   * branch - it is a folder or a submodule, or it is binary.
   */
  public async getFileContent(data: {
    ref: string;
    filePath: string;
  }): Promise<CodeHostFileContent | null> {
    const path: string = AzureDevOpsApi.toRepositoryPath(data.filePath);

    if (!path) {
      return null;
    }

    let answer: CodeHostApiAnswer;

    try {
      answer = await this.getItems({
        path: `/${path}`,
        includeContent: true,
        includeContentMetadata: true,
        "versionDescriptor.version": data.ref,
        "versionDescriptor.versionType": "branch",
      });
    } catch (error) {
      // No such file, or no such branch: Azure DevOps answers 404 to both.
      if (
        error instanceof CodeHostHttpError &&
        error.kind === CodeHostHttpErrorKind.NotFound
      ) {
        return null;
      }

      throw error;
    }

    const item: JSONObject = this.asObject(answer.json, "the file");
    const type: string = CodeHostText.readString(
      item["gitObjectType"],
    ).toLowerCase();

    if (item["isFolder"] === true || (type && type !== "blob")) {
      return null;
    }

    const metadata: unknown = item["contentMetadata"];

    if (
      metadata &&
      typeof metadata === "object" &&
      (metadata as JSONObject)["isBinary"] === true
    ) {
      return null;
    }

    const content: unknown = item["content"];

    if (typeof content !== "string") {
      throw new CodeHostHttpError({
        kind: CodeHostHttpErrorKind.BadResponse,
        message: `${this.client.getProviderName()} answered for ${path} without its contents.`,
      });
    }

    // A binary file Azure DevOps did not mark as one: nothing a reader can use.
    if (content.includes("\0")) {
      return null;
    }

    return {
      content,
      filePath: data.filePath,
      sizeInBytes: Buffer.byteLength(content, "utf8"),
      totalLines: CodeHostText.countLines(content),
      htmlUrl:
        CodeHost.getFileWebUrl({
          type: CodeRepositoryType.Git,
          webUrl: this.repository.webUrl,
          branchName: data.ref,
          path,
        }) || this.repository.webUrl,
    };
  }

  // One listing of a folder at a branch, as far down as `recursion` says.
  private async listItems(data: {
    scopePath: string;
    ref: string;
    recursion: AzureDevOpsRecursion;
  }): Promise<Array<AzureDevOpsItem>> {
    const answer: CodeHostApiAnswer = await this.getItems({
      scopePath: data.scopePath,
      recursionLevel: data.recursion,
      "versionDescriptor.version": data.ref,
      "versionDescriptor.versionType": "branch",
    });

    const body: unknown = answer.json;
    const value: unknown = Array.isArray(body)
      ? body
      : this.asObject(body, "the tree")["value"];

    if (!Array.isArray(value)) {
      throw this.badAnswer("the tree");
    }

    const items: Array<AzureDevOpsItem> = [];

    for (const entry of value) {
      const item: AzureDevOpsItem | null = AzureDevOpsApi.readItem(entry);

      if (item) {
        items.push(item);
      }
    }

    return items;
  }

  /*
   * One request to Items, in api-version 5.0. Azure DevOps Services answers
   * credentials it did not take with its sign-in page (203 and HTML), which
   * is said as the refusal it is.
   */
  private async getItems(query: CodeHostQuery): Promise<CodeHostApiAnswer> {
    try {
      return await this.client.getJson("/items", {
        ...query,
        "api-version": AZURE_DEVOPS_API_VERSION,
      });
    } catch (error) {
      if (
        error instanceof CodeHostHttpError &&
        error.kind === CodeHostHttpErrorKind.BadResponse &&
        error.statusCode === 203
      ) {
        throw new CodeHostHttpError({
          kind: CodeHostHttpErrorKind.Unauthorized,
          statusCode: 203,
          message: `${this.client.getProviderName()} answered with its sign-in page: it did not take the username and password or access token. Check them, and that the token has not expired.`,
        });
      }

      throw error;
    }
  }

  // One entry of a listing, or null for one that is not an item.
  private static readItem(raw: unknown): AzureDevOpsItem | null {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return null;
    }

    const entry: JSONObject = raw as JSONObject;
    const scopePath: string = CodeHostText.readString(entry["path"]);

    if (!scopePath.startsWith("/")) {
      return null;
    }

    const type: string = CodeHostText.readString(
      entry["gitObjectType"],
    ).toLowerCase();
    const isFolder: boolean =
      type === "tree" || (!type && entry["isFolder"] === true);

    return {
      scopePath,
      path: AzureDevOpsApi.toRepositoryPath(scopePath),
      isFile: type === "blob" || (!type && !isFolder),
      isFolder,
    };
  }

  // A path in the repository, as every other host writes it: no leading slash.
  private static toRepositoryPath(path: string): string {
    let start: number = 0;

    while (start < path.length && path.charAt(start) === "/") {
      start++;
    }

    return path.substring(start);
  }

  // Whether an item's path is below a folder's - never the folder itself.
  private static isInside(path: string, folder: string): boolean {
    if (folder === "/") {
      return path.length > 1;
    }

    return path.startsWith(`${folder}/`);
  }

  private static isTooLarge(error: unknown): boolean {
    return (
      error instanceof CodeHostHttpError &&
      error.kind === CodeHostHttpErrorKind.TooLarge
    );
  }

  private asObject(raw: unknown, what: string): JSONObject {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw this.badAnswer(what);
    }

    return raw as JSONObject;
  }

  private badAnswer(what: string): CodeHostHttpError {
    return new CodeHostHttpError({
      kind: CodeHostHttpErrorKind.BadResponse,
      message: `The server did not say ${what} as ${this.client.getProviderName()}'s API does. Check the repository's address.`,
    });
  }
}
