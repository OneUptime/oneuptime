import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  headerValueToString,
} from "Common/Server/Utils/Express";
import CaptureSpan from "Common/Server/Utils/Telemetry/CaptureSpan";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import TelemetryIngestSurface from "Common/Types/Telemetry/TelemetryIngestSurface";
import { MAX_DECOMPRESSED_OTLP_BODY_BYTES } from "../Utils/OtelPayloadDecoder";
import { drainCloudStreamBody } from "../Utils/CloudStreamBody";
import CompatibleIngestBody, {
  CompatibleBodyEncoding,
} from "../Utils/Compatible/CompatibleIngestBody";
import CompatibleIngestFailureMapper, {
  CompatibleIngestFailure,
} from "../Utils/Compatible/CompatibleIngestFailure";
import PrometheusRemoteWrite, {
  PrometheusRemoteWriteError,
  PrometheusRemoteWriteVersion,
  PrometheusTranslation,
  PrometheusWriteRequest,
} from "../Utils/Compatible/PrometheusRemoteWrite";
import SnappyBlock from "../Utils/Compatible/SnappyBlock";
import CompatibleIngestService from "./CompatibleIngestService";

/*
 * Prometheus remote write: POST /prometheus/api/v1/write (and under
 * /telemetry). See PrometheusRemoteWrite for what a series becomes.
 *
 * Answered as the remote write specification asks: 204 once the samples
 * are queued; 400 for a body that is not a write request (a sender drops
 * it, it would never be accepted); 415 for a proto this endpoint does not
 * read; 503 when the queue cannot take it (a sender retries). A 2.0
 * request is also told how many samples and histograms were written, in
 * the X-Prometheus-Remote-Write-*-Written headers.
 *
 * The key travels as remote write's own `authorization` (Bearer) or
 * `basic_auth` settings, or as an x-oneuptime-token header.
 */
export default class PrometheusRemoteWriteIngestService {
  public static setProductType(
    req: ExpressRequest,
    _res: ExpressResponse,
    next: NextFunction,
  ): void {
    (req as TelemetryRequest).productType = ProductType.Metrics;
    next();
  }

  @CaptureSpan()
  public static async ingest(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      const version: PrometheusRemoteWriteVersion | null =
        PrometheusRemoteWrite.versionOf(
          headerValueToString(req.headers["content-type"]),
        );

      if (version === null) {
        drainCloudStreamBody(req);
        PrometheusRemoteWriteIngestService.answer(
          res,
          415,
          "Unsupported remote write proto. Send prometheus.WriteRequest (remote write 1.0) or io.prometheus.write.v2.Request (2.0).",
        );
        return;
      }

      const encoding: CompatibleBodyEncoding | null =
        CompatibleIngestBody.encodingOf(req.headers["content-encoding"]);

      let body: Buffer = await CompatibleIngestBody.read(req);

      /*
       * Remote write is always snappy. A sender that leaves out the
       * Content-Encoding still sends snappy; one that sent the protobuf
       * as it is (no sender does, but nothing forbids it) is read as that.
       */
      if (encoding === "none") {
        body = PrometheusRemoteWriteIngestService.snappyOrAsIs(body);
      }

      const request: PrometheusWriteRequest = PrometheusRemoteWrite.decode(
        body,
        version,
      );

      const translation: PrometheusTranslation = PrometheusRemoteWrite.toOtlp(
        request,
        {
          serviceName: headerValueToString(
            req.headers["x-oneuptime-service-name"],
          ),
        },
      );

      await CompatibleIngestService.enqueue({
        req: req as TelemetryRequest,
        surface: TelemetryIngestSurface.PrometheusRemoteWrite,
        batch: { metrics: translation.metrics },
      });

      if (version === PrometheusRemoteWriteVersion.V2) {
        res.setHeader(
          "X-Prometheus-Remote-Write-Samples-Written",
          String(translation.samplesWritten),
        );
        res.setHeader(
          "X-Prometheus-Remote-Write-Histograms-Written",
          String(translation.histogramsWritten),
        );
        res.setHeader("X-Prometheus-Remote-Write-Exemplars-Written", "0");
      }

      res.status(204).end();
    } catch (error) {
      const failure: CompatibleIngestFailure | null =
        CompatibleIngestFailureMapper.fromError(error, [
          PrometheusRemoteWriteError,
        ]);

      if (failure) {
        PrometheusRemoteWriteIngestService.answer(
          res,
          failure.statusCode,
          failure.message,
        );
        return;
      }

      next(error);
    }
  }

  private static snappyOrAsIs(body: Buffer): Buffer {
    try {
      return SnappyBlock.decompress(body, MAX_DECOMPRESSED_OTLP_BODY_BYTES);
    } catch {
      return body;
    }
  }

  // Prometheus logs a refusal's body as it is: plain text.
  private static answer(
    res: ExpressResponse,
    statusCode: number,
    message: string,
  ): void {
    if (res.headersSent) {
      return;
    }

    res.status(statusCode).type("text/plain").send(message);
  }
}
