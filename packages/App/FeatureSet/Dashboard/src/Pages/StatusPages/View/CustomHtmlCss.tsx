import PageComponentProps from "../../PageComponentProps";
import {
  STATUS_PAGE_CUSTOM_CODE_NOTICE_TEST_ID,
  StatusPageCustomCodeCopy,
} from "../../../Components/StatusPage/StatusPageCustomCodeCopy";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import Includes from "Common/Types/BaseDatabase/Includes";
import Query from "Common/Types/BaseDatabase/Query";
import ObjectID from "Common/Types/ObjectID";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import ModelAPI, { type ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import Domain from "Common/Models/DatabaseModels/Domain";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageDomain from "Common/Models/DatabaseModels/StatusPageDomain";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * How many of a page's domains the custom code notice reads: far more than
 * a status page has.
 */
export const CUSTOM_CODE_DOMAINS_READ_LIMIT: number = 100;

/*
 * Status Pages -> a page -> Branding -> HTML, CSS & JavaScript: the code
 * that goes past what the Branding page offers. See
 * StatusPageCustomCodeCopy for what each card says, and why the page opens
 * on where the code runs.
 */
const StatusPageCustomCode: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const statusPageId: string = modelId.toString();

  /*
   * Whether the page has a custom domain its code runs on: a CNAME verified
   * for this page, on a verified project domain - what the status page
   * server asks before it serves any of this code
   * (canServeStatusPageCustomizations). Until there is one the code runs
   * nowhere, and the page says so, with Custom Domains a click away; a page
   * that has one is not told again on every visit. Null while it is asked,
   * and after a read that failed: no notice on a guess.
   *
   * Two reads: the page's CNAME-verified domains, then whether any of their
   * project domains is verified. Domain.isVerified cannot be read through
   * the relation (it has no canReadOnRelationQuery), so selecting it on the
   * first read would throw, and the notice would never show.
   */
  const [hasServingDomain, setHasServingDomain] = useState<boolean | null>(
    null,
  );

  useEffect(() => {
    let isCancelled: boolean = false;

    const readDomains: () => Promise<boolean> = async (): Promise<boolean> => {
      const pageDomains: ListResult<StatusPageDomain> =
        await ModelAPI.getList<StatusPageDomain>({
          modelType: StatusPageDomain,
          query: {
            statusPageId: new ObjectID(statusPageId),
            isCnameVerified: true,
          } as Query<StatusPageDomain>,
          select: {
            _id: true,
            domainId: true,
          },
          sort: {},
          limit: CUSTOM_CODE_DOMAINS_READ_LIMIT,
          skip: 0,
        });

      const domainIds: Array<ObjectID> = [];

      for (const pageDomain of pageDomains.data) {
        if (pageDomain.domainId) {
          domainIds.push(pageDomain.domainId);
        }
      }

      if (domainIds.length === 0) {
        return false;
      }

      const verifiedDomains: ListResult<Domain> =
        await ModelAPI.getList<Domain>({
          modelType: Domain,
          query: {
            _id: new Includes(domainIds),
            isVerified: true,
          } as Query<Domain>,
          select: {
            _id: true,
          },
          sort: {},
          limit: 1,
          skip: 0,
        });

      return verifiedDomains.data.length > 0;
    };

    void readDomains()
      .then((hasDomain: boolean): void => {
        if (!isCancelled) {
          setHasServingDomain(hasDomain);
        }
      })
      .catch((): void => {
        // Not known: the notice waits for an answer.
      });

    return () => {
      isCancelled = true;
    };
  }, [statusPageId]);

  return (
    <Fragment>
      {hasServingDomain === false && (
        <Alert
          className="mb-5"
          type={AlertType.INFO}
          title={StatusPageCustomCodeCopy.notice}
          textOnRight={StatusPageCustomCodeCopy.noticeAction}
          dataTestId={STATUS_PAGE_CUSTOM_CODE_NOTICE_TEST_ID}
          onClick={() => {
            Navigation.navigate(
              RouteUtil.populateRouteParams(
                RouteMap[PageMap.STATUS_PAGE_VIEW_DOMAINS] as Route,
                { modelId },
              ),
            );
          }}
        />
      )}

      <CardModelDetail<StatusPage>
        name="Status Page > Branding > Header HTML"
        cardProps={{
          title: StatusPageCustomCodeCopy.headerTitle,
          description: StatusPageCustomCodeCopy.headerDescription,
        }}
        isEditable={true}
        editButtonText={StatusPageCustomCodeCopy.headerEdit}
        editModalTitle={StatusPageCustomCodeCopy.headerEdit}
        formFields={[
          {
            field: {
              headerHTML: true,
            },
            title: "Header HTML",
            fieldType: FormFieldSchemaType.HTML,
            required: false,
            placeholder: "Insert Custom HTML here.",
            hideColumnDescription: true,
          },
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 1,
          modelType: StatusPage,
          id: "model-detail-status-page-header-html",
          fields: [
            {
              field: {
                headerHTML: true,
              },
              fieldType: FieldType.HTML,
              title: "Header HTML",
              placeholder: StatusPageCustomCodeCopy.headerEmpty,
            },
          ],
          modelId: modelId,
        }}
      />

      <CardModelDetail<StatusPage>
        name="Status Page > Branding > Footer HTML"
        cardProps={{
          title: StatusPageCustomCodeCopy.footerTitle,
          description: StatusPageCustomCodeCopy.footerDescription,
        }}
        isEditable={true}
        editButtonText={StatusPageCustomCodeCopy.footerEdit}
        editModalTitle={StatusPageCustomCodeCopy.footerEdit}
        formFields={[
          {
            field: {
              footerHTML: true,
            },
            title: "Footer HTML",
            fieldType: FormFieldSchemaType.HTML,
            required: false,
            placeholder: "Insert Custom HTML here.",
            hideColumnDescription: true,
          },
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 1,
          modelType: StatusPage,
          id: "model-detail-status-page-footer-html",
          fields: [
            {
              field: {
                footerHTML: true,
              },
              fieldType: FieldType.HTML,
              title: "Footer HTML",
              placeholder: StatusPageCustomCodeCopy.footerEmpty,
            },
          ],
          modelId: modelId,
        }}
      />

      <CardModelDetail<StatusPage>
        name="Status Page > Branding > Custom CSS"
        cardProps={{
          title: StatusPageCustomCodeCopy.cssTitle,
          description: StatusPageCustomCodeCopy.cssDescription,
        }}
        isEditable={true}
        editButtonText={StatusPageCustomCodeCopy.cssEdit}
        editModalTitle={StatusPageCustomCodeCopy.cssEdit}
        formFields={[
          {
            field: {
              customCSS: true,
            },
            title: "Custom CSS",
            fieldType: FormFieldSchemaType.CSS,
            required: false,
            placeholder: "Insert Custom CSS here.",
            hideColumnDescription: true,
          },
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 1,
          modelType: StatusPage,
          id: "model-detail-status-page-custom-css",
          fields: [
            {
              field: {
                customCSS: true,
              },
              fieldType: FieldType.CSS,
              title: "Custom CSS",
            },
          ],
          modelId: modelId,
        }}
      />

      <CardModelDetail<StatusPage>
        name="Status Page > Branding > Custom JavaScript"
        cardProps={{
          title: StatusPageCustomCodeCopy.javaScriptTitle,
          description: StatusPageCustomCodeCopy.javaScriptDescription,
        }}
        isEditable={true}
        editButtonText={StatusPageCustomCodeCopy.javaScriptEdit}
        editModalTitle={StatusPageCustomCodeCopy.javaScriptEdit}
        formFields={[
          {
            field: {
              customJavaScript: true,
            },
            title: "Custom JavaScript",
            fieldType: FormFieldSchemaType.JavaScript,
            required: false,
            placeholder: "Insert Custom JavaScript here.",
            hideColumnDescription: true,
          },
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 1,
          modelType: StatusPage,
          id: "model-detail-status-page-custom-javascript",
          fields: [
            {
              field: {
                customJavaScript: true,
              },
              fieldType: FieldType.JavaScript,
              title: "Custom JavaScript",
            },
          ],
          modelId: modelId,
        }}
      />
    </Fragment>
  );
};

export default StatusPageCustomCode;
