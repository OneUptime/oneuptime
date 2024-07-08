Here is the code with improved comments:

    import AuthenticationServiceHandler from ./Service/Authentication;
import DataTypeServiceHandler from ./Service/DataType;
import ErrorServiceHandler from ./Service/Errors;
import IntroductionServiceHandler from ./Service/Introduction;
import ModelServiceHandler from ./Service/Model;
import PageNotFoundServiceHandler from ./Service/PageNotFound;
import PaginationServiceHandler from ./Service/Pagination;
import PermissionServiceHandler from ./Service/Permissions;
import StatusServiceHandler from ./Service/Status;
import { StaticPath } from ./Utils/Config;
import ResourceUtil, { ModelDocumentation } from ./Utils/Resources;
import Dictionary from Common/Types/Dictionary;
import FeatureSet from CommonServer/Types/FeatureSet;
import Express, {
  ExpressApplication,
  ExpressRequest,
  ExpressResponse,
  ExpressStatic,
} from CommonServer/Utils/Express;

const APIReferenceFeatureSet: FeatureSet = {
  init: async (): Promise<void> => {
    const ResourceDictionary: Dictionary<ModelDocumentation> =
      // Get the resource dictionary from ResourceUtil
      ResourceUtil.getResourceDictionaryByPath();

    const app: ExpressApplication = Express.getExpressApp();

    app.use(/reference, ExpressStatic(StaticPath, { maxAge: 2592000 }));

    // Redirect to introduction page when accessing root reference page
    app.get([/reference], (_req: ExpressRequest, res: ExpressResponse) => {
      return res.redirect(/reference/introduction);
    });

    app.get(
      [/reference/page-not-found],
      (req: ExpressRequest, res: ExpressResponse) => {
        // Handle page not found
        return PageNotFoundServiceHandler.executeResponse(req, res);
      },
    );

    // Handle all pages in the reference section
    app.get(
      [/reference/:page],
      (req: ExpressRequest, res: ExpressResponse) => {
        const page: string | undefined = req.params[page];

        if (!page) {
          // Return page not found if no page is specified
          return PageNotFoundServiceHandler.executeResponse(req, res);
        }

        const currentResource: ModelDocumentation | undefined =
          // Get the current resource from the resource dictionary
          ResourceDictionary[page];

        if (req.params[page] === permissions) {
          // Handle permissions page
          return PermissionServiceHandler.executeResponse(req, res);
        } else if (req.params[page] === authentication) {
          // Handle authentication page
          return AuthenticationServiceHandler.executeResponse(req, res);
        } else if (req.params[page] === pagination) {
          // Handle pagination page
          return PaginationServiceHandler.executeResponse(req, res);
        } else if (req.params[page] === errors) {
          // Handle errors page
          return ErrorServiceHandler.executeResponse(req, res);
        } else if (req.params[page] === introduction) {
          // Handle introduction page
          return IntroductionServiceHandler.executeResponse(req, res);
        } else if (req.params[page] === status) {
          // Handle status page
          return StatusServiceHandler.executeResponse(req, res);
        } else if (req.params[page] === data-types) {
          // Handle data types page
          return DataTypeServiceHandler.executeResponse(req, res);
        } else if (currentResource) {
          // Handle other pages that have a corresponding resource
          return ModelServiceHandler.executeResponse(req, res);
        }
        // Return page not found if no handler is found
        return PageNotFoundServiceHandler.executeResponse(req, res);
      },
    );

    app.get(/reference/*, (req: ExpressRequest, res: ExpressResponse) => {
      // Handle any other requests in the reference section
      return PageNotFoundServiceHandler.executeResponse(req, res);
    });
  },
};

export default APIReferenceFeatureSet;
