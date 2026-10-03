import PageComponentProps from "../../PageComponentProps";
import {
  getStatusPageCustomDomainState,
  isStatusPageCustomDomainDnsSetupAvailable,
  StatusPageCustomDomainCopy,
  StatusPageCustomDomainState,
} from "../../../Components/StatusPage/CustomDomain/StatusPageCustomDomainCopy";
import StatusPageDomainDnsSetupModal from "../../../Components/StatusPage/CustomDomain/StatusPageDomainDnsSetupModal";
import StatusPageCustomDomainStatus from "../../../Components/StatusPage/CustomDomain/StatusPageCustomDomainStatus";
import CustomDomainCertificates, {
  CustomDomainCertificate,
} from "Common/Types/StatusPage/CustomDomainCertificates";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import BadDataException from "Common/Types/Exception/BadDataException";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import { ModalType } from "Common/UI/Components/ModelTable/BaseModelTable";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import { APP_API_URL, StatusPageCNameRecord } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import Domain from "Common/Models/DatabaseModels/Domain";
import StatusPageDomain from "Common/Models/DatabaseModels/StatusPageDomain";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useRef,
  useState,
} from "react";
import OneUptimeDate from "Common/Types/Date";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ProjectUtil from "Common/UI/Utils/Project";
import CertificateReissueUtil from "Common/Utils/CertificateReissue";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

/*
 * The certificate options, folded: nearly every domain runs on the free
 * certificate we issue and renew, and the folded header says so. Built once,
 * so the fields in it are one section (FormStepsScan reads them that way).
 */
const certificateSection: FormFieldCollapsibleSection<StatusPageDomain> =
  getAdvancedFormSection<StatusPageDomain>({
    getSummary: (values: FormValues<StatusPageDomain>): Array<string> => {
      return [
        values.isCustomCertificate
          ? StatusPageCustomDomainCopy.advancedSummaryUploadedCertificate
          : StatusPageCustomDomainCopy.advancedSummaryFreeCertificate,
      ];
    },
  });

const StatusPageDomains: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [refreshToggle, setRefreshToggle] = useState<string>(
    OneUptimeDate.getCurrentDate().toString(),
  );

  // The domain whose DNS Setup dialog is open.
  const [dnsSetupDomain, setDnsSetupDomain] = useState<StatusPageDomain | null>(
    null,
  );

  const [selectedStatusPageDomain, setSelectedStatusPageDomain] =
    useState<StatusPageDomain | null>(null);

  const [error, setError] = useState<string>("");

  /*
   * Each listed domain's certificate - its expiry, and why its last order
   * failed - by domain id. Read whenever the table loads its rows, so the
   * Status column is never older than the rows. Until it is read, or when
   * reading it fails, each row shows what its own flags say.
   */
  const [certificates, setCertificates] = useState<
    Map<string, CustomDomainCertificate>
  >(new Map<string, CustomDomainCertificate>());

  const certificatesRequest: React.MutableRefObject<number> = useRef<number>(0);

  const loadCertificates: () => Promise<void> = async (): Promise<void> => {
    const request: number = ++certificatesRequest.current;

    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.get<JSONObject>({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            `/${new StatusPageDomain().crudApiPath}/certificates/${modelId.toString()}`,
          ),
          data: {},
          headers: ModelAPI.getCommonHeaders(),
        });

      if (response.isFailure() || request !== certificatesRequest.current) {
        return;
      }

      setCertificates(
        CustomDomainCertificates.fromJSON(response.data as JSONObject),
      );
    } catch {
      // The Status column falls back to each row's own flags.
    }
  };

  const certificateOf: (
    domain: StatusPageDomain,
  ) => CustomDomainCertificate | undefined = (
    domain: StatusPageDomain,
  ): CustomDomainCertificate | undefined => {
    return domain.id ? certificates.get(domain.id.toString()) : undefined;
  };

  const [showReissueSSLModal, setShowReissueSSLModal] =
    useState<boolean>(false);

  const [reissueSslLoading, setReissueSslLoading] = useState<boolean>(false);

  /*
   * The server enforces the cooldown; this is only so the button explains
   * itself before it is pressed rather than after the request comes back
   * rejected. Both sides read the same helper, so they cannot disagree.
   */
  const isReissueCoolingDown: boolean = CertificateReissueUtil.isInCooldown(
    selectedStatusPageDomain?.certificateReissueRequestedAt,
    OneUptimeDate.getCurrentDate(),
  );

  const refreshTable: VoidFunction = (): void => {
    setRefreshToggle(OneUptimeDate.getCurrentDate().toString());
  };

  /*
   * Open DNS Setup on a domain that was just added: adding the record is
   * the next step, and the only one its owner has to take. The create
   * answer carries the new row; should it lack the domain's name (a role
   * that may add domains but not read them), the row is read once more.
   */
  const openDnsSetupForNewDomain: (
    createdDomain: StatusPageDomain,
  ) => Promise<void> = async (
    createdDomain: StatusPageDomain,
  ): Promise<void> => {
    if (createdDomain.fullDomain) {
      setDnsSetupDomain(createdDomain);
      return;
    }

    if (!createdDomain.id) {
      return;
    }

    try {
      const fetchedDomain: StatusPageDomain | null =
        await ModelAPI.getItem<StatusPageDomain>({
          modelType: StatusPageDomain,
          id: createdDomain.id,
          select: {
            _id: true,
            fullDomain: true,
            subdomain: true,
            isCustomCertificate: true,
          },
        });

      if (fetchedDomain?.fullDomain) {
        setDnsSetupDomain(fetchedDomain);
      }
    } catch {
      // The row action opens it too; the new row is in the table already.
    }
  };

  return (
    <Fragment>
      <>
        <ModelTable<StatusPageDomain>
          modelType={StatusPageDomain}
          query={{
            projectId: ProjectUtil.getCurrentProjectId()!,
            statusPageId: modelId,
          }}
          name="Status Page > Domains"
          userPreferencesKey="status-page-domains-table"
          id="domains-table"
          saveFilterProps={{
            tableId: "status-page-domains-table",
          }}
          isDeleteable={true}
          isCreateable={true}
          isEditable={true}
          cardProps={{
            title: "Custom Domains",
            description: StatusPageCNameRecord
              ? translator.translateTemplate(
                  StatusPageCustomDomainCopy.cardDescription,
                  { cnameRecord: StatusPageCNameRecord },
                )
              : StatusPageCustomDomainCopy.cardDescriptionNotEnabled,
          }}
          refreshToggle={refreshToggle}
          onFetchSuccess={() => {
            void loadCertificates();
          }}
          onBeforeCreate={(
            item: StatusPageDomain,
          ): Promise<StatusPageDomain> => {
            if (!props.currentProject || !props.currentProject._id) {
              throw new BadDataException("Project ID cannot be null");
            }
            item.statusPageId = modelId;
            item.projectId = new ObjectID(props.currentProject._id);
            return Promise.resolve(item);
          }}
          onCreateSuccess={async (
            item: StatusPageDomain,
            modalType?: ModalType,
          ): Promise<StatusPageDomain> => {
            if (modalType === ModalType.Create) {
              await openDnsSetupForNewDomain(item);
            }

            return item;
          }}
          actionButtons={[
            {
              title: StatusPageCustomDomainCopy.dnsSetupTitle,
              buttonStyleType: ButtonStyleType.SUCCESS_OUTLINE,
              icon: IconProp.Globe,
              /*
               * Until the record is verified, and on a verified domain
               * whose free certificate is not in place: not ordered yet, an
               * order that keeps failing (a CAA record, a server Let's
               * Encrypt cannot reach), or a certificate that has expired.
               * Check now orders it again and says why it failed.
               */
              isVisible: (item: StatusPageDomain): boolean => {
                return isStatusPageCustomDomainDnsSetupAvailable(
                  item,
                  certificateOf(item),
                );
              },
              onClick: async (
                item: StatusPageDomain,
                onCompleteAction: VoidFunction,
                onError: ErrorFunction,
              ) => {
                try {
                  setDnsSetupDomain(item);
                  onCompleteAction();
                } catch (err) {
                  onCompleteAction();
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
              isVisible: (item: StatusPageDomain): boolean => {
                /*
                 * Only where there is a Let's Encrypt certificate of ours to
                 * replace. A custom certificate is the customer's own upload,
                 * and a domain whose first certificate is not ordered yet
                 * gets one on its own.
                 */
                return Boolean(
                  !item.isCustomCertificate &&
                    item["isCnameVerified"] &&
                    item.isSslOrdered,
                );
              },
              onClick: async (
                item: StatusPageDomain,
                onCompleteAction: VoidFunction,
                onError: ErrorFunction,
              ) => {
                try {
                  setShowReissueSSLModal(true);
                  setSelectedStatusPageDomain(item);
                  onCompleteAction();
                } catch (err) {
                  onCompleteAction();
                  setSelectedStatusPageDomain(null);
                  onError(err as Error);
                }
              },
            },
          ]}
          noItemsMessage={"No custom domains found."}
          viewPageRoute={Navigation.getCurrentRoute()}
          selectMoreFields={{
            subdomain: true,
            isSslOrdered: true,
            isSslProvisioned: true,
            isCnameVerified: true,
            isCustomCertificate: true,
            // Read by the reissue modal to show the cooldown before it is hit.
            certificateReissueRequestedAt: true,
          }}
          formFields={[
            {
              field: {
                subdomain: true,
              },
              title: "Subdomain",
              fieldType: FormFieldSchemaType.Text,
              required: false,
              placeholder: "status (leave blank for root)",
              description:
                "Enter the subdomain label only (for example, status). Leave blank or enter @ to use the root/apex domain.",
              disableSpellCheck: true,
              /*
               * The full domain is worked out when the domain is added and
               * never again, so a subdomain changed afterwards would change
               * nothing. A different subdomain is a different domain: add it.
               */
              doNotShowWhenEditing: true,
            },
            {
              field: {
                domain: true,
              },
              title: "Domain",
              description: StatusPageCustomDomainCopy.domainFieldDescription,
              sideLink: {
                text: StatusPageCustomDomainCopy.domainFieldSideLink,
                url: RouteUtil.populateRouteParams(
                  RouteMap[PageMap.SETTINGS_DOMAINS] as Route,
                ),
                openLinkInNewTab: true,
              },
              fieldType: FormFieldSchemaType.Dropdown,
              /*
               * Verified domains only: the server refuses any other, so
               * listing them only led to "This domain is not verified" after
               * the form was filled in.
               */
              dropdownModal: {
                type: Domain,
                labelField: "domain",
                valueField: "_id",
                query: {
                  isVerified: true,
                },
                sort: {
                  domain: SortOrder.Ascending,
                },
              },
              required: true,
              placeholder: "Select domain",
            },
            {
              field: {
                isCustomCertificate: true,
              },
              title: "Upload Custom Certificate",
              fieldType: FormFieldSchemaType.Toggle,
              required: false,
              defaultValue: false,
              description:
                "If you have a custom certificate, you can upload it here. If you do not have a certificate, we will order a free SSL certificate for you.",
              collapsibleSection: certificateSection,
            },
            {
              field: {
                customCertificate: true,
              },
              title: "Certificate",
              fieldType: FormFieldSchemaType.LongText,
              required: (item: FormValues<StatusPageDomain>): boolean => {
                return Boolean(item.isCustomCertificate);
              },
              placeholder:
                "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----",
              disableSpellCheck: true,
              showIf: (item: FormValues<StatusPageDomain>): boolean => {
                return Boolean(item.isCustomCertificate);
              },
              collapsibleSection: certificateSection,
            },
            {
              field: {
                customCertificateKey: true,
              },
              title: "Certificate Private Key",
              fieldType: FormFieldSchemaType.LongText,
              required: (item: FormValues<StatusPageDomain>): boolean => {
                return Boolean(item.isCustomCertificate);
              },
              placeholder:
                "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----",
              disableSpellCheck: true,
              showIf: (item: FormValues<StatusPageDomain>): boolean => {
                return Boolean(item.isCustomCertificate);
              },
              collapsibleSection: certificateSection,
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

              getElement: (item: StatusPageDomain): ReactElement => {
                return (
                  <StatusPageCustomDomainStatus
                    domain={item}
                    certificate={certificateOf(item)}
                  />
                );
              },
            },
          ]}
        />

        {dnsSetupDomain ? (
          <StatusPageDomainDnsSetupModal
            domain={dnsSetupDomain}
            hasExpiredCertificate={
              getStatusPageCustomDomainState(
                dnsSetupDomain,
                certificateOf(dnsSetupDomain),
              ) === StatusPageCustomDomainState.CertificateExpired
            }
            onClose={() => {
              setDnsSetupDomain(null);
            }}
            onVerified={refreshTable}
          />
        ) : (
          <></>
        )}

        {showReissueSSLModal && selectedStatusPageDomain && (
          <ConfirmModal
            title={`Reissue SSL Certificate for this Status Page`}
            description={
              !StatusPageCNameRecord ? (
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
                    selectedStatusPageDomain.certificateReissueRequestedAt!,
                    OneUptimeDate.getCurrentDate(),
                  )}
                </div>
              ) : (
                <div>
                  {translator.translateText(
                    "We will ask Let's Encrypt for a brand new certificate for this domain, and replace the one we currently serve with it. Your status page stays online on the existing certificate while this happens, and the new certificate is served within 15 minutes.",
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
              return setSelectedStatusPageDomain(null);
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
                        new StatusPageDomain().crudApiPath
                      }/reissue-ssl/${selectedStatusPageDomain?.id?.toString()}`,
                    ),
                    data: {},
                    headers: ModelAPI.getCommonHeaders(),
                  });

                if (response.isFailure()) {
                  throw response;
                }

                setShowReissueSSLModal(false);
                refreshTable();
                setSelectedStatusPageDomain(null);
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

export default StatusPageDomains;
