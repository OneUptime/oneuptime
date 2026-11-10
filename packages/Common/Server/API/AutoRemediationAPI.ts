import UserMiddleware from "../Middleware/UserAuthorization";
import CommonAPI from "./CommonAPI";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../Types/ObjectID";
import BadDataException from "../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../Types/JSON";
import {
  getRemediationTryAgainRefusal,
  RemediationTryAgainResult,
} from "../../Types/AutoRemediation/RemediationTryAgain";
import AutoRemediationRuleEngineService from "../Services/AutoRemediationRuleEngineService";
import AlertService from "../Services/AlertService";
import IncidentService from "../Services/IncidentService";
import Alert from "../../Models/DatabaseModels/Alert";
import Incident from "../../Models/DatabaseModels/Incident";
import RemediationApproval, {
  getScopeRefusalNextStep,
} from "../Utils/AutoRemediation/RemediationApproval";
import DeclaredCodeChanges from "../Utils/AutoRemediation/DeclaredCodeChanges";
import RemediationRound from "../Utils/AutoRemediation/RemediationRound";
import {
  REMEDIATION_ROUND_PATH,
  REMEDIATION_ROUND_TRY_AGAIN_PATH,
} from "../../Types/AutoRemediation/RemediationRound";
import {
  DECLARED_CODE_CHANGE_PATH,
  DECLARED_CODE_CHANGES_PATH,
  DECLARED_CODE_OWNER_PATH,
} from "../../Utils/AiRemediation/DeclaredCodeChange";

const router: ExpressRouter = Express.getRouter();

/*
 * Human-action endpoints for auto-remediation suggestions: Approve, Dry run
 * again and Dismiss on the Remediation step of an incident's or alert's AI
 * card, and Try again. What each one checks and writes is
 * RemediationApproval's (Utils/AutoRemediation), which a Slack or Microsoft
 * Teams press on the fix's message goes through too: the routes only read
 * who is asking and what they asked about.
 */

async function getLoggedInProps(
  req: ExpressRequest,
): Promise<DatabaseCommonInteractionProps> {
  const props: DatabaseCommonInteractionProps =
    await CommonAPI.getDatabaseCommonInteractionProps(req);

  CommonAPI.assertAuthenticatedUser(props);

  return props;
}

// Kept here for the suites that read it from the route module.
export { getScopeRefusalNextStep };

/*
 * The person's own suggestion id, from the body: RemediationApproval checks
 * they may read it before anything else.
 */
function readSuggestionId(req: ExpressRequest): unknown {
  return req.body ? req.body["suggestionId"] : undefined;
}

router.post(
  "/auto-remediation/approve",
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const props: DatabaseCommonInteractionProps = await getLoggedInProps(req);

      Response.sendJsonObjectResponse(
        req,
        res,
        await RemediationApproval.approve({
          props,
          suggestionId: readSuggestionId(req),
        }),
      );
      return;
    } catch (err) {
      next(err);
      return;
    }
  },
);

/*
 * Dry run again: dry-run the cloud changes of a fix that waits for approval
 * (CloudChangeDryRun), as OneUptime did when the fix was proposed. The
 * answers land on the plan's steps, which the Remediation card polls.
 *
 * Asked by someone who could approve the fix: the dry run is a job sent to
 * the account's Cloud AI agent, so the same bar as approving holds -
 * executing runbooks, and an edit of every resource the plan changes. It
 * changes nothing, and runs in the background (a change's dry run waits
 * for its agent), so the route answers as soon as each change is marked
 * as being checked: what it started, or 400 with why it would not.
 */
router.post(
  "/auto-remediation/dry-run",
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const props: DatabaseCommonInteractionProps = await getLoggedInProps(req);

      Response.sendJsonObjectResponse(
        req,
        res,
        await RemediationApproval.startDryRun({
          props,
          suggestionId: readSuggestionId(req),
        }),
      );
      return;
    } catch (err) {
      next(err);
      return;
    }
  },
);

router.post(
  "/auto-remediation/dismiss",
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const props: DatabaseCommonInteractionProps = await getLoggedInProps(req);

      Response.sendJsonObjectResponse(
        req,
        res,
        await RemediationApproval.dismiss({
          props,
          suggestionId: readSuggestionId(req),
        }),
      );
      return;
    } catch (err) {
      next(err);
      return;
    }
  },
);

/*
 * The incident or alert a Try again names (body: incidentId OR alertId),
 * checked as the person asking, inside the tenant they asked in: they may
 * read it, and change it - Try again may start a fix on it, as a link of
 * what it is about may (#5293). "Not found" and "not yours" read alike, so
 * the route never says whether an id exists in another project.
 */
export async function findTryAgainSubject(data: {
  body: JSONObject;
  tenantId: ObjectID;
  viewerProps: DatabaseCommonInteractionProps;
}): Promise<{ incidentId?: ObjectID; alertId?: ObjectID }> {
  const readId: (key: string) => ObjectID | undefined = (
    key: string,
  ): ObjectID | undefined => {
    const value: unknown = data.body[key];

    if (value === undefined || value === null || value === "") {
      return undefined;
    }

    if (typeof value !== "string" || !ObjectID.isValidUUID(value.trim())) {
      throw new BadDataException(`${key} must be a valid ID.`);
    }

    return new ObjectID(value.trim());
  };

  const incidentId: ObjectID | undefined = readId("incidentId");
  const alertId: ObjectID | undefined = readId("alertId");

  if (Boolean(incidentId) === Boolean(alertId)) {
    throw new BadDataException("Send exactly one of incidentId and alertId.");
  }

  const kind: "incident" | "alert" = incidentId ? "incident" : "alert";
  const noun: string = incidentId ? "Incident" : "Alert";

  const readable: Incident | Alert | null = incidentId
    ? await IncidentService.findOneById({
        id: incidentId,
        select: { _id: true, projectId: true },
        props: data.viewerProps,
      })
    : await AlertService.findOneById({
        id: alertId!,
        select: { _id: true, projectId: true },
        props: data.viewerProps,
      });

  if (
    !readable ||
    !readable.projectId ||
    readable.projectId.toString() !== data.tenantId.toString()
  ) {
    throw new BadDataException(
      `${noun} not found (or you do not have access to it).`,
    );
  }

  let changeable: Incident | Alert | null = null;

  try {
    changeable = incidentId
      ? await IncidentService.findOneUpdatableById({
          id: incidentId,
          select: { _id: true },
          props: data.viewerProps,
        })
      : await AlertService.findOneUpdatableById({
          id: alertId!,
          select: { _id: true },
          props: data.viewerProps,
        });
  } catch {
    changeable = null;
  }

  if (!changeable) {
    throw new NotAuthorizedException(
      `You do not have permission to change this ${kind}, so you cannot ask OneUptime AI to try fixing it again.`,
    );
  }

  return incidentId ? { incidentId } : { alertId: alertId! };
}

/*
 * Try again on the Remediation step of an incident's or alert's AI card
 * (Types/AutoRemediation/RemediationTryAgain): OneUptime AI decides again,
 * now, how to fix it - with the project's settings of now, as for a new
 * incident (AutoRemediationRuleEngineService.tryAgain). For whoever may
 * change the record. Body: { incidentId } or { alertId }. Response:
 * { result: "Evaluated" }; the step then reads the new decision. Refused
 * with what stops it: the record is resolved, its remediation still waits
 * for its investigation, a fix is on its way, it was decided moments ago,
 * or it is being decided right now.
 */
router.post(
  "/auto-remediation/try-again",
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const props: DatabaseCommonInteractionProps = await getLoggedInProps(req);
      const tenantId: ObjectID =
        CommonAPI.assertAuthenticatedProjectMember(props);
      // Pinned to the tenant: the multi-tenant header never widens the read.
      const viewerProps: DatabaseCommonInteractionProps = {
        ...props,
        isMultiTenantRequest: false,
      };

      const subject: { incidentId?: ObjectID; alertId?: ObjectID } =
        await findTryAgainSubject({
          body: (req.body || {}) as JSONObject,
          tenantId,
          viewerProps,
        });

      const result: RemediationTryAgainResult =
        await AutoRemediationRuleEngineService.tryAgain({
          projectId: tenantId,
          ...subject,
        });

      if (result !== RemediationTryAgainResult.Evaluated) {
        throw new BadDataException(
          getRemediationTryAgainRefusal({
            result,
            signal: subject.incidentId ? "incident" : "alert",
          }),
        );
      }

      Response.sendJsonObjectResponse(req, res, { result });
      return;
    } catch (err) {
      next(err);
      return;
    }
  },
);

/*
 * A ROUND OF AN AI FIX (RemediationRound, issues #6436 and #6487): what
 * the Remediation step shows of how OneUptime AI worked a fix out - its
 * run, how its attempts ended, the commands it checked with and why it
 * found no fix - and Try again for a round that did not finish.
 *
 *   POST /auto-remediation/round            { suggestionId }
 *     For whoever may read the fix: the round, and mayTryAgain - whether
 *     they may start it again.
 *   POST /auto-remediation/round-try-again  { suggestionId }
 *     For whoever may change the incident or alert the fix is for: the
 *     round starts again with a new run. Response { runId }, or 400 with
 *     why not.
 *
 * Both read the fix under the person's own permissions, in the tenant they
 * asked in: the multi-tenant header never widens the read.
 */
async function getTenantViewer(req: ExpressRequest): Promise<{
  tenantId: ObjectID;
  viewerProps: DatabaseCommonInteractionProps;
}> {
  const props: DatabaseCommonInteractionProps = await getLoggedInProps(req);
  const tenantId: ObjectID = CommonAPI.assertAuthenticatedProjectMember(props);

  return { tenantId, viewerProps: { ...props, isMultiTenantRequest: false } };
}

router.post(
  REMEDIATION_ROUND_PATH,
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const viewer: {
        tenantId: ObjectID;
        viewerProps: DatabaseCommonInteractionProps;
      } = await getTenantViewer(req);

      Response.sendJsonObjectResponse(
        req,
        res,
        await RemediationRound.readForViewer({
          suggestionId: readSuggestionId(req),
          ...viewer,
        }),
      );
      return;
    } catch (err) {
      next(err);
      return;
    }
  },
);

router.post(
  REMEDIATION_ROUND_TRY_AGAIN_PATH,
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const viewer: {
        tenantId: ObjectID;
        viewerProps: DatabaseCommonInteractionProps;
      } = await getTenantViewer(req);

      const runId: ObjectID = await RemediationRound.tryAgain({
        suggestionId: readSuggestionId(req),
        ...viewer,
        userId: viewer.viewerProps.userId!,
      });

      Response.sendJsonObjectResponse(req, res, { runId: runId.toString() });
      return;
    } catch (err) {
      next(err);
      return;
    }
  },
);

/*
 * A FIX THAT LASTS (DeclaredCodeChanges): a step of a fix that changes a
 * cloud resource declared as code can also be made in that code, as a pull
 * request - beside the live change, or instead of it.
 *
 *   POST /auto-remediation/declared-code-owner   { suggestionId, sequence }
 *     The repositories connected to Code that may hold the code, ranked,
 *     each the reader may read, with whether they may ask AI to work in it:
 *     what the dialog that asks before opening the pull request shows.
 *   POST /auto-remediation/declared-code-change  { suggestionId, sequence, codeRepositoryId }
 *     The pull request asked for: a Code task in that repository, for whoever
 *     may ask AI to work in it, with every check Code makes. A step whose
 *     task is on its way gets that one back.
 *   POST /auto-remediation/declared-code-changes { suggestionId }
 *     Each step's task as it stands: being written, opened, ended or failed.
 *
 * Each reads the fix under the person's own permissions, in the tenant they
 * asked in.
 */
router.post(
  DECLARED_CODE_OWNER_PATH,
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const props: DatabaseCommonInteractionProps = await getLoggedInProps(req);
      const tenantId: ObjectID = CommonAPI.assertTenantScoped(props);
      const body: JSONObject = (req.body || {}) as JSONObject;

      Response.sendJsonObjectResponse(
        req,
        res,
        (await DeclaredCodeChanges.getOwner({
          props,
          tenantId,
          suggestionId: body["suggestionId"],
          sequence: body["sequence"],
        })) as unknown as JSONObject,
      );
      return;
    } catch (err) {
      next(err);
      return;
    }
  },
);

router.post(
  DECLARED_CODE_CHANGE_PATH,
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const props: DatabaseCommonInteractionProps = await getLoggedInProps(req);
      const tenantId: ObjectID = CommonAPI.assertTenantScoped(props);
      const body: JSONObject = (req.body || {}) as JSONObject;

      Response.sendJsonObjectResponse(
        req,
        res,
        (await DeclaredCodeChanges.start({
          props,
          tenantId,
          suggestionId: body["suggestionId"],
          sequence: body["sequence"],
          codeRepositoryId: body["codeRepositoryId"],
        })) as unknown as JSONObject,
      );
      return;
    } catch (err) {
      next(err);
      return;
    }
  },
);

router.post(
  DECLARED_CODE_CHANGES_PATH,
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const props: DatabaseCommonInteractionProps = await getLoggedInProps(req);
      const tenantId: ObjectID = CommonAPI.assertTenantScoped(props);
      const body: JSONObject = (req.body || {}) as JSONObject;

      Response.sendJsonObjectResponse(
        req,
        res,
        (await DeclaredCodeChanges.list({
          props,
          tenantId,
          suggestionId: body["suggestionId"],
        })) as unknown as JSONObject,
      );
      return;
    } catch (err) {
      next(err);
      return;
    }
  },
);

export default router;
