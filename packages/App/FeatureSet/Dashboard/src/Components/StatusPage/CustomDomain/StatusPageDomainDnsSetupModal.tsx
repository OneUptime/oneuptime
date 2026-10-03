import {
  DNS_SETUP_TEST_IDS,
  STATUS_PAGE_CUSTOM_DOMAIN_RECORD_TYPE,
  STATUS_PAGE_CUSTOM_DOMAIN_VERIFIED_NEXT,
  StatusPageCustomDomainCopy,
} from "./StatusPageCustomDomainCopy";
import StatusPageDomain from "Common/Models/DatabaseModels/StatusPageDomain";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import CustomDomainVerification, {
  CustomDomainCertificateStatus,
  CustomDomainVerificationResult,
} from "Common/Types/StatusPage/CustomDomainVerification";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import Modal from "Common/UI/Components/Modal/Modal";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { APP_API_URL, StatusPageCNameRecord } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * DNS Setup: the one thing only a custom domain's owner can do - add the
 * CNAME record - and a way to say it is done.
 *
 * It opens by itself on a domain that was just added, and from the domain's
 * DNS Setup row action until the record is verified. The record is shown
 * field by field, the way DNS providers ask for it, each with a copy
 * button. Check now verifies the record at once (the sweeps check every 15
 * minutes anyway), and the server orders the domain's free certificate the
 * moment the record is found; the dialog then says what happens to the
 * certificate next instead of closing on a guess.
 */

export interface ComponentProps {
  // The domain: its id, fullDomain, subdomain and isCustomCertificate.
  domain: StatusPageDomain;
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

const StatusPageDomainDnsSetupModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const [isChecking, setIsChecking] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [result, setResult] = useState<CustomDomainVerificationResult | null>(
    null,
  );

  const fullDomain: string = props.domain.fullDomain?.toString() || "";

  const domainSlot: ReactElement = (
    <span className="font-semibold text-gray-900">{fullDomain}</span>
  );

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
            `/${new StatusPageDomain().crudApiPath}/verify-cname/${props.domain.id?.toString()}`,
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

  // An installation without a status page CNAME record cannot verify any.
  if (!StatusPageCNameRecord) {
    return (
      <Modal
        title={StatusPageCustomDomainCopy.dnsSetupTitle}
        onClose={props.onClose}
        closeButtonText={StatusPageCustomDomainCopy.dnsSetupClose}
      >
        <p className="text-sm leading-6 text-gray-600">
          <TranslatedSentence
            template={StatusPageCustomDomainCopy.dnsSetupNotEnabled}
            slots={{
              variable: (
                <span className="font-semibold">STATUS_PAGE_CNAME_RECORD</span>
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
        title={StatusPageCustomDomainCopy.dnsSetupTitle}
        onClose={props.onClose}
        closeButtonText={StatusPageCustomDomainCopy.dnsSetupDone}
      >
        <div className="space-y-4" data-testid={DNS_SETUP_TEST_IDS.verified}>
          <Alert
            type={AlertType.SUCCESS}
            title={StatusPageCustomDomainCopy.dnsSetupVerified}
          />
          <p className="text-sm leading-6 text-gray-600">
            <TranslatedSentence
              template={
                STATUS_PAGE_CUSTOM_DOMAIN_VERIFIED_NEXT[
                  result.certificateStatus
                ]
              }
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
      label: StatusPageCustomDomainCopy.dnsSetupRecordType,
      value: STATUS_PAGE_CUSTOM_DOMAIN_RECORD_TYPE,
      copyTitle: StatusPageCustomDomainCopy.dnsSetupCopyRecordType,
      testId: DNS_SETUP_TEST_IDS.recordType,
    },
    {
      label: StatusPageCustomDomainCopy.dnsSetupRecordName,
      value: fullDomain,
      copyTitle: StatusPageCustomDomainCopy.dnsSetupCopyRecordName,
      testId: DNS_SETUP_TEST_IDS.recordName,
    },
    {
      label: StatusPageCustomDomainCopy.dnsSetupRecordValue,
      value: StatusPageCNameRecord,
      copyTitle: StatusPageCustomDomainCopy.dnsSetupCopyRecordValue,
      testId: DNS_SETUP_TEST_IDS.recordValue,
    },
  ];

  return (
    <Modal
      title={StatusPageCustomDomainCopy.dnsSetupTitle}
      onClose={props.onClose}
      closeButtonText={StatusPageCustomDomainCopy.dnsSetupClose}
      onSubmit={checkNow}
      submitButtonText={StatusPageCustomDomainCopy.dnsSetupCheckNow}
      isLoading={isChecking}
      error={error}
    >
      <div className="space-y-4">
        <p className="text-sm leading-6 text-gray-600">
          <TranslatedSentence
            template={StatusPageCustomDomainCopy.dnsSetupIntro}
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
            {translator.translateText(
              StatusPageCustomDomainCopy.dnsSetupRootDomain,
            )}
          </p>
        ) : (
          <></>
        )}

        <p className="text-sm leading-6 text-gray-600">
          {translator.translateText(
            props.domain.isCustomCertificate
              ? StatusPageCustomDomainCopy.dnsSetupWhatHappensNextUploaded
              : StatusPageCustomDomainCopy.dnsSetupWhatHappensNext,
          )}
        </p>
      </div>
    </Modal>
  );
};

export default StatusPageDomainDnsSetupModal;
