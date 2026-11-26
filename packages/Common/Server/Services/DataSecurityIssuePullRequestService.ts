import CodeRepositoryService from "./CodeRepositoryService";
import DataSecurityIssueService from "./DataSecurityIssueService";
import ProjectReferencesService from "./ProjectReferencesService";
import CodeRepository from "../../Models/DatabaseModels/CodeRepository";
import DataSecurityIssue from "../../Models/DatabaseModels/DataSecurityIssue";
import Model from "../../Models/DatabaseModels/DataSecurityIssuePullRequest";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete } from "../Types/Database/Hooks";
import DataSecurityFixTarget from "../Utils/AI/CodeFix/DataSecurityFixTarget";
import LinkedPullRequestReader, {
  LinkedPullRequestReadError,
  LinkedPullRequestReadProblem,
} from "../Utils/CodeRepository/LinkedPullRequests/LinkedPullRequestReader";
import { CodeHostPullRequestState } from "../Utils/CodeRepository/CodeHost/CodeHostTypes";
import DataSecurityLinkedFixes from "../Utils/DataSecurity/DataSecurityLinkedFixes";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import logger from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import FixProductionCheck from "../../Types/AI/FixProductionCheck";
import URL from "../../Types/API/URL";
import PullRequestState from "../../Types/CodeRepository/PullRequestState";
import {
  PullRequestLink,
  getPullRequestLinkName,
  parsePullRequestLink,
} from "../../Types/CodeRepository/PullRequestLink";
import {
  DATA_SECURITY_ISSUE_PULL_REQUESTS_MAX,
  ISSUE_PULL_REQUEST_ALREADY_LINKED,
  ISSUE_PULL_REQUEST_ISSUE_NOT_FOUND,
  ISSUE_PULL_REQUEST_SET_ASIDE,
  ISSUE_PULL_REQUEST_TOO_MANY,
  PULL_REQUEST_LINK_CLOSED,
  PULL_REQUEST_LINK_NOT_AN_ADDRESS,
  PULL_REQUEST_LINK_NOT_CONNECTED,
  PULL_REQUEST_LINK_NOT_FOLLOWED,
  PULL_REQUEST_LINK_NOT_FOUND,
  PULL_REQUEST_LINK_READ_FAILED,
  PULL_REQUEST_LINK_REPOSITORY_NOT_READABLE,
  canIssueTakePullRequest,
} from "../../Types/DataSecurity/DataSecurityIssuePullRequestLink";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import { getRefusalText } from "../../Types/Exception/RefusalWithValues";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";

/*
 * A pull request a person links to a Data Security issue as its fix
 * (DataSecurityIssuePullRequest, #10831).
 *
 * A link is taken from the pull request's address alone. Before it is
 * kept, OneUptime makes sure it can follow it, as a security case's link
 * (#10604) does: the issue is the project's and the person may read it -
 * and it is open or resolved, not set aside; the address is a pull
 * request's page; its repository is one the project connected under Code,
 * one the person may read there; and its host says it exists and was not
 * closed without merging. Each refusal says why and what to do
 * (Types/DataSecurity/DataSecurityIssuePullRequestLink). What OneUptime
 * read of it - its repository, number, state, merge commit - and the
 * production check its issue's store calls for, it writes itself.
 *
 * Linked, it is on the issue's timeline, and OneUptime starts following it
 * (DataSecurityLinkedFixes): a leak's baseline taken at once, and one that
 * merged already checked at once. Taken off, the timeline says so.
 */

// The issue a link is on, under both of its names (RelationIdUtil).
const ISSUE_KEYS: Array<string> = ["dataSecurityIssueId", "dataSecurityIssue"];

function refuse(message: string): BadDataException {
  return new BadDataException(message);
}

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    const data: JSONObject = createBy.data as unknown as JSONObject;
    const projectId: ObjectID | undefined =
      createBy.data.projectId || createBy.props.tenantId;
    const issueId: ObjectID | null = RelationIdUtil.readIntoIdColumn(
      data,
      ISSUE_KEYS,
      "Data Security Issue",
    );

    if (!projectId || !issueId) {
      throw refuse(ISSUE_PULL_REQUEST_ISSUE_NOT_FOUND);
    }

    // Only an issue the person may read: one held from them by its labels is not found.
    if (!createBy.props.isRoot && !createBy.props.isMasterAdmin) {
      const readable: DataSecurityIssue | null =
        await DataSecurityIssueService.findOneBy({
          query: { _id: issueId, projectId },
          select: { _id: true },
          props: createBy.props,
        }).catch((): null => {
          return null;
        });

      if (!readable) {
        throw refuse(ISSUE_PULL_REQUEST_ISSUE_NOT_FOUND);
      }
    }

    const issue: DataSecurityIssue | null =
      await DataSecurityIssueService.findOneBy({
        query: { _id: issueId, projectId },
        select: { _id: true, status: true, dataStoreId: true },
        props: { isRoot: true },
      });

    if (!issue) {
      throw refuse(ISSUE_PULL_REQUEST_ISSUE_NOT_FOUND);
    }

    if (!canIssueTakePullRequest(issue.status)) {
      throw refuse(ISSUE_PULL_REQUEST_SET_ASIDE);
    }

    const linked: PositiveNumber = await this.countBy({
      query: { projectId, dataSecurityIssueId: issueId },
      props: { isRoot: true },
    });

    if (linked.toNumber() >= DATA_SECURITY_ISSUE_PULL_REQUESTS_MAX) {
      throw refuse(ISSUE_PULL_REQUEST_TOO_MANY);
    }

    const link: PullRequestLink | null = parsePullRequestLink(
      createBy.data.pullRequestUrl?.toString(),
    );

    if (!link) {
      throw refuse(PULL_REQUEST_LINK_NOT_AN_ADDRESS);
    }

    const name: string = getPullRequestLinkName(link);
    const repositoryName: string = `${link.owner}/${link.repository}`;
    const repository: CodeRepository | null =
      await LinkedPullRequestReader.findRepository({ projectId, link });

    if (!repository?.id) {
      throw refuse(
        getRefusalText(PULL_REQUEST_LINK_NOT_CONNECTED, {
          repository: repositoryName,
        }),
      );
    }

    /*
     * Linking a pull request reads it through the project's connection:
     * whoever links one may read the repository in OneUptime, as Code's
     * own pages let them.
     */
    if (!createBy.props.isRoot && !createBy.props.isMasterAdmin) {
      const readable: CodeRepository | null =
        await CodeRepositoryService.findOneBy({
          query: { _id: repository.id, projectId },
          select: { _id: true },
          props: createBy.props,
        }).catch((): null => {
          return null;
        });

      if (!readable) {
        throw refuse(
          getRefusalText(PULL_REQUEST_LINK_REPOSITORY_NOT_READABLE, {
            repository: repositoryName,
          }),
        );
      }
    }

    const already: PositiveNumber = await this.countBy({
      query: {
        projectId,
        dataSecurityIssueId: issueId,
        codeRepositoryId: repository.id,
        pullRequestNumber: link.number,
      },
      props: { isRoot: true },
    });

    if (already.toNumber() > 0) {
      throw refuse(
        getRefusalText(ISSUE_PULL_REQUEST_ALREADY_LINKED, {
          pullRequest: name,
        }),
      );
    }

    let read: CodeHostPullRequestState;

    try {
      read = await LinkedPullRequestReader.readState({
        repository,
        number: link.number,
      });
    } catch (error) {
      const problem: LinkedPullRequestReadProblem =
        error instanceof LinkedPullRequestReadError
          ? error.problem
          : LinkedPullRequestReadProblem.ReadFailed;

      if (problem === LinkedPullRequestReadProblem.NotFollowed) {
        throw refuse(
          getRefusalText(PULL_REQUEST_LINK_NOT_FOLLOWED, {
            repository: repositoryName,
          }),
        );
      }

      if (problem === LinkedPullRequestReadProblem.NotFound) {
        throw refuse(
          getRefusalText(PULL_REQUEST_LINK_NOT_FOUND, { pullRequest: name }),
        );
      }

      logger.error(
        `DataSecurityIssuePullRequestService: could not read ${name} for issue ${issueId.toString()}:`,
      );
      logger.error(error);

      throw refuse(
        getRefusalText(PULL_REQUEST_LINK_READ_FAILED, { pullRequest: name }),
      );
    }

    if (read.state === PullRequestState.Closed) {
      throw refuse(
        getRefusalText(PULL_REQUEST_LINK_CLOSED, { pullRequest: name }),
      );
    }

    const now: Date = OneUptimeDate.getCurrentDate();
    // What production is watched for: a telemetry store's leak in code, any other store's configuration.
    const check: FixProductionCheck = await DataSecurityFixTarget.checkOfStore({
      projectId,
      dataStoreId: issue.dataStoreId,
    });

    // What OneUptime read of it, written by OneUptime.
    createBy.data.projectId = projectId;
    createBy.data.dataSecurityIssueId = issueId;
    createBy.data.pullRequestUrl = URL.fromString(link.url);
    createBy.data.codeRepositoryId = repository.id;
    createBy.data.pullRequestNumber = link.number;
    createBy.data.repoOrganizationName =
      repository.organizationName || link.owner;
    createBy.data.repoName = repository.repositoryName || link.repository;
    createBy.data.pullRequestState = read.state;
    createBy.data.followedAt = now;
    createBy.data.productionCheck = check;

    if (read.state === PullRequestState.Merged) {
      createBy.data.mergedAt = read.mergedAt || now;

      if (read.mergeCommitSha) {
        createBy.data.mergeCommitSha = read.mergeCommitSha;
      }

      // Merged already: its check waits for the deploy that ships it, as an AI fix's does.
      Object.assign(
        createBy.data,
        DataSecurityLinkedFixes.productionFieldsWhenMerged({
          row: { productionCheck: check },
          now,
        }),
      );
    }

    return { createBy, carryForward: { link } };
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    if (
      !createdItem.id ||
      !createdItem.projectId ||
      !createdItem.dataSecurityIssueId
    ) {
      return createdItem;
    }

    try {
      await DataSecurityLinkedFixes.sayLinked({
        row: createdItem,
        userId: createdItem.createdByUserId || onCreate.createBy.props.userId,
      });
    } catch (error) {
      // The link is kept; what is said about it must not undo that.
      logger.error(
        `DataSecurityIssuePullRequestService: could not say on its issue that pull request ${createdItem.id.toString()} was linked:`,
      );
      logger.error(error);
    }

    // A leak's baseline now, and a merged one's check at once. Never throws.
    await DataSecurityLinkedFixes.startFollowing({
      projectId: createdItem.projectId,
      id: createdItem.id,
    });

    return createdItem;
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    // The rows are gone by the time onDeleteSuccess runs: read them here.
    const rows: Array<Model> = await this.findRowsAndHoldDeleteToThem(
      deleteBy,
      {
        _id: true,
        projectId: true,
        dataSecurityIssueId: true,
        repoOrganizationName: true,
        repoName: true,
        pullRequestNumber: true,
        pullRequestUrl: true,
      },
    );

    return { deleteBy, carryForward: { rows } };
  }

  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    _itemIdsBeforeDelete: Array<ObjectID>,
  ): Promise<OnDelete<Model>> {
    const rows: Array<Model> = (onDelete.carryForward?.rows ||
      []) as Array<Model>;
    const actorUserId: ObjectID | undefined =
      onDelete.deleteBy.deletedByUser?.id || onDelete.deleteBy.props.userId;

    for (const row of rows) {
      try {
        await DataSecurityLinkedFixes.sayUnlinked({
          row,
          userId: actorUserId,
        });
      } catch (error) {
        logger.error(
          `DataSecurityIssuePullRequestService: could not say on its issue that pull request ${row.id?.toString() || ""} was taken off:`,
        );
        logger.error(error);
      }
    }

    return onDelete;
  }
}

export default new Service();
