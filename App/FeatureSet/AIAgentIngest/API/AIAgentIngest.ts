import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import AIAgentService from "Common/Server/Services/AIAgentService";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import AIAgent from "Common/Models/DatabaseModels/AIAgent";

const router: ExpressRouter = Express.getRouter();

// Middleware to authorize AI Agent requests
async function isAuthorizedAIAgentMiddleware(
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
): Promise<void> {
  const data: JSONObject = req.body;

  if (!data["aiAgentId"] || !data["aiAgentKey"]) {
    return Response.sendErrorResponse(
      req,
      res,
      new BadDataException("aiAgentId or aiAgentKey is missing"),
    );
  }

  const aiAgentId: ObjectID = new ObjectID(data["aiAgentId"] as string);

  const aiAgentKey: string = data["aiAgentKey"] as string;

  const aiAgent: AIAgent | null = await AIAgentService.findOneBy({
    query: {
      _id: aiAgentId.toString(),
      secretKey: aiAgentKey,
    },
    select: {
      _id: true,
    },
    props: {
      isRoot: true,
    },
  });

  if (!aiAgent) {
    return Response.sendErrorResponse(
      req,
      res,
      new BadDataException("Invalid AI Agent ID or AI Agent Key"),
    );
  }

  // Update last alive
  await AIAgentService.updateLastAlive(aiAgentId);

  return next();
}

router.post(
  "/alive",
  isAuthorizedAIAgentMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      // Update last alive in AI Agent and return success response.
      // The middleware already updates lastAlive, so we just return success.

      return Response.sendEmptySuccessResponse(req, res);
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
