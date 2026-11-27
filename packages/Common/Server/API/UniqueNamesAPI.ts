import UserMiddleware from "../Middleware/UserAuthorization";
import BaseService from "../Services/BaseService";
import DatabaseService from "../Services/DatabaseService";
import Services from "../Services/Index";
import DatabaseRequestType from "../Types/BaseDatabase/DatabaseRequestType";
import TablePermission from "../Types/Database/Permissions/TablePermission";
import RecordPageFieldsReader from "../Utils/Database/RecordPageFieldsReader";
import RequiredUniqueNames from "../Utils/Database/RequiredUniqueNames";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import CommonAPI from "./CommonAPI";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  getProjectNameRule,
  ProjectNameRule,
} from "../../Types/Database/ProjectNameRule";
import { RecordPageFields } from "../../Types/Database/RecordPageFields";
import {
  DuplicateNameGroup,
  DuplicateNameRecord,
  DuplicateNamesOfKind,
  toDuplicateNamesAnswerJSON,
  toUniqueNameCheckAnswerJSON,
  UNIQUE_NAME_CHECK_PARAMS,
  UNIQUE_NAME_CHECK_ROUTE,
  UNIQUE_NAME_DUPLICATES_ROUTE,
  UniqueNameCheckAnswer,
} from "../../Types/Database/RequiredUniqueNames";
import NotFoundException from "../../Types/Exception/NotFoundException";
import ObjectID from "../../Types/ObjectID";

/*
 * NAMES THAT REPEAT IN A PROJECT (#10761, Types/Database/RequiredUniqueNames).
 *
 *   GET /unique-names/check?tableName=Monitor&name=...&exceptId=...
 *     Whether another record of the kind in the request's project has the
 *     name a form holds - the one the caller may read, to link to - and
 *     whether saving it would be refused: the project requires unique names
 *     and the kind is one it holds (@UniqueNameWhenRequired), or the kind
 *     holds its names unique always (getProjectNameRule). A kind whose
 *     names repeat freely is no kind of this route.
 *
 *   GET /unique-names/duplicates
 *     The names the project already holds more than once, kind by kind,
 *     among the kinds Require Unique Names holds: Project Settings > Project
 *     lists them beside the setting, for renaming.
 *
 * For a signed-in member of the project or a project API key, asked before
 * anything is read; the project is the request's own. Records are named
 * only where the caller may read them, read with the caller's own props: a
 * caller who may not read a kind at all is refused its check, as a list of
 * it would be, and has none of it in the duplicates. Nothing is written or
 * cached.
 *
 * A bare router, as SharedNamesAPI is: it belongs to no one model. GETs, so
 * no body is read.
 */

const router: ExpressRouter = Express.getRouter();

// The longest name the check reads: longer than any name column holds.
const MAX_CHECKED_NAME_LENGTH: number = 1000;

// A query parameter as text: the first of several, nothing for anything else.
const readQueryText: (value: unknown) => string = (value: unknown): string => {
  if (Array.isArray(value)) {
    return readQueryText(value[0]);
  }

  return typeof value === "string" ? value : "";
};

// Every service of a database model, as the server registers them.
export const getDatabaseServices: (
  services: ReadonlyArray<BaseService>,
) => Array<DatabaseService<BaseModel>> = (
  services: ReadonlyArray<BaseService>,
): Array<DatabaseService<BaseModel>> => {
  return services.filter(
    (service: BaseService): service is DatabaseService<BaseModel> => {
      return service instanceof DatabaseService;
    },
  );
};

// The service of the kind with that table, or null.
export const getServiceOfTable: (
  services: ReadonlyArray<BaseService>,
  tableName: string,
) => DatabaseService<BaseModel> | null = (
  services: ReadonlyArray<BaseService>,
  tableName: string,
): DatabaseService<BaseModel> | null => {
  if (!tableName) {
    return null;
  }

  return (
    getDatabaseServices(services).find(
      (service: DatabaseService<BaseModel>): boolean => {
        return service.getModel().tableName === tableName;
      },
    ) || null
  );
};

/*
 * The services of the kinds Require Unique Names holds
 * (@UniqueNameWhenRequired), each once, by their table's name.
 */
export const getRequiredUniqueNameServices: (
  services: ReadonlyArray<BaseService>,
) => Array<DatabaseService<BaseModel>> = (
  services: ReadonlyArray<BaseService>,
): Array<DatabaseService<BaseModel>> => {
  const seen: Set<string> = new Set<string>();

  return getDatabaseServices(services)
    .filter((service: DatabaseService<BaseModel>): boolean => {
      const tableName: string = service.getModel().tableName || "";

      if (!RequiredUniqueNames.getColumn(service) || seen.has(tableName)) {
        return false;
      }

      seen.add(tableName);

      return true;
    })
    .sort(
      (
        a: DatabaseService<BaseModel>,
        b: DatabaseService<BaseModel>,
      ): number => {
        return (a.getModel().tableName || "").localeCompare(
          b.getModel().tableName || "",
        );
      },
    );
};

/*
 * What the pages of the records a route names need beside their ids, read
 * for the caller (RecordPageFieldsReader, #11020): an OpenStack budget's
 * cloud, a workspace summary's workspace. Nothing for most kinds.
 */
export const readPageFields: (data: {
  service: DatabaseService<BaseModel>;
  projectId: ObjectID;
  ids: ReadonlyArray<string>;
  props: DatabaseCommonInteractionProps;
}) => Promise<Map<string, RecordPageFields>> = async (data: {
  service: DatabaseService<BaseModel>;
  projectId: ObjectID;
  ids: ReadonlyArray<string>;
  props: DatabaseCommonInteractionProps;
}): Promise<Map<string, RecordPageFields>> => {
  return await RecordPageFieldsReader.read({
    service: data.service,
    projectId: data.projectId,
    ids: data.ids,
    props: data.props,
    getServiceOfTable: (tableName: string) => {
      return getServiceOfTable(Services, tableName);
    },
  });
};

// A kind's duplicates, each record with what its page needs beside its id.
export const withPageFields: (data: {
  kind: DuplicateNamesOfKind;
  service: DatabaseService<BaseModel>;
  projectId: ObjectID;
  props: DatabaseCommonInteractionProps;
}) => Promise<DuplicateNamesOfKind> = async (data: {
  kind: DuplicateNamesOfKind;
  service: DatabaseService<BaseModel>;
  projectId: ObjectID;
  props: DatabaseCommonInteractionProps;
}): Promise<DuplicateNamesOfKind> => {
  const pageFields: Map<string, RecordPageFields> = await readPageFields({
    service: data.service,
    projectId: data.projectId,
    ids: data.kind.groups.flatMap(
      (group: DuplicateNameGroup): Array<string> => {
        return group.records.map((record: DuplicateNameRecord): string => {
          return record.id;
        });
      },
    ),
    props: data.props,
  });

  if (pageFields.size === 0) {
    return data.kind;
  }

  return {
    ...data.kind,
    groups: data.kind.groups.map(
      (group: DuplicateNameGroup): DuplicateNameGroup => {
        return {
          ...group,
          records: group.records.map(
            (record: DuplicateNameRecord): DuplicateNameRecord => {
              const fields: RecordPageFields | undefined = pageFields.get(
                record.id.toLowerCase(),
              );

              return fields ? { ...record, pageFields: fields } : record;
            },
          ),
        };
      },
    ),
  };
};

router.get(
  UNIQUE_NAME_CHECK_ROUTE,
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const props: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      const projectId: ObjectID =
        CommonAPI.assertAuthenticatedProjectPrincipal(props);

      const tableName: string = readQueryText(
        req.query[UNIQUE_NAME_CHECK_PARAMS.tableName],
      );

      const service: DatabaseService<BaseModel> | null = getServiceOfTable(
        Services,
        tableName,
      );

      const rule: ProjectNameRule | null = service
        ? getProjectNameRule(service.getModel())
        : null;

      if (!service || !rule) {
        throw new NotFoundException(
          "Names of that kind of record may repeat in a project, so there is nothing to check. Ask for a kind whose names are unique in a project, such as Monitor.",
        );
      }

      // A caller who may not read the kind is refused, as a list of it would be.
      TablePermission.checkTableLevelPermissions(
        service.modelType,
        props,
        DatabaseRequestType.Read,
      );

      const exceptIdText: string = readQueryText(
        req.query[UNIQUE_NAME_CHECK_PARAMS.exceptId],
      );

      const answer: UniqueNameCheckAnswer = await RequiredUniqueNames.checkName(
        {
          service: service,
          rule: rule,
          projectId: projectId,
          name: readQueryText(req.query[UNIQUE_NAME_CHECK_PARAMS.name]).slice(
            0,
            MAX_CHECKED_NAME_LENGTH,
          ),
          exceptId: ObjectID.isValidUUID(exceptIdText)
            ? new ObjectID(exceptIdText)
            : null,
          props: props,
        },
      );

      // The record that has the name, with what its page needs to be linked.
      if (answer.takenBy) {
        const pageFields: RecordPageFields | undefined = (
          await readPageFields({
            service: service,
            projectId: projectId,
            ids: [answer.takenBy.id],
            props: props,
          })
        ).get(answer.takenBy.id.toLowerCase());

        if (pageFields) {
          answer.takenBy = { ...answer.takenBy, pageFields: pageFields };
        }
      }

      Response.setNoCacheHeaders(res);

      return Response.sendJsonObjectResponse(
        req,
        res,
        toUniqueNameCheckAnswerJSON(answer),
      );
    } catch (err) {
      return next(err);
    }
  },
);

router.get(
  UNIQUE_NAME_DUPLICATES_ROUTE,
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const props: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      const projectId: ObjectID =
        CommonAPI.assertAuthenticatedProjectPrincipal(props);

      const kinds: Array<DuplicateNamesOfKind> = [];

      // One kind at a time: each is one read of its table's index.
      for (const service of getRequiredUniqueNameServices(Services)) {
        const kind: DuplicateNamesOfKind | null =
          await RequiredUniqueNames.findDuplicatesOfKind({
            service: service,
            projectId: projectId,
            props: props,
          });

        if (kind) {
          kinds.push(
            await withPageFields({
              kind: kind,
              service: service,
              projectId: projectId,
              props: props,
            }),
          );
        }
      }

      Response.setNoCacheHeaders(res);

      return Response.sendJsonObjectResponse(
        req,
        res,
        toDuplicateNamesAnswerJSON({
          requireUniqueNames:
            await RequiredUniqueNames.isRequiredInProject(projectId),
          kinds: kinds,
        }),
      );
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
