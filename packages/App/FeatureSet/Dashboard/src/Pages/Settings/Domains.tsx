import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import {
  CustomDomainCopy,
  DNS_SETUP_TEST_IDS,
} from "../../Components/CustomDomain/CustomDomainCopy";
import CustomDomainRecords, {
  CustomDomainRecord,
} from "../../Components/CustomDomain/CustomDomainRecords";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Modal from "Common/UI/Components/Modal/Modal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import Domain from "Common/Models/DatabaseModels/Domain";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import OneUptimeDate from "Common/Types/Date";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import { APP_API_URL } from "Common/UI/Config";
import CustomDomainDnsCheckResultJSON, {
  CustomDomainDnsCheckResult,
} from "Common/Types/CustomDomain/CustomDomainDnsCheckResult";
import {
  DnsRecordCheck,
  DnsRecordType,
} from "Common/Types/CustomDomain/DnsRecordCheck";

/*
 * Project Settings -> Domains: the domains the project owns, each verified
 * once with a TXT record before a status page, dashboard or form can be put
 * on an address on it.
 *
 * Verify Domain draws the TXT record exactly as a custom domain's DNS Setup
 * draws it (CustomDomainRecords): its type, name and value with a copy
 * button each, what it is for, and - once Verify Domain has looked it up -
 * its status beside it and, under it, what was looked up, what came back
 * and what to change. It used to list the record as bold labels and say
 * what the lookup found as the dialog's error, above the record it was
 * about (#7025). A refusal, or a lookup that failed, is still the dialog's
 * error: it is about the request, not the record.
 *
 * Nothing checks a project domain's TXT record on its own, so the dialog
 * stays open until Verify Domain finds it; then it closes and the row reads
 * Verified.
 */

const Domains: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const [error, setError] = useState<string>("");
  const [currentVerificationDomain, setCurrentVerificationDomain] =
    useState<Domain | null>(null);
  const [refreshToggle, setRefreshToggle] = useState<string>(
    OneUptimeDate.getCurrentDate().toString(),
  );
  const [isVerificationLoading, setIsVerificationLoading] =
    useState<boolean>(false);

  // What the last Verify Domain found for the open dialog's record.
  const [txtCheck, setTxtCheck] = useState<DnsRecordCheck | undefined>(
    undefined,
  );

  const openVerification: (domain: Domain) => void = (domain: Domain): void => {
    setError("");
    setTxtCheck(undefined);
    setCurrentVerificationDomain(domain);
  };

  const closeVerification: () => void = (): void => {
    setCurrentVerificationDomain(null);
    setError("");
    setTxtCheck(undefined);
  };

  const domainName: string =
    currentVerificationDomain?.["domain"]?.toString() || "";

  const verify: () => Promise<void> = async (): Promise<void> => {
    if (!currentVerificationDomain) {
      return;
    }

    try {
      setIsVerificationLoading(true);
      setError("");

      /*
       * check-txt verifies the domain when its record is found, and
       * otherwise says what it looked up and what came back - the check
       * a status page's DNS Setup draws under the same record (#6835).
       */
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.get<JSONObject>({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            `/domain/check-txt/${new ObjectID(
              currentVerificationDomain["_id"]
                ? currentVerificationDomain["_id"].toString()
                : "",
            ).toString()}`,
          ),
          data: {},
          headers: ModelAPI.getCommonHeaders(),
        });

      if (response.isFailure()) {
        throw response;
      }

      const result: CustomDomainDnsCheckResult =
        CustomDomainDnsCheckResultJSON.fromJSON(response.data as JSONObject);

      if (!result.isVerified) {
        setTxtCheck(result.records[0]);
        setIsVerificationLoading(false);
        return;
      }

      setIsVerificationLoading(false);
      closeVerification();
      setRefreshToggle(OneUptimeDate.getCurrentDate().toString());
    } catch (err) {
      setError(API.getFriendlyMessage(err));
      setIsVerificationLoading(false);
    }
  };

  const txtRecord: CustomDomainRecord = {
    type: DnsRecordType.TXT,
    name: domainName,
    value:
      (currentVerificationDomain?.["domainVerificationText"] as string) || "",
    purpose: CustomDomainCopy.dnsSetupTxtPurpose,
    purposeDomain: domainName,
    check: txtCheck,
    testIds: {
      record: DNS_SETUP_TEST_IDS.txtRecord,
      type: DNS_SETUP_TEST_IDS.txtRecordType,
      name: DNS_SETUP_TEST_IDS.txtRecordName,
      value: DNS_SETUP_TEST_IDS.txtRecordValue,
      status: DNS_SETUP_TEST_IDS.txtStatus,
      lookedUp: DNS_SETUP_TEST_IDS.txtLookedUp,
    },
  };

  return (
    <Fragment>
      <ModelTable<Domain>
        modelType={Domain}
        showViewIdButton={true}
        name="Settings > Domain"
        userPreferencesKey={"domains-table"}
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        id="domains-table"
        saveFilterProps={{
          tableId: "settings-domains-table",
        }}
        isDeleteable={true}
        isEditable={false}
        isCreateable={true}
        // A domain is one you own, added here: not created.
        createVerb="Add"
        cardProps={{
          title: "Domains",
          description:
            "Domains you own. Verify one with a TXT record to use it for a status page or dashboard address.",
        }}
        refreshToggle={refreshToggle}
        viewPageRoute={Navigation.getCurrentRoute()}
        actionButtons={[
          {
            title: "Verify Domain",
            buttonStyleType: ButtonStyleType.SUCCESS_OUTLINE,
            icon: IconProp.Check,
            isVisible: (item: Domain): boolean => {
              if (item["isVerified"]) {
                return false;
              }

              return true;
            },
            onClick: async (
              item: Domain,
              onCompleteAction: VoidFunction,
              onError: ErrorFunction,
            ) => {
              try {
                openVerification(item);

                onCompleteAction();
              } catch (err) {
                onCompleteAction();
                onError(err as Error);
              }
            },
          },
        ]}
        formFields={[
          {
            field: {
              domain: true,
            },
            title: "Domain",
            description:
              "A domain you own. Once it is added, verify it from its row.",
            fieldType: FormFieldSchemaType.Domain,
            required: true,
            placeholder: "acme-inc.com",
            validation: {
              minLength: 2,
            },
            disableSpellCheck: true,
          },
        ]}
        selectMoreFields={{
          domainVerificationText: true,
        }}
        showRefreshButton={true}
        searchableFields={["domain"]}
        filters={[
          {
            field: {
              domain: true,
            },
            type: FieldType.Text,
            title: "Domain",
          },
          {
            field: {
              isVerified: true,
            },
            title: "Verified",
            type: FieldType.Boolean,
          },
        ]}
        columns={[
          {
            field: {
              domain: true,
            },
            title: "Domain",
            type: FieldType.Text,
          },
          {
            field: {
              isVerified: true,
            },
            title: "Verified",
            type: FieldType.Boolean,
          },
        ]}
      />
      {currentVerificationDomain ? (
        <Modal
          title={translator.translateTemplate("Verify {{domain}}", {
            domain: domainName,
          })}
          isTitleTranslated={true}
          onClose={closeVerification}
          submitButtonText={"Verify Domain"}
          onSubmit={() => {
            void verify();
          }}
          isLoading={isVerificationLoading}
          error={error}
        >
          <div className="space-y-4">
            <p className="text-sm leading-6 text-gray-600">
              {translator.translateText(CustomDomainCopy.verifyDomainIntro)}
            </p>

            <CustomDomainRecords records={[txtRecord]} />
          </div>
        </Modal>
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default Domains;
