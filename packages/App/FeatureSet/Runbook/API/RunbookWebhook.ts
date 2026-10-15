import crypto from "crypto";
import BadDataException from "Common/Types/Exception/BadDataException";
import Exception from "Common/Types/Exception/Exception";
import ForbiddenException from "Common/Types/Exception/ForbiddenException";
import NotFoundException from "Common/Types/Exception/NotFoundException";
import PayloadTooLargeException from "Common/Types/Exception/PayloadTooLargeException";
import ProjectBlockedException from "Common/Types/Exception/ProjectBlockedException";
import ServiceUnavailableException from "Common/Types/Exception/ServiceUnavailableException";
import TooManyRequestsException from "Common/Types/Exception/TooManyRequestsException";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import PositiveNumber from "Common/Types/PositiveNumber";
import StatusCode from "Common/Types/API/StatusCode";
import RunbookExecutionStatus from "Common/Types/Runbook/RunbookExecutionStatus";
import {
  RunbookInputsReadResult,
  RunbookInputsRefusal,
  readRunbookInputs,
} from "Common/Types/Runbook/RunbookInputs";
import RunbookTriggerType from "Common/Types/Runbook/RunbookTriggerType";
import {
  RUNBOOK_WEBHOOK_MAX_ACTIVE_RUNS,
  RUNBOOK_WEBHOOK_ROUTE,
  RUNBOOK_WEBHOOK_SECRET_RESET_ROUTE,
  RUNBOOK_WEBHOOK_SECRET_ROUTE,
  RunbookWebhookMessages,
  isRunbookWebhookSecretKeyShape,
} from "Common/Types/Runbook/RunbookWebhook";
import CommonAPI from "Common/Server/API/CommonAPI";
import UserMiddleware from "Common/Server/Middleware/UserAuthorization";
import RunbookExecutionService from "Common/Server/Services/RunbookExecutionService";
import RunbookService from "Common/Server/Services/RunbookService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import resolveTrustedClientIp, {
  ClientIpRequestLike,
} from "Common/Server/Utils/ClientIp";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
  OneUptimeRequest,
} from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import Response from "Common/Server/Utils/Response";
import RunbookStarter, {
  RUNBOOK_START_SELECT,
  RunbookStartRefusal,
  RunbookStartResult,
} from "Common/Server/Utils/Runbook/RunbookStarter";
import RunbookTriggerAccess from "Common/Server/Utils/Runbook/RunbookTriggerAccess";
import RunbookWebhookRateLimit, {
  RunbookWebhookRateLimitDecision,
  RunbookWebhookRateLimitOutcome,
} from "Common/Server/Utils/Runbook/RunbookWebhookRateLimit";
import Runbook from "Common/Models/DatabaseModels/Runbook";

/*
 * A RUNBOOK'S WEBHOOK URL, AND WHERE ITS TRIGGERS PAGE READS IT.
 *
 *   POST /runbook/webhook/:runbookId/:secretKey       (public: starts a run)
 *   GET  /runbook/webhook/:runbookId/:secretKey       (says to POST; starts nothing)
 *   POST /runbook/webhook-secret/:runbookId           (the key, for the Triggers page)
 *   POST /runbook/webhook-secret/:runbookId/reset     (a new key; the old URL stops)
 *
 * A call is answered, in this order, before anything runs:
 *
 *   1. every call counts against the caller's address (RunbookWebhookRateLimit);
 *   2. the runbook is looked up by the id in the URL and the key compared
 *      with its own in constant time. No such runbook, a wrong key, and a
 *      runbook with no key are one answer, 404, so the URL says nothing
 *      about which runbooks exist;
 *   3. with the right key, a webhook or runbook that is turned off is told
 *      so (403): the caller holds the key, so this gives nothing away and
 *      says what to fix;
 *   4. the body must be a JSON object (or nothing) of at most 64 KB, nested
 *      at most 32 deep, with no NUL character: it becomes the run's inputs,
 *      handed to the steps as data (Types/Runbook/RunbookInputs);
 *   5. a run is about to start: it counts against the runbook's own budget,
 *      and is refused (429) while RUNBOOK_WEBHOOK_MAX_ACTIVE_RUNS runs the
 *      webhook started are still queued, running or waiting for someone;
 *   6. the run starts through the one start path (RunbookStarter), recorded
 *      as started by the Webhook, with the caller's address.
 *
 * The key routes answer only people who may set up the runbook's triggers
 * and run it (RunbookTriggerAccess.assertMayManageWebhook), and are never
 * cached.
 */

const ACTIVE_STATUSES: Array<string> = [
  RunbookExecutionStatus.Scheduled,
  RunbookExecutionStatus.Running,
  RunbookExecutionStatus.WaitingForManualStep,
];

/*
 * Whether the key in the URL is the runbook's: compared as SHA-256 digests
 * with timingSafeEqual, so the time the answer takes says nothing about how
 * much of a guess was right. A runbook with no key - or no runbook - is
 * compared against nothing and never matches.
 */
export function isRunbookWebhookKeyMatch(
  stored: string | null | undefined,
  given: string | null | undefined,
): boolean {
  const storedDigest: Buffer = crypto
    .createHash("sha256")
    .update(typeof stored === "string" ? stored : "")
    .digest();
  const givenDigest: Buffer = crypto
    .createHash("sha256")
    .update(typeof given === "string" ? given : "")
    .digest();

  const isSame: boolean = crypto.timingSafeEqual(storedDigest, givenDigest);

  return isSame && isRunbookWebhookSecretKeyShape(stored);
}

// A refused call, with Retry-After when the refusal says when to try again.
function throwRateLimited(data: {
  res: ExpressResponse;
  decision: RunbookWebhookRateLimitDecision;
  message: string;
}): never {
  if (
    data.decision.outcome === RunbookWebhookRateLimitOutcome.CounterUnavailable
  ) {
    throw new ServiceUnavailableException(
      RunbookWebhookMessages.counterUnavailable,
    );
  }

  if (data.decision.retryAfterSeconds) {
    data.res.setHeader("Retry-After", String(data.decision.retryAfterSeconds));
  }

  throw new TooManyRequestsException(data.message);
}

function getInputsRefusalException(refusal: RunbookInputsRefusal): Exception {
  switch (refusal) {
    case RunbookInputsRefusal.TooLarge:
      return new PayloadTooLargeException(RunbookWebhookMessages.bodyTooLarge);
    case RunbookInputsRefusal.TooDeep:
      return new BadDataException(RunbookWebhookMessages.bodyTooDeep);
    case RunbookInputsRefusal.NulCharacter:
      return new BadDataException(RunbookWebhookMessages.nulCharacter);
    case RunbookInputsRefusal.NotAnObject:
    default:
      return new BadDataException(RunbookWebhookMessages.bodyNotAnObject);
  }
}

function getStartRefusalException(refusal: RunbookStartRefusal): Exception {
  switch (refusal) {
    case RunbookStartRefusal.TurnedOff:
      return new ForbiddenException(RunbookWebhookMessages.runbookOff);
    case RunbookStartRefusal.NoSteps:
      return new BadDataException(RunbookWebhookMessages.noSteps);
    case RunbookStartRefusal.ProjectBlocked:
      return new ProjectBlockedException();
    case RunbookStartRefusal.NotQueued:
      return new ServiceUnavailableException(
        RunbookWebhookMessages.counterUnavailable,
      );
    case RunbookStartRefusal.NotFound:
    default:
      return new NotFoundException(RunbookWebhookMessages.notFound);
  }
}

function readRunbookId(req: ExpressRequest): ObjectID | null {
  const value: string | undefined = req.params["runbookId"];

  if (!value || !ObjectID.isValidUUID(value)) {
    return null;
  }

  return new ObjectID(value);
}

function getRawBodyByteLength(req: ExpressRequest): number | undefined {
  const rawBody: string | undefined = (req as OneUptimeRequest).rawBody;

  return typeof rawBody === "string"
    ? Buffer.byteLength(rawBody, "utf8")
    : undefined;
}

export default class RunbookWebhookAPI {
  public router!: ExpressRouter;

  public constructor() {
    this.router = Express.getRouter();

    this.router.post(RUNBOOK_WEBHOOK_ROUTE, this.callWebhook);
    this.router.get(RUNBOOK_WEBHOOK_ROUTE, this.refuseGet);

    this.router.post(
      RUNBOOK_WEBHOOK_SECRET_ROUTE,
      UserMiddleware.getUserMiddleware,
      this.readSecretKey,
    );
    this.router.post(
      RUNBOOK_WEBHOOK_SECRET_RESET_ROUTE,
      UserMiddleware.getUserMiddleware,
      this.resetSecretKey,
    );
  }

  public async callWebhook(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      const addressDecision: RunbookWebhookRateLimitDecision =
        await RunbookWebhookRateLimit.consumeForAddress(req);

      if (addressDecision.outcome !== RunbookWebhookRateLimitOutcome.Allowed) {
        throwRateLimited({
          res,
          decision: addressDecision,
          message: RunbookWebhookMessages.tooManyCallsFromAddress,
        });
      }

      const runbookId: ObjectID | null = readRunbookId(req);

      const runbook: Runbook | null = runbookId
        ? await RunbookService.findOneById({
            id: runbookId,
            select: {
              ...RUNBOOK_START_SELECT,
              isWebhookEnabled: true,
              webhookSecretKey: true,
            },
            props: { isRoot: true },
          })
        : null;

      if (
        !runbookId ||
        !runbook ||
        !isRunbookWebhookKeyMatch(
          runbook.webhookSecretKey,
          req.params["secretKey"],
        )
      ) {
        throw new NotFoundException(RunbookWebhookMessages.notFound);
      }

      if (runbook.isWebhookEnabled !== true) {
        throw new ForbiddenException(RunbookWebhookMessages.webhookOff);
      }

      if (runbook.isEnabled === false) {
        throw new ForbiddenException(RunbookWebhookMessages.runbookOff);
      }

      const read: RunbookInputsReadResult = readRunbookInputs(
        req.body,
        getRawBodyByteLength(req),
      );

      if (read.isRefused) {
        throw getInputsRefusalException(read.refusal);
      }

      const runbookDecision: RunbookWebhookRateLimitDecision =
        await RunbookWebhookRateLimit.consumeForRunbook(runbookId);

      if (runbookDecision.outcome !== RunbookWebhookRateLimitOutcome.Allowed) {
        throwRateLimited({
          res,
          decision: runbookDecision,
          message: RunbookWebhookMessages.rateLimited,
        });
      }

      const activeRuns: PositiveNumber = await RunbookExecutionService.countBy({
        query: {
          runbookId: runbookId,
          triggerType: RunbookTriggerType.Webhook,
          status: QueryHelper.any(ACTIVE_STATUSES),
        },
        props: { isRoot: true },
      });

      if (activeRuns.toNumber() >= RUNBOOK_WEBHOOK_MAX_ACTIVE_RUNS) {
        throw new TooManyRequestsException(
          RunbookWebhookMessages.tooManyActiveRuns,
        );
      }

      const callerIp: string | undefined = resolveTrustedClientIp(
        req as unknown as ClientIpRequestLike,
      );

      const started: RunbookStartResult = await RunbookStarter.start({
        projectId: runbook.projectId!,
        runbookId: runbookId,
        trigger: RunbookTriggerType.Webhook,
        inputs: read.inputs,
        triggerDetails: callerIp ? ({ callerIp } as JSONObject) : undefined,
        runbook: runbook,
      });

      if (!started.isStarted) {
        throw getStartRefusalException(started.refusal);
      }

      logger.info(
        `Runbook ${runbookId.toString()} was started by its webhook (execution ${started.execution._id?.toString()}).`,
        { projectId: runbook.projectId?.toString() },
      );

      return Response.sendJsonObjectResponse(req, res, {
        runbookExecutionId: started.execution._id?.toString() || null,
        status: RunbookExecutionStatus.Scheduled,
      });
    } catch (err) {
      next(err);
    }
  }

  /*
   * A GET never starts a run: a chat app previewing a pasted link, or a
   * crawler, sends one. Answered 405 with how to call the URL, before
   * anything is looked up.
   */
  public async refuseGet(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      res.setHeader("Allow", "POST");

      return Response.sendJsonObjectResponse(
        req,
        res,
        { message: RunbookWebhookMessages.getNotAllowed },
        { statusCode: new StatusCode(405) },
      );
    } catch (err) {
      next(err);
    }
  }

  public async readSecretKey(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      const target: {
        props: DatabaseCommonInteractionProps;
        runbookId: ObjectID;
      } = await RunbookWebhookAPI.assertMayManage(req);

      const runbook: Runbook | null = await RunbookService.findOneById({
        id: target.runbookId,
        select: { isWebhookEnabled: true, webhookSecretKey: true },
        props: { isRoot: true },
      });

      let secretKey: string | null = isRunbookWebhookSecretKeyShape(
        runbook?.webhookSecretKey,
      )
        ? runbook!.webhookSecretKey!
        : null;

      // A webhook that is on always has a URL to show.
      if (!secretKey && runbook?.isWebhookEnabled === true) {
        secretKey = await RunbookService.ensureWebhookSecretKey(
          target.runbookId,
        );
      }

      res.setHeader("Cache-Control", "no-store");

      return Response.sendJsonObjectResponse(req, res, {
        secretKey: secretKey,
        isWebhookEnabled: runbook?.isWebhookEnabled === true,
      });
    } catch (err) {
      next(err);
    }
  }

  public async resetSecretKey(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      const target: {
        props: DatabaseCommonInteractionProps;
        runbookId: ObjectID;
      } = await RunbookWebhookAPI.assertMayManage(req);

      const secretKey: string = await RunbookService.resetWebhookSecretKey(
        target.runbookId,
      );

      logger.info(
        `The webhook URL of runbook ${target.runbookId.toString()} was reset${
          target.props.userId
            ? ` by user ${target.props.userId.toString()}`
            : ""
        }.`,
      );

      res.setHeader("Cache-Control", "no-store");

      return Response.sendJsonObjectResponse(req, res, {
        secretKey: secretKey,
      });
    } catch (err) {
      next(err);
    }
  }

  /*
   * The caller of a key route: a signed-in member of the project (or its
   * API key) who may set up this runbook's triggers and run it.
   */
  private static async assertMayManage(
    req: ExpressRequest,
  ): Promise<{ props: DatabaseCommonInteractionProps; runbookId: ObjectID }> {
    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);
    const projectId: ObjectID =
      CommonAPI.assertAuthenticatedProjectPrincipal(props);

    const runbookId: ObjectID | null = readRunbookId(req);

    if (!runbookId) {
      throw new NotFoundException("Runbook not found.");
    }

    await RunbookTriggerAccess.assertMayManageWebhook({
      props,
      projectId,
      runbookId,
    });

    return { props, runbookId };
  }
}
