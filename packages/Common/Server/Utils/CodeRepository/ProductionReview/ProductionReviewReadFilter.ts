import DataStoreFindingService from "../../../Services/DataStoreFindingService";
import IncidentService from "../../../Services/IncidentService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import ProductionReviewComposer from "./ProductionReviewComposer";
import Incident from "../../../../Models/DatabaseModels/Incident";
import CodeFixTaskContext, {
  getReviewedPullRequest,
  ReviewedPullRequest,
} from "../../../../Types/AI/CodeFixTaskContext";
import { CodeTaskOutcome } from "../../../../Types/AI/CodeTask";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  CodeHost,
  PullRequestTerm,
} from "../../../../Types/CodeRepository/CodeHost";
import {
  ProductionReviewReport,
  ProductionReviewUtil,
} from "../../../../Types/CodeRepository/ProductionReview";
import {
  ProductionReviewLeakJSON,
  ProductionReviewSensitiveDataUtil,
} from "../../../../Types/CodeRepository/ProductionReviewSensitiveData";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../../Types/Exception/PaymentRequiredException";
import ObjectID from "../../../../Types/ObjectID";

/*
 * A STORED PRODUCTION REVIEW, AS ITS READER MAY READ IT (#9241).
 *
 * A production review is worked out once, when the pull request changes,
 * and kept on its task's outcome (AIRun.taskOutcome.productionReview): the
 * Code pages draw it from there. It lists no private incident
 * (ProductionReviewFindings reads none), but an incident on it can be made
 * private afterwards - or be deleted - and then every reader of the
 * repository's tasks kept reading its label, its severity and state, the
 * changed code its root cause names and a link to it, and the counts went
 * on counting it.
 *
 * So the review is held to its reader when it is read, not when it is
 * worked out: wherever the Code API serves a stored review (a list's row,
 * a task's page and its turns), the incidents it lists are asked of the
 * incidents themselves, as the reader, in one read for the whole answer
 * (readReadableIncidentIds) - a private incident they do not see, one they
 * may not read at all, one that is gone: each leaves the review, with the
 * counts and the points of OneUptime AI's read that rest on it
 * (ProductionReviewUtil.keepReadableIncidents), and the outcome's sentence
 * that counts them is written again from what is left (keepOutcome).
 *
 * The comment already posted on the pull request is left alone: it was
 * the code host's, posted while the incident was not private, and the
 * repository's collaborators read it there.
 */
export default class ProductionReviewReadFilter {
  /*
   * Of the incidents `reports` list, the ones the reader may read now, by
   * id in lower case: read as the reader, every incident in one read, so
   * whatever narrows their reads - a private incident they do not own, a
   * label their team's permission does not reach, no permission to read
   * incidents at all - narrows this too, and an incident that is gone is
   * read by no one. Every one for root. None when the reader may read no
   * incident, or the incidents could not be read: what is not known to be
   * theirs to read is left out.
   */
  @CaptureSpan()
  public static async readReadableIncidentIds(data: {
    projectId: ObjectID;
    reports: Array<ProductionReviewReport | null | undefined>;
    props: DatabaseCommonInteractionProps;
  }): Promise<Set<string>> {
    const ids: Array<string> = [];

    for (const report of data.reports) {
      for (const id of ProductionReviewUtil.getIncidentIds(report)) {
        if (ObjectID.isValidUUID(id) && !ids.includes(id)) {
          ids.push(id);
        }
      }
    }

    if (ids.length === 0) {
      return new Set<string>();
    }

    if (data.props.isRoot || data.props.isMasterAdmin) {
      return new Set<string>(ids);
    }

    try {
      const incidents: Array<Incident> = await IncidentService.findBy({
        query: {
          _id: QueryHelper.any(ids),
          projectId: data.projectId,
        } as never,
        select: { _id: true },
        limit: ids.length,
        skip: 0,
        props: data.props,
      });

      return new Set<string>(
        incidents
          .map((incident: Incident): string => {
            return (incident.id?.toString() || "").toLowerCase();
          })
          .filter((id: string): boolean => {
            return Boolean(id);
          }),
      );
    } catch (error) {
      if (!(error instanceof NotAuthorizedException)) {
        logger.error(
          `Production review: could not read who may read a review's incidents: ${error}`,
        );
      }

      return new Set<string>();
    }
  }

  /*
   * Whether the reader may read Data Security's findings: what production
   * knows of a review's Sensitive data points - where the telemetry held
   * the data, the scrub rule that masks it, the store a resource is - is
   * theirs, read as the reader, in one read. Root may. What cannot be read
   * is not known to be theirs: false.
   */
  @CaptureSpan()
  public static async canReadDataSecurity(data: {
    projectId: ObjectID;
    reports: Array<ProductionReviewReport | null | undefined>;
    props: DatabaseCommonInteractionProps;
  }): Promise<boolean> {
    if (data.props.isRoot || data.props.isMasterAdmin) {
      return true;
    }

    const knowsProduction: boolean = data.reports.some(
      (report: ProductionReviewReport | null | undefined): boolean => {
        return ProductionReviewSensitiveDataUtil.getPoints(
          report?.sensitiveData,
        ).some((point: ProductionReviewLeakJSON): boolean => {
          return point.production !== undefined;
        });
      },
    );

    // Nothing to hold back: no read needed.
    if (!knowsProduction) {
      return false;
    }

    try {
      await DataStoreFindingService.findBy({
        query: { projectId: data.projectId },
        select: { _id: true },
        limit: 1,
        skip: 0,
        props: data.props,
      });

      return true;
    } catch (error) {
      if (
        !(error instanceof NotAuthorizedException) &&
        !(error instanceof PaymentRequiredException)
      ) {
        logger.error(
          `Production review: could not read who may read a review's sensitive data: ${error}`,
        );
      }

      return false;
    }
  }

  /*
   * An outcome with its review held to `readableIncidentIds`
   * (ProductionReviewUtil.keepReadableIncidents) and to whether the reader
   * may read Data Security (ProductionReviewUtil.keepReadableSensitiveData)
   * and, where that left something out, the sentence a list reads as what
   * the review found (CodeTaskOutcome.summary) written again from what is
   * left, in the host's words (`term`). The same outcome when it holds no
   * review, or nothing in it is hidden.
   */
  public static keepOutcome<T extends CodeTaskOutcome | null | undefined>(
    outcome: T,
    readableIncidentIds: Set<string>,
    term?: PullRequestTerm | undefined,
    canReadDataSecurity: boolean = false,
  ): T {
    const report: ProductionReviewReport | undefined =
      outcome?.productionReview;

    if (!outcome || !report) {
      return outcome;
    }

    const kept: ProductionReviewReport =
      ProductionReviewUtil.keepReadableSensitiveData(
        ProductionReviewUtil.keepReadableIncidents(
          report,
          (incidentId: string): boolean => {
            return readableIncidentIds.has(incidentId.toLowerCase());
          },
        ),
        canReadDataSecurity,
      );

    if (kept === report) {
      return outcome;
    }

    return {
      ...outcome,
      productionReview: kept,
      summary: ProductionReviewComposer.summarize(kept, term),
    };
  }

  // The host's word for the pull request a review task reviews.
  public static getTerm(
    taskContext: CodeFixTaskContext | null | undefined,
  ): PullRequestTerm {
    const reviewed: ReviewedPullRequest | null =
      getReviewedPullRequest(taskContext);

    return CodeHost.getFacts(reviewed?.provider).pullRequestTerm;
  }
}
