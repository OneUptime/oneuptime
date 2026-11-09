import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject, JSONValue } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import {
  PUBLIC_NOTE_APPROVAL_TEXT_MAX_LENGTH,
  PublicNoteApprovalDecision,
} from "../../Types/StatusPage/PublicNoteApproval";
import UserMiddleware from "../Middleware/UserAuthorization";
import {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import PublicNoteApprovalEngine, {
  PublicNoteApprovalHost,
  PublicNoteApprovalNoteSummary,
  PublicNoteApprovalOutcome,
  PublicNoteApprovalPolicySummary,
} from "../Utils/Notes/PublicNoteApprovalEngine";
import Response from "../Utils/Response";
import CommonAPI from "./CommonAPI";

/*
 * What a person does to a public note's approval, beside its CRUD
 * (Types/StatusPage/PublicNoteApproval), on each kind of public note's path:
 *
 *   POST <note path>/:noteId/approve        { comment? }
 *   POST <note path>/:noteId/reject         { reason }
 *   POST <note path>/:noteId/resubmit
 *   POST <note path>/:noteId/discard-edit
 *   POST <note path>/approval/notes         { noteIds }  where each note stands
 *   POST <note path>/approval/policy                     who approves
 *
 * Approving and rejecting take a signed-in person - an approver is a
 * person, never an API key - who can read the note and is named on the step
 * it waits for (PublicNoteApprovalEngine.decide). Sending a note again and
 * withdrawing an edit take whoever may edit the note, as an edit does. The
 * two reads take a member of the project who can read its notes.
 */

// The most notes one summary request reads: a page of the notes feed.
export const PUBLIC_NOTE_APPROVAL_SUMMARY_LIMIT: number = 100;

export default class PublicNoteApprovalRoutes {
  public static register<TNote extends BaseModel>(data: {
    router: ExpressRouter;
    basePath: string;
    getHost: () => PublicNoteApprovalHost<TNote>;
  }): void {
    const decisions: Array<{
      route: string;
      decision: PublicNoteApprovalDecision;
      textKey: string;
    }> = [
      {
        route: "approve",
        decision: PublicNoteApprovalDecision.Approve,
        textKey: "comment",
      },
      {
        route: "reject",
        decision: PublicNoteApprovalDecision.Reject,
        textKey: "reason",
      },
    ];

    for (const decision of decisions) {
      data.router.post(
        `${data.basePath}/:noteId/${decision.route}`,
        UserMiddleware.getUserMiddleware,
        async (
          req: ExpressRequest,
          res: ExpressResponse,
          next: NextFunction,
        ) => {
          try {
            const props: DatabaseCommonInteractionProps =
              await CommonAPI.getDatabaseCommonInteractionProps(req);

            CommonAPI.assertAuthenticatedUser(
              props,
              "Only a signed-in person can approve or reject a public note: approvers are people.",
            );
            CommonAPI.assertAuthenticatedProjectMember(props);

            const outcome: PublicNoteApprovalOutcome =
              await PublicNoteApprovalEngine.decide({
                host: data.getHost(),
                noteId: this.readNoteId(req),
                decision: decision.decision,
                props,
                text: this.readText(req, decision.textKey),
              });

            return Response.sendJsonObjectResponse(
              req,
              res,
              outcome as unknown as JSONObject,
            );
          } catch (error) {
            next(error);
          }
        },
      );
    }

    data.router.post(
      `${data.basePath}/:noteId/resubmit`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          CommonAPI.assertAuthenticatedProjectPrincipal(props);

          const outcome: PublicNoteApprovalOutcome =
            await PublicNoteApprovalEngine.resubmit({
              host: data.getHost(),
              noteId: this.readNoteId(req),
              props,
            });

          return Response.sendJsonObjectResponse(
            req,
            res,
            outcome as unknown as JSONObject,
          );
        } catch (error) {
          next(error);
        }
      },
    );

    data.router.post(
      `${data.basePath}/:noteId/discard-edit`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          CommonAPI.assertAuthenticatedProjectPrincipal(props);

          const outcome: PublicNoteApprovalOutcome =
            await PublicNoteApprovalEngine.discardEdit({
              host: data.getHost(),
              noteId: this.readNoteId(req),
              props,
            });

          return Response.sendJsonObjectResponse(
            req,
            res,
            outcome as unknown as JSONObject,
          );
        } catch (error) {
          next(error);
        }
      },
    );

    data.router.post(
      `${data.basePath}/approval/notes`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          const projectId: ObjectID =
            CommonAPI.assertAuthenticatedProjectPrincipal(props);

          const summaries: Array<PublicNoteApprovalNoteSummary> =
            await PublicNoteApprovalEngine.describeNotes({
              host: data.getHost(),
              noteIds: this.readNoteIds(req),
              props,
              projectId,
            });

          return Response.sendJsonObjectResponse(req, res, {
            notes: summaries as unknown as Array<JSONObject>,
          });
        } catch (error) {
          next(error);
        }
      },
    );

    data.router.post(
      `${data.basePath}/approval/policy`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          const projectId: ObjectID =
            CommonAPI.assertAuthenticatedProjectPrincipal(props);

          // Who approves is told to those who read the notes they approve.
          CommonAPI.assertPermittedInProject({
            databaseProps: props,
            allowedPermissions:
              new (data.getHost().modelType)().getReadPermissions(),
            errorMessage:
              "Reading who approves public notes takes a role that can read them.",
          });

          const policy: PublicNoteApprovalPolicySummary =
            await PublicNoteApprovalEngine.describePolicy({
              host: data.getHost(),
              projectId,
            });

          return Response.sendJsonObjectResponse(
            req,
            res,
            policy as unknown as JSONObject,
          );
        } catch (error) {
          next(error);
        }
      },
    );
  }

  public static readNoteId(req: ExpressRequest): ObjectID {
    const noteId: string | undefined = req.params["noteId"];

    if (!noteId || !ObjectID.isValidUUID(noteId)) {
      throw new BadDataException("A valid note ID is required.");
    }

    return new ObjectID(noteId);
  }

  // A comment or a reason, as text, at most the length a decision keeps.
  public static readText(req: ExpressRequest, key: string): string {
    const body: JSONObject =
      req.body && typeof req.body === "object" && !Array.isArray(req.body)
        ? (req.body as JSONObject)
        : {};

    const value: JSONValue | undefined = body[key];

    if (value === undefined || value === null) {
      return "";
    }

    if (typeof value !== "string") {
      throw new BadDataException(`${key} must be text.`);
    }

    return value.trim().substring(0, PUBLIC_NOTE_APPROVAL_TEXT_MAX_LENGTH);
  }

  public static readNoteIds(req: ExpressRequest): Array<ObjectID> {
    const body: JSONObject =
      req.body && typeof req.body === "object" && !Array.isArray(req.body)
        ? (req.body as JSONObject)
        : {};

    const value: JSONValue | undefined = body["noteIds"];

    if (!Array.isArray(value)) {
      throw new BadDataException("noteIds must be a list of note IDs.");
    }

    if (value.length > PUBLIC_NOTE_APPROVAL_SUMMARY_LIMIT) {
      throw new BadDataException(
        `Ask about at most ${PUBLIC_NOTE_APPROVAL_SUMMARY_LIMIT} notes at a time.`,
      );
    }

    const ids: Array<ObjectID> = [];

    for (const item of value) {
      if (typeof item !== "string" || !ObjectID.isValidUUID(item)) {
        throw new BadDataException("noteIds must be a list of note IDs.");
      }

      if (
        !ids.some((id: ObjectID): boolean => {
          return id.toString() === item;
        })
      ) {
        ids.push(new ObjectID(item));
      }
    }

    return ids;
  }
}
