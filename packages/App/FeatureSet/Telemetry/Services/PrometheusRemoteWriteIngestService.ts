import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  headerValueToString,
} from "Common/Server/Utils/Express";
import CaptureSpan from "Common/Server/Utils/Telemetry/CaptureSpan";
import TelemetryIngestionKeyLastUsed from "Common/Server/Utils/Telemetry/TelemetryIngestionKeyLastUsed";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import { PROMETHEUS_REMOTE_WRITE_MAX_BYTES } from "Common/Types/Telemetry/CompatibleIngest";
import TelemetryIngestSurface from "Common/Types/Telemetry/TelemetryIngestSurface";
import { drainCloudStreamBody } from "../Utils/CloudStreamBody";
import CompatibleIngestBody, {
  CompatibleBodyEncoding,
  CompatibleBodyLimits,
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
import SnappyBlock, {
  SnappyTooLargeError,
} from "../Utils/Compatible/SnappyBlock";
import CompatibleIngestService from "./CompatibleIngestService";

/*
 * Prometheus remote write: POST /prometheus/api/v1/write (and under
 * /telemetry). See PrometheusRemoteWrite for what a series becomes.
 *
 * Answered as the remote write specifications ask, so a sender retries
 * only what it should:
 *
 *   - 204 once the samples are queued;
 *   - 400 for a body that is not a write request (a sender drops it, it
 *     would never be accepted), and for a partial write: data neither
 *     version allows is refused, the rest is queued, and the answer's text
 *     says what was refused;
 *   - 413 for a body over PROMETHEUS_REMOTE_WRITE_MAX_BYTES as sent or
 *     decompressed, or one that holds more than
 *     PROMETHEUS_REMOTE_WRITE_MAX_ELEMENTS series, labels and samples;
 *   - 415 for a proto or a content coding this endpoint does not read, with
 *     Accept and Accept-Encoding saying what it does (2.0);
 *   - 503 when the queue cannot take it (a sender retries).
 *
 * The key's own refusals come from the TelemetryIngest guard before the
 * body is read: 401 for a missing or unknown key, 403 for a used-up daily
 * budget (retrying cannot help until it resets), 429 with Retry-After for
 * a rate. A 2.0 request is told how many samples, histograms and exemplars
 * were written, in the X-Prometheus-Remote-Write-*-Written headers.
 *
 * The key travels as remote write's own `authorization` (Bearer) or
 * `basic_auth` settings, or as an x-oneuptime-token header.
 *
 * INGESTION BUDGETS
 *
 * The door checked the budget without sizing the body (a deferred
 * surface); the request is counted at the size of its body once its
 * snappy compression is undone - "bytes are counted decompressed", as an
 * OTLP export is - and that same number is what the worker shares out
 * over the services, teams and labels of the batch.
 */

const REMOTE_WRITE_LIMITS: CompatibleBodyLimits = {
  maxBodyBytes: PROMETHEUS_REMOTE_WRITE_MAX_BYTES,
  maxDecompressedBytes: PROMETHEUS_REMOTE_WRITE_MAX_BYTES,
};

// What a 415 says this endpoint reads (remote write 2.0's Accept headers).
export const PROMETHEUS_REMOTE_WRITE_ACCEPT: string =
  "application/x-protobuf;proto=prometheus.WriteRequest, application/x-protobuf;proto=io.prometheus.write.v2.Request";

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
        PrometheusRemoteWriteIngestService.unsupported(
          res,
          "Unsupported remote write proto. Send prometheus.WriteRequest (remote write 1.0) or io.prometheus.write.v2.Request (2.0).",
        );
        return;
      }

      const encoding: CompatibleBodyEncoding | null =
        CompatibleIngestBody.encodingOf(req.headers["content-encoding"]);

      let body: Buffer = await CompatibleIngestBody.read(req, {
        limits: REMOTE_WRITE_LIMITS,
      });

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
        ingestBytes: body.length,
      });

      if (version === PrometheusRemoteWriteVersion.V2) {
        PrometheusRemoteWriteIngestService.setWrittenHeaders(res, translation);
      }

      const refused: string | null =
        PrometheusRemoteWrite.describeRefusals(translation);

      if (refused) {
        /*
         * What was accepted is queued, so the key was used: stamped here,
         * as the guard stamps it only on a success.
         */
        const policy: TelemetryRequest["ingestionKeyPolicy"] | undefined = (
          req as Partial<TelemetryRequest>
        ).ingestionKeyPolicy;

        if (policy && translation.metrics) {
          TelemetryIngestionKeyLastUsed.stamp(policy);
        }

        PrometheusRemoteWriteIngestService.answer(res, 400, refused);
        return;
      }

      res.status(204).end();
    } catch (error) {
      const failure: CompatibleIngestFailure | null =
        CompatibleIngestFailureMapper.fromError(error, [
          PrometheusRemoteWriteError,
        ]);

      if (failure) {
        if (failure.statusCode === 415) {
          PrometheusRemoteWriteIngestService.unsupported(res, failure.message);
          return;
        }

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

  // Remote write 2.0's count of what was written, on any answer to it.
  private static setWrittenHeaders(
    res: ExpressResponse,
    translation: PrometheusTranslation,
  ): void {
    res.setHeader(
      "X-Prometheus-Remote-Write-Samples-Written",
      String(translation.samplesWritten),
    );
    res.setHeader(
      "X-Prometheus-Remote-Write-Histograms-Written",
      String(translation.histogramsWritten),
    );
    res.setHeader(
      "X-Prometheus-Remote-Write-Exemplars-Written",
      String(translation.exemplarsWritten),
    );
  }

  /*
   * A body sent with no Content-Encoding: snappy if it is, else the
   * protobuf as it is. A snappy body that would decompress past the limit
   * is refused, not read as protobuf.
   */
  private static snappyOrAsIs(body: Buffer): Buffer {
    const maxBytes: number =
      CompatibleIngestBody.maxDecompressedBytes(REMOTE_WRITE_LIMITS);

    try {
      return SnappyBlock.decompress(body, maxBytes);
    } catch (error) {
      if (error instanceof SnappyTooLargeError) {
        throw CompatibleIngestBody.decompressesTooLarge(maxBytes);
      }

      return body;
    }
  }

  // A 415, with what this endpoint reads (remote write 2.0 asks for both).
  private static unsupported(res: ExpressResponse, message: string): void {
    if (res.headersSent) {
      return;
    }

    res.setHeader("Accept", PROMETHEUS_REMOTE_WRITE_ACCEPT);
    res.setHeader("Accept-Encoding", "snappy");
    PrometheusRemoteWriteIngestService.answer(res, 415, message);
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
