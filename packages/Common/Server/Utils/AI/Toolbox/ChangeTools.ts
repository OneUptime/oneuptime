import ChangeEvent from "../../../../Models/AnalyticsModels/ChangeEvent";
import CodeRepository from "../../../../Models/DatabaseModels/CodeRepository";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import Service from "../../../../Models/DatabaseModels/Service";
import {
  AIChatCitationTarget,
  AIChatCitationTargetType,
} from "../../../../Types/AI/AIChatTypes";
import LessThan from "../../../../Types/BaseDatabase/LessThan";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import Dictionary from "../../../../Types/Dictionary";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import {
  ChangeEventFields,
  describeChangeEventSource,
  readChangeEventFields,
  shortCommitSha,
} from "../../../../Utils/Telemetry/ChangeEventFields";
import ChangeEventService from "../../../Services/ChangeEventService";
import CodeRepositoryService from "../../../Services/CodeRepositoryService";
import ServiceService from "../../../Services/ServiceService";
import GitHubUtil, {
  GitHubInstallationToken,
} from "../../CodeRepository/GitHub/GitHub";
import GitHubCommits, {
  GitHubChangedFile,
  GitHubCommitRange,
  GitHubCommitSummary,
  GitHubPullRequestSummary,
  GitHubRepositoryName,
} from "../../CodeRepository/GitHub/GitHubCommits";
import logger from "../../Logger";
import { findReadableRepositories } from "./CodeTools";
import CodeRepositoryType from "../../../../Types/CodeRepository/CodeRepositoryType";
import { CodeHost } from "../../../../Types/CodeRepository/CodeHost";
import ToolResultSerializer, { SerializedResult } from "./Serializer";
import {
  ObservabilityTool,
  ToolArgs,
  ToolContext,
  ToolExecutionResult,
} from "./ToolTypes";

/*
 * get_change_details: what one recorded change was, and - for a deploy that
 * names a commit in a repository connected through the GitHub App - what it
 * shipped: the commits since the service's previous deploy (or the one
 * commit, and the pull requests it came from) and the files they touched.
 *
 * Every read is the caller's own: the change event and its service under
 * the caller's props, the repository through findReadableRepositories, so
 * a caller who may not read a repository never gets its commits. A change
 * the repository cannot be found for is still described, with why its
 * commits are not.
 */

// Same gate as recent_changes, which hands out the changeIds this reads.
let cachedReadPermissions: Array<Permission> | null = null;
const resolveReadPermissions: () => Array<Permission> =
  (): Array<Permission> => {
    if (!cachedReadPermissions) {
      cachedReadPermissions = new Monitor().getReadPermissions();
    }
    return cachedReadPermissions;
  };

// How many of the service's earlier changes are searched for its previous commit.
const PREVIOUS_CHANGES_SEARCHED: number = 20;

export interface ChangeCode {
  repository: GitHubRepositoryName;
  // The commit of the service's previous deploy, when one was found.
  baseCommitSha?: string | undefined;
  /*
   * The previous deploy's commit, when GitHub could not compare it with
   * this one (it is not in the repository, or was force-pushed away).
   */
  uncomparedBaseCommitSha?: string | undefined;
  range?: GitHubCommitRange | undefined;
  commit?: GitHubCommitSummary | undefined;
  files?: Array<GitHubChangedFile> | undefined;
  pullRequests?: Array<GitHubPullRequestSummary> | undefined;
}

export const GetChangeDetailsTool: ObservabilityTool = {
  name: "get_change_details",
  description:
    "Get one recorded change by its changeId (from recent_changes, or the Recent changes section of an investigation's context): its time, kind, service, version before and after, commit, environment and where it was recorded from - and, when it names a commit in a repository connected through the GitHub App, what it shipped: the commits since the service's previous deploy (or that commit and the pull requests it came from), with their authors, and the files they touched. Use it to see whether a deploy that came right before a problem changed the code the problem points at.",
  inputSchema: {
    type: "object",
    properties: {
      changeId: {
        type: "string",
        description: "The change's id (changeId in recent_changes).",
      },
    },
    required: ["changeId"],
  },
  get requiredPermissions(): Array<Permission> {
    return resolveReadPermissions();
  },
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const changeIdText: string | undefined = ToolArgs.getString(
      args,
      "changeId",
    );

    if (!changeIdText || !ObjectID.isValidUUID(changeIdText)) {
      throw new BadDataException(
        "changeId must be the id of a change, as recent_changes lists it.",
      );
    }

    const changeId: ObjectID = new ObjectID(changeIdText);

    const changes: Array<ChangeEvent> = await ChangeEventService.findBy({
      query: { _id: changeId } as never,
      select: {
        _id: true,
        time: true,
        eventType: true,
        title: true,
        description: true,
        primaryEntityId: true,
        attributes: true,
      } as never,
      limit: 1,
      skip: 0,
      props: ctx.props,
    });

    const change: ChangeEvent | undefined = changes[0];

    if (!change || !change.time) {
      return {
        dataForLlm: `No change with id ${changeId.toString()} was found that you may read.`,
        rowCount: 0,
        citationLabel: `Change ${changeId.toString()} (not found)`,
        redactionCount: 0,
        isTruncated: false,
      };
    }

    const fields: ChangeEventFields = readChangeEventFields(
      (change.attributes as Dictionary<unknown>) || {},
    );
    const serviceId: ObjectID | undefined = change.primaryEntityId
      ? new ObjectID(change.primaryEntityId.toString())
      : undefined;
    const serviceName: string | undefined = serviceId
      ? await readServiceName(serviceId, ctx)
      : undefined;

    const rows: Array<JSONObject> = [
      describeChangeRow({ change, fields, serviceName }),
    ];

    let commitCount: number = 0;

    if (fields.commitSha) {
      try {
        const code: ChangeCode | string = await readChangeCode({
          change,
          fields,
          serviceId,
          serviceName,
          ctx,
        });

        if (typeof code === "string") {
          rows.push({ kind: "note", text: code });
        } else {
          const codeRows: Array<JSONObject> = describeCodeRows(code);
          commitCount = codeRows.filter((row: JSONObject): boolean => {
            return row["kind"] === "commit";
          }).length;
          rows.push(...codeRows);
        }
      } catch (error) {
        logger.debug(`get_change_details: commits not read: ${error}`);
        rows.push({
          kind: "note",
          text: "The commits this change shipped could not be read from GitHub.",
        });
      }
    } else if (change.eventType === "deployment") {
      rows.push({
        kind: "note",
        text: "This change names no commit, so what it shipped is not known. A pipeline can send one as `commit` (or the vcs.ref.head.revision attribute), and a service as its vcs.ref.head.revision resource attribute.",
      });
    }

    const serialized: SerializedResult =
      ToolResultSerializer.serializeRows(rows);

    const citationTarget: AIChatCitationTarget | undefined = serviceId
      ? {
          type: AIChatCitationTargetType.ServiceView,
          params: { serviceId: serviceId.toString() },
        }
      : undefined;

    return {
      dataForLlm: serialized.text,
      rowCount: serialized.rowCount,
      citationLabel: `Change ${(change.title || changeId.toString()).slice(0, 120)}${
        commitCount > 0
          ? ` (${commitCount} commit${commitCount === 1 ? "" : "s"})`
          : ""
      }`,
      ...(citationTarget ? { citationTarget } : {}),
      redactionCount: serialized.redactionCount,
      isTruncated: serialized.isTruncated,
    };
  },
};

async function readServiceName(
  serviceId: ObjectID,
  ctx: ToolContext,
): Promise<string | undefined> {
  try {
    const service: Service | null = await ServiceService.findOneBy({
      query: { _id: serviceId.toString() } as never,
      select: { name: true },
      props: ctx.props,
    });

    return service?.name || undefined;
  } catch (error) {
    logger.debug(`get_change_details: service name not read: ${error}`);
    return undefined;
  }
}

// The change itself, as one row.
export function describeChangeRow(data: {
  change: ChangeEvent;
  fields: ChangeEventFields;
  serviceName?: string | undefined;
}): JSONObject {
  const { change, fields } = data;
  const row: JSONObject = {
    kind: "change",
    at: change.time,
    type: change.eventType || "change",
    title: change.title || "",
  };

  const add: (key: string, value: string | undefined) => void = (
    key: string,
    value: string | undefined,
  ): void => {
    if (value) {
      row[key] = value;
    }
  };

  add("service", data.serviceName);
  add("version", fields.version);
  add("previousVersion", fields.previousVersion);
  /*
   * Short, as people read it - and a full SHA reads to the serializer like
   * a secret, which it would redact.
   */
  add(
    "commit",
    fields.commitSha ? shortCommitSha(fields.commitSha) : undefined,
  );
  add("branch", fields.branch);
  add("pullRequest", fields.pullRequest);
  add("repository", fields.repositoryUrl);
  add("environment", fields.environment);
  add("deployment", fields.kubernetesDeployment);
  add("namespace", fields.kubernetesNamespace);
  add("replicaSet", fields.kubernetesReplicaSet);
  add("previousReplicaSet", fields.previousReplicaSet);
  add("command", fields.command);
  add("status", fields.status);
  add(
    "recordedFrom",
    fields.source ? describeChangeEventSource(fields.source) : undefined,
  );
  add("description", change.description);

  return row;
}

// What the code lookup found, as rows: commits, pull requests, files.
export function describeCodeRows(code: ChangeCode): Array<JSONObject> {
  const rows: Array<JSONObject> = [];
  const repository: string = `${code.repository.owner}/${code.repository.name}`;

  if (code.range) {
    const from: string = code.baseCommitSha
      ? shortCommitSha(code.baseCommitSha)
      : "";
    let note: string | undefined = undefined;

    if (code.range.status === "behind") {
      note = `this commit is older than the previous deploy's (${from}): the change rolled back`;
    } else if (code.range.isTruncated) {
      note = "more commits or files than listed";
    }

    rows.push({
      kind: "range",
      repository,
      from,
      commits: code.range.totalCommits,
      status: code.range.status,
      ...(note ? { note } : {}),
    });

    for (const commit of code.range.commits) {
      rows.push(commitRow(commit));
    }

    for (const file of code.range.files) {
      rows.push(fileRow(file));
    }

    return rows;
  }

  if (code.commit) {
    rows.push({
      kind: "range",
      repository,
      commits: 1,
      note: code.uncomparedBaseCommitSha
        ? `the previous deploy's commit (${shortCommitSha(code.uncomparedBaseCommitSha)}) could not be compared with this one, so only this commit is listed`
        : "no earlier deploy of this service names a commit, so only this commit is listed",
    });
    rows.push(commitRow(code.commit));
  }

  for (const pullRequest of code.pullRequests || []) {
    rows.push({
      kind: "pull_request",
      number: pullRequest.number,
      title: pullRequest.title,
      author: pullRequest.authorLogin || "",
      mergedAt: pullRequest.mergedAt || "",
      url: pullRequest.url,
    });
  }

  for (const file of code.files || []) {
    rows.push(fileRow(file));
  }

  return rows;
}

function commitRow(commit: GitHubCommitSummary): JSONObject {
  return {
    kind: "commit",
    sha: shortCommitSha(commit.sha),
    author: commit.authorLogin || commit.authorName,
    message: commit.message,
    ...(commit.pullRequestNumbers.length > 0
      ? {
          pullRequests: commit.pullRequestNumbers
            .map((number: number): string => {
              return `#${number}`;
            })
            .join(", "),
        }
      : {}),
  };
}

function fileRow(file: GitHubChangedFile): JSONObject {
  return {
    kind: "file",
    path: file.path,
    status: file.status,
    changes: `+${file.additions} -${file.deletions}`,
  };
}

/*
 * The repository a change's commit lives in: the one its repository URL
 * names, else the one its service's name resolves to - always one the
 * caller may read, through an installation bound to the project.
 */
async function findChangeRepository(data: {
  fields: ChangeEventFields;
  serviceName?: string | undefined;
  ctx: ToolContext;
}): Promise<CodeRepository | null> {
  const readable: Array<CodeRepository> = await findReadableRepositories(
    data.ctx,
  );

  if (readable.length === 0) {
    return null;
  }

  const named: GitHubRepositoryName | null = GitHubCommits.parseRepositoryName(
    data.fields.repositoryUrl,
  );

  if (named) {
    return (
      readable.find((repository: CodeRepository): boolean => {
        return (
          (repository.organizationName || "").toLowerCase() ===
            named.owner.toLowerCase() &&
          (repository.repositoryName || "").toLowerCase() ===
            named.name.toLowerCase()
        );
      }) || null
    );
  }

  const resolution: { codeRepositoryId: string } | null =
    await CodeRepositoryService.resolveRepositoryForException({
      projectId: data.ctx.projectId,
      stackTrace: null,
      serviceName: data.serviceName || null,
    });

  if (!resolution) {
    return null;
  }

  return (
    readable.find((repository: CodeRepository): boolean => {
      return repository.id?.toString() === resolution.codeRepositoryId;
    }) || null
  );
}

/*
 * Whether an earlier change of a service can be the deploy before this one,
 * the base a compare starts from: another commit, in the same environment
 * and the same repository whenever both name theirs. A staging deploy is
 * not what production ran before, and another repository's commit is not
 * in this one.
 */
export function isPreviousDeployOf(
  current: ChangeEventFields,
  earlier: ChangeEventFields,
): boolean {
  const currentSha: string = (current.commitSha || "").toLowerCase();
  const earlierSha: string = (earlier.commitSha || "").toLowerCase();

  // The same commit, also when one of them is abbreviated.
  if (
    !earlierSha ||
    (currentSha &&
      (currentSha.startsWith(earlierSha) || earlierSha.startsWith(currentSha)))
  ) {
    return false;
  }

  if (
    current.environment &&
    earlier.environment &&
    current.environment.toLowerCase() !== earlier.environment.toLowerCase()
  ) {
    return false;
  }

  if (current.repositoryUrl && earlier.repositoryUrl) {
    const currentName: GitHubRepositoryName | null =
      GitHubCommits.parseRepositoryName(current.repositoryUrl);
    const earlierName: GitHubRepositoryName | null =
      GitHubCommits.parseRepositoryName(earlier.repositoryUrl);

    const isSameRepository: boolean =
      currentName && earlierName
        ? currentName.owner.toLowerCase() === earlierName.owner.toLowerCase() &&
          currentName.name.toLowerCase() === earlierName.name.toLowerCase()
        : current.repositoryUrl.trim().toLowerCase() ===
          earlier.repositoryUrl.trim().toLowerCase();

    if (!isSameRepository) {
      return false;
    }
  }

  return true;
}

/*
 * The commit of the deploy before this one, of the same service: the base
 * a compare starts from. Searched among the service's earlier changes
 * (isPreviousDeployOf).
 */
async function findPreviousCommit(data: {
  change: ChangeEvent;
  fields: ChangeEventFields;
  serviceId: ObjectID;
  ctx: ToolContext;
}): Promise<string | undefined> {
  const earlier: Array<ChangeEvent> = await ChangeEventService.findBy({
    query: {
      primaryEntityId: data.serviceId,
      time: new LessThan(data.change.time!),
    } as never,
    select: { _id: true, time: true, attributes: true } as never,
    sort: { time: SortOrder.Descending } as never,
    limit: PREVIOUS_CHANGES_SEARCHED,
    skip: 0,
    props: data.ctx.props,
  });

  for (const change of earlier) {
    const fields: ChangeEventFields = readChangeEventFields(
      (change.attributes as Dictionary<unknown>) || {},
    );

    if (isPreviousDeployOf(data.fields, fields)) {
      return fields.commitSha;
    }
  }

  return undefined;
}

// What the change's commit shipped, or why that cannot be said.
async function readChangeCode(data: {
  change: ChangeEvent;
  fields: ChangeEventFields;
  serviceId?: ObjectID | undefined;
  serviceName?: string | undefined;
  ctx: ToolContext;
}): Promise<ChangeCode | string> {
  const head: string = data.fields.commitSha!;

  if (!GitHubCommits.isCommitSha(head)) {
    return `The change names ${JSON.stringify(head)} as its commit, which is not a commit SHA, so its commits are not read.`;
  }

  const repository: CodeRepository | null = await findChangeRepository({
    fields: data.fields,
    ...(data.serviceName ? { serviceName: data.serviceName } : {}),
    ctx: data.ctx,
  });

  /*
   * A deploy's commits are read with GitHub's compare API: a repository on
   * another host says so, rather than no repository matching.
   */
  if (
    repository &&
    CodeHost.readType(repository.repositoryHostedAt) !==
      CodeRepositoryType.GitHub
  ) {
    return `The change's repository, ${repository.organizationName}/${repository.repositoryName}, is on ${CodeHost.getFacts(repository.repositoryHostedAt).name}. OneUptime lists the commits a deploy shipped for GitHub repositories only, so they are not listed.`;
  }

  if (
    !repository ||
    !repository.gitHubAppInstallationId ||
    !repository.organizationName ||
    !repository.repositoryName
  ) {
    return "No repository connected through the GitHub App that you may read matches this change, so the commits it shipped are not listed.";
  }

  const token: GitHubInstallationToken =
    await GitHubUtil.getInstallationAccessToken(
      repository.gitHubAppInstallationId,
      {
        permissions: {
          contents: "read",
          pull_requests: "read",
          metadata: "read",
        },
      },
    );

  const target: {
    token: string;
    owner: string;
    repository: string;
  } = {
    token: token.token,
    owner: repository.organizationName,
    repository: repository.repositoryName,
  };
  const name: GitHubRepositoryName = {
    owner: repository.organizationName,
    name: repository.repositoryName,
  };

  const base: string | undefined = data.serviceId
    ? await findPreviousCommit({
        change: data.change,
        fields: data.fields,
        serviceId: data.serviceId,
        ctx: data.ctx,
      })
    : undefined;

  let uncomparedBase: string | undefined = undefined;

  if (base && GitHubCommits.isCommitSha(base)) {
    try {
      return {
        repository: name,
        baseCommitSha: base,
        range: await GitHubCommits.compare({ ...target, base, head }),
      };
    } catch (error) {
      // The previous commit is not in this repository, or was force-pushed away.
      logger.debug(
        `get_change_details: could not compare ${shortCommitSha(base)} with ${shortCommitSha(head)}: ${error}`,
      );
      uncomparedBase = base;
    }
  }

  const [commit, pullRequests]: [
    { commit: GitHubCommitSummary; files: Array<GitHubChangedFile> },
    Array<GitHubPullRequestSummary>,
  ] = await Promise.all([
    GitHubCommits.getCommit({ ...target, sha: head }),
    GitHubCommits.listPullRequestsForCommit({ ...target, sha: head }),
  ]);

  return {
    repository: name,
    ...(uncomparedBase ? { uncomparedBaseCommitSha: uncomparedBase } : {}),
    commit: commit.commit,
    files: commit.files,
    pullRequests,
  };
}
