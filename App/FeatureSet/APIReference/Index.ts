import AuthenticationServiceHandler from "./Service/Authentication";
import DataTypeServiceHandler from "./Service/DataType";
import DataTypeDetailServiceHandler from "./Service/DataTypeDetail";
import ErrorServiceHandler from "./Service/Errors";
import OpenAPIServiceHandler from "./Service/OpenAPI";
import IntroductionServiceHandler from "./Service/Introduction";
import ModelServiceHandler from "./Service/Model";
import PageNotFoundServiceHandler from "./Service/PageNotFound";
import PaginationServiceHandler from "./Service/Pagination";
import PermissionServiceHandler from "./Service/Permissions";
import StatusServiceHandler from "./Service/Status";
import { StaticPath } from "./Utils/Config";
import { DEFAULT_DOCS_LANGUAGE, isSupportedDocsLanguage } from "./Utils/I18n";
import ResourceUtil, { ModelDocumentation } from "./Utils/Resources";
import DataTypeUtil, { DataTypeDocumentation } from "./Utils/DataTypes";
import Dictionary from "Common/Types/Dictionary";
import FeatureSet from "Common/Server/Types/FeatureSet";
import Express, {
  ExpressApplication,
  ExpressRequest,
  ExpressResponse,
  ExpressStatic,
  NextFunction,
} from "Common/Server/Utils/Express";

/*
 * Pick the best language for a request based on the URL parameter, the
 * Accept-Language header, or fall back to English.
 */
function pickLanguage(req: ExpressRequest): string {
  const fromParam: string | undefined = req.params["lang"];
  if (fromParam && isSupportedDocsLanguage(fromParam)) {
    return fromParam;
  }
  const header: string | undefined = req.headers["accept-language"];
  if (header) {
    const codes: Array<string> = header
      .split(",")
      .map((part: string) => {
        return part.split(";")[0]!.trim().toLowerCase();
      })
      .filter((code: string) => {
        return code.length > 0;
      });
    for (const code of codes) {
      const primary: string = code.split("-")[0]!;
      if (isSupportedDocsLanguage(primary)) {
        return primary;
      }
    }
  }
  return DEFAULT_DOCS_LANGUAGE;
}

const APIReferenceFeatureSet: FeatureSet = {
  init: async (): Promise<void> => {
    const ResourceDictionary: Dictionary<ModelDocumentation> =
      ResourceUtil.getResourceDictionaryByPath();

    const DataTypeDictionary: Dictionary<DataTypeDocumentation> =
      DataTypeUtil.getDataTypeDictionaryByPath();

    const app: ExpressApplication = Express.getExpressApp();

    // Serve static files for the API reference with a cache max age of 30 days
    app.use("/reference", ExpressStatic(StaticPath, { maxAge: 2592000 }));

    /*
     * Root /reference — redirect to the best language's introduction page.
     */
    app.get("/reference", (req: ExpressRequest, res: ExpressResponse) => {
      const lang: string = pickLanguage(req);
      return res.redirect(`/reference/${lang}/introduction`);
    });

    /*
     * /reference/:lang — if `:lang` is a known language, redirect to its
     * introduction. Otherwise fall through to the page handler so legacy
     * URLs like /reference/permissions keep working.
     */
    app.get(
      "/reference/:lang",
      (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        const lang: string = req.params["lang"] || "";
        if (!isSupportedDocsLanguage(lang)) {
          return next();
        }
        return res.redirect(`/reference/${lang}/introduction`);
      },
    );

    /*
     * Language-aware 404.
     */
    app.get(
      "/reference/:lang/page-not-found",
      (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        const lang: string = req.params["lang"] || "";
        if (!isSupportedDocsLanguage(lang)) {
          return next();
        }
        return PageNotFoundServiceHandler.executeResponse(req, res);
      },
    );

    /*
     * Language-aware page route: /reference/:lang/:page
     */
    app.get(
      "/reference/:lang/:page",
      (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        const lang: string = req.params["lang"] || "";
        if (!isSupportedDocsLanguage(lang)) {
          return next();
        }
        const page: string | undefined = req.params["page"];

        if (!page) {
          return PageNotFoundServiceHandler.executeResponse(req, res);
        }

        const currentResource: ModelDocumentation | undefined =
          ResourceDictionary[page];

        if (page === "permissions") {
          return PermissionServiceHandler.executeResponse(req, res);
        } else if (page === "authentication") {
          return AuthenticationServiceHandler.executeResponse(req, res);
        } else if (page === "pagination") {
          return PaginationServiceHandler.executeResponse(req, res);
        } else if (page === "errors") {
          return ErrorServiceHandler.executeResponse(req, res);
        } else if (page === "introduction") {
          return IntroductionServiceHandler.executeResponse(req, res);
        } else if (page === "openapi") {
          return OpenAPIServiceHandler.executeResponse(req, res);
        } else if (page === "status") {
          return StatusServiceHandler.executeResponse(req, res);
        } else if (page === "data-types") {
          return DataTypeServiceHandler.executeResponse(req, res);
        } else if (DataTypeDictionary[page]) {
          return DataTypeDetailServiceHandler.executeResponse(req, res);
        } else if (currentResource) {
          return ModelServiceHandler.executeResponse(req, res);
        }

        return PageNotFoundServiceHandler.executeResponse(req, res);
      },
    );

    /*
     * Legacy "Page Not Found" without language prefix — redirect to the
     * user's best-fit language so older bookmarks still work.
     */
    app.get(
      ["/reference/page-not-found"],
      (req: ExpressRequest, res: ExpressResponse) => {
        const lang: string = pickLanguage(req);
        return res.redirect(`/reference/${lang}/page-not-found`);
      },
    );

    /*
     * Legacy single-segment URL: /reference/:page → redirect to the best
     * language's version of the same page.
     */
    app.get(
      ["/reference/:page"],
      (req: ExpressRequest, res: ExpressResponse) => {
        const lang: string = pickLanguage(req);
        const page: string = req.params["page"]!;
        return res.redirect(`/reference/${lang}/${page}`);
      },
    );

    app.get("/reference/*", (req: ExpressRequest, res: ExpressResponse) => {
      return PageNotFoundServiceHandler.executeResponse(req, res);
    });
  },
};

export default APIReferenceFeatureSet;
