import UserMiddleware from "../Middleware/UserAuthorization";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import FormFollowUp from "../Utils/Form/FormFollowUp";
import { isFormFollowUpRecordType } from "../Utils/Form/FormFollowUpRecords";
import Response from "../Utils/Response";
import ProductsOfRequest from "../Utils/ServerProducts/ProductsOfRequest";
import ServerProductRoutes from "../Utils/ServerProducts/ServerProductRoutes";
import CommonAPI from "./CommonAPI";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import {
  FORM_FOLLOW_UP_RECORD_PEOPLE_PATH,
  FORM_FOLLOW_UP_RECORD_REMOVE_PATH,
  FORM_FOLLOW_UP_RECORD_REPLY_PATH,
  FORM_FOLLOW_UP_RECORD_ROUTE,
  FormFollowUpRecordView,
} from "../../Types/Form/FormFollowUp";
import FormTargetType from "../../Types/Form/FormTargetType";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";

/*
 * A FORM SUBMISSION'S FOLLOW-UP, ON THE PAGE OF THE RECORD IT CREATED
 * (Common/Types/Form/FormFollowUp, Utils/Form/FormFollowUp).
 *
 * GET  /form-follow-up/<record type>/<record id>
 *   Who sent the form, who follows the request, the conversation, and
 *   whether the caller may reply. For somebody who may read the record and
 *   its private notes - read with their own permissions first, so a private
 *   incident's follow-up is as private as the incident. 404 for a record no
 *   submission created: the record's page shows no card.
 *
 * POST /form-follow-up/<record type>/<record id>/reply           { message }
 * POST /form-follow-up/<record type>/<record id>/people          { email, name? }
 * POST /form-follow-up/<record type>/<record id>/people/<id>/remove
 *   A reply, emailed to everybody following - written as the caller's own
 *   private note on the record - and somebody added or taken off. For a
 *   signed-in member of the project who may edit the record, on a form whose
 *   follow-ups are on. Refused while Forms, or the record's product, is
 *   switched off on the server (#9489).
 *
 * Each answers with the follow-up as it is now.
 */
const router: ExpressRouter = Express.getRouter();

// The record type and id in the path, checked before anything is read.
const readRecord: (req: ExpressRequest) => {
  recordType: FormTargetType;
  recordId: ObjectID;
} = (
  req: ExpressRequest,
): { recordType: FormTargetType; recordId: ObjectID } => {
  const recordType: unknown = req.params["recordType"];

  if (!isFormFollowUpRecordType(recordType)) {
    throw new BadDataException(
      `Unknown record type. Use one of: ${Object.values(FormTargetType).join(
        ", ",
      )}.`,
    );
  }

  const recordIdText: string = String(req.params["recordId"] || "");

  if (!ObjectID.isValidUUID(recordIdText)) {
    throw new BadDataException("The record id is not a valid id.");
  }

  return { recordType: recordType, recordId: new ObjectID(recordIdText) };
};

// A JSON object body, or nothing at all.
const readBody: (req: ExpressRequest) => JSONObject = (
  req: ExpressRequest,
): JSONObject => {
  return req.body && typeof req.body === "object" && !Array.isArray(req.body)
    ? (req.body as JSONObject)
    : {};
};

// The caller, held to the project the request is for.
const readProps: (
  req: ExpressRequest,
  data: { isWrite: boolean },
) => Promise<DatabaseCommonInteractionProps> = async (
  req: ExpressRequest,
  data: { isWrite: boolean },
): Promise<DatabaseCommonInteractionProps> => {
  const props: DatabaseCommonInteractionProps =
    await CommonAPI.getDatabaseCommonInteractionProps(req);

  if (data.isWrite) {
    // A person writes to strangers, and the record's notes say who.
    CommonAPI.assertAuthenticatedProjectMember(props);
  } else {
    CommonAPI.assertTenantScoped(props);
  }

  return props;
};

/*
 * A record's follow-up, or for a record no submission created - most of
 * them, whose page asks all the same - an empty object: nothing to draw,
 * and nothing gone wrong.
 */
const send: (
  req: ExpressRequest,
  res: ExpressResponse,
  view: FormFollowUpRecordView | null,
) => void = (
  req: ExpressRequest,
  res: ExpressResponse,
  view: FormFollowUpRecordView | null,
): void => {
  Response.setNoCacheHeaders(res);

  return Response.sendJsonObjectResponse(
    req,
    res,
    view ? (view as unknown as JSONObject) : {},
  );
};

router.get(
  `${FORM_FOLLOW_UP_RECORD_ROUTE}/:recordType/:recordId`,
  UserMiddleware.getUserMiddleware,
  UserMiddleware.requireUserAuthentication,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const props: DatabaseCommonInteractionProps = await readProps(req, {
        isWrite: false,
      });

      return send(
        req,
        res,
        await FormFollowUp.getForRecord({ ...readRecord(req), props: props }),
      );
    } catch (err) {
      return next(err);
    }
  },
);

router.post(
  `${FORM_FOLLOW_UP_RECORD_ROUTE}/:recordType/:recordId/${FORM_FOLLOW_UP_RECORD_REPLY_PATH}`,
  UserMiddleware.getUserMiddleware,
  UserMiddleware.requireUserAuthentication,
  ServerProductRoutes.refuseWhileOffFor(ProductsOfRequest.formFollowUpRecord),
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const props: DatabaseCommonInteractionProps = await readProps(req, {
        isWrite: true,
      });

      return send(
        req,
        res,
        await FormFollowUp.replyFromRecord({
          ...readRecord(req),
          message: readBody(req)["message"],
          props: props,
        }),
      );
    } catch (err) {
      return next(err);
    }
  },
);

router.post(
  `${FORM_FOLLOW_UP_RECORD_ROUTE}/:recordType/:recordId/${FORM_FOLLOW_UP_RECORD_PEOPLE_PATH}`,
  UserMiddleware.getUserMiddleware,
  UserMiddleware.requireUserAuthentication,
  ServerProductRoutes.refuseWhileOffFor(ProductsOfRequest.formFollowUpRecord),
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const props: DatabaseCommonInteractionProps = await readProps(req, {
        isWrite: true,
      });

      const body: JSONObject = readBody(req);

      return send(
        req,
        res,
        await FormFollowUp.addPersonFromRecord({
          ...readRecord(req),
          email: body["email"],
          name: body["name"],
          props: props,
        }),
      );
    } catch (err) {
      return next(err);
    }
  },
);

router.post(
  `${FORM_FOLLOW_UP_RECORD_ROUTE}/:recordType/:recordId/${FORM_FOLLOW_UP_RECORD_PEOPLE_PATH}/:followerId/${FORM_FOLLOW_UP_RECORD_REMOVE_PATH}`,
  UserMiddleware.getUserMiddleware,
  UserMiddleware.requireUserAuthentication,
  ServerProductRoutes.refuseWhileOffFor(ProductsOfRequest.formFollowUpRecord),
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const props: DatabaseCommonInteractionProps = await readProps(req, {
        isWrite: true,
      });

      const followerId: string = String(req.params["followerId"] || "");

      if (!ObjectID.isValidUUID(followerId)) {
        throw new BadDataException("The person's id is not a valid id.");
      }

      return send(
        req,
        res,
        await FormFollowUp.removePersonFromRecord({
          ...readRecord(req),
          followerId: new ObjectID(followerId),
          props: props,
        }),
      );
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
