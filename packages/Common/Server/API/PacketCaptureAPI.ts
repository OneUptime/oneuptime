import UserMiddleware from "../Middleware/UserAuthorization";
import AuditLogService from "../Services/AuditLogService";
import FileService from "../Services/FileService";
import PacketCaptureService, {
  Service as PacketCaptureServiceType,
} from "../Services/PacketCaptureService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import FileOwnership from "../Utils/File/FileOwnership";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import CommonAPI from "./CommonAPI";
import File from "../../Models/DatabaseModels/File";
import PacketCapture from "../../Models/DatabaseModels/PacketCapture";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import MimeType from "../../Types/File/MimeType";
import ObjectID from "../../Types/ObjectID";
import {
  PACKET_CAPTURE_DOWNLOAD_PERMISSIONS,
  PACKET_CAPTURE_DOWNLOAD_REFUSED_MESSAGE,
  PACKET_CAPTURE_NOT_FOUND_MESSAGE,
  PACKET_CAPTURE_STOP_PERMISSIONS,
  PACKET_CAPTURE_STOP_REFUSED_MESSAGE,
} from "../../Types/PacketCapture/PacketCapturePermissions";
import PacketCaptureStatus from "../../Types/PacketCapture/PacketCaptureStatus";

export const FILE_GONE_MESSAGE: string =
  "This capture has no file to download: it captured no packets, or its file has been deleted.";

/*
 * What a download answers: the capture's pcap file as base64, with the name
 * and type to save it under. JSON rather than the bare bytes so the
 * dashboard's request carries its session (and refreshes it) the way every
 * other request does; the browser then saves it as a .pcap file.
 */
export interface PacketCaptureDownload {
  fileName: string;
  fileType: string;
  sizeInBytes: number;
  base64: string;
}

/*
 * Packet captures over HTTP. The CRUD routes (BaseAPI) start, list and
 * delete captures, each held to the PacketCapture model's own lists. Two
 * more act on one capture, and are held to their own lists
 * (Types/PacketCapture/PacketCapturePermissions):
 *
 *   POST /packet-capture/:packetCaptureId/stop      ask the probe to stop it
 *   POST /packet-capture/:packetCaptureId/download  its pcap file
 *
 * Both take the project from the request (a member's session or the
 * project's API key) and find the capture inside it, so another project's
 * capture answers exactly as one that does not exist. Every download is
 * written to the audit log, by whom, before the file is sent.
 */
export default class PacketCaptureAPI extends BaseAPI<
  PacketCapture,
  PacketCaptureServiceType
> {
  public constructor() {
    super(PacketCapture, PacketCaptureService);

    const path: string = `${new this.entityType().getCrudApiPath()?.toString()}`;

    this.router.post(
      `${path}/:packetCaptureId/stop`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const { props, projectId } = await PacketCaptureAPI.getCaller(req);

          CommonAPI.assertPermittedInProject({
            databaseProps: props,
            allowedPermissions: [...PACKET_CAPTURE_STOP_PERMISSIONS],
            errorMessage: PACKET_CAPTURE_STOP_REFUSED_MESSAGE,
          });

          await PacketCaptureService.requestStop({
            packetCaptureId: PacketCaptureAPI.readCaptureId(req),
            projectId: projectId,
          });

          return Response.sendJsonObjectResponse(req, res, { result: "ok" });
        } catch (err) {
          next(err);
        }
      },
    );

    this.router.post(
      `${path}/:packetCaptureId/download`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const { props, projectId } = await PacketCaptureAPI.getCaller(req);

          CommonAPI.assertPermittedInProject({
            databaseProps: props,
            allowedPermissions: [...PACKET_CAPTURE_DOWNLOAD_PERMISSIONS],
            errorMessage: PACKET_CAPTURE_DOWNLOAD_REFUSED_MESSAGE,
          });

          const download: PacketCaptureDownload =
            await PacketCaptureAPI.readDownload({
              packetCaptureId: PacketCaptureAPI.readCaptureId(req),
              projectId: projectId,
              props: props,
            });

          return Response.sendJsonObjectResponse(req, res, {
            fileName: download.fileName,
            fileType: download.fileType,
            sizeInBytes: download.sizeInBytes,
            base64: download.base64,
          });
        } catch (err) {
          next(err);
        }
      },
    );
  }

  /*
   * The capture's file, held to the capture's project, and the audit entry
   * that says who took it. The entry is written before the bytes leave: a
   * download whose entry could not be written still goes ahead (the audit
   * log never blocks the work it records), but no file is sent without the
   * attempt.
   */
  public static async readDownload(data: {
    packetCaptureId: ObjectID;
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<PacketCaptureDownload> {
    const capture: PacketCapture | null = await PacketCaptureService.findOneBy(
      {
        query: {
          _id: data.packetCaptureId.toString(),
          projectId: data.projectId,
        },
        select: {
          _id: true,
          projectId: true,
          name: true,
          interfaceName: true,
          bpfFilter: true,
          probeId: true,
          networkDeviceId: true,
          status: true,
          packetCount: true,
          fileSizeInBytes: true,
          fileId: true,
        },
        props: { isRoot: true },
      },
    );

    if (!capture || !capture.id) {
      throw new BadDataException(PACKET_CAPTURE_NOT_FOUND_MESSAGE);
    }

    if (capture.status !== PacketCaptureStatus.Completed || !capture.fileId) {
      throw new BadDataException(FILE_GONE_MESSAGE);
    }

    const storedFile: File | null = await FileService.findOneById({
      id: capture.fileId,
      select: {
        _id: true,
        file: true,
        fileType: true,
        name: true,
        projectId: true,
      },
      props: { isRoot: true },
    });

    const file: File | undefined = FileOwnership.keepProjectFile(
      storedFile,
      capture.projectId,
    );

    if (!file || !file.file) {
      throw new BadDataException(FILE_GONE_MESSAGE);
    }

    const downloadedItem: PacketCapture = new PacketCapture(capture.id);
    downloadedItem.projectId = capture.projectId!;
    downloadedItem.name = capture.name!;
    downloadedItem.interfaceName = capture.interfaceName!;
    downloadedItem.bpfFilter = capture.bpfFilter || "";
    downloadedItem.probeId = capture.probeId!;
    downloadedItem.packetCount = capture.packetCount || 0;
    downloadedItem.fileSizeInBytes = file.file.length;

    if (capture.networkDeviceId) {
      downloadedItem.networkDeviceId = capture.networkDeviceId;
    }

    await AuditLogService.recordDownload({
      model: new PacketCapture(),
      downloadedItem: downloadedItem,
      itemId: capture.id,
      props: data.props,
    });

    const bytes: Buffer = Buffer.isBuffer(file.file)
      ? file.file
      : Buffer.from(file.file as unknown as Uint8Array);

    return {
      fileName: file.name || "packet-capture.pcap",
      fileType: MimeType.pcap,
      sizeInBytes: bytes.length,
      base64: bytes.toString("base64"),
    };
  }

  /*
   * A member's session or the project's API key, and the project it is
   * for. The capture is then looked up inside that project only.
   */
  private static async getCaller(req: ExpressRequest): Promise<{
    props: DatabaseCommonInteractionProps;
    projectId: ObjectID;
  }> {
    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    CommonAPI.assertCredentialsPresent(props);

    if (!props.tenantId) {
      throw new BadDataException("Project ID is required");
    }

    return { props: props, projectId: props.tenantId };
  }

  private static readCaptureId(req: ExpressRequest): ObjectID {
    const id: string | undefined = req.params["packetCaptureId"];

    if (!id || !ObjectID.isValidUUID(id)) {
      throw new BadDataException(PACKET_CAPTURE_NOT_FOUND_MESSAGE);
    }

    return new ObjectID(id);
  }
}
