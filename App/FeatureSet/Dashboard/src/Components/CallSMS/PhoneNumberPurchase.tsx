import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import Modal from "Common/UI/Components/Modal/Modal";
import { NOTIFICATION_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import Card from "Common/UI/Components/Card/Card";
import Icon from "Common/UI/Components/Icon/Icon";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import IncomingCallPolicyPhoneNumber from "Common/Models/DatabaseModels/IncomingCallPolicyPhoneNumber";
import { getIncomingCallPolicyPhoneNumberText } from "./IncomingCallPolicyPhoneNumberUtil";

// Available phone number from search
interface AvailablePhoneNumber {
  phoneNumber: string;
  friendlyName: string;
  locality?: string;
  region?: string;
  country: string;
}

// Owned phone number (already purchased in Twilio)
interface OwnedPhoneNumber {
  phoneNumberId: string;
  phoneNumber: string;
  friendlyName: string;
  voiceUrl?: string;
}

export interface PhoneNumberPurchaseProps {
  projectId: ObjectID;
  incomingCallPolicyId: ObjectID;
  projectCallSMSConfigId?: ObjectID | undefined;
  phoneNumbers: Array<IncomingCallPolicyPhoneNumber>;
  onPhoneNumbersChanged?: () => void;
  hideCard?: boolean; // If true, renders content without Card wrapper
}

// Country codes supported by Twilio for voice
const COUNTRY_OPTIONS: Array<DropdownOption> = [
  { label: "United States (+1)", value: "US" },
  { label: "United Kingdom (+44)", value: "GB" },
  { label: "Canada (+1)", value: "CA" },
  { label: "Australia (+61)", value: "AU" },
  { label: "Germany (+49)", value: "DE" },
  { label: "France (+33)", value: "FR" },
  { label: "Netherlands (+31)", value: "NL" },
  { label: "Sweden (+46)", value: "SE" },
  { label: "Ireland (+353)", value: "IE" },
  { label: "Belgium (+32)", value: "BE" },
  { label: "Switzerland (+41)", value: "CH" },
  { label: "Austria (+43)", value: "AT" },
  { label: "Spain (+34)", value: "ES" },
  { label: "Italy (+39)", value: "IT" },
  { label: "Poland (+48)", value: "PL" },
  { label: "Portugal (+351)", value: "PT" },
  { label: "Denmark (+45)", value: "DK" },
  { label: "Norway (+47)", value: "NO" },
  { label: "Finland (+358)", value: "FI" },
  { label: "Japan (+81)", value: "JP" },
  { label: "Singapore (+65)", value: "SG" },
  { label: "Hong Kong (+852)", value: "HK" },
  { label: "New Zealand (+64)", value: "NZ" },
  { label: "Brazil (+55)", value: "BR" },
  { label: "Mexico (+52)", value: "MX" },
  { label: "Israel (+972)", value: "IL" },
  { label: "South Africa (+27)", value: "ZA" },
];

const PhoneNumberPurchase: FunctionComponent<PhoneNumberPurchaseProps> = (
  props: PhoneNumberPurchaseProps,
): ReactElement => {
  // Main configuration modal state
  const [showConfigureModal, setShowConfigureModal] = useState<boolean>(false);
  const [configureStep, setConfigureStep] = useState<
    "choose" | "existing" | "buy"
  >("choose");

  const [showSearchModal, setShowSearchModal] = useState<boolean>(false);
  const [showReleaseConfirmModal, setShowReleaseConfirmModal] =
    useState<boolean>(false);
  const [phoneNumberToRelease, setPhoneNumberToRelease] =
    useState<IncomingCallPolicyPhoneNumber | null>(null);
  const [showPurchaseConfirmModal, setShowPurchaseConfirmModal] =
    useState<boolean>(false);
  const [showSuccessModal, setShowSuccessModal] = useState<boolean>(false);
  const [successMessage, setSuccessMessage] = useState<string>("");

  const [error, setError] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isSearching, setIsSearching] = useState<boolean>(false);

  const [availableNumbers, setAvailableNumbers] = useState<
    Array<AvailablePhoneNumber>
  >([]);
  const [selectedNumber, setSelectedNumber] =
    useState<AvailablePhoneNumber | null>(null);

  // Owned phone numbers state
  const [ownedNumbers, setOwnedNumbers] = useState<Array<OwnedPhoneNumber>>([]);
  const [selectedOwnedNumber, setSelectedOwnedNumber] =
    useState<OwnedPhoneNumber | null>(null);
  const [isLoadingOwned, setIsLoadingOwned] = useState<boolean>(false);
  const [showAssignConfirmModal, setShowAssignConfirmModal] =
    useState<boolean>(false);

  useEffect(() => {
    setError("");
  }, [
    showSearchModal,
    showReleaseConfirmModal,
    showPurchaseConfirmModal,
    showAssignConfirmModal,
    showConfigureModal,
  ]);

  // Close the configure modal and reset state
  const closeConfigureModal: () => void = (): void => {
    setShowConfigureModal(false);
    setConfigureStep("choose");
    setAvailableNumbers([]);
    setOwnedNumbers([]);
    setError("");
  };

  // Search for available phone numbers
  const searchPhoneNumbers: (values: JSONObject) => Promise<void> = async (
    values: JSONObject,
  ): Promise<void> => {
    try {
      setIsSearching(true);
      setError("");
      setAvailableNumbers([]);

      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post({
          url: URL.fromString(NOTIFICATION_URL.toString()).addRoute(
            "/phone-number/search",
          ),
          data: {
            projectId: props.projectId.toString(),
            projectCallSMSConfigId: props.projectCallSMSConfigId?.toString(),
            countryCode: values["countryCode"],
            areaCode: values["areaCode"] || undefined,
            contains: values["contains"] || undefined,
          },
          headers: ModelAPI.getCommonHeaders(),
        });

      if (response.isFailure()) {
        setError(API.getFriendlyMessage(response));
        setIsSearching(false);
        return;
      }

      const data: JSONObject = response.data as JSONObject;
      const numbers: Array<AvailablePhoneNumber> =
        (data["availableNumbers"] as unknown as Array<AvailablePhoneNumber>) ||
        [];

      setAvailableNumbers(numbers);
      setIsSearching(false);
      setShowSearchModal(false);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
      setIsSearching(false);
    }
  };

  // Purchase a phone number
  const purchasePhoneNumber: () => Promise<void> = async (): Promise<void> => {
    if (!selectedNumber) {
      return;
    }

    try {
      setIsLoading(true);
      setError("");

      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post({
          url: URL.fromString(NOTIFICATION_URL.toString()).addRoute(
            "/phone-number/purchase",
          ),
          data: {
            projectId: props.projectId.toString(),
            phoneNumber: selectedNumber.phoneNumber,
            incomingCallPolicyId: props.incomingCallPolicyId.toString(),
          },
          headers: ModelAPI.getCommonHeaders(),
        });

      if (response.isFailure()) {
        setError(API.getFriendlyMessage(response));
        setIsLoading(false);
        return;
      }

      setIsLoading(false);
      setShowPurchaseConfirmModal(false);
      setAvailableNumbers([]);
      setSelectedNumber(null);
      closeConfigureModal();
      setSuccessMessage(
        `Phone number ${selectedNumber.phoneNumber} has been reserved and configured for this policy.`,
      );
      setShowSuccessModal(true);

      props.onPhoneNumbersChanged?.();
    } catch (err) {
      setError(API.getFriendlyMessage(err));
      setIsLoading(false);
    }
  };

  // Release a phone number
  const releasePhoneNumber: () => Promise<void> = async (): Promise<void> => {
    const selectedPhoneNumber: IncomingCallPolicyPhoneNumber | null =
      phoneNumberToRelease;

    if (!selectedPhoneNumber) {
      setError("The selected phone number could not be found.");
      return;
    }

    const phoneNumberId: ObjectID | null = selectedPhoneNumber.id;

    try {
      setIsLoading(true);
      setError("");

      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.delete({
          url: URL.fromString(NOTIFICATION_URL.toString()).addRoute(
            `/phone-number/release/${props.incomingCallPolicyId.toString()}${
              phoneNumberId ? `/${phoneNumberId.toString()}` : ""
            }`,
          ),
          headers: ModelAPI.getCommonHeaders(),
        });

      if (response.isFailure()) {
        setError(API.getFriendlyMessage(response));
        setIsLoading(false);
        return;
      }

      setIsLoading(false);
      setShowReleaseConfirmModal(false);
      const releasedPhoneNumber: string =
        getIncomingCallPolicyPhoneNumberText(selectedPhoneNumber) ||
        "The phone number";
      setPhoneNumberToRelease(null);
      setSuccessMessage(
        `${releasedPhoneNumber} has been released back to Twilio.`,
      );
      setShowSuccessModal(true);
      props.onPhoneNumbersChanged?.();
    } catch (err) {
      setError(API.getFriendlyMessage(err));
      setIsLoading(false);
    }
  };

  // Fetch owned phone numbers from Twilio
  const fetchOwnedNumbers: () => Promise<void> = async (): Promise<void> => {
    try {
      setIsLoadingOwned(true);
      setError("");
      setOwnedNumbers([]);

      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post({
          url: URL.fromString(NOTIFICATION_URL.toString()).addRoute(
            "/phone-number/list-owned",
          ),
          data: {
            projectId: props.projectId.toString(),
            projectCallSMSConfigId: props.projectCallSMSConfigId?.toString(),
          },
          headers: ModelAPI.getCommonHeaders(),
        });

      if (response.isFailure()) {
        setError(API.getFriendlyMessage(response));
        setIsLoadingOwned(false);
        return;
      }

      const data: JSONObject = response.data as JSONObject;
      const numbers: Array<OwnedPhoneNumber> =
        (data["ownedNumbers"] as unknown as Array<OwnedPhoneNumber>) || [];

      setOwnedNumbers(numbers);
      setIsLoadingOwned(false);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
      setIsLoadingOwned(false);
    }
  };

  // Assign an existing phone number to this policy
  const assignExistingNumber: () => Promise<void> = async (): Promise<void> => {
    if (!selectedOwnedNumber) {
      return;
    }

    try {
      setIsLoading(true);
      setError("");

      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post({
          url: URL.fromString(NOTIFICATION_URL.toString()).addRoute(
            "/phone-number/assign-existing",
          ),
          data: {
            projectId: props.projectId.toString(),
            phoneNumberId: selectedOwnedNumber.phoneNumberId,
            phoneNumber: selectedOwnedNumber.phoneNumber,
            incomingCallPolicyId: props.incomingCallPolicyId.toString(),
          },
          headers: ModelAPI.getCommonHeaders(),
        });

      if (response.isFailure()) {
        setError(API.getFriendlyMessage(response));
        setIsLoading(false);
        return;
      }

      setIsLoading(false);
      setShowAssignConfirmModal(false);
      setOwnedNumbers([]);
      setSelectedOwnedNumber(null);
      closeConfigureModal();
      setSuccessMessage(
        `Phone number ${selectedOwnedNumber.phoneNumber} has been assigned and configured for this policy.`,
      );
      setShowSuccessModal(true);

      props.onPhoneNumbersChanged?.();
    } catch (err) {
      setError(API.getFriendlyMessage(err));
      setIsLoading(false);
    }
  };

  const renderPhoneNumbers: () => ReactElement = (): ReactElement => {
    if (props.phoneNumbers.length === 0) {
      return (
        <div
          className="p-4 bg-yellow-50 rounded-lg border border-yellow-200"
          data-testid="incoming-call-policy-no-phone-numbers"
        >
          <div className="flex items-center space-x-3">
            <Icon
              icon={IconProp.ExclaimationCircle}
              className="text-yellow-500 h-6 w-6"
            />
            <div>
              <p className="text-sm font-medium text-gray-900">
                No Phone Numbers Configured
              </p>
              <p className="text-sm text-gray-600">
                Add a phone number to enable incoming call routing.
              </p>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div
        className="space-y-3"
        data-testid="incoming-call-policy-phone-number-list"
      >
        <p className="text-sm text-gray-600">
          {props.phoneNumbers.length === 1
            ? "1 phone number routes calls to this policy."
            : `${props.phoneNumbers.length} phone numbers route calls to this policy.`}
        </p>
        {props.phoneNumbers.map(
          (
            phoneNumber: IncomingCallPolicyPhoneNumber,
            index: number,
          ): ReactElement => {
            const phoneNumberText: string =
              getIncomingCallPolicyPhoneNumberText(phoneNumber);

            return (
              <div
                className="flex items-center justify-between p-4 bg-green-50 rounded-lg border border-green-200"
                data-testid="incoming-call-policy-phone-number"
                key={phoneNumber.id?.toString() || phoneNumberText || index}
              >
                <div className="flex items-center space-x-3 min-w-0">
                  <Icon
                    icon={IconProp.CheckCircle}
                    className="text-green-500 h-6 w-6 flex-shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900">
                      Phone Number
                    </p>
                    <p className="text-lg font-semibold text-green-700 break-all">
                      {phoneNumberText || "Unknown phone number"}
                    </p>
                    {phoneNumber.countryCode ? (
                      <p className="text-xs text-gray-500">
                        Country: {phoneNumber.countryCode}
                      </p>
                    ) : (
                      <></>
                    )}
                  </div>
                </div>
                <Button
                  title="Release"
                  buttonStyle={ButtonStyleType.DANGER_OUTLINE}
                  icon={IconProp.Trash}
                  onClick={() => {
                    setPhoneNumberToRelease(phoneNumber);
                    setShowReleaseConfirmModal(true);
                  }}
                />
              </div>
            );
          },
        )}
      </div>
    );
  };

  // Check if Twilio config is set
  if (!props.projectCallSMSConfigId && props.phoneNumbers.length === 0) {
    if (props.hideCard) {
      return (
        <div className="text-gray-500 text-sm">
          Please link a Twilio configuration first.
        </div>
      );
    }
    return (
      <Card
        title="Reserve Phone Number"
        description="Reserve a phone number from Twilio to receive incoming calls"
      >
        <Alert type={AlertType.WARNING} title="Twilio Configuration Required" />
      </Card>
    );
  }

  // Open the configure modal
  const openConfigureModal: () => void = (): void => {
    setConfigureStep("choose");
    setShowConfigureModal(true);
    setAvailableNumbers([]);
    setOwnedNumbers([]);
    setError("");
  };

  // Render the configure modal content based on current step
  const renderConfigureModalContent: () => ReactElement = (): ReactElement => {
    if (configureStep === "choose") {
      return (
        <div className="space-y-4">
          {/* Use Existing Option */}
          <div
            className="border-2 border-gray-200 rounded-lg p-5 cursor-pointer hover:border-blue-500 hover:bg-blue-50 transition-all"
            onClick={() => {
              setConfigureStep("existing");
              fetchOwnedNumbers();
            }}
          >
            <div className="flex items-center space-x-4">
              <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                <Icon icon={IconProp.List} className="h-6 w-6 text-blue-600" />
              </div>
              <div className="flex-1">
                <h4 className="text-lg font-semibold text-gray-900">
                  Use Existing Phone Number
                </h4>
                <p className="text-sm text-gray-500 mt-1">
                  Select a phone number you already own in your Twilio account
                </p>
              </div>
              <Icon
                icon={IconProp.ChevronRight}
                className="h-5 w-5 text-gray-400"
              />
            </div>
          </div>

          {/* Buy New Option */}
          <div
            className="border-2 border-gray-200 rounded-lg p-5 cursor-pointer hover:border-green-500 hover:bg-green-50 transition-all"
            onClick={() => {
              setConfigureStep("buy");
            }}
          >
            <div className="flex items-center space-x-4">
              <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
                <Icon icon={IconProp.Add} className="h-6 w-6 text-green-600" />
              </div>
              <div className="flex-1">
                <h4 className="text-lg font-semibold text-gray-900">
                  Reserve New Phone Number
                </h4>
                <p className="text-sm text-gray-500 mt-1">
                  Search and reserve a new phone number from Twilio
                </p>
              </div>
              <Icon
                icon={IconProp.ChevronRight}
                className="h-5 w-5 text-gray-400"
              />
            </div>
          </div>
        </div>
      );
    }

    if (configureStep === "existing") {
      return (
        <div>
          {/* Back button */}
          <button
            className="flex items-center text-sm text-gray-500 hover:text-gray-700 mb-4"
            onClick={() => {
              setConfigureStep("choose");
              setOwnedNumbers([]);
            }}
          >
            <Icon icon={IconProp.ChevronLeft} className="h-4 w-4 mr-1" />
            Back to options
          </button>

          {isLoadingOwned ? (
            <div className="py-8">
              <ComponentLoader />
            </div>
          ) : ownedNumbers.length === 0 ? (
            <div className="py-8 text-center">
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Icon icon={IconProp.Call} className="h-8 w-8 text-gray-400" />
              </div>
              <p className="text-gray-600 mb-2">
                No existing phone numbers found
              </p>
              <p className="text-sm text-gray-500 mb-4">
                Your Twilio account doesn&apos;t have any phone numbers yet.
              </p>
              <Button
                title="Reserve a New Number Instead"
                buttonStyle={ButtonStyleType.PRIMARY}
                onClick={() => {
                  setConfigureStep("buy");
                }}
              />
            </div>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {ownedNumbers.map((number: OwnedPhoneNumber, index: number) => {
                const isInUse: boolean = Boolean(number.voiceUrl);
                const isAlreadyAttached: boolean = props.phoneNumbers.some(
                  (
                    attachedPhoneNumber: IncomingCallPolicyPhoneNumber,
                  ): boolean => {
                    return (
                      attachedPhoneNumber.callProviderPhoneNumberId ===
                        number.phoneNumberId ||
                      getIncomingCallPolicyPhoneNumberText(
                        attachedPhoneNumber,
                      ) === number.phoneNumber
                    );
                  },
                );
                return (
                  <div
                    key={index}
                    className="flex items-center justify-between p-4 bg-white border rounded-lg hover:bg-gray-50"
                  >
                    <div>
                      <p className="font-medium text-gray-900">
                        {number.friendlyName}
                      </p>
                      <p className="text-sm text-gray-500">
                        {number.phoneNumber}
                      </p>
                      {isInUse && (
                        <p className="text-xs text-yellow-600 mt-1">
                          Currently has a webhook configured
                        </p>
                      )}
                      {isAlreadyAttached ? (
                        <p className="text-xs text-green-600 mt-1">
                          Already attached to this policy
                        </p>
                      ) : (
                        <></>
                      )}
                    </div>
                    <Button
                      title={isAlreadyAttached ? "Attached" : "Select"}
                      buttonStyle={ButtonStyleType.SUCCESS}
                      icon={IconProp.Check}
                      disabled={isAlreadyAttached}
                      onClick={() => {
                        if (isAlreadyAttached) {
                          return;
                        }
                        setSelectedOwnedNumber(number);
                        setShowAssignConfirmModal(true);
                      }}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      );
    }

    if (configureStep === "buy") {
      return (
        <div>
          {/* Back button */}
          <button
            className="flex items-center text-sm text-gray-500 hover:text-gray-700 mb-4"
            onClick={() => {
              setConfigureStep("choose");
              setAvailableNumbers([]);
            }}
          >
            <Icon icon={IconProp.ChevronLeft} className="h-4 w-4 mr-1" />
            Back to options
          </button>

          {/* Search Form */}
          {availableNumbers.length === 0 && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600 mb-4">
                Search for available phone numbers in your preferred country.
                The number will be reserved using your Twilio balance.
              </p>
              <Button
                title="Search for Numbers"
                buttonStyle={ButtonStyleType.PRIMARY}
                icon={IconProp.Search}
                onClick={() => {
                  setShowSearchModal(true);
                }}
              />
            </div>
          )}

          {/* Search Results */}
          {availableNumbers.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-medium text-gray-700">
                  {availableNumbers.length} Available Numbers
                </h4>
                <Button
                  title="Search Again"
                  buttonStyle={ButtonStyleType.SECONDARY_LINK}
                  onClick={() => {
                    setShowSearchModal(true);
                  }}
                />
              </div>
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {availableNumbers.map(
                  (number: AvailablePhoneNumber, index: number) => {
                    return (
                      <div
                        key={index}
                        className="flex items-center justify-between p-4 bg-white border rounded-lg hover:bg-gray-50"
                      >
                        <div>
                          <p className="font-medium text-gray-900">
                            {number.friendlyName}
                          </p>
                          <p className="text-sm text-gray-500">
                            {number.locality && `${number.locality}, `}
                            {number.region && `${number.region}, `}
                            {number.country}
                          </p>
                        </div>
                        <Button
                          title="Reserve"
                          buttonStyle={ButtonStyleType.SUCCESS}
                          icon={IconProp.Add}
                          onClick={() => {
                            setSelectedNumber(number);
                            setShowPurchaseConfirmModal(true);
                          }}
                        />
                      </div>
                    );
                  },
                )}
              </div>
            </div>
          )}
        </div>
      );
    }

    return <></>;
  };

  // Render the add button inline when hideCard is true.
  const renderButtons: () => ReactElement = (): ReactElement => {
    return (
      <div className="flex space-x-2">
        <Button
          title="Add Phone Number"
          buttonStyle={ButtonStyleType.PRIMARY}
          icon={IconProp.Add}
          disabled={!props.projectCallSMSConfigId}
          tooltip={
            props.projectCallSMSConfigId
              ? undefined
              : "Link a Twilio configuration before adding another number."
          }
          onClick={openConfigureModal}
        />
      </div>
    );
  };

  // Render all modals - shared between card and no-card modes
  const renderModals: () => ReactElement = (): ReactElement => {
    return (
      <>
        {/* Configure Phone Number Modal */}
        {showConfigureModal && (
          <Modal
            title={
              configureStep === "choose"
                ? "Add Phone Number"
                : configureStep === "existing"
                  ? "Select Existing Phone Number"
                  : "Reserve New Phone Number"
            }
            description={
              configureStep === "choose"
                ? "Choose how you want to add a phone number for incoming calls"
                : configureStep === "existing"
                  ? "Select a phone number from your Twilio account"
                  : "Search and reserve a new phone number"
            }
            onClose={closeConfigureModal}
          >
            <>
              {error && (
                <div className="mb-4">
                  <Alert type={AlertType.DANGER} title={error} />
                </div>
              )}
              {renderConfigureModalContent()}
            </>
          </Modal>
        )}

        {/* Search Modal */}
        {showSearchModal ? (
          <BasicFormModal
            title="Search Available Phone Numbers"
            description="Search for phone numbers available in your Twilio account. The number will be reserved using your Twilio balance."
            formProps={{
              name: "Search Phone Numbers",
              error: error,
              fields: [
                {
                  title: "Country",
                  description: "Select the country for the phone number",
                  field: {
                    countryCode: true,
                  },
                  fieldType: FormFieldSchemaType.Dropdown,
                  dropdownOptions: COUNTRY_OPTIONS,
                  required: true,
                  placeholder: "Select a country",
                },
                {
                  title: "Area Code (Optional)",
                  description:
                    "Specify an area code to narrow down the search (e.g., 415 for San Francisco)",
                  field: {
                    areaCode: true,
                  },
                  fieldType: FormFieldSchemaType.Text,
                  required: false,
                  placeholder: "415",
                },
                {
                  title: "Contains (Optional)",
                  description:
                    "Search for numbers containing specific digits (e.g., 555)",
                  field: {
                    contains: true,
                  },
                  fieldType: FormFieldSchemaType.Text,
                  required: false,
                  placeholder: "555",
                },
              ],
            }}
            submitButtonText="Search"
            onClose={() => {
              setShowSearchModal(false);
              setError("");
            }}
            isLoading={isSearching}
            onSubmit={searchPhoneNumbers}
          />
        ) : (
          <></>
        )}

        {/* Release Confirmation Modal */}
        {showReleaseConfirmModal ? (
          <ConfirmModal
            title="Release Phone Number"
            description={`Are you sure you want to release ${phoneNumberToRelease ? getIncomingCallPolicyPhoneNumberText(phoneNumberToRelease) : "this phone number"}? This action will return the number to Twilio and it may not be available to reserve again.`}
            error={error}
            submitButtonText="Release Number"
            submitButtonType={ButtonStyleType.DANGER}
            onClose={() => {
              setShowReleaseConfirmModal(false);
              setPhoneNumberToRelease(null);
              setError("");
            }}
            isLoading={isLoading}
            onSubmit={releasePhoneNumber}
          />
        ) : (
          <></>
        )}

        {/* Reserve Confirmation Modal */}
        {showPurchaseConfirmModal && selectedNumber ? (
          <ConfirmModal
            title="Confirm Reservation"
            description={`Are you sure you want to reserve ${selectedNumber.friendlyName}? This will be charged to your Twilio account.`}
            error={error}
            submitButtonText="Reserve"
            submitButtonType={ButtonStyleType.SUCCESS}
            onClose={() => {
              setShowPurchaseConfirmModal(false);
              setSelectedNumber(null);
              setError("");
            }}
            isLoading={isLoading}
            onSubmit={purchasePhoneNumber}
          />
        ) : (
          <></>
        )}

        {/* Assign Existing Number Confirmation Modal */}
        {showAssignConfirmModal && selectedOwnedNumber ? (
          <ConfirmModal
            title="Assign Phone Number"
            description={`Are you sure you want to use ${selectedOwnedNumber.friendlyName} for this policy? ${selectedOwnedNumber.voiceUrl ? "This number currently has a webhook configured which will be updated to point to OneUptime." : "The webhook will be configured automatically."}`}
            error={error}
            submitButtonText="Assign Number"
            submitButtonType={ButtonStyleType.SUCCESS}
            onClose={() => {
              setShowAssignConfirmModal(false);
              setSelectedOwnedNumber(null);
              setError("");
            }}
            isLoading={isLoading}
            onSubmit={assignExistingNumber}
          />
        ) : (
          <></>
        )}

        {/* Success Modal */}
        {showSuccessModal ? (
          <ConfirmModal
            title="Success"
            description={successMessage}
            submitButtonText="Close"
            submitButtonType={ButtonStyleType.NORMAL}
            onSubmit={() => {
              setShowSuccessModal(false);
              setSuccessMessage("");
            }}
          />
        ) : (
          <></>
        )}

        {/* Loading State */}
        {isLoading &&
        !showReleaseConfirmModal &&
        !showPurchaseConfirmModal &&
        !showAssignConfirmModal ? (
          <ComponentLoader />
        ) : (
          <></>
        )}

        {/* Error State */}
        {error &&
        !showSearchModal &&
        !showReleaseConfirmModal &&
        !showPurchaseConfirmModal &&
        !showAssignConfirmModal ? (
          <ErrorMessage message={error} />
        ) : (
          <></>
        )}
      </>
    );
  };

  // Inline mode (no card wrapper)
  if (props.hideCard) {
    return (
      <>
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-medium text-gray-900">Phone Numbers</p>
              <p className="text-sm text-gray-500">
                Add one or more numbers that route calls to this policy.
              </p>
            </div>
            {renderButtons()}
          </div>
          {renderPhoneNumbers()}
        </div>
        {renderModals()}
      </>
    );
  }

  // Card mode (with card wrapper)
  return (
    <>
      <Card
        title="Phone Numbers"
        description="Add existing Twilio phone numbers or reserve new ones"
        buttons={[
          {
            title: "Add Phone Number",
            buttonStyle: ButtonStyleType.PRIMARY,
            icon: IconProp.Add,
            disabled: !props.projectCallSMSConfigId,
            tooltip: props.projectCallSMSConfigId
              ? undefined
              : "Link a Twilio configuration before adding another number.",
            onClick: openConfigureModal,
          },
        ]}
      >
        <div className="p-6">{renderPhoneNumbers()}</div>
      </Card>
      {renderModals()}
    </>
  );
};

export default PhoneNumberPurchase;
