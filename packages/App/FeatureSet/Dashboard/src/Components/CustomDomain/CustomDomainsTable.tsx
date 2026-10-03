import {
  CustomDomainCopy,
  CustomDomainState,
  getCustomDomainState,
  isCustomDomainDnsSetupAvailable,
} from "./CustomDomainCopy";
import { CustomDomainKind, CustomDomainModel } from "./CustomDomainKinds";
import CustomDomainDnsSetupModal from "./CustomDomainDnsSetupModal";
import CustomDomainStatus from "./CustomDomainStatus";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import CustomDomainCertificates, {
  CustomDomainCertificate,
} from "Common/Types/CustomDomain/CustomDomainCertificates";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import Query from "Common/Types/BaseDatabase/Query";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import BadDataException from "Common/Types/Exception/BadDataException";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import { ModalType } from "Common/UI/Components/ModelTable/BaseModelTable";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import CertificateReissueUtil from "Common/Utils/CertificateReissue";
import Domain from "Common/Models/DatabaseModels/Domain";
import Project from "Common/Models/DatabaseModels/Project";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useRef,
  useState,
} from "react";

/*
 * The Custom Domains table of a status page and of a dashboard: one table, so
 * the two pages that do the same job read and work the same. The dashboard
 * page kept "Add CNAME", "Order Free SSL" and its own Status wording after
 * the status page lost them, because each page had its own copy of this.
 *
 *   - Adding a domain is one page: the subdomain and one of the project's
 *     verified domains, with the certificate options folded under
 *     Advanced. The new domain's DNS Setup opens as soon as it is added.
 *   - DNS Setup shows the record to add, and its Check now verifies it and
 *     orders the free certificate on the spot. Nothing asks for an order.
 *   - The Status column says where each domain is on its way to HTTPS, with
 *     why an order failed when one did (the certificates route).
 *   - Reissue SSL stays, for a domain with a certificate of ours to replace.
 */

/*
 * The certificate options, folded: nearly every domain runs on the free
 * certificate we issue and renew, and the folded header says so. Built once,
 * so the fields in it are one section (FormStepsScan reads them that way).
 */
const certificateSection: FormFieldCollapsibleSection<CustomDomainModel> =
  getAdvancedFormSection<CustomDomainModel>({
    getSummary: (values: FormValues<CustomDomainModel>): Array<string> => {
      return [
        values.isCustomCertificate
          ? CustomDomainCopy.advancedSummaryUploadedCertificate
          : CustomDomainCopy.advancedSummaryFreeCertificate,
      ];
    },
  });

export interface ComponentProps {
  // Whose domains: a status page's or a dashboard's.
  kind: CustomDomainKind;
  // The status page or dashboard the domains belong to.
  parentId: ObjectID;
  currentProject: Project | null;
}

const CustomDomainsTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const kind: CustomDomainKind = props.kind;
  const cnameRecord: string = kind.getCnameRecord();
  const crudApiPath: string = new kind.modelType().crudApiPath?.toString() || "";

  const [refreshToggle, setRefreshToggle] = useState<string>(
    OneUptimeDate.getCurrentDate().toString(),
  );

  // The domain whose DNS Setup dialog is open.
  const [dnsSetupDomain, setDnsSetupDomain] =
    useState<CustomDomainModel | null>(null);

  const [selectedDomain, setSelectedDomain] =
    useState<CustomDomainModel | null>(null);

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
            `/${crudApiPath}/certificates/${props.parentId.toString()}`,
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
    domain: CustomDomainModel,
  ) => CustomDomainCertificate | undefined = (
    domain: CustomDomainModel,
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
    selectedDomain?.certificateReissueRequestedAt,
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
    createdDomain: CustomDomainModel,
  ) => Promise<void> = async (
    createdDomain: CustomDomainModel,
  ): Promise<void> => {
    if (createdDomain.fullDomain) {
      setDnsSetupDomain(createdDomain);
      return;
    }

    if (!createdDomain.id) {
      return;
    }

    try {
      const fetchedDomain: CustomDomainModel | null =
        await ModelAPI.getItem<CustomDomainModel>({
          modelType: kind.modelType,
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

  /*
   * The project's domains of this status page or dashboard. The column that
   * names it differs by kind, and the table's types know only the columns
   * both kinds have.
   */
  const query: Query<CustomDomainModel> = {
    projectId: ProjectUtil.getCurrentProjectId()!,
    [kind.parentColumn]: props.parentId,
  } as Query<CustomDomainModel>;

  return (
    <Fragment>
      <ModelTable<CustomDomainModel>
        modelType={kind.modelType}
        query={query}
        name={kind.tableName}
        userPreferencesKey={kind.userPreferencesKey}
        id={kind.tableId}
        saveFilterProps={{
          tableId: kind.saveFilterTableId,
        }}
        isDeleteable={true}
        isCreateable={true}
        isEditable={true}
        cardProps={{
          title: "Custom Domains",
          description: cnameRecord
            ? translator.translateTemplate(kind.copy.cardDescription, {
                cnameRecord: cnameRecord,
              })
            : CustomDomainCopy.cardDescriptionNotEnabled,
        }}
        refreshToggle={refreshToggle}
        onFetchSuccess={() => {
          void loadCertificates();
        }}
        onBeforeCreate={(
          item: CustomDomainModel,
        ): Promise<CustomDomainModel> => {
          if (!props.currentProject || !props.currentProject._id) {
            throw new BadDataException("Project ID cannot be null");
          }

          (item as unknown as Record<string, unknown>)[kind.parentColumn] =
            props.parentId;
          item.projectId = new ObjectID(props.currentProject._id);
          return Promise.resolve(item);
        }}
        onCreateSuccess={async (
          item: CustomDomainModel,
          modalType?: ModalType,
        ): Promise<CustomDomainModel> => {
          if (modalType === ModalType.Create) {
            await openDnsSetupForNewDomain(item);
          }

          return item;
        }}
        actionButtons={[
          {
            title: CustomDomainCopy.dnsSetupTitle,
            buttonStyleType: ButtonStyleType.SUCCESS_OUTLINE,
            icon: IconProp.Globe,
            /*
             * Until the record is verified, and on a verified domain whose
             * free certificate is not in place: not ordered yet, an order
             * that keeps failing (a CAA record, a server Let's Encrypt
             * cannot reach), or a certificate that has expired. Check now
             * orders it again and says why it failed.
             */
            isVisible: (item: CustomDomainModel): boolean => {
              return isCustomDomainDnsSetupAvailable(item, certificateOf(item));
            },
            onClick: async (
              item: CustomDomainModel,
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
            isVisible: (item: CustomDomainModel): boolean => {
              /*
               * Only where there is a Let's Encrypt certificate of ours to
               * replace. A custom certificate is the customer's own upload,
               * and a domain whose first certificate is not ordered yet
               * gets one on its own.
               */
              return Boolean(
                !item.isCustomCertificate &&
                  item.isCnameVerified &&
                  item.isSslOrdered,
              );
            },
            onClick: async (
              item: CustomDomainModel,
              onCompleteAction: VoidFunction,
              onError: ErrorFunction,
            ) => {
              try {
                setShowReissueSSLModal(true);
                setSelectedDomain(item);
                onCompleteAction();
              } catch (err) {
                onCompleteAction();
                setSelectedDomain(null);
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
            placeholder: kind.copy.subdomainPlaceholder,
            description: kind.copy.subdomainDescription,
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
            description: CustomDomainCopy.domainFieldDescription,
            sideLink: {
              text: CustomDomainCopy.domainFieldSideLink,
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
            required: (item: FormValues<CustomDomainModel>): boolean => {
              return Boolean(item.isCustomCertificate);
            },
            placeholder:
              "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----",
            disableSpellCheck: true,
            showIf: (item: FormValues<CustomDomainModel>): boolean => {
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
            required: (item: FormValues<CustomDomainModel>): boolean => {
              return Boolean(item.isCustomCertificate);
            },
            placeholder:
              "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----",
            disableSpellCheck: true,
            showIf: (item: FormValues<CustomDomainModel>): boolean => {
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
          /*
           * These two had no column behind them (field: {}), so picking Yes
           * or No filtered nothing.
           */
          {
            field: {
              isCnameVerified: true,
            },
            title: "CNAME Valid",
            type: FieldType.Boolean,
          },
          {
            field: {
              isSslProvisioned: true,
            },
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

            getElement: (item: CustomDomainModel): ReactElement => {
              return (
                <CustomDomainStatus
                  domain={item}
                  certificate={certificateOf(item)}
                />
              );
            },
          },
        ]}
      />

      {dnsSetupDomain ? (
        <CustomDomainDnsSetupModal
          kind={kind}
          domain={dnsSetupDomain}
          hasExpiredCertificate={
            getCustomDomainState(
              dnsSetupDomain,
              certificateOf(dnsSetupDomain),
            ) === CustomDomainState.CertificateExpired
          }
          onClose={() => {
            setDnsSetupDomain(null);
          }}
          onVerified={refreshTable}
        />
      ) : (
        <></>
      )}

      {showReissueSSLModal && selectedDomain && (
        <ConfirmModal
          title={kind.copy.reissueTitle}
          description={
            !cnameRecord ? (
              <div>
                <span>
                  {translator.translateText(
                    CustomDomainCopy.cardDescriptionNotEnabled,
                  )}
                </span>
              </div>
            ) : isReissueCoolingDown ? (
              <div>
                {CertificateReissueUtil.getCooldownMessage(
                  selectedDomain.certificateReissueRequestedAt!,
                  OneUptimeDate.getCurrentDate(),
                )}
              </div>
            ) : (
              <div>
                {translator.translateText(kind.copy.reissueDescription)}
                <br />
                <br />
                {translator.translateTemplate(
                  CustomDomainCopy.reissueRateLimit,
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
            return setSelectedDomain(null);
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
                    `/${crudApiPath}/reissue-ssl/${selectedDomain?.id?.toString()}`,
                  ),
                  data: {},
                  headers: ModelAPI.getCommonHeaders(),
                });

              if (response.isFailure()) {
                throw response;
              }

              setShowReissueSSLModal(false);
              refreshTable();
              setSelectedDomain(null);
            } catch (err) {
              setError(API.getFriendlyMessage(err));
            }

            setReissueSslLoading(false);
          }}
        />
      )}
    </Fragment>
  );
};

export default CustomDomainsTable;
