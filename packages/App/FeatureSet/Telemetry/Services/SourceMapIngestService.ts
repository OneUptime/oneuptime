import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "Common/Server/Services/OpenTelemetryIngestService";
import TelemetrySourceMapService, {
  MAX_SOURCE_MAPS_PER_RELEASE,
} from "Common/Server/Services/TelemetrySourceMapService";
import SourceMapResolver, {
  MAX_SOURCE_MAP_SIZE_IN_BYTES,
} from "Common/Server/Utils/Telemetry/SourceMapResolver";
import { SourceMapMaxFilesPerRequest } from "Common/Server/EnvironmentConfig";
import TelemetrySourceMap from "Common/Models/DatabaseModels/TelemetrySourceMap";
import BadDataException from "Common/Types/Exception/BadDataException";
import ColumnLength from "Common/Types/Database/ColumnLength";
import { JSONObject } from "Common/Types/JSON";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import logger from "Common/Server/Utils/Logger";
import CaptureSpan from "Common/Server/Utils/Telemetry/CaptureSpan";

interface UploadedFilePart {
  fieldname: string;
  originalname: string;
  buffer: Buffer;
}

export default class SourceMapIngestService {
  /**
   * POST /source-maps/v1/upload
   *
   * Multipart upload of one or more source maps, authenticated with a
   * telemetry ingestion key. Fields:
   *   - serviceName (required): must match the service.name OTel resource
   *     attribute the browser telemetry is sent with.
   *   - serviceVersion (required): must match the service.version resource
   *     attribute (the release).
   *   - bundlePath (optional, single file only): explicit path of the
   *     minified bundle the map belongs to.
   * File parts: each uploaded .map file. Unless bundlePath is given, the
   * bundle path is the file's name with a trailing ".map" stripped
   * (main.a8f1b2.js.map → main.a8f1b2.js).
   *
   * The service is found or created by name, so maps can be uploaded from
   * CI before the release has sent its first telemetry.
   */
  @CaptureSpan()
  public static async uploadSourceMaps(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      const projectId: TelemetryRequest["projectId"] = (req as TelemetryRequest)
        .projectId;

      const serviceName: string = SourceMapIngestService.getTrimmedField(
        req,
        "serviceName",
      );
      const serviceVersion: string = SourceMapIngestService.getTrimmedField(
        req,
        "serviceVersion",
      );

      if (!serviceName) {
        throw new BadDataException(
          "serviceName is required. Send the same value as the service.name OpenTelemetry resource attribute.",
        );
      }

      if (!serviceVersion) {
        throw new BadDataException(
          "serviceVersion is required. Send the same value as the service.version OpenTelemetry resource attribute.",
        );
      }

      /*
       * Both fields land in ShortText (varchar 100) columns —
       * Service.name and TelemetrySourceMap.serviceVersion. Reject
       * over-long values with a clear 400 instead of letting the insert
       * fail with an opaque 500.
       */
      if (serviceName.length > ColumnLength.ShortText) {
        throw new BadDataException(
          `serviceName must be at most ${ColumnLength.ShortText} characters.`,
        );
      }

      if (serviceVersion.length > ColumnLength.ShortText) {
        throw new BadDataException(
          `serviceVersion must be at most ${ColumnLength.ShortText} characters.`,
        );
      }

      const files: Array<UploadedFilePart> = Array.isArray(req.files)
        ? (req.files as Array<UploadedFilePart>)
        : [];

      if (files.length === 0) {
        throw new BadDataException(
          "No source map files were uploaded. Attach at least one .map file as a multipart file part.",
        );
      }

      /*
       * The multipart middleware already 413s past this count, so the branch
       * is defense in depth — and the message states the real per-request
       * limit rather than the (higher) per-release one.
       */
      if (files.length > SourceMapMaxFilesPerRequest) {
        throw new BadDataException(
          `At most ${SourceMapMaxFilesPerRequest} source maps can be uploaded in one request. Split the upload across requests — up to ${MAX_SOURCE_MAPS_PER_RELEASE} maps are kept per release.`,
        );
      }

      const explicitBundlePath: string = SourceMapIngestService.getTrimmedField(
        req,
        "bundlePath",
      );

      if (explicitBundlePath && files.length > 1) {
        throw new BadDataException(
          "bundlePath can only be used when uploading a single file. For multiple files, name each file after its bundle (for example main.a8f1b2.js.map).",
        );
      }

      /*
       * Validate every file before saving any, so a failed request never
       * leaves a partial release behind for CI to misread as success.
       */
      const validatedUploads: Array<{ bundlePath: string; content: string }> =
        [];

      for (const file of files) {
        const bundlePath: string =
          explicitBundlePath ||
          SourceMapIngestService.bundlePathFromFileName(file.originalname);

        if (!bundlePath) {
          throw new BadDataException(
            "Could not determine the bundle path for an uploaded file. Name the file after its bundle (for example main.a8f1b2.js.map) or pass a bundlePath field.",
          );
        }

        if (bundlePath.length > ColumnLength.LongText) {
          throw new BadDataException(
            `Bundle path must be at most ${ColumnLength.LongText} characters.`,
          );
        }

        if (!file.buffer || file.buffer.length === 0) {
          throw new BadDataException(
            `Uploaded file for bundle ${bundlePath} is empty.`,
          );
        }

        if (file.buffer.length > MAX_SOURCE_MAP_SIZE_IN_BYTES) {
          throw new BadDataException(
            `Source map for bundle ${bundlePath} is too large. The maximum size is ${
              MAX_SOURCE_MAP_SIZE_IN_BYTES / (1024 * 1024)
            } MB.`,
          );
        }

        const content: string = file.buffer.toString("utf8");

        /*
         * Re-check the DECODED size here, not just the raw buffer above:
         * invalid UTF-8 bytes decode to 3-byte U+FFFD, so a file under the
         * cap can decode past it. onBeforeCreate enforces the same ceiling
         * at save time — catching it in this validate-everything-first loop
         * keeps a failed request from leaving a partial release behind.
         */
        if (Buffer.byteLength(content, "utf8") > MAX_SOURCE_MAP_SIZE_IN_BYTES) {
          throw new BadDataException(
            `Source map for bundle ${bundlePath} is too large after decoding. The maximum size is ${
              MAX_SOURCE_MAP_SIZE_IN_BYTES / (1024 * 1024)
            } MB.`,
          );
        }

        try {
          SourceMapResolver.validateSourceMapContent(content);
        } catch (validationError) {
          throw new BadDataException(
            `File for bundle ${bundlePath} is not a valid source map: ${
              validationError instanceof Error
                ? validationError.message
                : String(validationError)
            }`,
          );
        }

        validatedUploads.push({ bundlePath, content });
      }

      const duplicateBundlePaths: Set<string> = new Set();
      for (const upload of validatedUploads) {
        if (duplicateBundlePaths.has(upload.bundlePath)) {
          throw new BadDataException(
            `Bundle ${upload.bundlePath} appears more than once in this request.`,
          );
        }
        duplicateBundlePaths.add(upload.bundlePath);
      }

      const serviceMetadata: TelemetryServiceMetadata =
        await OTelIngestService.telemetryServiceFromName({
          serviceName: serviceName,
          projectId: projectId,
        });

      /*
       * Per-release ceiling: what is already stored, minus bundles this
       * request replaces, plus this request's bundles must fit. This is a
       * storage-shape limit the operator chooses, not a resolver constraint —
       * resolveFramesForService bounds itself by bytes, so everything that
       * fits this ceiling resolves.
       */
      const existingBundlePaths: Array<string> =
        await TelemetrySourceMapService.getStoredBundlePathsForRelease({
          projectId: projectId,
          serviceId: serviceMetadata.primaryEntityId,
          serviceVersion: serviceVersion,
        });

      const bundlePathsAfterUpload: Set<string> = new Set(existingBundlePaths);
      for (const upload of validatedUploads) {
        bundlePathsAfterUpload.add(upload.bundlePath);
      }

      if (bundlePathsAfterUpload.size > MAX_SOURCE_MAPS_PER_RELEASE) {
        throw new BadDataException(
          `This release already has ${existingBundlePaths.length} source maps and this upload would take it past the limit of ${MAX_SOURCE_MAPS_PER_RELEASE} per release. Delete unused maps, use a new serviceVersion, or raise SOURCE_MAP_MAX_MAPS_PER_RELEASE.`,
        );
      }

      const savedSourceMaps: Array<JSONObject> = [];

      for (const upload of validatedUploads) {
        const savedSourceMap: TelemetrySourceMap =
          await TelemetrySourceMapService.replaceSourceMap({
            projectId: projectId,
            serviceId: serviceMetadata.primaryEntityId,
            serviceVersion: serviceVersion,
            bundlePath: upload.bundlePath,
            content: upload.content,
          });

        savedSourceMaps.push({
          _id: savedSourceMap.id?.toString() || "",
          bundlePath: upload.bundlePath,
          serviceVersion: serviceVersion,
          sizeInBytes: Buffer.byteLength(upload.content, "utf8"),
        });
      }

      logger.debug(
        `Stored ${savedSourceMaps.length} source map(s) for service ${serviceName} version ${serviceVersion} in project ${projectId.toString()}`,
      );

      return Response.sendJsonObjectResponse(req, res, {
        serviceId: serviceMetadata.primaryEntityId.toString(),
        serviceName: serviceName,
        serviceVersion: serviceVersion,
        sourceMaps: savedSourceMaps,
      });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * main.a8f1b2.js.map → main.a8f1b2.js. A file not named *.map is used
   * as-is (some pipelines name the part after the bundle directly).
   */
  public static bundlePathFromFileName(fileName: string): string {
    const trimmed: string = (fileName || "").trim();

    if (trimmed.toLowerCase().endsWith(".map")) {
      return trimmed.substring(0, trimmed.length - ".map".length);
    }

    return trimmed;
  }

  private static getTrimmedField(
    req: ExpressRequest,
    fieldName: string,
  ): string {
    const value: unknown = req.body ? req.body[fieldName] : undefined;

    if (typeof value !== "string") {
      return "";
    }

    return value.trim();
  }
}
