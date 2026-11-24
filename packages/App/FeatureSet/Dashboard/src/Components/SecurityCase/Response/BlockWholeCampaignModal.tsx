import CampaignAddressChecklist, {
  CampaignChecklistEntry,
  getChecklistValue,
} from "../../SecurityEvents/Campaigns/CampaignAddressChecklist";
import {
  WholeCampaignBlockStarted,
  blockWholeCampaign,
} from "../../SecurityEvents/Campaigns/CampaignContainmentApi";
import {
  BLOCK_WHOLE_CAMPAIGN,
  BLOCK_WHOLE_CAMPAIGN_DESCRIPTION,
  CHALLENGE_INSTEAD_DESCRIPTION,
  SIGNED_IN_UNKNOWN,
  WHOLE_CAMPAIGN_ASKED_TOAST,
  WHOLE_CAMPAIGN_STARTED_TOAST,
} from "../../SecurityEvents/Campaigns/CampaignContainmentCopy";
import {
  splitCampaignChecks,
  writeWillBlock,
} from "../../SecurityEvents/Campaigns/CampaignContainmentModel";
import { getBlockDurationOptions } from "../../SecurityEvents/Blocklist/BlockAddressModal";
import { EXPIRES_FIELD_TITLE } from "../../SecurityEvents/Blocklist/BlocklistCopy";
import { BLOCK_CHALLENGE_INSTEAD } from "./SecurityCaseResponseCopy";
import ObjectID from "Common/Types/ObjectID";
import {
  SecurityBlockAction,
  SecurityBlockDuration,
} from "Common/Types/SecurityBlocklist/SecurityBlock";
import { SecurityCampaignOfCaseAddress } from "Common/Types/SecurityEvent/SecurityCampaignContainment";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import Modal from "Common/UI/Components/Modal/Modal";
import Toggle from "Common/UI/Components/Toggle/Toggle";
import API from "Common/UI/Utils/API/API";
import Toast from "Common/UI/Utils/Toast";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * BLOCK THE WHOLE CAMPAIGN, FROM A CASE (#10354): the case's address and
 * the other addresses that sent the same requests with the same tools,
 * blocked together through the playbook engine - one run, one approval
 * that lists them all, when the person's block waits for one. Each address
 * it can block is ticked; the ones it leaves out say why. The case's own
 * address is blocked with them unless a block holds it already. For as
 * long as the step's own Block would - the ladder's next step for a repeat
 * offender - unless the person says.
 */

export interface ComponentProps {
  securityCaseId: ObjectID;
  campaign: SecurityCampaignOfCaseAddress;
  // How long the block lasts unless the person says: the step's own choice.
  suggestedDuration: SecurityBlockDuration;
  // A block holds the case's own address already: it is not blocked again.
  isCaseAddressBlocked: boolean;
  onClose: () => void;
  // Told once the block is asked for, so the plan reads it.
  onStarted: () => void;
}

const DURATION_FIELD_ID: string = "whole-campaign-duration";

const BlockWholeCampaignModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const checks: Array<CampaignChecklistEntry> = props.campaign.addresses;
  const [selected, setSelected] = useState<Array<string>>(
    splitCampaignChecks(checks).blocking.map(getChecklistValue),
  );
  const [duration, setDuration] = useState<SecurityBlockDuration>(
    props.suggestedDuration,
  );
  const [isChallenge, setIsChallenge] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [isStarting, setIsStarting] = useState<boolean>(false);

  const action: SecurityBlockAction = isChallenge
    ? SecurityBlockAction.Challenge
    : SecurityBlockAction.Block;
  const durationOptions: Array<DropdownOption> =
    getBlockDurationOptions(translator);

  const submit: () => Promise<void> = async (): Promise<void> => {
    if (selected.length === 0 || isStarting) {
      return;
    }

    setIsStarting(true);
    setError("");

    try {
      const started: WholeCampaignBlockStarted = await blockWholeCampaign({
        securityCaseId: props.securityCaseId,
        address: props.campaign.address,
        values: selected,
        blockAction: action,
        duration,
      });

      Toast.success(
        translator.translatePlural(
          started.needsApproval
            ? WHOLE_CAMPAIGN_ASKED_TOAST
            : WHOLE_CAMPAIGN_STARTED_TOAST,
          started.blocking.length,
        ),
      );
      props.onStarted();
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setIsStarting(false);
    }
  };

  return (
    <Modal
      title={BLOCK_WHOLE_CAMPAIGN}
      description={translator.translateTemplate(
        BLOCK_WHOLE_CAMPAIGN_DESCRIPTION,
        { address: props.campaign.address },
      )}
      submitButtonText={BLOCK_WHOLE_CAMPAIGN}
      onClose={props.onClose}
      onSubmit={() => {
        void submit();
      }}
      isLoading={isStarting}
      disableSubmitButton={selected.length === 0}
      error={error || undefined}
    >
      <div className="space-y-5">
        {props.campaign.signedInUnknownReason ? (
          <Alert
            type={AlertType.WARNING}
            title={
              <span>
                {translator.translateText(SIGNED_IN_UNKNOWN)}{" "}
                <span dir="auto">{props.campaign.signedInUnknownReason}</span>
              </span>
            }
          />
        ) : (
          <></>
        )}

        <CampaignAddressChecklist
          checks={checks}
          selected={selected}
          onChange={setSelected}
          isDisabled={isStarting}
        />

        <p className="text-sm text-gray-700">
          {writeWillBlock({
            // The case's own address goes with them, unless a block holds it already.
            count: selected.length + (props.isCaseAddressBlocked ? 0 : 1),
            action,
            duration,
            translator,
          })}
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
      </div>
    </Modal>
  );
};

export default BlockWholeCampaignModal;
