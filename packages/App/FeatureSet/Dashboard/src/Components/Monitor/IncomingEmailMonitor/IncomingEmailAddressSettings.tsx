import { getIncomingEmailAddress } from "./IncomingEmailMonitorLink";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import BadDataException from "Common/Types/Exception/BadDataException";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import { INBOUND_EMAIL_DOMAIN } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import IncomingEmailMonitorAddress, {
  CUSTOM_LOCAL_PART_MAX_LENGTH,
  CUSTOM_LOCAL_PART_MIN_LENGTH,
} from "Common/Utils/Monitor/IncomingEmailMonitorAddress";
import React, { FunctionComponent, ReactElement, useState } from "react";

export interface ComponentProps {
  monitorId: ObjectID;
  // Absent when the viewer may not read the monitor's credentials.
  secretKey?: ObjectID | undefined;
  customLocalPart?: string | undefined;
  // Called once the person has seen the new address, so the page can refetch.
  onAddressChanged?: (() => void | Promise<void>) | undefined;
}

interface CustomAddressFormData {
  localPart: string;
}

enum OpenModal {
  None = "None",
  ConfirmReset = "ConfirmReset",
  Customize = "Customize",
  Result = "Result",
}

interface AddressChange {
  newAddress: string;
  previousAddress: string | null;
}

type NormalizeFunction = (value: string) => string;

// Throws a BadDataException with a message written for the person typing.
const normalizeLocalPart: NormalizeFunction = (value: string): string => {
  return IncomingEmailMonitorAddress.normalizeCustomLocalPart({
    value: value,
    inboundDomain: INBOUND_EMAIL_DOMAIN,
  });
};

type GetErrorFunction = (value: string) => string | null;

const getLocalPartError: GetErrorFunction = (value: string): string | null => {
  try {
    normalizeLocalPart(value);
    return null;
  } catch (err) {
    return err instanceof BadDataException
      ? err.message
      : "Please enter a valid name.";
  }
};

/*
 * Monitor > Settings for an Incoming Email monitor: shows the live inbound
 * address and lets an editor replace it, either with a new random address
 * ("Reset") or with a name of their own ("Customize"). Both retire the current
 * address immediately, so both ask first and then show the new address with a
 * copy button.
 *
 * The address is a credential -- anyone who has it can send mail the monitor
 * counts -- so it is only shown to people who can read the monitor's secret
 * key, and the customize dialog warns against easy-to-guess names.
 */
const IncomingEmailAddressSettings: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [openModal, setOpenModal] = useState<OpenModal>(OpenModal.None);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [addressChange, setAddressChange] = useState<AddressChange | null>(
    null,
  );
  /*
   * What was last submitted in the customize dialog. BasicFormModal unmounts
   * the form while saving, so without this a refused name ("already used by
   * another monitor") would come back as an empty field.
   */
  const [draftLocalPart, setDraftLocalPart] = useState<string>("");

  const currentAddress: string | null = getIncomingEmailAddress(
    props.secretKey,
    props.customLocalPart,
  );

  const hasCredentials: boolean = Boolean(
    props.secretKey || props.customLocalPart,
  );

  const updateGate: PermissionGateResult = PermissionGate.check(
    new Monitor(),
    ModelAction.Update,
  );

  const closeModal: () => void = (): void => {
    setOpenModal(OpenModal.None);
    setError("");
  };

  type SaveFunction = (data: {
    newAddress: string | null;
    update: Record<string, string | null>;
  }) => Promise<void>;

  const save: SaveFunction = async (data: {
    newAddress: string | null;
    update: Record<string, string | null>;
  }): Promise<void> => {
    setIsSaving(true);
    setError("");

    try {
      await ModelAPI.updateById<Monitor>({
        modelType: Monitor,
        id: props.monitorId,
        data: data.update,
      });

      setAddressChange({
        newAddress: data.newAddress || "",
        previousAddress: currentAddress,
      });
      setOpenModal(OpenModal.Result);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsSaving(false);
  };

  const resetAddress: () => Promise<void> = async (): Promise<void> => {
    const newSecretKey: ObjectID = ObjectID.generate();

    /*
     * Clearing the custom name in the same write is what makes this a reset
     * of the ADDRESS: with a custom name set, a new key alone would change
     * nothing anyone sends mail to.
     */
    await save({
      newAddress: getIncomingEmailAddress(newSecretKey),
      update: {
        incomingEmailSecretKey: newSecretKey.toString(),
        incomingEmailCustomLocalPart: null,
      },
    });
  };

  const saveCustomAddress: (
    formData: FormValues<CustomAddressFormData>,
  ) => Promise<void> = async (
    formData: FormValues<CustomAddressFormData>,
  ): Promise<void> => {
    let localPart: string;

    setDraftLocalPart(String(formData.localPart || ""));

    try {
      localPart = normalizeLocalPart(String(formData.localPart || ""));
    } catch (err) {
      setError(API.getFriendlyMessage(err));
      return;
    }

    if (localPart === props.customLocalPart) {
      closeModal();
      return;
    }

    await save({
      newAddress: getIncomingEmailAddress(props.secretKey, localPart),
      update: {
        incomingEmailCustomLocalPart: localPart,
      },
    });
  };

  if (!INBOUND_EMAIL_DOMAIN) {
    return (
      <Card
        title="Incoming Email Address"
        description={
          <ErrorMessage message="Inbound email is not configured on this server, so this monitor has no email address. Please ask your OneUptime administrator to set up the inbound email environment variables." />
        }
      />
    );
  }

  const getAddressRow: (address: string, testId: string) => ReactElement = (
    address: string,
    testId: string,
  ): ReactElement => {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
        <span
          data-testid={testId}
          className="min-w-0 flex-1 break-all font-mono text-sm text-gray-900"
        >
          {address}
        </span>
        <CopyTextButton textToBeCopied={address} size="sm" variant="soft" />
      </div>
    );
  };

  const buttonsDisabled: boolean = !updateGate.isAllowed || !hasCredentials;

  return (
    <>
      <Card
        title="Incoming Email Address"
        description="Emails sent to this address are evaluated against this monitor's criteria. Reset it to get a new random address, or customize it to use a name of your own. Either way, the current address stops working immediately."
        buttons={[
          {
            title: "Customize Address",
            buttonStyle: ButtonStyleType.NORMAL,
            icon: IconProp.Edit,
            disabled: buttonsDisabled,
            tooltip: updateGate.disabledReason,
            onClick: () => {
              if (buttonsDisabled) {
                return;
              }

              setError("");
              setDraftLocalPart(props.customLocalPart || "");
              setOpenModal(OpenModal.Customize);
            },
          },
          {
            title: "Reset Address",
            buttonStyle: ButtonStyleType.NORMAL,
            icon: IconProp.Reload,
            disabled: buttonsDisabled,
            tooltip: updateGate.disabledReason,
            isLoading: isSaving && openModal === OpenModal.ConfirmReset,
            onClick: () => {
              if (buttonsDisabled) {
                return;
              }

              setError("");
              setOpenModal(OpenModal.ConfirmReset);
            },
          },
        ]}
      >
        <div
          data-testid="incoming-email-address-settings"
          className="space-y-2"
        >
          {currentAddress ? (
            <>
              <p className="text-xs font-medium text-gray-500">
                {props.customLocalPart ? "Custom address" : "Generated address"}
              </p>
              {getAddressRow(currentAddress, "incoming-email-current-address")}
            </>
          ) : (
            <p className="text-sm text-gray-500">
              Only people who can edit monitors can see this, because it
              contains the monitor&apos;s secret key.
            </p>
          )}
        </div>
      </Card>

      {openModal === OpenModal.ConfirmReset ? (
        <ConfirmModal
          title="Reset email address?"
          description={
            <span data-testid="incoming-email-reset-confirmation">
              {
                "This monitor will get a new, randomly generated email address. "
              }
              {currentAddress ? (
                <>
                  {"The current address "}
                  <span className="font-mono font-medium text-gray-900">
                    {currentAddress}
                  </span>
                  {
                    " will stop working immediately, and email sent to it will be ignored. "
                  }
                </>
              ) : (
                "The current address will stop working immediately, and email sent to it will be ignored. "
              )}
              {props.customLocalPart
                ? "Your custom address will be removed. "
                : ""}
              {"Update every system that sends email to this monitor."}
            </span>
          }
          submitButtonText="Reset Address"
          submitButtonType={ButtonStyleType.DANGER}
          isLoading={isSaving}
          error={error || undefined}
          onClose={closeModal}
          onSubmit={async () => {
            await resetAddress();
          }}
        />
      ) : (
        <></>
      )}

      {openModal === OpenModal.Customize ? (
        <BasicFormModal<CustomAddressFormData>
          title="Customize email address"
          name="Customize Incoming Email Address"
          description={`Choose the name before the @. It must be unique across all monitors. When you save, the current address stops working immediately. Anyone who knows this address can send email to this monitor, so avoid names that are easy to guess.`}
          submitButtonText="Save Address"
          isLoading={isSaving}
          onClose={closeModal}
          onSubmit={async (formData: CustomAddressFormData) => {
            await saveCustomAddress(formData);
          }}
          formProps={{
            /*
             * On the form, not the modal: BasicFormModal renders a modal-level
             * error twice (as an alert and again as a message).
             */
            error: error || undefined,
            initialValues: {
              localPart: draftLocalPart,
            },
            fields: [
              {
                field: {
                  localPart: true,
                },
                title: "Address name",
                description: `${CUSTOM_LOCAL_PART_MIN_LENGTH} to ${CUSTOM_LOCAL_PART_MAX_LENGTH} lowercase letters, numbers, dots, hyphens or underscores. The domain is always @${INBOUND_EMAIL_DOMAIN}.`,
                fieldType: FormFieldSchemaType.Text,
                placeholder: "nightly-backups",
                required: true,
                dataTestId: "incoming-email-custom-local-part",
                customValidation: (
                  values: FormValues<CustomAddressFormData>,
                ): string | null => {
                  return getLocalPartError(String(values.localPart || ""));
                },
                getFooterElement: (
                  values: FormValues<CustomAddressFormData>,
                ): ReactElement | undefined => {
                  const value: string = String(values.localPart || "");

                  if (!value || getLocalPartError(value)) {
                    return undefined;
                  }

                  return (
                    <p
                      data-testid="incoming-email-custom-address-preview"
                      className="mt-2 text-sm text-gray-500"
                    >
                      {"New address: "}
                      <span className="font-mono text-gray-900">
                        {getIncomingEmailAddress(
                          props.secretKey,
                          normalizeLocalPart(value),
                        )}
                      </span>
                    </p>
                  );
                },
              },
            ],
          }}
        />
      ) : (
        <></>
      )}

      {openModal === OpenModal.Result && addressChange ? (
        <ConfirmModal
          title="Email address updated"
          description={
            addressChange.previousAddress
              ? `This monitor now receives email at the address below. The previous address (${addressChange.previousAddress}) no longer works.`
              : "This monitor now receives email at the address below."
          }
          submitButtonText="Done"
          submitButtonType={ButtonStyleType.NORMAL}
          onSubmit={async () => {
            closeModal();
            setAddressChange(null);
            await props.onAddressChanged?.();
          }}
        >
          {getAddressRow(
            addressChange.newAddress,
            "incoming-email-new-address",
          )}
        </ConfirmModal>
      ) : (
        <></>
      )}
    </>
  );
};

export default IncomingEmailAddressSettings;
