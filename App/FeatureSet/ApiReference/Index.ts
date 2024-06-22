import { AuthenticationServiceHandler } from ./Service/Authentication;
import { DataTypeServiceHandler } from ./Service/DataType;
import { ErrorServiceHandler } from ./Service/Errors;
import { IntroductionServiceHandler } from ./Service/Introduction;
import { ModelServiceHandler } from ./Service/Model;
import { PageNotFoundServiceHandler } from ./Service/PageNotFound;
import { PaginationServiceHandler } from ./Service/Pagination;
import { PermissionServiceHandler } from ./Service/Permissions;
import { StatusServiceHandler } from ./Service/Status;
import { StaticPath } from ./Utils/Config;
import { ResourceUtil, ModelDocumentation } from ./Utils/Resources;
import { Dictionary } from Common/Types/Dictionary;
import { FeatureSet } from CommonServer/Types/FeatureSet;
import Express, { ExpressApplication, ExpressRequest, ExpressResponse, ExpressStatic } from CommonServer/Utils/Express;

const APIReferenceFeatureSet: FeatureSet = {
  init: async (): Promise<void> => {
    const ResourceDictionary: Dictionary<ModelDocumentation> = ResourceUtil.getResourceDictionaryByPath();

    const app: ExpressApplication = Express.getExpressApp();

    app.use(/reference, ExpressStatic(StaticPath, { maxAge: 2592000 }));

    // Index page
    app.get(['/reference'], (_req: ExpressRequest, res: ExpressResponse) => {
      return res.redirect('/reference/introduction');
    });

    app.get(['/reference/page-not-found'], (req: ExpressRequest, res: ExpressResponse) => {
      return PageNotFoundServiceHandler.executeResponse(req, res);
    });

    // All Pages
    app.get(['/reference/:page'], (req: ExpressRequest, res: ExpressResponse) => {
      const page: string | undefined = req.params['page'];

      if (!page) {
        return PageNotFoundServiceHandler.executeResponse(req, res);
      }

      const currentResource: ModelDocumentation | undefined = ResourceDictionary[page];

      if (req.params['page'] === 'permissions') {
        return PermissionServiceHandler.executeResponse(req, res);
      } else if (req.params['page'] === 'authentication') {
        return AuthenticationServiceHandler.executeResponse(req, res);
      } else if (req.params['page'] === 'pagination') {
        return PaginationServiceHandler.executeResponse(req, res);
      } else if (req.params['page'] === 'errors') {
        return ErrorServiceHandler.executeResponse(req, res);
      } else if (req.params['page'] === 'introduction') {
        return IntroductionServiceHandler.executeResponse(req, res);
      } else if (req.params['page'] ==='status') {
        return StatusServiceHandler.executeResponse(req, res);
      } else if (req.params['page'] === 'data-types') {
        return DataTypeServiceHandler.executeResponse(req, res);
      } else if (currentResource) {
        return ModelServiceHandler.executeResponse(req, res);
      }
      // page not found
      return PageNotFoundServiceHandler.executeResponse(req, res);
    });

    app.get('/reference/*', (req: ExpressRequest, res: ExpressResponse) => {
      return PageNotFoundServiceHandler.executeResponse(req, res);
    });
  },
};

export default APIReferenceFeatureSet;

