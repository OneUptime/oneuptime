import MasterAdminAuthorization from "Common/Server/Middleware/MasterAdminAuthorization";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
  RequestHandler,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import MimeType from "Common/Types/File/MimeType";
import PartialEntity from "Common/Types/Database/PartialEntity";
import { JSONObject } from "Common/Types/JSON";
import { WhiteLabelImage, WhiteLabelImageKind } from "../WhiteLabelImages";
import whiteLabelProvider, { WhiteLabelProvider } from "../WhiteLabelProvider";
import {
  EMPTY_WHITE_LABEL_SETTINGS,
  parseWhiteLabelSettingsUpdate,
  toWhiteLabelSettingsResponse,
  WHITE_LABEL_IMAGE_ROUTES,
  WHITE_LABEL_SETTINGS_ROUTE,
  WhiteLabelSettings,
} from "../WhiteLabelSettings";
import WhiteLabelStore from "../WhiteLabelStore";

/*
 * The white-label routes, mounted under "/api":
 *
 *   GET /branding/settings              master admins: what is set
 *   PUT /branding/settings              master admins: change it
 *   GET /branding/logo                  anyone: the images, for pages and
 *   GET /branding/dark-logo             emails
 *   GET /branding/favicon
 *
 * EVERY route starts with the license gate (whiteLabelGate). While the
 * license does not allow white-labelling, the gate passes the request on
 * (next("route")) before anything else looks at it - before the master-admin
 * check, before the body is read - so it ends where a request for a path
 * that does not exist ends: the same 404, for anyone. An installation whose
 * license does not allow it cannot tell these routes from no routes at all.
 *
 * An image that is not set ends the same way, so the image routes do not
 * tell "not allowed" from "not set" either.
 *
 * A router of routes only, no router.use() (see EnterpriseArea).
 */

export interface WhiteLabelRouterDependencies {
  provider: WhiteLabelProvider;
  writeSettings: (update: PartialEntity<GlobalConfig>) => Promise<void>;
  now: () => Date;
}

const getDefaultDependencies: () => WhiteLabelRouterDependencies =
  (): WhiteLabelRouterDependencies => {
    return {
      provider: whiteLabelProvider,
      writeSettings: (update: PartialEntity<GlobalConfig>): Promise<void> => {
        return WhiteLabelStore.writeSettings(update);
      },
      now: (): Date => {
        return new Date();
      },
    };
  };

/*
 * How the images are cached. Their addresses carry the time the settings
 * last changed (?v=...), so a changed image is fetched again at once; the
 * short max-age bounds how long one keeps showing after white-labelling
 * stops being allowed.
 */
export const WHITE_LABEL_IMAGE_CACHE_CONTROL: string = "public, max-age=300";

/*
 * The same protections Response.sendFileResponse gives every stored file:
 * nosniff, a sandboxing policy so an image opened on its own cannot run
 * anything, never framed, and only raster images inline.
 */
export const WHITE_LABEL_IMAGE_CONTENT_SECURITY_POLICY: string =
  "sandbox; script-src 'none'; object-src 'none'; frame-ancestors 'none'";

const INLINE_IMAGE_TYPES: ReadonlyArray<string> = [
  MimeType.png,
  MimeType.jpeg,
  MimeType.gif,
  MimeType.webp,
  MimeType.ico,
];

const FILE_EXTENSIONS: Readonly<Record<string, string>> = {
  [MimeType.png]: "png",
  [MimeType.jpeg]: "jpg",
  [MimeType.gif]: "gif",
  [MimeType.webp]: "webp",
  [MimeType.ico]: "ico",
  [MimeType.svg]: "svg",
};

const FILE_NAMES: Readonly<Record<WhiteLabelImageKind, string>> = {
  [WhiteLabelImageKind.Logo]: "logo",
  [WhiteLabelImageKind.DarkLogo]: "logo-dark",
  [WhiteLabelImageKind.Favicon]: "favicon",
};

export const sendWhiteLabelImage: (
  req: ExpressRequest,
  res: ExpressResponse,
  kind: WhiteLabelImageKind,
  image: WhiteLabelImage,
) => void = (
  _req: ExpressRequest,
  res: ExpressResponse,
  kind: WhiteLabelImageKind,
  image: WhiteLabelImage,
): void => {
  const fileName: string = `${FILE_NAMES[kind]}.${FILE_EXTENSIONS[image.type] || "img"}`;

  res.set("Content-Type", image.type);
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Content-Security-Policy", WHITE_LABEL_IMAGE_CONTENT_SECURITY_POLICY);
  res.set("X-Frame-Options", "DENY");
  res.set("Cache-Control", WHITE_LABEL_IMAGE_CACHE_CONTROL);
  res.set(
    "Content-Disposition",
    Response.getContentDisposition(
      INLINE_IMAGE_TYPES.includes(image.type) ? "inline" : "attachment",
      fileName,
    ),
  );
  res.status(200);
  res.send(image.bytes);
};

export const createWhiteLabelRouter: (
  dependencies?: Partial<WhiteLabelRouterDependencies>,
) => ExpressRouter = (
  dependencies?: Partial<WhiteLabelRouterDependencies>,
): ExpressRouter => {
  const deps: WhiteLabelRouterDependencies = {
    ...getDefaultDependencies(),
    ...(dependencies || {}),
  };

  const router: ExpressRouter = Express.getRouter();

  /*
   * The license gate, first on every route. Asked per request: the license
   * changes at runtime and the routes are mounted once.
   */
  const whiteLabelGate: RequestHandler = (
    _req: ExpressRequest,
    _res: ExpressResponse,
    next: NextFunction,
  ): void => {
    if (deps.provider.isAllowed()) {
      next();
      return;
    }

    next("route");
  };

  const readSettings: () => Promise<WhiteLabelSettings> =
    async (): Promise<WhiteLabelSettings> => {
      return (await deps.provider.getSettings()) || {
        ...EMPTY_WHITE_LABEL_SETTINGS,
      };
    };

  router.get(
    WHITE_LABEL_SETTINGS_ROUTE,
    whiteLabelGate,
    MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
    async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
      try {
        return Response.sendJsonObjectResponse(
          req,
          res,
          toWhiteLabelSettingsResponse(await readSettings()),
        );
      } catch (err) {
        next(err);
      }
    },
  );

  router.put(
    WHITE_LABEL_SETTINGS_ROUTE,
    whiteLabelGate,
    MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
    async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
      try {
        const update: PartialEntity<GlobalConfig> =
          parseWhiteLabelSettingsUpdate(req.body as JSONObject, deps.now());

        await deps.writeSettings(update);

        const settings: WhiteLabelSettings | null =
          await deps.provider.refresh();

        return Response.sendJsonObjectResponse(
          req,
          res,
          toWhiteLabelSettingsResponse(settings || (await readSettings())),
        );
      } catch (err) {
        next(err);
      }
    },
  );

  for (const kind of Object.values(WhiteLabelImageKind)) {
    router.get(
      WHITE_LABEL_IMAGE_ROUTES[kind],
      whiteLabelGate,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const image: WhiteLabelImage | null =
            await deps.provider.getImage(kind);

          if (!image) {
            // Not set: the same 404 as a route that does not exist.
            next("route");
            return;
          }

          sendWhiteLabelImage(req, res, kind, image);
        } catch (err) {
          next(err);
        }
      },
    );
  }

  return router;
};
