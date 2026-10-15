import NetworkDeviceDiscoveryImport from "../../Models/DatabaseModels/NetworkDeviceDiscoveryImport";
import NetworkDeviceDiscoveryScan from "../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseRequestType from "../Types/BaseDatabase/DatabaseRequestType";
import Includes from "../../Types/BaseDatabase/Includes";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import BadDataException from "../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../Types/Exception/PaymentRequiredException";
import { JSONObject } from "../../Types/JSON";
import { ACTIVE_DISCOVERY_IMPORT_STATUSES } from "../../Types/NetworkDevice/DiscoveryImport";
import ObjectID from "../../Types/ObjectID";
import UserMiddleware from "../Middleware/UserAuthorization";
import NetworkDeviceDiscoveryImportService from "../Services/NetworkDeviceDiscoveryImportService";
import TablePermission from "../Types/Database/Permissions/TablePermission";
import CallerPlan from "../Utils/Billing/CallerPlan";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import DiscoveryImportRunner, {
  DISCOVERY_IMPORT_VIEW_SELECT,
} from "../Utils/NetworkDiscovery/DiscoveryImportRunner";
import Response from "../Utils/Response";
import CommonAPI from "./CommonAPI";

/*
 * IMPORTING A DISCOVERY SCAN'S HOSTS, OVER HTTP (Network > Discovery >
 * Review Results).
 *
 *   POST /network-device-discovery-import/start
 *        { scanId, ipAddresses, settings }        ask for an import
 *   GET  /network-device-discovery-import/import/:importId[?results=all]
 *                                                 one import, as it stands
 *   GET  /network-device-discovery-import/scan/:scanId/latest
 *                                                 the scan's newest import
 *   GET  /network-device-discovery-import/active  the project's imports that
 *                                                 have not finished
 *   POST /network-device-discovery-import/import/:importId/stop
 *   POST /network-device-discovery-import/import/:importId/retry
 *
 * A bare router (ToolImportAPI is the precedent): imports are internal rows
 * with no CRUD API, read here as root, so these handlers are the gate.
 *
 *  - Every route needs a person signed in to the project. An import acts as
 *    a person - its devices are created with their permissions - so a
 *    project API key cannot ask for one.
 *  - Seeing imports needs the right to read discovery scans: an import is a
 *    scan's results becoming devices, and everybody who can see the scan
 *    can see that someone is importing it, how far it has got and what
 *    failed. Imports are a team's shared state, not one person's.
 *  - Asking for one, retrying one and stopping one need the right to create
 *    network devices - and, for monitors, monitors - checked by the runner
 *    with the person's own permissions (DiscoveryImportRunner).
 */
const router: ExpressRouter = Express.getRouter();

const ACTIVE_LIST_LIMIT: number = 20;

async function getPersonProps(req: ExpressRequest): Promise<{
  props: DatabaseCommonInteractionProps;
  projectId: ObjectID;
}> {
  const props: DatabaseCommonInteractionProps = await CallerPlan.withPlan(
    await CommonAPI.getDatabaseCommonInteractionProps(req),
  );

  const projectId: ObjectID = CommonAPI.assertAuthenticatedProjectMember(props);

  return { props: props, projectId: projectId };
}

/*
 * Refused unless the person may read the project's discovery scans, in the
 * same words as a refused read of the scans themselves.
 */
export function assertCanSeeImports(
  props: DatabaseCommonInteractionProps,
): void {
  try {
    TablePermission.checkTableLevelPermissions(
      NetworkDeviceDiscoveryScan,
      props,
      DatabaseRequestType.Read,
    );
  } catch (error) {
    if (
      error instanceof NotAuthorizedException ||
      error instanceof PaymentRequiredException
    ) {
      throw new NotAuthorizedException(
        "You may not see this project's discovery scans, so you cannot see their imports.",
      );
    }

    throw error;
  }
}

function readIdParam(
  req: ExpressRequest,
  name: string,
  message: string,
): ObjectID {
  const value: string | undefined = req.params[name];

  if (!value || !ObjectID.isValidUUID(value)) {
    throw new BadDataException(message);
  }

  return new ObjectID(value);
}

function readBody(req: ExpressRequest): JSONObject {
  return req.body && typeof req.body === "object" && !Array.isArray(req.body)
    ? (req.body as JSONObject)
    : {};
}

async function readImportView(data: {
  importId: ObjectID;
  projectId: ObjectID;
  props: DatabaseCommonInteractionProps;
  allResults: boolean;
}): Promise<JSONObject> {
  const row: NetworkDeviceDiscoveryImport =
    await DiscoveryImportRunner.findImport({
      importId: data.importId,
      projectId: data.projectId,
      select: DISCOVERY_IMPORT_VIEW_SELECT,
    });

  return DiscoveryImportRunner.toView({
    row: row,
    userId: data.props.userId,
    allResults: data.allResults,
  }) as unknown as JSONObject;
}

router.post(
  "/network-device-discovery-import/start",
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { props, projectId } = await getPersonProps(req);
      const body: JSONObject = readBody(req);

      assertCanSeeImports(props);

      const created: NetworkDeviceDiscoveryImport =
        await DiscoveryImportRunner.start({
          projectId: projectId,
          props: props,
          scanId: body["scanId"],
          ipAddresses: body["ipAddresses"],
          settings: body["settings"],
        });

      return Response.sendJsonObjectResponse(req, res, {
        import: await readImportView({
          importId: created.id!,
          projectId: projectId,
          props: props,
          allResults: false,
        }),
      });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/network-device-discovery-import/import/:importId",
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { props, projectId } = await getPersonProps(req);

      assertCanSeeImports(props);

      return Response.sendJsonObjectResponse(req, res, {
        import: await readImportView({
          importId: readIdParam(req, "importId", "This import was not found."),
          projectId: projectId,
          props: props,
          allResults: req.query["results"] === "all",
        }),
      });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/network-device-discovery-import/scan/:scanId/latest",
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { props, projectId } = await getPersonProps(req);

      assertCanSeeImports(props);

      const scanId: ObjectID = readIdParam(
        req,
        "scanId",
        "This discovery scan was not found.",
      );

      const latest: NetworkDeviceDiscoveryImport | null =
        await NetworkDeviceDiscoveryImportService.findOneBy({
          query: {
            projectId: projectId,
            networkDeviceDiscoveryScanId: scanId,
          },
          select: DISCOVERY_IMPORT_VIEW_SELECT as never,
          sort: { createdAt: SortOrder.Descending },
          props: { isRoot: true },
        });

      return Response.sendJsonObjectResponse(req, res, {
        import: latest
          ? (DiscoveryImportRunner.toView({
              row: latest,
              userId: props.userId,
            }) as unknown as JSONObject)
          : null,
      });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/network-device-discovery-import/active",
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { props, projectId } = await getPersonProps(req);

      assertCanSeeImports(props);

      const active: Array<NetworkDeviceDiscoveryImport> =
        await NetworkDeviceDiscoveryImportService.findBy({
          query: {
            projectId: projectId,
            status: new Includes([...ACTIVE_DISCOVERY_IMPORT_STATUSES]),
          },
          select: DISCOVERY_IMPORT_VIEW_SELECT as never,
          sort: { createdAt: SortOrder.Ascending },
          limit: ACTIVE_LIST_LIMIT,
          skip: 0,
          props: { isRoot: true },
        });

      return Response.sendJsonObjectResponse(req, res, {
        imports: active.map((row: NetworkDeviceDiscoveryImport): JSONObject => {
          return DiscoveryImportRunner.toView({
            row: row,
            userId: props.userId,
          }) as unknown as JSONObject;
        }),
      });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/network-device-discovery-import/import/:importId/stop",
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { props, projectId } = await getPersonProps(req);
      const importId: ObjectID = readIdParam(
        req,
        "importId",
        "This import was not found.",
      );

      assertCanSeeImports(props);

      await DiscoveryImportRunner.stop({
        projectId: projectId,
        props: props,
        importId: importId,
      });

      return Response.sendJsonObjectResponse(req, res, {
        import: await readImportView({
          importId: importId,
          projectId: projectId,
          props: props,
          allResults: false,
        }),
      });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/network-device-discovery-import/import/:importId/retry",
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { props, projectId } = await getPersonProps(req);

      assertCanSeeImports(props);

      const created: NetworkDeviceDiscoveryImport =
        await DiscoveryImportRunner.retry({
          projectId: projectId,
          props: props,
          importId: readIdParam(req, "importId", "This import was not found."),
        });

      return Response.sendJsonObjectResponse(req, res, {
        import: await readImportView({
          importId: created.id!,
          projectId: projectId,
          props: props,
          allResults: false,
        }),
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
