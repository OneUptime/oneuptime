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
import MarketingConversionService from "Common/Server/Services/MarketingConversionService";
import MarketingConversion from "Common/Models/DatabaseModels/MarketingConversion";
import {
  AttributionConsentState,
  AttributionTouchpointType,
} from "Common/Types/Marketing/AcquisitionAttribution";
import { MarketingConversionType } from "Common/Types/Marketing/MarketingConversion";

const app: ExpressApplication = Express.getExpressApp();

app.post(
  "/api/acquisition/touchpoint",
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    try {
      const body: JSONObject = (req.body || {}) as JSONObject;
      const eventId: string = String(body["eventId"] || "").slice(0, 100);
      const touchpointType: string = String(body["touchpointType"] || "");
      const attribution: JSONObject | undefined =
        Attribution.sanitizeAcquisitionAttribution(body["attribution"]);
      const visitorId: string = String(
        attribution?.["anonymousVisitorId"] || "",
      );

      if (!eventId || !visitorId) {
        throw new BadDataException("A valid event and anonymous visitor are required.");
      }
      if (
        !Object.values(AttributionTouchpointType).includes(
          touchpointType as AttributionTouchpointType,
        )
      ) {
        throw new BadDataException("Unsupported acquisition touchpoint type.");
      }

      const existing: MarketingConversion | null =
        await MarketingConversionService.findOneBy({
          query: { sourceEventId: eventId },
          select: { _id: true },
          props: { isRoot: true },
        });

      if (!existing) {
        const occurredAt: Date = new Date(String(body["occurredAt"] || ""));
        const conversion: MarketingConversion = new MarketingConversion();
        conversion.conversionType = MarketingConversionType.Touchpoint;
        conversion.sourceEventId = eventId;
        conversion.anonymousVisitorId = visitorId;
        conversion.touchpointType = touchpointType;
        conversion.consentState = String(
          attribution?.["consentState"] || AttributionConsentState.Unknown,
        );
        conversion.attribution = attribution || {};
        conversion.clickIds = {};
        conversion.conversionAt =
          !Number.isNaN(occurredAt.getTime()) &&
          Math.abs(Date.now() - occurredAt.getTime()) < 7 * 86400000
            ? occurredAt
            : new Date();
        conversion.externalReferenceId = body["externalReferenceId"]
          ? String(body["externalReferenceId"]).slice(0, 100)
          : undefined;
        try {
          await MarketingConversionService.create({
            data: conversion,
            props: { isRoot: true },
          });
        } catch (err) {
          const raced: MarketingConversion | null =
            await MarketingConversionService.findOneBy({
              query: { sourceEventId: eventId },
              select: { _id: true },
              props: { isRoot: true },
            });
          if (!raced) throw err;
        }
      }

      return Response.sendEmptySuccessResponse(req, res);
    } catch (err) {
      return next(err);
    }
  },
);
