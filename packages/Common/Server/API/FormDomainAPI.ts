import { FormCNameRecord } from "../EnvironmentConfig";
import FormDomainService, {
  Service as FormDomainServiceType,
} from "../Services/FormDomainService";
import BaseAPI from "./BaseAPI";
import FormDomain from "../../Models/DatabaseModels/FormDomain";
import CustomDomainRoutes from "./CustomDomainRoutes";

/*
 * A form's own domains (Forms -> a form -> Custom Domains): the CRUD routes
 * of /form-domain, and the same Check now (verify-cname), Order SSL,
 * Reissue SSL and Status column (certificates/:formId) routes as a status
 * page's and a dashboard's custom domains, registered once for all three
 * (CustomDomainRoutes). The three that change a domain take what editing it
 * takes.
 *
 * The routes the form's page calls ON its domain - its questions, sending
 * the answers, the CNAME check - are the form API's
 * (FormAPI, Types/Form/FormCustomDomain).
 */
export default class FormDomainAPI extends BaseAPI<
  FormDomain,
  FormDomainServiceType
> {
  public constructor() {
    super(FormDomain, FormDomainService);

    CustomDomainRoutes.add({
      router: this.router,
      crudApiPath: new this.entityType().getCrudApiPath()?.toString() || "",
      service: FormDomainService,
      getCnameRecord: (): string => {
        return FormCNameRecord;
      },
      parentColumn: "formId",
    });
  }
}
