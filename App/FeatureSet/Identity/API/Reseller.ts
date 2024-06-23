import OneUptimeDate from Common/Types/Date;
import BadDataException from Common/Types/Exception/BadDataException;
import ResellerService from CommonServer/Services/ResellerService;
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from CommonServer/Utils/Express;
import JSONWebToken from CommonServer/Utils/JsonWebToken;
import Response from CommonServer/Utils/Response;
import Reseller from Model/Models/Reseller;

const router: ExpressRouter = Express.getRouter();

router.post(
  /reseller/auth/:resellerid,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const resellerId = await validateResellerId(req);
      const { username, password } = await validateRequestBody(req);

      const reseller = await findReseller(resellerId, username, password);

      if (!reseller) {
        throw new BadDataException(
          Reseller not found or username and password is incorrect,
        );
      }

      const token = generateToken(resellerId, reseller);
      return Response.sendJsonObjectResponse(req, res, { access: token });
    } catch (err) {
      return next(err);
    }
  },
);

async function validateResellerId(req: ExpressRequest): Promise<string | undefined> {
  const resellerId = req.params[resellerid];
  if (!resellerId) {
    throw new BadDataException(Reseller ID not found);
  }
  return resellerId;
}

async function validateRequestBody(req: ExpressRequest): Promise<{ username: string; password: string }> {
  const username = req.body[username];
  const password = req.body[password];
  if (!username) {
    throw new BadDataException(Username not found);
  }
  if (!password) {
    throw new BadDataException(Password not found);
  }
  return { username, password };
}

async function findReseller(
  resellerId: string,
  username: string,
  password: string,
): Promise<Reseller | null> {
  return await ResellerService.findOneBy({
    query: {
      resellerId,
      username,
      password,
    },
    select: {
      _id: true,
      resellerId: true,
    },
    props: {
      isRoot: true,
    },
  });
}

function generateToken(resellerId: string, reseller: Reseller): string {
  return JSONWebToken.sign({
    data: { resellerId },
    expiresInSeconds: OneUptimeDate.getDayInSeconds(365),
  });
}

export default router;

