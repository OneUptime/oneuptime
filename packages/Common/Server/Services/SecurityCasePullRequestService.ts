import CodeRepositoryService from "./CodeRepositoryService";
import ProjectReferencesService from "./ProjectReferencesService";
import SecurityCaseFeedService from "./SecurityCaseFeedService";
import SecurityCaseService from "./SecurityCaseService";
import CodeRepository from "../../Models/DatabaseModels/CodeRepository";
import SecurityCase from "../../Models/DatabaseModels/SecurityCase";
import { SecurityCaseFeedEventType } from "../../Models/DatabaseModels/SecurityCaseFeed";
import Model from "../../Models/DatabaseModels/SecurityCasePullRequest";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete } from "../Types/Database/Hooks";
import LinkedPullRequestReader, {
  LinkedPullRequestReadError,
  LinkedPullRequestReadProblem,
} from "../Utils/CodeRepository/LinkedPullRequests/LinkedPullRequestReader";
import { CodeHostPullRequestState } from "../Utils/CodeRepository/CodeHost/CodeHostTypes";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import logger from "../Utils/Logger";
import SecurityCasePullRequestFollower from "../Utils/SecurityCase/SecurityCasePullRequestFollower";
import SecurityCaseStepChecks from "../Utils/SecurityCase/StepChecks/SecurityCaseStepChecks";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import URL from "../../Types/API/URL";
import { Gray500, Indigo500 } from "../../Types/BrandColors";
import PullRequestState from "../../Types/CodeRepository/PullRequestState";
import {
  PullRequestLink,
  getPullRequestLinkName,
  parsePullRequestLink,
} from "../../Types/CodeRepository/PullRequestLink";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import { getRefusalText } from "../../Types/Exception/RefusalWithValues";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import {
  PULL_REQUEST_LINK_ALREADY_LINKED,
  PULL_REQUEST_LINK_CASE_NOT_FOUND,
  PULL_REQUEST_LINK_CLOSED,
  PULL_REQUEST_LINK_NOT_AN_ADDRESS,
  PULL_REQUEST_LINK_NOT_CONNECTED,
  PULL_REQUEST_LINK_NOT_FOLLOWED,
  PULL_REQUEST_LINK_NOT_FOUND,
  PULL_REQUEST_LINK_READ_FAILED,
  PULL_REQUEST_LINK_REPOSITORY_NOT_READABLE,
  PULL_REQUEST_LINK_TOO_MANY,
  SECURITY_CASE_PULL_REQUESTS_MAX,
} from "../../Types/SecurityCase/SecurityCasePullRequestLink";
import {
  pullRequestLinkedMarkdown,
  pullRequestUnlinkedMarkdown,
} from "../../Utils/SecurityCase/SecurityCaseMarkdown";

/*
 * A pull request a person links to a security case's Fix step
 * (SecurityCasePullRequest, #10604).
 *
 * A link is taken from the pull request's address alone. Before it is
 * kept, OneUptime makes sure it can follow it: the case is the project's,
 * the address is a pull request's page, its repository is one the project
 * connected under Code - one the person may read there - and its host says
 * it exists and was not closed without merging. Each refusal says why and
 * what to do (Types/SecurityCase/SecurityCasePullRequestLink). What
 * OneUptime read of it - its repository, number, state and merge commit -
 * it writes itself.
 *
 * Linked, it is on the case's timeline and the case's steps are checked at
 * once; a merged one is matched to its deploy straight away
 * (SecurityCasePullRequestFollower). Taken off, the timeline says so and
 * the steps are checked again.
 */

// The case a link is on, under both of its names (RelationIdUtil).
const SECURITY_CASE_KEYS: Array<string> = ["securityCaseId", "securityCase"];

// What a create learned of the pull request, for the steps after it.
interface LinkRead {
  link: PullRequestLink;
  repository: CodeRepository;
  read: CodeHostPullRequestState;
}

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
    const securityCaseId: ObjectID | null = RelationIdUtil.readIntoIdColumn(
      data,
      SECURITY_CASE_KEYS,
      "Security Case",
    );

    if (!projectId || !securityCaseId) {
      throw refuse(PULL_REQUEST_LINK_CASE_NOT_FOUND);
    }

    const securityCase: SecurityCase | null =
      await SecurityCaseService.findOneBy({
        query: { _id: securityCaseId, projectId },
        select: { _id: true },
        props: { isRoot: true },
      });

    if (!securityCase) {
      throw refuse(PULL_REQUEST_LINK_CASE_NOT_FOUND);
    }

    const linked: PositiveNumber = await this.countBy({
      query: { projectId, securityCaseId },
      props: { isRoot: true },
    });

    if (linked.toNumber() >= SECURITY_CASE_PULL_REQUESTS_MAX) {
      throw refuse(PULL_REQUEST_LINK_TOO_MANY);
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
      const readable: CodeRepository | null = await CodeRepositoryService.findOneBy(
        {
          query: { _id: repository.id, projectId },
          select: { _id: true },
          props: createBy.props,
        },
      ).catch((): null => {
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
        securityCaseId,
        codeRepositoryId: repository.id,
        pullRequestNumber: link.number,
      },
      props: { isRoot: true },
    });

    if (already.toNumber() > 0) {
      throw refuse(
        getRefusalText(PULL_REQUEST_LINK_ALREADY_LINKED, { pullRequest: name }),
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
        `SecurityCasePullRequestService: could not read ${name} for case ${securityCaseId.toString()}:`,
      );
      logger.error(error);

      throw refuse(
        getRefusalText(PULL_REQUEST_LINK_READ_FAILED, { pullRequest: name }),
      );
    }

    if (read.state === PullRequestState.Closed) {
      throw refuse(getRefusalText(PULL_REQUEST_LINK_CLOSED, { pullRequest: name }));
    }

    // What OneUptime read of it, written by OneUptime.
    createBy.data.projectId = projectId;
    createBy.data.pullRequestUrl = URL.fromString(link.url);
    createBy.data.codeRepositoryId = repository.id;
    createBy.data.pullRequestNumber = link.number;
    createBy.data.repoOrganizationName =
      repository.organizationName || link.owner;
    createBy.data.repoName = repository.repositoryName || link.repository;
    createBy.data.pullRequestState = read.state;
    createBy.data.followedAt = OneUptimeDate.getCurrentDate();

    if (read.state === PullRequestState.Merged) {
      createBy.data.mergedAt = read.mergedAt || OneUptimeDate.getCurrentDate();

      if (read.mergeCommitSha) {
        createBy.data.mergeCommitSha = read.mergeCommitSha;
      }
    }

    const carried: LinkRead = { link, repository, read };

    return { createBy, carryForward: carried };
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    const carried: LinkRead | undefined = onCreate.carryForward as
      | LinkRead
      | undefined;

    if (!createdItem.id || !createdItem.projectId || !createdItem.securityCaseId) {
      return createdItem;
    }

    try {
      if (carried) {
        await SecurityCaseFeedService.createSecurityCaseFeedItem({
          projectId: createdItem.projectId,
          securityCaseId: createdItem.securityCaseId,
          feedInfoInMarkdown: pullRequestLinkedMarkdown({
            name: getPullRequestLinkName(carried.link),
            url: carried.link.url,
          }).toString(),
          eventType: SecurityCaseFeedEventType.ResponseAction,
          displayColor: Indigo500,
          userId: createdItem.createdByUserId || onCreate.createBy.props.userId,
        });
      }

      // Merged already: matched to its deploy now, not at the follower's next round.
      if (createdItem.pullRequestState === PullRequestState.Merged) {
        await SecurityCasePullRequestFollower.followById({
          projectId: createdItem.projectId,
          id: createdItem.id,
        });
      }

      // The Fix step reads the case's fixes: OneUptime looks at it now.
      await SecurityCaseStepChecks.requestCheck({
        projectId: createdItem.projectId,
        securityCaseId: createdItem.securityCaseId,
      });
    } catch (error) {
      // The link is kept; what is said about it must not undo that.
      logger.error(
        `SecurityCasePullRequestService: could not record the linked pull request ${createdItem.id.toString()}:`,
      );
      logger.error(error);
    }

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
        securityCaseId: true,
        repoOrganizationName: true,
        repoName: true,
        pullRequestNumber: true,
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
      if (!row.projectId || !row.securityCaseId) {
        continue;
      }

      try {
        await SecurityCaseFeedService.createSecurityCaseFeedItem({
          projectId: row.projectId,
          securityCaseId: row.securityCaseId,
          feedInfoInMarkdown: pullRequestUnlinkedMarkdown({
            name: getPullRequestLinkName({
              owner: row.repoOrganizationName || "",
              repository: row.repoName || "",
              number: row.pullRequestNumber || 0,
            }),
          }).toString(),
          eventType: SecurityCaseFeedEventType.ResponseAction,
          displayColor: Gray500,
          userId: actorUserId,
        });

        await SecurityCaseStepChecks.requestCheck({
          projectId: row.projectId,
          securityCaseId: row.securityCaseId,
        });
      } catch (error) {
        logger.error(
          `SecurityCasePullRequestService: could not record the pull request ${row.id?.toString() || ""} taken off its case:`,
        );
        logger.error(error);
      }
    }

    return onDelete;
  }
}

export default new Service();
