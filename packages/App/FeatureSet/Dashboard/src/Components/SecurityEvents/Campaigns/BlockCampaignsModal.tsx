import CampaignAddressChecklist, {
  CampaignChecklistEntry,
  getChecklistValue,
} from "./CampaignAddressChecklist";
import {
  blockCampaignAddresses,
  checkCampaignAddresses,
} from "./CampaignContainmentApi";
import {
  BLOCK_ADDRESSES,
  BLOCK_ADDRESSES_DESCRIPTION,
  CHALLENGE_INSTEAD_DESCRIPTION,
  CHECK_ADDRESSES_FAILED,
  NOTHING_TO_BLOCK,
  SIGNED_IN_UNKNOWN,
} from "./CampaignContainmentCopy";
import {
  splitCampaignChecks,
  writeBlockedToast,
  writeWillBlock,
} from "./CampaignContainmentModel";
import { getBlockDurationOptions } from "../Blocklist/BlockAddressModal";
import {
  EXPIRES_FIELD_TITLE,
  REASON_FIELD_DESCRIPTION,
  REASON_FIELD_TITLE,
} from "../Blocklist/BlocklistCopy";
import { BLOCK_CHALLENGE_INSTEAD } from "../../SecurityCase/Response/SecurityCaseResponseCopy";
import {
  SECURITY_BLOCK_DEFAULT_DURATION,
  SECURITY_BLOCK_REASON_MAX_LENGTH,
  SecurityBlockAction,
  SecurityBlockDuration,
} from "Common/Types/SecurityBlocklist/SecurityBlock";
import {
  SecurityCampaignAddressCheck,
  SecurityCampaignAddressesCheck,
} from "Common/Types/SecurityEvent/SecurityCampaignContainment";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import Modal from "Common/UI/Components/Modal/Modal";
import TextArea from "Common/UI/Components/TextArea/TextArea";
import Toggle from "Common/UI/Components/Toggle/Toggle";
import API from "Common/UI/Utils/API/API";
import Toast from "Common/UI/Utils/Toast";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * BLOCK ADDRESSES, FROM THE CAMPAIGNS PAGE (#10354): the selected
 * campaigns' addresses blocked in one go, through the Blocklist, as the
 * person - one dialog, one decision. It asks the server first what a block
 * of each would meet, lists the addresses it will block, each one ticked,
 * and the ones it leaves out with why: already blocked, one of your own or
 * protected, a signed-in user's in the last 30 days, or one OneUptime could
 * not check. 24 hours unless the person says, Challenge instead of Block on
 * asking, and a reason for whoever reads the Blocklist later.
 */

export interface ComponentProps {
  addresses: Array<string>;
  // How many requests each address sent, as the page counted them.
  requestCounts?: Record<string, number> | undefined;
  onClose: () => void;
  // Told once the blocks are made, so the page reads them.
  onBlocked: () => void;
}

const DURATION_FIELD_ID: string = "campaign-block-duration";
const REASON_FIELD_ID: string = "campaign-block-reason";

const BlockCampaignsModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [checks, setChecks] = useState<Array<CampaignChecklistEntry> | null>(
    null,
  );
  const [signedInUnknown, setSignedInUnknown] = useState<string>("");
  const [selected, setSelected] = useState<Array<string>>([]);
  const [duration, setDuration] = useState<SecurityBlockDuration>(
    SECURITY_BLOCK_DEFAULT_DURATION,
  );
  const [isChallenge, setIsChallenge] = useState<boolean>(false);
  const [reason, setReason] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [isBlocking, setIsBlocking] = useState<boolean>(false);

  useEffect(() => {
    let isCurrent: boolean = true;

    checkCampaignAddresses(props.addresses)
      .then((check: SecurityCampaignAddressesCheck) => {
        if (!isCurrent) {
          return;
        }

        const entries: Array<CampaignChecklistEntry> = check.addresses.map(
          (address: SecurityCampaignAddressCheck): CampaignChecklistEntry => {
            const count: number | undefined =
              props.requestCounts?.[address.typed];

            return typeof count === "number"
              ? { ...address, requestCount: count }
              : address;
          },
        );

        setChecks(entries);
        setSignedInUnknown(check.signedInUnknownReason || "");
        setSelected(
          splitCampaignChecks(entries).blocking.map(getChecklistValue),
        );
      })
      .catch((err: unknown) => {
        if (isCurrent) {
          setChecks([]);
          setError(API.getFriendlyMessage(err));
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [props.addresses.join(",")]);

  const action: SecurityBlockAction = isChallenge
    ? SecurityBlockAction.Challenge
    : SecurityBlockAction.Block;
  const durationOptions: Array<DropdownOption> =
    getBlockDurationOptions(translator);

  const submit: () => Promise<void> = async (): Promise<void> => {
    if (selected.length === 0 || isBlocking) {
      return;
    }

    setIsBlocking(true);
    setError("");

    try {
      const outcome: SecurityCampaignAddressesCheck =
        await blockCampaignAddresses({
          values: selected,
          action,
          duration,
          reason: reason.trim() || undefined,
        });

      Toast.success(writeBlockedToast({ outcome, action, translator }));
      props.onBlocked();
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setIsBlocking(false);
    }
  };

  return (
    <Modal
      title={BLOCK_ADDRESSES}
      description={BLOCK_ADDRESSES_DESCRIPTION}
      submitButtonText={BLOCK_ADDRESSES}
      onClose={props.onClose}
      onSubmit={() => {
        void submit();
      }}
      isLoading={isBlocking}
      isBodyLoading={checks === null}
      disableSubmitButton={selected.length === 0}
      error={error || undefined}
      errorWhatFailed={
        checks && checks.length > 0
          ? undefined
          : translator.translateText(CHECK_ADDRESSES_FAILED)
      }
    >
      <div className="space-y-5">
        {signedInUnknown ? (
          <Alert
            type={AlertType.WARNING}
            title={
              <span>
                {translator.translateText(SIGNED_IN_UNKNOWN)}{" "}
                <span dir="auto">{signedInUnknown}</span>
              </span>
            }
          />
        ) : (
          <></>
        )}

        <CampaignAddressChecklist
          checks={checks || []}
          selected={selected}
          onChange={setSelected}
          isDisabled={isBlocking}
        />

        <p className="text-sm text-gray-700">
          {selected.length > 0
            ? writeWillBlock({
                count: selected.length,
                action,
                duration,
                translator,
              })
            : translator.translateText(NOTHING_TO_BLOCK)}
        </p>

        <div className="space-y-1">
          <label
            htmlFor={DURATION_FIELD_ID}
            className="block text-sm font-medium text-gray-700"
          >
            {translator.translateText(EXPIRES_FIELD_TITLE)}
          </label>
          <Dropdown
            inputId={DURATION_FIELD_ID}
            options={durationOptions}
            value={durationOptions.find((option: DropdownOption) => {
              return option.value === duration;
            })}
            isClearable={false}
            onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
              if (typeof value === "string") {
                setDuration(value as SecurityBlockDuration);
              }
            }}
          />
        </div>

        <Toggle
          title={BLOCK_CHALLENGE_INSTEAD}
          description={CHALLENGE_INSTEAD_DESCRIPTION}
          value={isChallenge}
          onChange={setIsChallenge}
        />

        <div className="space-y-1">
          <label
            htmlFor={REASON_FIELD_ID}
            className="block text-sm font-medium text-gray-700"
          >
            {translator.translateText(REASON_FIELD_TITLE)}
          </label>
          <TextArea
            id={REASON_FIELD_ID}
            value={reason}
            ariaDescribedby={`${REASON_FIELD_ID}-help`}
            onChange={(value: string) => {
              setReason(value.slice(0, SECURITY_BLOCK_REASON_MAX_LENGTH));
            }}
          />
          <p id={`${REASON_FIELD_ID}-help`} className="text-xs text-gray-500">
            {translator.translateText(REASON_FIELD_DESCRIPTION)}
          </p>
        </div>
      </div>
    </Modal>
  );
};

export default BlockCampaignsModal;
