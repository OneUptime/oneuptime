import AcmeChallenge from "../../Models/DatabaseModels/AcmeChallenge";
import NotFoundException from "../../Types/Exception/NotFoundException";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import AcmeChallengeService from "../Services/AcmeChallengeService";

const router: ExpressRouter = Express.getRouter();

router.get(
  "/.well-known/acme-challenge/:token",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ) => {
    try {
      const challenge: AcmeChallenge | null =
        await AcmeChallengeService.findOneBy({
          query: {
            token: req.params["token"] as string,
          },
          select: {
            challenge: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (!challenge) {
        return next(new NotFoundException("Challenge not found"));
      }

      return Response.sendTextResponse(
        req,
        res,
        challenge.challenge as string,
      );
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
