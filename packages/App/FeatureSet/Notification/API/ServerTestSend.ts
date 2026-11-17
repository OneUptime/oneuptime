import ServerTestSendService from "../Services/ServerTestSendService";
import MasterAdminAuthorization from "Common/Server/Middleware/MasterAdminAuthorization";
import UserMiddleware, {
  RequestSession,
} from "Common/Server/Middleware/UserAuthorization";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import Email from "Common/Types/Email";
import BadDataException from "Common/Types/Exception/BadDataException";
import NotAuthenticatedException from "Common/Types/Exception/NotAuthenticatedException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Phone from "Common/Types/Phone";
import { ServerTestSendAnswer } from "Common/Types/ServerSetup/ServerTestSend";

/*
 * POST /server-test/email, /server-test/sms and /server-test/call - a master
 * admin's "Send test email", "Send test SMS" and "Make test call": one send
 * through the server's own settings, to the address or number they typed
 * (ServerTestSendService). Answers how it went in words - accepted by what,
 * refused and why, or not set up and what is missing - with 200 every time:
 * a refused test is an answer, not an error. Only an address or number that
 * is not one is refused (400).
 *
 * POST /server-test/push - "Send test push" (#7028): to the master admin
 * who pressed it, on their own registered phones and browsers. It takes no
 * address: whoever is signed in is who it goes to, and a body naming
 * another person changes nothing.
 *
 * Master admins only, and never the master API key: a test sends a message
 * on the server's account.
 */

// Who is signed in: the admin a test push goes to.
export const readSignedInUserId: (
  req: ExpressRequest,
) => Promise<ObjectID> = async (req: ExpressRequest): Promise<ObjectID> => {
  const session: RequestSession = await UserMiddleware.readRequestSession(req);

  if (session.kind !== "user" || !session.session.userId) {
    throw new NotAuthenticatedException(
      "Sign in again to send a test push to your own devices.",
    );
  }

  return new ObjectID(session.session.userId.toString());
};

const router: ExpressRouter = Express.getRouter();

export const readTestEmail: (value: unknown) => Email = (
  value: unknown,
): Email => {
  const text: string = typeof value === "string" ? value.trim() : "";

  if (!text || !Email.isValid(text)) {
    throw new BadDataException("Enter the email address to send the test to.");
  }

  return new Email(text);
};

export const readTestPhone: (value: unknown) => Phone = (
  value: unknown,
): Phone => {
  const text: string = typeof value === "string" ? value.trim() : "";

  if (!text) {
    throw new BadDataException("Enter the phone number to send the test to.");
  }

  try {
    return new Phone(text);
  } catch {
    throw new BadDataException(
      "Enter the phone number with its country code, such as +14155550100.",
    );
  }
};

const send: (
  read: (body: JSONObject) => Promise<ServerTestSendAnswer>,
) => (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => Promise<void> = (
  read: (body: JSONObject) => Promise<ServerTestSendAnswer>,
) => {
  return async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const answer: ServerTestSendAnswer = await read(
        (req.body || {}) as JSONObject,
      );

      return Response.sendJsonObjectResponse(
        req,
        res,
        answer as unknown as JSONObject,
      );
    } catch (err) {
      return next(err);
    }
  };
};

router.post(
  "/email",
  MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
  send(async (body: JSONObject): Promise<ServerTestSendAnswer> => {
    return await ServerTestSendService.sendEmail(
      readTestEmail(body["toEmail"]),
    );
  }),
);

router.post(
  "/sms",
  MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
  send(async (body: JSONObject): Promise<ServerTestSendAnswer> => {
    return await ServerTestSendService.sendSms(readTestPhone(body["toPhone"]));
  }),
);

router.post(
  "/call",
  MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
  send(async (body: JSONObject): Promise<ServerTestSendAnswer> => {
    return await ServerTestSendService.makeCall(readTestPhone(body["toPhone"]));
  }),
);

router.post(
  "/push",
  MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      // The signed-in admin's own devices, never ones a body names.
      const answer: ServerTestSendAnswer = await ServerTestSendService.sendPush(
        await readSignedInUserId(req),
      );

      return Response.sendJsonObjectResponse(
        req,
        res,
        answer as unknown as JSONObject,
      );
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
