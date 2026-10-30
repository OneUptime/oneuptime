import SecurityCaseEvidence from "../../Models/DatabaseModels/SecurityCaseEvidence";
import SecurityHunt from "../../Models/DatabaseModels/SecurityHunt";
import SecurityEvent from "../../Models/AnalyticsModels/SecurityEvent";
import File from "../../Models/DatabaseModels/File";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import NotFoundException from "../../Types/Exception/NotFoundException";
import { JSONObject, JSONValue } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import {
  SecurityCaseEventHunt,
  SecurityCaseEventReference,
  SecurityCaseEventsAddResult,
  readSecurityCaseEventReferences,
} from "../../Types/SecurityCase/SecurityCaseEventEvidence";
import SecurityHuntService from "../Services/SecurityHuntService";
import SecurityCaseEvidenceService, {
  Service as SecurityCaseEvidenceServiceType,
} from "../Services/SecurityCaseEvidenceService";
import UserMiddleware from "../Middleware/UserAuthorization";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import FileOwnership from "../Utils/File/FileOwnership";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import CommonAPI from "./CommonAPI";

// The one answer for evidence that is not there, not a file, or not the reader's.
export const EVIDENCE_FILE_NOT_FOUND_MESSAGE: string = "Evidence not found";

/*
 * A security case's evidence, the route its files download through -
 * GET /security-case-evidence/file/:projectId/:evidenceId - and the route
 * that keeps security events on a case - POST
 * /security-case-evidence/add-events (see addEvents below).
 *
 * The evidence is read as the person asking (its read permissions, and the
 * case's: CanAccessIfCanReadOn), so only whoever can read the case can
 * download what is kept on it, and its file must have been uploaded in the
 * case's own project. Anything else - evidence that is not there, a link,
 * another project's - gets the same answer, so the route never says what
 * exists. The file is sent as a download (Response.sendFileResponse: only a
 * raster image is shown inline, behind a sandboxing policy): evidence can be
 * an attacker's own page or script.
 */
export default class SecurityCaseEvidenceAPI extends BaseAPI<
  SecurityCaseEvidence,
  SecurityCaseEvidenceServiceType
> {
  public constructor() {
    super(SecurityCaseEvidence, SecurityCaseEvidenceService);

    this.router.get(
      `${new this.entityType().getCrudApiPath()?.toString()}/file/:projectId/:evidenceId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.getEvidenceFile(req, res);
        } catch (err) {
          next(err);
        }
      },
    );

    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/add-events`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.addEvents(req, res);
        } catch (err) {
          next(err);
        }
      },
    );
  }

  /*
   * POST /security-case-evidence/add-events: security events kept on a
   * case, as the person asking (SecurityCaseEvidenceService.addEvents).
   * It takes a role that adds evidence to cases and one that reads security
   * events: what is kept is read from the events table as them.
   *
   *   { securityCaseId, events: [{ eventUid, time }], securityHuntId? }
   *
   * answers { added, alreadyOnCase, notFound }, each a list of event ids.
   * A hunt named that is not there is left out of what is kept.
   */
  private async addEvents(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);
    const projectId: ObjectID =
      CommonAPI.assertAuthenticatedProjectMember(props);

    CommonAPI.assertCanCreateTable({
      modelType: SecurityCaseEvidence,
      props,
      errorMessage:
        "Keeping events on a case takes a role that can add evidence to cases.",
    });

    CommonAPI.assertPermittedInProject({
      databaseProps: props,
      allowedPermissions: new SecurityEvent().getReadPermissions(),
      errorMessage:
        "Keeping events on a case takes a role that can read security events.",
    });

    const body: JSONObject =
      req.body && typeof req.body === "object" && !Array.isArray(req.body)
        ? (req.body as JSONObject)
        : {};

    const caseIdText: JSONValue | undefined = body["securityCaseId"];

    if (typeof caseIdText !== "string" || !ObjectID.isValidUUID(caseIdText)) {
      throw new BadDataException("Choose the case to keep the events on.");
    }

    const events: Array<SecurityCaseEventReference> =
      readSecurityCaseEventReferences(body["events"]);

    if (events.length === 0) {
      throw new BadDataException("Choose the events to keep on the case.");
    }

    const result: SecurityCaseEventsAddResult =
      await SecurityCaseEvidenceService.addEvents({
        projectId,
        securityCaseId: new ObjectID(caseIdText),
        events,
        hunt: await this.readHunt({
          huntIdText: body["securityHuntId"],
          projectId,
          props,
        }),
        props,
      });

    return Response.sendJsonObjectResponse(
      req,
      res,
      result as unknown as JSONObject,
    );
  }

  // The hunt the events were found by, read as the person asking; null when none is named or found.
  private async readHunt(data: {
    huntIdText: JSONValue | undefined;
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<SecurityCaseEventHunt | null> {
    if (
      typeof data.huntIdText !== "string" ||
      !ObjectID.isValidUUID(data.huntIdText)
    ) {
      return null;
    }

    const hunt: SecurityHunt | null = await SecurityHuntService.findOneBy({
      query: {
        _id: new ObjectID(data.huntIdText),
        projectId: data.projectId,
      },
      select: {
        _id: true,
        name: true,
      },
      props: data.props,
    });

    if (!hunt?.id || !hunt.name) {
      return null;
    }

    return { id: hunt.id.toString(), name: hunt.name };
  }

  private async getEvidenceFile(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const evidenceIdParam: string | undefined = req.params["evidenceId"];

    if (!evidenceIdParam || !ObjectID.isValidUUID(evidenceIdParam)) {
      throw new NotFoundException(EVIDENCE_FILE_NOT_FOUND_MESSAGE);
    }

    const evidenceId: ObjectID = new ObjectID(evidenceIdParam);

    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    const evidence: SecurityCaseEvidence | null = await this.service.findOneBy({
      query: {
        _id: evidenceId,
      },
      select: {
        projectId: true,
        fileId: true,
        file: {
          _id: true,
          file: true,
          fileType: true,
          name: true,
        },
      },
      props,
    });

    // A link, or evidence the person cannot read: nothing to send.
    if (!evidence?.fileId || !evidence.file) {
      throw new NotFoundException(EVIDENCE_FILE_NOT_FOUND_MESSAGE);
    }

    // Its own file, uploaded in its own project.
    const file: File | undefined = await FileOwnership.findProjectAttachment({
      files: [evidence.file],
      fileId: evidence.fileId,
      projectId: evidence.projectId,
    });

    if (!file) {
      throw new NotFoundException(EVIDENCE_FILE_NOT_FOUND_MESSAGE);
    }

    Response.setNoCacheHeaders(res);
    return Response.sendFileResponse(req, res, file);
  }
}
