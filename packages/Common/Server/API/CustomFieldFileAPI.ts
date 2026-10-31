import File from "../../Models/DatabaseModels/File";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { readCustomFieldFiles } from "../../Types/CustomField/CustomFieldFile";
import {
  CUSTOM_FIELD_FILE_ROUTE,
  CustomFieldRecordKind,
  getCustomFieldRecordKindByRouteName,
} from "../../Types/CustomField/CustomFieldRecordKinds";
import NotFoundException from "../../Types/Exception/NotFoundException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import UserMiddleware from "../Middleware/UserAuthorization";
import DatabaseService from "../Services/DatabaseService";
import FileService from "../Services/FileService";
import CustomFieldFiles, {
  CustomFieldFileField,
} from "../Utils/CustomField/CustomFieldFiles";
import { getCustomFieldValueStores } from "../Utils/CustomField/CustomFieldValueStores";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import FileOwnership from "../Utils/File/FileOwnership";
import Response from "../Utils/Response";
import CommonAPI from "./CommonAPI";

/*
 * DOWNLOADING A FILE THAT A RECORD'S FILE CUSTOM FIELD HOLDS.
 *
 *   GET /api/custom-field-file/:projectId/:recordKind/:recordId/:fileId
 *
 * :recordKind names the kind of record (CustomFieldRecordKinds: incident,
 * alert, monitor, scheduled-maintenance, ...). Signed in, or with an API key
 * of the project.
 *
 * A file is served only:
 *
 *   - to someone who may read the record and its custom fields: the record
 *     is read as the caller, so a person who may not read it, or not its
 *     custom field values, gets no file - whatever file id they hold;
 *   - while a File or Multiple files field of the record holds it: a file
 *     taken out of a field, or held by another record, is not served
 *     through this one;
 *   - when it is a file of the record's own project (FileOwnership), as
 *     every route that serves a stored file checks again, whatever wrote the
 *     row.
 *
 * Anything else is answered as for a file that does not exist, so the route
 * tells nobody which files are there. The file goes out as an attachment,
 * never shown in the page that asked for it, with no caching anywhere: a
 * file's name and type are what its uploader said, and its bytes are
 * theirs (Response.sendFileResponse).
 */

export const CUSTOM_FIELD_FILE_NOT_FOUND_MESSAGE: string = "File not found";

type ReadIdFunction = (value: unknown) => ObjectID | null;

const readId: ReadIdFunction = (value: unknown): ObjectID | null => {
  if (typeof value !== "string") {
    return null;
  }

  const id: string = value.trim().toLowerCase();

  return ObjectID.isValidUUID(id) ? new ObjectID(id) : null;
};

export default class CustomFieldFileAPI {
  public router: ExpressRouter;

  public constructor() {
    this.router = Express.getRouter();

    this.router.get(
      `${CUSTOM_FIELD_FILE_ROUTE}/:projectId/:recordKind/:recordId/:fileId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await CustomFieldFileAPI.download(req, res);
        } catch (err) {
          next(err);
        }
      },
    );
  }

  public getRouter(): ExpressRouter {
    return this.router;
  }

  /*
   * The service whose table holds this kind of record: the record table of
   * one of the custom field value stores.
   */
  public static getRecordService(
    kind: CustomFieldRecordKind,
  ): DatabaseService<BaseModel> | null {
    for (const store of getCustomFieldValueStores()) {
      for (const service of store.getValueServices()) {
        if (service.getModel().tableName === kind.recordTableName) {
          return service as DatabaseService<BaseModel>;
        }
      }
    }

    return null;
  }

  public static async download(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const kind: CustomFieldRecordKind | undefined =
      getCustomFieldRecordKindByRouteName(req.params["recordKind"]);
    const projectId: ObjectID | null = readId(req.params["projectId"]);
    const recordId: ObjectID | null = readId(req.params["recordId"]);
    const fileId: ObjectID | null = readId(req.params["fileId"]);

    // Not a kind of record or not ids: nothing is looked up.
    if (!kind || !projectId || !recordId || !fileId) {
      throw new NotFoundException(CUSTOM_FIELD_FILE_NOT_FOUND_MESSAGE);
    }

    const service: DatabaseService<BaseModel> | null =
      CustomFieldFileAPI.getRecordService(kind);

    if (!service) {
      throw new NotFoundException(CUSTOM_FIELD_FILE_NOT_FOUND_MESSAGE);
    }

    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    // As the caller: what they may not read is not there for them.
    const record: BaseModel | null = await service.findOneBy({
      query: {
        _id: recordId.toString(),
        projectId: projectId,
      } as never,
      select: {
        _id: true,
        projectId: true,
        customFields: true,
      } as never,
      props: props,
    });

    const recordProjectId: ObjectID | null = readId(
      record?.getValue<ObjectID>("projectId")?.toString(),
    );

    if (!record || !recordProjectId) {
      throw new NotFoundException(CUSTOM_FIELD_FILE_NOT_FOUND_MESSAGE);
    }

    const customFields: JSONObject =
      record.getValue<JSONObject>("customFields") || {};

    // Only a file one of its file fields holds now.
    const fields: Array<CustomFieldFileField> =
      await CustomFieldFiles.getFileFields({
        recordTableName: kind.recordTableName,
        projectId: recordProjectId.toString(),
        query: async (
          sql: string,
          parameters: Array<unknown>,
        ): Promise<unknown> => {
          return await service.getRepository().manager.query(sql, parameters);
        },
      });

    const isHeld: boolean = fields.some(
      (field: CustomFieldFileField): boolean => {
        return readCustomFieldFiles(customFields[field.name]).some(
          (file: { fileId: string }): boolean => {
            return file.fileId === fileId.toString();
          },
        );
      },
    );

    if (!isHeld) {
      throw new NotFoundException(CUSTOM_FIELD_FILE_NOT_FOUND_MESSAGE);
    }

    const file: File | null = await FileService.findOneBy({
      query: {
        _id: fileId.toString(),
      },
      select: {
        _id: true,
        file: true,
        name: true,
        fileType: true,
        projectId: true,
      },
      props: {
        isRoot: true,
      },
    });

    // One of the record's own project, as every served file is.
    const servedFile: File | undefined = FileOwnership.keepProjectFile(
      file || undefined,
      recordProjectId,
    );

    if (!servedFile || !servedFile.file) {
      throw new NotFoundException(CUSTOM_FIELD_FILE_NOT_FOUND_MESSAGE);
    }

    Response.setNoCacheHeaders(res);

    return Response.sendFileResponse(req, res, servedFile, {
      disposition: "attachment",
    });
  }
}
