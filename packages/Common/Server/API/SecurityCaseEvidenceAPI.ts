import SecurityCaseEvidence from "../../Models/DatabaseModels/SecurityCaseEvidence";
import File from "../../Models/DatabaseModels/File";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotFoundException from "../../Types/Exception/NotFoundException";
import ObjectID from "../../Types/ObjectID";
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
 * A security case's evidence, and the route its files download through:
 * GET /security-case-evidence/file/:projectId/:evidenceId.
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

    const evidence: SecurityCaseEvidence | null =
      await this.service.findOneBy({
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

    // Its own file, uploaded in its own project.
    const file: File | undefined =
      evidence?.fileId && evidence.file
        ? await FileOwnership.findProjectAttachment({
            files: [evidence.file],
            fileId: evidence.fileId,
            projectId: evidence.projectId,
          })
        : undefined;

    if (!file) {
      throw new NotFoundException(EVIDENCE_FILE_NOT_FOUND_MESSAGE);
    }

    Response.setNoCacheHeaders(res);
    return Response.sendFileResponse(req, res, file);
  }
}
