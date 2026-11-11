import {
  CUSTOM_DOMAIN_RECORD_TYPE,
  CUSTOM_DOMAIN_VERIFIED_NEXT,
  CustomDomainCopy,
  CustomDomainInstallation,
  DNS_SETUP_TEST_IDS,
} from "./CustomDomainCopy";
import {
  CustomDomainKind,
  getCustomDomainInstallation,
} from "./CustomDomainKinds";
import CustomDomainRecords, { CustomDomainRecord } from "./CustomDomainRecords";
import CustomDomainServerReadinessNotice from "./CustomDomainServerReadinessNotice";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import {
  CustomDomainCertificateStatus,
  CustomDomainVerificationResult,
} from "Common/Types/CustomDomain/CustomDomainVerification";
import CustomDomainDnsCheckResultJSON, {
  CustomDomainDnsCheckResult,
} from "Common/Types/CustomDomain/CustomDomainDnsCheckResult";
import {
  DnsRecordCheck,
  DnsRecordCheckOutcome,
  DnsRecordType,
} from "Common/Types/CustomDomain/DnsRecordCheck";
import {
  DnsRecordCheckDescription,
  describeDnsRecordCheck,
} from "Common/Types/CustomDomain/DnsRecordCheckWords";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Modal from "Common/UI/Components/Modal/Modal";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { PermissionGateResult } from "Common/UI/Utils/PermissionGate";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * DNS Setup: the records only a custom domain's owner can add, each with its
 * own status, and one Check now for all of them. The same dialog for a
 * status page's custom domains, a dashboard's and a form's.
 *
 * It opens by itself on a domain that was just added, and from the domain's
 * DNS Setup row action until the record is verified. Each record is shown
 * field by field, the way DNS providers ask for it, each with a copy
 * button.
 *
 * Two records, while the project has not verified the custom domain's
 * domain yet (Add Custom Domain opens it that way): the TXT record that
 * proves the project owns example.com, then the CNAME record that points
 * status.example.com here. Check now checks the TXT first (the domain's
 * check-txt); once it is found, adds the custom domain and checks its CNAME.
 * Nobody leaves the status page to verify a domain in Project Settings.
 *
 * Check now looks the records up at once (the sweeps check every 15 minutes
 * anyway) and says, record by record, what it looked up and what came back
 * (DnsRecordCheck): "We looked up the CNAME record of status.example.com
 * and got other.example.net, but expected ...". The server orders the
 * domain's free certificate the moment its CNAME is found; the dialog then
 * says what happens to the certificate next instead of closing on a guess.
 *
 * Check now changes the domain - it verifies it and orders its
 * certificate - so it is for whoever may edit the domain, as the server
 * holds it. Anyone else who opens the dialog still gets the records to add,
 * with Check now locked and the reason under it.
 *
 * On a self-hosted server, what the server still needs before any custom
 * domain can work is said above the records (CustomDomainServerReadiness).
 */

// What the dialog reads of the domain's row.
export interface CustomDomainDnsSetupDomain {
  id?: ObjectID | null | undefined;
  fullDomain?: string | undefined;
  subdomain?: string | undefined;
  isCustomCertificate?: boolean | undefined;
  isCnameVerified?: boolean | undefined;
}

// The project's domain whose TXT record is still to be found.
export interface CustomDomainDnsSetupProjectDomain {
  id: ObjectID;
  // Its name: example.com.
  domain: string;
  // The TXT record's value that verifies it.
  verificationText: string;
}

export interface ComponentProps {
  // Whose domain: a status page's, a dashboard's or a form's.
  kind: CustomDomainKind;
  /*
   * The custom domain. Without an id it is not added yet: it is added by
   * createCustomDomain once projectDomain is verified.
   */
  domain: CustomDomainDnsSetupDomain;
  // The domain's free certificate has expired: its renewals keep failing.
  hasExpiredCertificate?: boolean | undefined;
  /*
   * Whether the viewer may press Check now - may edit the domain - and if
   * not, why. With no reason to give (the permission snapshot has not
   * arrived) there is no Check now at all rather than a locked one.
   */
  checkNowGate: PermissionGateResult;
  /*
   * The project's domain, while it is not verified: its TXT record is
   * shown first, and checked first.
   */
  projectDomain?: CustomDomainDnsSetupProjectDomain | undefined;
  // Whether the viewer may verify the project's domain, and if not, why.
  verifyDomainGate?: PermissionGateResult | undefined;
  // Adds the custom domain once its project domain is verified.
  createCustomDomain?:
    | (() => Promise<CustomDomainDnsSetupDomain>)
    | undefined;
  onClose: () => void;
  // Check now found the record: what shows the domain's status is stale.
  onVerified: () => void;
  // The custom domain was added from this dialog: the table is stale.
  onCreated?: ((domain: CustomDomainDnsSetupDomain) => void) | undefined;
}

// A CNAME that waits for the TXT before it: what its status says.
const cnameNotCheckedYet: (name: string, target: string) => DnsRecordCheck = (
  name: string,
  target: string,
): DnsRecordCheck => {
  return {
    type: DnsRecordType.CNAME,
    name: name,
    expectedValue: target,
    foundValues: [],
    outcome: DnsRecordCheckOutcome.NotCheckedYet,
    checkedAt: OneUptimeDate.getCurrentDate(),
  };
};

const CustomDomainDnsSetupModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const [isChecking, setIsChecking] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [result, setResult] = useState<CustomDomainVerificationResult | null>(
    null,
  );

  // The custom domain, once it is added (from this dialog, or before it).
  const [customDomain, setCustomDomain] =
    useState<CustomDomainDnsSetupDomain>(props.domain);

  // What the last Check now found, record by record.
  const [txtCheck, setTxtCheck] = useState<DnsRecordCheck | undefined>(
    undefined,
  );
  const [cnameCheck, setCnameCheck] = useState<DnsRecordCheck | undefined>(
    undefined,
  );

  const [isProjectDomainVerified, setIsProjectDomainVerified] =
    useState<boolean>(!props.projectDomain);

  const cnameRecord: string = props.kind.getCnameRecord();

  const fullDomain: string = props.domain.fullDomain?.toString() || "";

  const domainSlot: ReactElement = (
    <span className="font-semibold text-gray-900">{fullDomain}</span>
  );

  /*
   * Whether this installation issues free certificates: without a Let's
   * Encrypt account key it issues none, and the dialog promises none.
   */
  const installation: CustomDomainInstallation = getCustomDomainInstallation();

  /*
   * What happens next, for where the domain is: a verified one is here
   * because its free certificate is not in place - an order that keeps
   * failing, or a certificate that has expired - and Check now tries again
   * and says why.
   */
  const whatHappensNext: string = !customDomain.id
    ? CustomDomainCopy.dnsSetupWhatHappensNextTwoRecords
    : props.domain.isCustomCertificate
      ? CustomDomainCopy.dnsSetupWhatHappensNextUploaded
    : !installation.issuesFreeCertificates
      ? CustomDomainCopy.dnsSetupWhatHappensNextWithoutFreeCertificate
      : props.domain.isCnameVerified
        ? props.hasExpiredCertificate
          ? CustomDomainCopy.dnsSetupVerifiedExpired
          : CustomDomainCopy.dnsSetupVerifiedNotIssued
        : CustomDomainCopy.dnsSetupWhatHappensNext;

  // The subdomain is empty for the domain itself ("@" when it was added).
  const isRootDomain: boolean =
    typeof props.domain.subdomain === "string" &&
    props.domain.subdomain.trim() === "";

  /*
   * Check now's gate: while the project's domain waits for its TXT record,
   * verifying it comes first, and takes what editing project domains takes.
   */
  const gate: PermissionGateResult =
    props.projectDomain && !isProjectDomainVerified && props.verifyDomainGate
      ? props.verifyDomainGate
      : props.checkNowGate;

  const canCheckNow: boolean = gate.isAllowed;

  const checkNowLockedReason: string | undefined = canCheckNow
    ? undefined
    : gate.disabledReason;

  const showsCheckNow: boolean = canCheckNow || Boolean(checkNowLockedReason);

  const getCheckResult: (route: string) => Promise<CustomDomainDnsCheckResult> =
    async (route: string): Promise<CustomDomainDnsCheckResult> => {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.get<JSONObject>({
          url: URL.fromString(APP_API_URL.toString()).addRoute(route),
          data: {},
          headers: ModelAPI.getCommonHeaders(),
        });

      if (response.isFailure()) {
        throw response;
      }

      return CustomDomainDnsCheckResultJSON.fromJSON(
        response.data as JSONObject,
      );
    };

  const checkNow: () => Promise<void> = async (): Promise<void> => {
    if (!canCheckNow) {
      return;
    }

    setIsChecking(true);
    setError("");

    try {
      // The project's domain first: the custom domain cannot be added before.
      if (props.projectDomain && !isProjectDomainVerified) {
        const txt: CustomDomainDnsCheckResult = await getCheckResult(
          `/domain/check-txt/${props.projectDomain.id.toString()}`,
        );

        setTxtCheck(txt.records[0]);

        if (!txt.isVerified) {
          setCnameCheck(cnameNotCheckedYet(fullDomain, cnameRecord));
          return;
        }

        setIsProjectDomainVerified(true);
      }

      let domainToCheck: CustomDomainDnsSetupDomain = customDomain;

      if (!domainToCheck.id) {
        if (!props.createCustomDomain) {
          return;
        }

        domainToCheck = await props.createCustomDomain();
        setCustomDomain(domainToCheck);
        props.onCreated?.(domainToCheck);
      }

      const dns: CustomDomainDnsCheckResult = await getCheckResult(
        `/${new props.kind.modelType().crudApiPath}/check-dns/${domainToCheck.id?.toString()}`,
      );

      setCnameCheck(dns.records[0]);

      if (dns.isVerified) {
        setResult(
          dns.certificate || {
            certificateStatus: CustomDomainCertificateStatus.Issuing,
          },
        );
        props.onVerified();
      }
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setIsChecking(false);
    }
  };

  // An installation without this kind's CNAME record cannot verify any.
  if (!cnameRecord) {
    return (
      <Modal
        title={CustomDomainCopy.dnsSetupTitle}
        onClose={props.onClose}
        closeButtonText={CustomDomainCopy.dnsSetupClose}
      >
        <div className="space-y-4">
          <CustomDomainServerReadinessNotice kind={props.kind} />
          <p className="text-sm leading-6 text-gray-600">
            <TranslatedSentence
              template={props.kind.copy.dnsSetupNotEnabled}
              slots={{
                variable: (
                  <span className="font-semibold">
                    {props.kind.cnameRecordVariable}
                  </span>
                ),
              }}
            />
          </p>
        </div>
      </Modal>
    );
  }

  /*
   * On an installation that issues no free certificates, a verified domain
   * has no certificate on its way: whatever the order the server tried says,
   * the next step is the installation's own HTTPS, or an upload.
   */
  const isWithoutFreeCertificate: boolean = Boolean(
    result &&
      !installation.issuesFreeCertificates &&
      result.certificateStatus !== CustomDomainCertificateStatus.Uploaded,
  );

  if (result) {
    /*
     * A CNAME that is right, whose requests do not reach OneUptime yet - a
     * proxy in front of a self-hosted server that does not pass the name
     * on (#1521): verified, and its certificate cannot be issued until the
     * proxy is fixed. Said here, before the order fails.
     */
    const cnameDescription: DnsRecordCheckDescription | undefined = cnameCheck
      ? describeDnsRecordCheck(cnameCheck)
      : undefined;

    return (
      <Modal
        title={CustomDomainCopy.dnsSetupTitle}
        onClose={props.onClose}
        closeButtonText={CustomDomainCopy.dnsSetupDone}
      >
        <div className="space-y-4" data-testid={DNS_SETUP_TEST_IDS.verified}>
          <Alert
            type={AlertType.SUCCESS}
            title={CustomDomainCopy.dnsSetupVerified}
          />
          <p className="text-sm leading-6 text-gray-600">
            {isWithoutFreeCertificate ? (
              translator.translateText(
                CustomDomainCopy.dnsSetupVerifiedWithoutFreeCertificate,
              )
            ) : (
              <TranslatedSentence
                template={CUSTOM_DOMAIN_VERIFIED_NEXT[result.certificateStatus]}
                slots={{ domain: domainSlot }}
              />
            )}
          </p>
          {cnameDescription?.warning ? (
            <Alert
              type={AlertType.WARNING}
              title={translator.translateTemplate(
                cnameDescription.warning.template,
                cnameDescription.warning.values,
              )}
              dataTestId={DNS_SETUP_TEST_IDS.cnameLookedUp}
            />
          ) : (
            <></>
          )}
          {!isWithoutFreeCertificate &&
          result.certificateStatus === CustomDomainCertificateStatus.Failed &&
          result.certificateError ? (
            <Alert
              type={AlertType.WARNING}
              title={result.certificateError}
              dataTestId={DNS_SETUP_TEST_IDS.certificateError}
            />
          ) : (
            <></>
          )}
        </div>
      </Modal>
    );
  }

  const records: Array<CustomDomainRecord> = [];

  if (props.projectDomain) {
    records.push({
      type: DnsRecordType.TXT,
      name: props.projectDomain.domain,
      value: props.projectDomain.verificationText,
      purpose: CustomDomainCopy.dnsSetupTxtPurpose,
      purposeDomain: props.projectDomain.domain,
      check: txtCheck,
      testIds: {
        record: DNS_SETUP_TEST_IDS.txtRecord,
        type: DNS_SETUP_TEST_IDS.txtRecordType,
        name: DNS_SETUP_TEST_IDS.txtRecordName,
        value: DNS_SETUP_TEST_IDS.txtRecordValue,
        status: DNS_SETUP_TEST_IDS.txtStatus,
        lookedUp: DNS_SETUP_TEST_IDS.txtLookedUp,
      },
    });
  }

  records.push({
    type: CUSTOM_DOMAIN_RECORD_TYPE,
    name: fullDomain,
    value: cnameRecord,
    purpose: CustomDomainCopy.dnsSetupCnamePurpose,
    purposeDomain: fullDomain,
    check: cnameCheck,
    testIds: {
      record: DNS_SETUP_TEST_IDS.record,
      type: DNS_SETUP_TEST_IDS.recordType,
      name: DNS_SETUP_TEST_IDS.recordName,
      value: DNS_SETUP_TEST_IDS.recordValue,
      status: DNS_SETUP_TEST_IDS.cnameStatus,
      lookedUp: DNS_SETUP_TEST_IDS.cnameLookedUp,
    },
  });

  return (
    <Modal
      title={CustomDomainCopy.dnsSetupTitle}
      onClose={props.onClose}
      closeButtonText={CustomDomainCopy.dnsSetupClose}
      onSubmit={showsCheckNow ? checkNow : undefined}
      submitButtonText={
        showsCheckNow ? CustomDomainCopy.dnsSetupCheckNow : undefined
      }
      disableSubmitButton={!canCheckNow}
      isLoading={isChecking}
      error={error}
    >
      <div className="space-y-4">
        <CustomDomainServerReadinessNotice kind={props.kind} />

        <p className="text-sm leading-6 text-gray-600">
          <TranslatedSentence
            template={
              props.projectDomain
                ? props.kind.copy.dnsSetupIntroTwoRecords
                : props.kind.copy.dnsSetupIntro
            }
            slots={{ domain: domainSlot }}
          />
        </p>

        <CustomDomainRecords records={records} />

        {isRootDomain ? (
          <p
            className="text-sm leading-6 text-gray-600"
            data-testid={DNS_SETUP_TEST_IDS.rootDomainNote}
          >
            {translator.translateText(CustomDomainCopy.dnsSetupRootDomain)}
          </p>
        ) : (
          <></>
        )}

        <p
          className="text-sm leading-6 text-gray-600"
          data-testid={DNS_SETUP_TEST_IDS.whatHappensNext}
        >
          {translator.translateText(whatHappensNext)}
        </p>

        {checkNowLockedReason ? (
          <p
            className="text-sm leading-6 text-gray-500"
            data-testid={DNS_SETUP_TEST_IDS.checkNowLocked}
          >
            {checkNowLockedReason}
          </p>
        ) : (
          <></>
        )}
      </div>
    </Modal>
  );
};

export default CustomDomainDnsSetupModal;
