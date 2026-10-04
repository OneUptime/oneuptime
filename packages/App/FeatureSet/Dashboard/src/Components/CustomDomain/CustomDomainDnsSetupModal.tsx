import {
  CUSTOM_DOMAIN_RECORD_TYPE,
  CUSTOM_DOMAIN_VERIFIED_NEXT,
  CustomDomainCopy,
  DNS_SETUP_TEST_IDS,
} from "./CustomDomainCopy";
import { CustomDomainKind } from "./CustomDomainKinds";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import CustomDomainVerification, {
  CustomDomainCertificateStatus,
  CustomDomainVerificationResult,
} from "Common/Types/CustomDomain/CustomDomainVerification";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import Modal from "Common/UI/Components/Modal/Modal";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * DNS Setup: the one thing only a custom domain's owner can do - add the
 * CNAME record - and a way to say it is done. The same dialog for a status
 * page's custom domains and a dashboard's.
 *
 * It opens by itself on a domain that was just added, and from the domain's
 * DNS Setup row action until the record is verified. The record is shown
 * field by field, the way DNS providers ask for it, each with a copy
 * button. Check now verifies the record at once (the sweeps check every 15
 * minutes anyway), and the server orders the domain's free certificate the
 * moment the record is found; the dialog then says what happens to the
 * certificate next instead of closing on a guess.
 */

// What the dialog reads of the domain's row.
export interface CustomDomainDnsSetupDomain {
  id?: ObjectID | null | undefined;
  fullDomain?: string | undefined;
  subdomain?: string | undefined;
  isCustomCertificate?: boolean | undefined;
  isCnameVerified?: boolean | undefined;
}

export interface ComponentProps {
  // Whose domain: a status page's or a dashboard's.
  kind: CustomDomainKind;
  domain: CustomDomainDnsSetupDomain;
  // The domain's free certificate has expired: its renewals keep failing.
  hasExpiredCertificate?: boolean | undefined;
  onClose: () => void;
  // Check now found the record: what shows the domain's status is stale.
  onVerified: () => void;
}

interface RecordRow {
  label: string;
  value: string;
  copyTitle: string;
  testId: string;
}

const CustomDomainDnsSetupModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const [isChecking, setIsChecking] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [result, setResult] = useState<CustomDomainVerificationResult | null>(
    null,
  );

  const cnameRecord: string = props.kind.getCnameRecord();

  const fullDomain: string = props.domain.fullDomain?.toString() || "";

  const domainSlot: ReactElement = (
    <span className="font-semibold text-gray-900">{fullDomain}</span>
  );

  /*
   * What happens next, for where the domain is: a verified one is here
   * because its free certificate is not in place - an order that keeps
   * failing, or a certificate that has expired - and Check now tries again
   * and says why.
   */
  const whatHappensNext: string = props.domain.isCustomCertificate
    ? CustomDomainCopy.dnsSetupWhatHappensNextUploaded
    : props.domain.isCnameVerified
      ? props.hasExpiredCertificate
        ? CustomDomainCopy.dnsSetupVerifiedExpired
        : CustomDomainCopy.dnsSetupVerifiedNotIssued
      : CustomDomainCopy.dnsSetupWhatHappensNext;

  // The subdomain is empty for the domain itself ("@" when it was added).
  const isRootDomain: boolean =
    typeof props.domain.subdomain === "string" &&
    props.domain.subdomain.trim() === "";

  const checkNow: () => Promise<void> = async (): Promise<void> => {
    setIsChecking(true);
    setError("");

    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.get<JSONObject>({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            `/${new props.kind.modelType().crudApiPath}/verify-cname/${props.domain.id?.toString()}`,
          ),
          data: {},
          headers: ModelAPI.getCommonHeaders(),
        });

      if (response.isFailure()) {
        throw response;
      }

      setResult(CustomDomainVerification.fromJSON(response.data as JSONObject));
      props.onVerified();
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsChecking(false);
  };

  // An installation without this kind's CNAME record cannot verify any.
  if (!cnameRecord) {
    return (
      <Modal
        title={CustomDomainCopy.dnsSetupTitle}
        onClose={props.onClose}
        closeButtonText={CustomDomainCopy.dnsSetupClose}
      >
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
      </Modal>
    );
  }

  if (result) {
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
            <TranslatedSentence
              template={CUSTOM_DOMAIN_VERIFIED_NEXT[result.certificateStatus]}
              slots={{ domain: domainSlot }}
            />
          </p>
          {result.certificateStatus === CustomDomainCertificateStatus.Failed &&
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

  const records: Array<RecordRow> = [
    {
      label: CustomDomainCopy.dnsSetupRecordType,
      value: CUSTOM_DOMAIN_RECORD_TYPE,
      copyTitle: CustomDomainCopy.dnsSetupCopyRecordType,
      testId: DNS_SETUP_TEST_IDS.recordType,
    },
    {
      label: CustomDomainCopy.dnsSetupRecordName,
      value: fullDomain,
      copyTitle: CustomDomainCopy.dnsSetupCopyRecordName,
      testId: DNS_SETUP_TEST_IDS.recordName,
    },
    {
      label: CustomDomainCopy.dnsSetupRecordValue,
      value: cnameRecord,
      copyTitle: CustomDomainCopy.dnsSetupCopyRecordValue,
      testId: DNS_SETUP_TEST_IDS.recordValue,
    },
  ];

  return (
    <Modal
      title={CustomDomainCopy.dnsSetupTitle}
      onClose={props.onClose}
      closeButtonText={CustomDomainCopy.dnsSetupClose}
      onSubmit={checkNow}
      submitButtonText={CustomDomainCopy.dnsSetupCheckNow}
      isLoading={isChecking}
      error={error}
    >
      <div className="space-y-4">
        <p className="text-sm leading-6 text-gray-600">
          <TranslatedSentence
            template={props.kind.copy.dnsSetupIntro}
            slots={{ domain: domainSlot }}
          />
        </p>

        <dl
          className="divide-y divide-gray-200 rounded-md border border-gray-200"
          data-testid={DNS_SETUP_TEST_IDS.record}
        >
          {records.map((record: RecordRow): ReactElement => {
            return (
              <div
                key={record.testId}
                className="flex items-center justify-between gap-3 px-3 py-2"
              >
                <div className="min-w-0">
                  <dt className="text-xs font-medium text-gray-500">
                    {translator.translateText(record.label)}
                  </dt>
                  <dd
                    className="mt-0.5 break-all font-mono text-sm text-gray-900"
                    data-testid={record.testId}
                  >
                    {record.value}
                  </dd>
                </div>
                <CopyTextButton
                  textToBeCopied={record.value}
                  title={record.copyTitle}
                  size="sm"
                  variant="ghost"
                  iconOnly={true}
                  className="shrink-0"
                />
              </div>
            );
          })}
        </dl>

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
      </div>
    </Modal>
  );
};

export default CustomDomainDnsSetupModal;
