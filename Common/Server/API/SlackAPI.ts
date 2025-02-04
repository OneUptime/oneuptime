import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
} from "../Utils/Express";
import Response from "../Utils/Response";
import SlackAuthorization from "../Middleware/SlackAuthorization";
import BadRequestException from "../../Types/Exception/BadRequestException";


export default class SlackAPI {
  public getRouter(): ExpressRouter {
    

    const router: ExpressRouter = Express.getRouter();

    router.get("/slack/auth", (_req: ExpressRequest, res: ExpressResponse) => {
      return Response.sendEmptySuccessResponse(_req, res);
    });


    router.post("/slack/events", SlackAuthorization.isAuthorizedSlackRequest,  (req: ExpressRequest, res: ExpressResponse) => {
     // respond to slack challenge

     const body: any = req.body;

      if (body.challenge) {
        return Response.sendJsonObjectResponse(req, res, {
          challenge: body.challenge,
        })
      }

      return Response.sendErrorResponse(req, res, new BadRequestException("Invalid request"));
    });

    return router;
  }
}
