import { ExpressRequest } from "Common/Server/Utils/Express";
import CaptureSpan from "Common/Server/Utils/Telemetry/CaptureSpan";
import { JSONArray, JSONObject } from "Common/Types/JSON";

export default abstract class OtelIngestBaseService {
  @CaptureSpan()
  protected static getServiceNameFromAttributes(
    req: ExpressRequest,
    attributes: JSONArray,
  ): string {
    for (const attribute of attributes) {
      if (
        attribute["key"] === "service.name" &&
        attribute["value"] &&
        (attribute["value"] as JSONObject)["stringValue"]
      ) {
        if (
          typeof (attribute["value"] as JSONObject)["stringValue"] === "string"
        ) {
          return (attribute["value"] as JSONObject)["stringValue"] as string;
        }
      }
    }

    const serviceName: string = req.headers[
      "x-oneuptime-service-name"
    ] as string;

    if (serviceName) {
      return serviceName;
    }

    return "Unknown Service";
  }

  @CaptureSpan()
  protected static getServiceNameFromHeaders(
    req: ExpressRequest,
    defaultName: string = "Unknown Service",
  ): string {
    const headerValue: string | string[] | undefined = req.headers[
      "x-oneuptime-service-name"
    ];

    if (typeof headerValue === "string" && headerValue.trim()) {
      return headerValue.trim();
    }

    if (Array.isArray(headerValue) && headerValue.length > 0) {
      const value: string = headerValue.find((item: string) => {
        return item && item.trim();
      }) as string;

      if (value && value.trim()) {
        return value.trim();
      }
    }

    return defaultName;
  }
}
