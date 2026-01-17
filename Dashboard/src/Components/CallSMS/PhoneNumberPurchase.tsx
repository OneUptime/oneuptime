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
import { NOTIFICATION_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
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
  currentPhoneNumber?: string | undefined;
  onPhoneNumberPurchased?: () => void;
  onPhoneNumberReleased?: () => void;
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
  const [showSearchModal, setShowSearchModal] = useState<boolean>(false);
  const [showReleaseConfirmModal, setShowReleaseConfirmModal] =
    useState<boolean>(false);
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
  const [showOwnedNumbers, setShowOwnedNumbers] = useState<boolean>(false);

  useEffect(() => {
    setError("");
  }, [showSearchModal, showReleaseConfirmModal, showPurchaseConfirmModal, showAssignConfirmModal]);

  // Search for available phone numbers
  const searchPhoneNumbers = async (values: JSONObject): Promise<void> => {
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
        });

      if (response.isFailure()) {
        setError(API.getFriendlyMessage(response));
        setIsSearching(false);
        return;
      }

      const data: JSONObject = response.data as JSONObject;
      const numbers: Array<AvailablePhoneNumber> =
        (data["availableNumbers"] as Array<AvailablePhoneNumber>) || [];

      setAvailableNumbers(numbers);
      setIsSearching(false);
      setShowSearchModal(false);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
      setIsSearching(false);
    }
  };

  // Purchase a phone number
  const purchasePhoneNumber = async (): Promise<void> => {
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
      setSuccessMessage(
        `Phone number ${selectedNumber.phoneNumber} has been purchased and configured for this policy.`,
      );
      setShowSuccessModal(true);

      if (props.onPhoneNumberPurchased) {
        props.onPhoneNumberPurchased();
      }
    } catch (err) {
      setError(API.getFriendlyMessage(err));
      setIsLoading(false);
    }
  };

  // Release a phone number
  const releasePhoneNumber = async (): Promise<void> => {
    try {
      setIsLoading(true);
      setError("");

      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.delete({
          url: URL.fromString(NOTIFICATION_URL.toString()).addRoute(
            `/phone-number/release/${props.incomingCallPolicyId.toString()}`,
          ),
        });

      if (response.isFailure()) {
        setError(API.getFriendlyMessage(response));
        setIsLoading(false);
        return;
      }

      setIsLoading(false);
      setShowReleaseConfirmModal(false);
      setSuccessMessage(
        "Phone number has been released back to Twilio. You can purchase a new number.",
      );
      setShowSuccessModal(true);

      if (props.onPhoneNumberReleased) {
        props.onPhoneNumberReleased();
      }
    } catch (err) {
      setError(API.getFriendlyMessage(err));
      setIsLoading(false);
    }
  };

  // Fetch owned phone numbers from Twilio
  const fetchOwnedNumbers = async (): Promise<void> => {
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
        });

      if (response.isFailure()) {
        setError(API.getFriendlyMessage(response));
        setIsLoadingOwned(false);
        return;
      }

      const data: JSONObject = response.data as JSONObject;
      const numbers: Array<OwnedPhoneNumber> =
        (data["ownedNumbers"] as Array<OwnedPhoneNumber>) || [];

      setOwnedNumbers(numbers);
      setIsLoadingOwned(false);
      setShowOwnedNumbers(true);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
      setIsLoadingOwned(false);
    }
  };

  // Assign an existing phone number to this policy
  const assignExistingNumber = async (): Promise<void> => {
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
      setShowOwnedNumbers(false);
      setSuccessMessage(
        `Phone number ${selectedOwnedNumber.phoneNumber} has been assigned and configured for this policy.`,
      );
      setShowSuccessModal(true);

      if (props.onPhoneNumberPurchased) {
        props.onPhoneNumberPurchased();
      }
    } catch (err) {
      setError(API.getFriendlyMessage(err));
      setIsLoading(false);
    }
  };

  // Render current phone number section
  const renderCurrentPhoneNumber = (): ReactElement => {
    if (props.currentPhoneNumber) {
      return (
        <div className="flex items-center justify-between p-4 bg-green-50 rounded-lg border border-green-200">
          <div className="flex items-center space-x-3">
            <Icon
              icon={IconProp.CheckCircle}
              className="text-green-500 h-6 w-6"
            />
            <div>
              <p className="text-sm font-medium text-gray-900">
                Current Phone Number
              </p>
              <p className="text-lg font-semibold text-green-700">
                {props.currentPhoneNumber}
              </p>
            </div>
          </div>
          <Button
            title="Release Number"
            buttonStyle={ButtonStyleType.DANGER_OUTLINE}
            icon={IconProp.Trash}
            onClick={() => {
              setShowReleaseConfirmModal(true);
            }}
          />
        </div>
      );
    }

    return (
      <div className="p-4 bg-yellow-50 rounded-lg border border-yellow-200">
        <div className="flex items-center space-x-3">
          <Icon
            icon={IconProp.ExclaimationCircle}
            className="text-yellow-500 h-6 w-6"
          />
          <div>
            <p className="text-sm font-medium text-gray-900">
              No Phone Number Configured
            </p>
            <p className="text-sm text-gray-600">
              Search and purchase a phone number to enable incoming call
              routing.
            </p>
          </div>
        </div>
      </div>
    );
  };

  // Render search results
  const renderSearchResults = (): ReactElement => {
    if (availableNumbers.length === 0) {
      return <></>;
    }

    return (
      <div className="mt-4">
        <h4 className="text-sm font-medium text-gray-700 mb-3">
          Available Phone Numbers (New)
        </h4>
        <div className="space-y-2 max-h-80 overflow-y-auto">
          {availableNumbers.map(
            (number: AvailablePhoneNumber, index: number) => {
              return (
                <div
                  key={index}
                  className="flex items-center justify-between p-3 bg-white border rounded-lg hover:bg-gray-50"
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
                    title="Purchase"
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
    );
  };

  // Render owned numbers list
  const renderOwnedNumbers = (): ReactElement => {
    if (!showOwnedNumbers) {
      return <></>;
    }

    if (isLoadingOwned) {
      return (
        <div className="mt-4">
          <ComponentLoader />
        </div>
      );
    }

    if (ownedNumbers.length === 0) {
      return (
        <div className="mt-4 p-4 bg-gray-50 rounded-lg">
          <p className="text-sm text-gray-600">
            No existing phone numbers found in your Twilio account. You can search and purchase a new number instead.
          </p>
        </div>
      );
    }

    return (
      <div className="mt-4">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-medium text-gray-700">
            Existing Phone Numbers in Twilio
          </h4>
          <Button
            title="Hide"
            buttonStyle={ButtonStyleType.NORMAL}
            onClick={() => {
              setShowOwnedNumbers(false);
              setOwnedNumbers([]);
            }}
          />
        </div>
        <div className="space-y-2 max-h-80 overflow-y-auto">
          {ownedNumbers.map((number: OwnedPhoneNumber, index: number) => {
            const isInUse: boolean = !!number.voiceUrl;
            return (
              <div
                key={index}
                className="flex items-center justify-between p-3 bg-white border rounded-lg hover:bg-gray-50"
              >
                <div>
                  <p className="font-medium text-gray-900">
                    {number.friendlyName}
                  </p>
                  <p className="text-xs text-gray-400">{number.phoneNumber}</p>
                  {isInUse && (
                    <p className="text-xs text-yellow-600 mt-1">
                      Currently has a webhook configured
                    </p>
                  )}
                </div>
                <Button
                  title="Use This"
                  buttonStyle={ButtonStyleType.SUCCESS_OUTLINE}
                  icon={IconProp.Check}
                  onClick={() => {
                    setSelectedOwnedNumber(number);
                    setShowAssignConfirmModal(true);
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // Check if Twilio config is set
  if (!props.projectCallSMSConfigId) {
    if (props.hideCard) {
      return (
        <div className="text-gray-500 text-sm">
          Please link a Twilio configuration first.
        </div>
      );
    }
    return (
      <Card
        title="Purchase Phone Number"
        description="Buy a phone number from Twilio to receive incoming calls"
      >
        <Alert
          type={AlertType.WARNING}
          title="Twilio Configuration Required"
        />
      </Card>
    );
  }

  // Render buttons inline when hideCard is true
  const renderButtons = (): ReactElement => {
    return (
      <div className="flex space-x-2">
        <Button
          title="Use Existing"
          buttonStyle={ButtonStyleType.OUTLINE}
          icon={IconProp.List}
          onClick={() => {
            fetchOwnedNumbers();
          }}
          disabled={isLoadingOwned}
        />
        <Button
          title="Buy New"
          buttonStyle={ButtonStyleType.PRIMARY}
          icon={IconProp.Add}
          onClick={() => {
            setShowSearchModal(true);
          }}
        />
        {props.currentPhoneNumber && (
          <Button
            title="Release"
            buttonStyle={ButtonStyleType.DANGER_OUTLINE}
            icon={IconProp.Trash}
            onClick={() => {
              setShowReleaseConfirmModal(true);
            }}
          />
        )}
      </div>
    );
  };

  // Content without card wrapper
  const renderContent = (): ReactElement => {
    return (
      <>
        {!props.hideCard && renderCurrentPhoneNumber()}
        {renderOwnedNumbers()}
        {renderSearchResults()}
      </>
    );
  };

  // Render all modals - shared between card and no-card modes
  const renderModals = (): ReactElement => {
    return (
      <>
        {/* Search Modal */}
        {showSearchModal ? (
          <BasicFormModal
            title="Search Available Phone Numbers"
            description="Search for phone numbers available in your Twilio account. The number will be purchased using your Twilio balance."
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
            description={`Are you sure you want to release the phone number ${props.currentPhoneNumber}? This action will return the number to Twilio and it may not be available for re-purchase.`}
            error={error}
            submitButtonText="Release Number"
            submitButtonType={ButtonStyleType.DANGER}
            onClose={() => {
              setShowReleaseConfirmModal(false);
              setError("");
            }}
            isLoading={isLoading}
            onSubmit={releasePhoneNumber}
          />
        ) : (
          <></>
        )}

        {/* Purchase Confirmation Modal */}
        {showPurchaseConfirmModal && selectedNumber ? (
          <ConfirmModal
            title="Confirm Purchase"
            description={`Are you sure you want to purchase ${selectedNumber.friendlyName}? This will be charged to your Twilio account.`}
            error={error}
            submitButtonText="Purchase"
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
        {isLoading && !showReleaseConfirmModal && !showPurchaseConfirmModal && !showAssignConfirmModal ? (
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
        {renderButtons()}
        {renderContent()}
        {renderModals()}
      </>
    );
  }

  // Card mode (with card wrapper)
  return (
    <>
      <Card
        title="Phone Number"
        description="Use an existing Twilio phone number or purchase a new one"
        buttons={[
          {
            title: "Use Existing Number",
            buttonStyle: ButtonStyleType.OUTLINE,
            icon: IconProp.List,
            onClick: () => {
              fetchOwnedNumbers();
            },
            disabled: isLoadingOwned,
          },
          {
            title: "Buy New Number",
            buttonStyle: ButtonStyleType.PRIMARY,
            icon: IconProp.Add,
            onClick: () => {
              setShowSearchModal(true);
            },
          },
        ]}
      >
        <div className="p-6">
          {renderCurrentPhoneNumber()}
          {renderOwnedNumbers()}
          {renderSearchResults()}
        </div>
      </Card>
      {renderModals()}
    </>
  );
};

export default PhoneNumberPurchase;
