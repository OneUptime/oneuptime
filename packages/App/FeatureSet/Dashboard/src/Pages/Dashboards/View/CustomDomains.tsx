import PageComponentProps from "../../PageComponentProps";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import BadDataException from "Common/Types/Exception/BadDataException";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import { APP_API_URL, DashboardCNameRecord } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import Domain from "Common/Models/DatabaseModels/Domain";
import DashboardDomain from "Common/Models/DatabaseModels/DashboardDomain";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import OneUptimeDate from "Common/Types/Date";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ProjectUtil from "Common/UI/Utils/Project";
import CertificateReissueUtil from "Common/Utils/CertificateReissue";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";

const DashboardCustomDomains: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [refreshToggle, setRefreshToggle] = useState<string>(
    OneUptimeDate.getCurrentDate().toString(),
  );

  const [showCnameModal, setShowCnameModal] = useState<boolean>(false);

  const [selectedDashboardDomain, setSelectedDashboardDomain] =
    useState<DashboardDomain | null>(null);

  const [verifyCnameLoading, setVerifyCnameLoading] = useState<boolean>(false);

  const [orderSslLoading, setOrderSslLoading] = useState<boolean>(false);

  const [error, setError] = useState<string>("");

  const [showOrderSSLModal, setShowOrderSSLModal] = useState<boolean>(false);

  const [showReissueSSLModal, setShowReissueSSLModal] =
    useState<boolean>(false);

  const [reissueSslLoading, setReissueSslLoading] = useState<boolean>(false);

  /*
   * The server enforces the cooldown; this is only so the button explains
   * itself before it is pressed rather than after the request comes back
   * rejected. Both sides read the same helper, so they cannot disagree.
   */
  const isReissueCoolingDown: boolean = CertificateReissueUtil.isInCooldown(
    selectedDashboardDomain?.certificateReissueRequestedAt,
    OneUptimeDate.getCurrentDate(),
  );

  return (
    <Fragment>
      <>
        <ModelTable<DashboardDomain>
          modelType={DashboardDomain}
          query={{
            projectId: ProjectUtil.getCurrentProjectId()!,
            dashboardId: modelId,
          }}
          name="Dashboard > Domains"
          userPreferencesKey="dashboard-domains-table"
          id="dashboard-domains-table"
          saveFilterProps={{
            tableId: "dashboard-domains-table",
          }}
          isDeleteable={true}
          isCreateable={true}
          isEditable={true}
          cardProps={{
            title: "Custom Domains",
            description: translator.translateTemplate(
              "Important: Please add a CNAME record pointing to {{cnameRecord}} for these domains for this to work.",
              { cnameRecord: DashboardCNameRecord },
            ),
          }}
          refreshToggle={refreshToggle}
          onBeforeCreate={(item: DashboardDomain): Promise<DashboardDomain> => {
            if (!props.currentProject || !props.currentProject._id) {
              throw new BadDataException("Project ID cannot be null");
            }
            item.dashboardId = modelId;
            item.projectId = new ObjectID(props.currentProject._id);
            return Promise.resolve(item);
          }}
          actionButtons={[
            {
              title: "Add CNAME",
              buttonStyleType: ButtonStyleType.SUCCESS_OUTLINE,
              icon: IconProp.Check,
              isVisible: (item: DashboardDomain): boolean => {
                if (item["isCnameVerified"]) {
                  return false;
                }

                return true;
              },
              onClick: async (
                item: DashboardDomain,
                onCompleteAction: VoidFunction,
                onError: ErrorFunction,
              ) => {
                try {
                  setShowCnameModal(true);
                  setSelectedDashboardDomain(item);
                  onCompleteAction();
                } catch (err) {
                  onCompleteAction();
                  onError(err as Error);
                }
              },
            },
            {
              title: "Order Free SSL",
              buttonStyleType: ButtonStyleType.SUCCESS_OUTLINE,
              icon: IconProp.Check,
              isVisible: (item: DashboardDomain): boolean => {
                if (
                  !item.isCustomCertificate &&
                  item["isCnameVerified"] &&
                  !item.isSslOrdered
                ) {
                  return true;
                }

                return false;
              },
              onClick: async (
                item: DashboardDomain,
                onCompleteAction: VoidFunction,
                onError: ErrorFunction,
              ) => {
                try {
                  setShowOrderSSLModal(true);
                  setSelectedDashboardDomain(item);
                  onCompleteAction();
                } catch (err) {
                  onCompleteAction();
                  setSelectedDashboardDomain(null);
                  onError(err as Error);
                }
              },
            },
            {
              /*
               * Certificates renew themselves, so this is not part of the
               * normal path - it is here for the customer who has a reason to
               * want a brand new certificate now (a key they would rather not
               * keep, a certificate their own scanner is unhappy with, a
               * domain that went through a change upstream).
               */
              title: "Reissue SSL",
              buttonStyleType: ButtonStyleType.NORMAL,
              icon: IconProp.Refresh,
              isVisible: (item: DashboardDomain): boolean => {
                /*
                 * Only where there is a Let's Encrypt certificate of ours to
                 * replace. A custom certificate is the customer's own upload,
                 * and a domain that never ordered one still shows "Order Free
                 * SSL" instead.
                 */
                return Boolean(
                  !item.isCustomCertificate &&
                    item["isCnameVerified"] &&
                    item.isSslOrdered,
                );
              },
              onClick: async (
                item: DashboardDomain,
                onCompleteAction: VoidFunction,
                onError: ErrorFunction,
              ) => {
                try {
                  setShowReissueSSLModal(true);
                  setSelectedDashboardDomain(item);
                  onCompleteAction();
                } catch (err) {
                  onCompleteAction();
                  setSelectedDashboardDomain(null);
                  onError(err as Error);
                }
              },
            },
          ]}
          noItemsMessage={"No custom domains found."}
          viewPageRoute={Navigation.getCurrentRoute()}
          selectMoreFields={{
            isSslOrdered: true,
            isSslProvisioned: true,
            isCnameVerified: true,
            isCustomCertificate: true,
            // Read by the reissue modal to show the cooldown before it is hit.
            certificateReissueRequestedAt: true,
          }}
          formSteps={[
            {
              title: "Basic",
              id: "basic",
            },
            {
              title: "More",
              id: "more",
            },
          ]}
          formFields={[
            {
              field: {
                subdomain: true,
              },
              title: "Subdomain",
              fieldType: FormFieldSchemaType.Text,
              required: false,
              placeholder: "dashboard (leave blank for root)",
              description:
                "Enter the subdomain label only (for example, dashboard). Leave blank or enter @ to use the root/apex domain.",
              stepId: "basic",
              disableSpellCheck: true,
            },
            {
              field: {
                domain: true,
              },
              title: "Domain",
              description:
                "Please select a verified domain from this list. If you do not see any domains in this list, please head over to More -> Project Settings -> Custom Domains to add one.",
              fieldType: FormFieldSchemaType.Dropdown,
              dropdownModal: {
                type: Domain,
                labelField: "domain",
                valueField: "_id",
              },
              required: true,
              placeholder: "Select domain",
              stepId: "basic",
            },
            {
              field: {
                isCustomCertificate: true,
              },
              title: "Upload Custom Certificate",
              fieldType: FormFieldSchemaType.Toggle,
              required: false,
              defaultValue: false,
              stepId: "more",
              description:
                "If you have a custom certificate, you can upload it here. If you do not have a certificate, we will order a free SSL certificate for you.",
            },
            {
              field: {
                customCertificate: true,
              },
              title: "Certificate",
              fieldType: FormFieldSchemaType.LongText,
              required: false,
              stepId: "more",
              placeholder:
                "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----",
              disableSpellCheck: true,
              showIf: (item: FormValues<DashboardDomain>): boolean => {
                return Boolean(item.isCustomCertificate);
              },
            },
            {
              field: {
                customCertificateKey: true,
              },
              title: "Certificate Private Key",
              fieldType: FormFieldSchemaType.LongText,
              required: false,
              placeholder:
                "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----",
              stepId: "more",
              disableSpellCheck: true,
              showIf: (item: FormValues<DashboardDomain>): boolean => {
                return Boolean(item.isCustomCertificate);
              },
            },
          ]}
          showRefreshButton={true}
          filters={[
            {
              field: {
                fullDomain: true,
              },
              title: "Domain",
              type: FieldType.Text,
            },
            {
              field: {},
              title: "CNAME Valid",
              type: FieldType.Boolean,
            },
            {
              field: {},
              title: "SSL Provisioned",
              type: FieldType.Boolean,
            },
          ]}
          columns={[
            {
              field: {
                fullDomain: true,
              },
              title: "Domain",
              type: FieldType.Text,
            },
            {
              field: {
                isCnameVerified: true,
              },
              title: "Status",
              type: FieldType.Element,

              getElement: (item: DashboardDomain): ReactElement => {
                if (!item.isCnameVerified) {
                  return (
                    <span>
                      <span className="font-semibold">
                        {translator.translateText("Action Required:")}
                      </span>{" "}
                      {translator.translateText(
                        "Please add your CNAME record.",
                      )}
                    </span>
                  );
                }

                if (item.isCustomCertificate) {
                  return (
                    <span>
                      {translator.translateText(
                        "No action is required. Please allow 30 minutes for the certificate to be provisioned.",
                      )}
                    </span>
                  );
                }

                /*
                 * The DashboardCerts worker orders it. "Order Free SSL" on the
                 * row is only a shortcut for not waiting.
                 */
                if (!item.isSslOrdered) {
                  return (
                    <span>
                      {translator.translateText(
                        "No action is required. We will order a free SSL certificate for this domain automatically, usually within 15 minutes.",
                      )}
                    </span>
                  );
                }

                if (!item.isSslProvisioned) {
                  return (
                    <span>
                      {translator.translateText(
                        "No action is required. This SSL certificate will be provisioned in 1 hour. If this does not happen. Please contact support.",
                      )}
                    </span>
                  );
                }

                return (
                  <span>
                    {translator.translateText(
                      "Certificate Provisioned. We will automatically renew this certificate. No action required.",
                    )}
                  </span>
                );
              },
            },
          ]}
        />

        {selectedDashboardDomain?.fullDomain && showCnameModal && (
          <ConfirmModal
            title={`Add CNAME`}
            description={
              DashboardCNameRecord ? (
                <div>
                  <span>
                    {translator.translateText(
                      "Please add CNAME record to your domain. Details of the CNAME records are:",
                    )}
                  </span>
                  <br />
                  <br />
                  <span>
                    <b>{translator.translateText("Record Type:")} </b> CNAME
                  </span>
                  <br />
                  <span>
                    <b>{translator.translateText("Name:")} </b>
                    {selectedDashboardDomain?.fullDomain}
                  </span>
                  <br />
                  <span>
                    <b>{translator.translateText("Content:")} </b>
                    {DashboardCNameRecord}
                  </span>
                  <br />
                  <br />
                  <span>
                    {translator.translateText(
                      "We check for this record every 15 minutes and verify your domain automatically once it is live. To check right away, click Verify CNAME.",
                    )}
                  </span>
                </div>
              ) : (
                <div>
                  <span>
                    <TranslatedSentence
                      template="Custom Domains not enabled for this OneUptime installation. Please contact your server admin to enable this feature. To enable this feature, if you are using Docker compose, the {{variable}} environment variable must be set when starting the OneUptime cluster. If you are using Helm and Kubernetes then set dashboard.cnameRecord in the values.yaml file."
                      slots={{ variable: <b>DASHBOARD_CNAME_RECORD</b> }}
                    />
                  </span>
                </div>
              )
            }
            submitButtonText={"Verify CNAME"}
            onClose={() => {
              setShowCnameModal(false);
              setError("");
              return setSelectedDashboardDomain(null);
            }}
            isLoading={verifyCnameLoading}
            error={error}
            onSubmit={async () => {
              try {
                setVerifyCnameLoading(true);
                setError("");

                const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
                  await API.get<JSONObject>({
                    url: URL.fromString(APP_API_URL.toString()).addRoute(
                      `/${
                        new DashboardDomain().crudApiPath
                      }/verify-cname/${selectedDashboardDomain?.id?.toString()}`,
                    ),
                    data: {},
                    headers: ModelAPI.getCommonHeaders(),
                  });

                if (response.isFailure()) {
                  throw response;
                }

                setShowCnameModal(false);
                setRefreshToggle(OneUptimeDate.getCurrentDate().toString());
                setSelectedDashboardDomain(null);
              } catch (err) {
                setError(API.getFriendlyMessage(err));
              }

              setVerifyCnameLoading(false);
            }}
          />
        )}

        {showOrderSSLModal && selectedDashboardDomain && (
          <ConfirmModal
            title={`Order Free SSL Certificate for this Dashboard`}
            description={
              DashboardCNameRecord ? (
                <div>
                  {translator.translateText(
                    "We order a free SSL certificate from Let's Encrypt for this domain automatically. To order it now instead of waiting, click the button below. The certificate is served within 15 minutes of being ordered.",
                  )}
                </div>
              ) : (
                <div>
                  <span>
                    {translator.translateText(
                      "Custom Domains not enabled for this OneUptime installation. Please contact your server admin to enable this feature.",
                    )}
                  </span>
                </div>
              )
            }
            submitButtonText={"Order Free SSL"}
            onClose={() => {
              setShowOrderSSLModal(false);
              setError("");
              return setSelectedDashboardDomain(null);
            }}
            isLoading={orderSslLoading}
            error={error}
            onSubmit={async () => {
              try {
                setOrderSslLoading(true);
                setError("");

                const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
                  await API.get<JSONObject>({
                    url: URL.fromString(APP_API_URL.toString()).addRoute(
                      `/${
                        new DashboardDomain().crudApiPath
                      }/order-ssl/${selectedDashboardDomain?.id?.toString()}`,
                    ),
                    data: {},
                    headers: ModelAPI.getCommonHeaders(),
                  });

                if (response.isFailure()) {
                  throw response;
                }

                setShowOrderSSLModal(false);
                setRefreshToggle(OneUptimeDate.getCurrentDate().toString());
                setSelectedDashboardDomain(null);
              } catch (err) {
                setError(API.getFriendlyMessage(err));
              }

              setOrderSslLoading(false);
            }}
          />
        )}

        {showReissueSSLModal && selectedDashboardDomain && (
          <ConfirmModal
            title={`Reissue SSL Certificate for this Dashboard`}
            description={
              !DashboardCNameRecord ? (
                <div>
                  <span>
                    {translator.translateText(
                      "Custom Domains not enabled for this OneUptime installation. Please contact your server admin to enable this feature.",
                    )}
                  </span>
                </div>
              ) : isReissueCoolingDown ? (
                <div>
                  {CertificateReissueUtil.getCooldownMessage(
                    selectedDashboardDomain.certificateReissueRequestedAt!,
                    OneUptimeDate.getCurrentDate(),
                  )}
                </div>
              ) : (
                <div>
                  {translator.translateText(
                    "We will ask Let's Encrypt for a brand new certificate for this domain, and replace the one we currently serve with it. Your dashboard stays online on the existing certificate while this happens, and the new certificate is served within 15 minutes.",
                  )}
                  <br />
                  <br />
                  {translator.translateTemplate(
                    "Certificates renew automatically well before they expire, so you do not need to do this to stay online. Because Let's Encrypt rate limits how often the same domain can be issued, a reissue can only be requested once every {{hours}} hours.",
                    { hours: CertificateReissueUtil.COOLDOWN_IN_HOURS },
                  )}
                </div>
              )
            }
            submitButtonText={"Reissue SSL Certificate"}
            disableSubmitButton={isReissueCoolingDown}
            onClose={() => {
              setShowReissueSSLModal(false);
              setError("");
              return setSelectedDashboardDomain(null);
            }}
            isLoading={reissueSslLoading}
            error={error}
            onSubmit={async () => {
              try {
                setReissueSslLoading(true);
                setError("");

                const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
                  await API.get<JSONObject>({
                    url: URL.fromString(APP_API_URL.toString()).addRoute(
                      `/${
                        new DashboardDomain().crudApiPath
                      }/reissue-ssl/${selectedDashboardDomain?.id?.toString()}`,
                    ),
                    data: {},
                    headers: ModelAPI.getCommonHeaders(),
                  });

                if (response.isFailure()) {
                  throw response;
                }

                setShowReissueSSLModal(false);
                setRefreshToggle(OneUptimeDate.getCurrentDate().toString());
                setSelectedDashboardDomain(null);
              } catch (err) {
                setError(API.getFriendlyMessage(err));
              }

              setReissueSslLoading(false);
            }}
          />
        )}
      </>
    </Fragment>
  );
};

export default DashboardCustomDomains;
