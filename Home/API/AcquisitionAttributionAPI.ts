import Express, {
  ExpressApplication,
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import Attribution from "Common/Server/Utils/Attribution";
import MarketingTouchpointService from "Common/Server/Services/MarketingTouchpointService";
import {
  AttributionConsentState,
  AttributionTouchpointType,
} from "Common/Types/Marketing/AcquisitionAttribution";

const app: ExpressApplication = Express.getExpressApp();
const MAX_EVENT_ID_LENGTH: number = 200;

app.post(
  "/api/acquisition/touchpoint",
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    try {
      const body: JSONObject = (req.body || {}) as JSONObject;
      const eventId: string = String(body["eventId"] || "").slice(
        0,
        MAX_EVENT_ID_LENGTH,
      );
      const touchpointType: string = String(body["touchpointType"] || "");
      const attribution: JSONObject | undefined =
        Attribution.sanitizeAcquisitionAttribution(body["attribution"]);
      const visitorId: string = String(
        attribution?.["anonymousVisitorId"] || "",
      );

      if (!eventId || !visitorId) {
        throw new BadDataException("A valid event and anonymous visitor are required.");
      }
      if (!Object.values(AttributionTouchpointType).includes(touchpointType as AttributionTouchpointType)) {
        throw new BadDataException("Unsupported acquisition touchpoint type.");
      }

      const consentState: string = String(
        attribution?.["consentState"] || AttributionConsentState.Unknown,
      );
      const occurredAt: Date = new Date(String(body["occurredAt"] || ""));
      const boundedOccurredAt: Date =
        !Number.isNaN(occurredAt.getTime()) &&
        Math.abs(Date.now() - occurredAt.getTime()) < 7 * 24 * 60 * 60 * 1000
          ? occurredAt
          : new Date();

      await MarketingTouchpointService.record({
        eventId,
        anonymousVisitorId: visitorId,
        touchpointType,
        consentState,
        attribution: attribution || {},
        occurredAt: boundedOccurredAt,
        externalReferenceId: body["externalReferenceId"]
          ? String(body["externalReferenceId"]).slice(0, 100)
          : undefined,
      });

      return Response.sendEmptySuccessResponse(req, res);
    } catch (err) {
      return next(err);
    }
  },
);
