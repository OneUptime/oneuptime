import OneUptimeDate from "Common/Types/Date";
import BadDataException from "Common/Types/Exception/BadDataException";
import ResellerService from "Common/Server/Services/ResellerService";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import JSONWebToken from "Common/Server/Utils/JsonWebToken";
import Response from "Common/Server/Utils/Response";
import Reseller from "Common/Models/DatabaseModels/Reseller";

const router: ExpressRouter = Express.getRouter();

router.post(
  "/reseller/auth/:resellerid",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const resellerId: string | undefined = req.params["resellerid"];

      if (!resellerId) {
        throw new BadDataException("Reseller ID not found");
      }

      const username: string = req.body["username"];
      const password: string = req.body["password"];

      if (!username) {
        throw new BadDataException("Username not found");
      }

      if (!password) {
        throw new BadDataException("Password not found");
      }

      // get the reseller user.
      const reseller: Reseller | null = await ResellerService.findOneBy({
        query: {
          resellerId: resellerId,
          username: username,
          password: password,
        },
        select: {
          _id: true,
          resellerId: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (!reseller) {
        throw new BadDataException(
          "Reseller not found or username and password is incorrect",
        );
      }

      // if found then generate a token and return it.

      const token: string = JSONWebToken.sign({
        data: { resellerId: resellerId },
        expiresInSeconds: OneUptimeDate.getDayInSeconds(365),
      });

      return Response.sendJsonObjectResponse(req, res, {
        access: token,
      });
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
