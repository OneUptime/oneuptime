import {
  CampaignWindowRange,
  NetworkChallenged,
  challengeNetwork,
  checkNetworkChallenge,
} from "./CampaignContainmentApi";
import {
  CHALLENGE_NETWORK_TITLE,
  CHALLENGE_THIS_NETWORK,
  CHECK_NETWORK_FAILED,
  NETWORK_ACKNOWLEDGE,
  SECURITY_CAMPAIGN_TEST_IDS,
  WHAT_TO_CHALLENGE,
} from "./CampaignContainmentCopy";
import {
  NetworkCheckTone,
  NetworkCheckWords,
  NetworkChallengeOption,
  describeNetworkCheck,
  getDefaultNetworkChallengeValue,
  getNetworkChallengeOptions,
  writeNetworkChallengeDoes,
  writeNetworkChallengedToast,
  writeRepeatOffenderLine,
} from "./CampaignContainmentModel";
import {
  BLOCK_ADMIN_PERMISSIONS,
  getBlockDurationOptions,
} from "../Blocklist/BlockAddressModal";
import {
  EXPIRES_FIELD_TITLE,
  REASON_FIELD_DESCRIPTION,
  REASON_FIELD_TITLE,
} from "../Blocklist/BlocklistCopy";
import {
  SECURITY_BLOCK_REASON_MAX_LENGTH,
  SecurityBlockDuration,
} from "Common/Types/SecurityBlocklist/SecurityBlock";
import { SecurityAttackNetwork } from "Common/Types/SecurityEvent/SecurityAttackNetwork";
import {
  SecurityNetworkChallengeCheck,
  SecurityNetworkChallengeStanding,
  maySecurityNetworkBeChallenged,
} from "Common/Types/SecurityEvent/SecurityCampaignContainment";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Checkbox from "Common/UI/Components/Checkbox/Checkbox";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import Modal from "Common/UI/Components/Modal/Modal";
import InlineValueSkeleton from "Common/UI/Components/Skeleton/InlineValueSkeleton";
import TextArea from "Common/UI/Components/TextArea/TextArea";
import API from "Common/UI/Utils/API/API";
import PermissionGate from "Common/UI/Utils/PermissionGate";
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
 * CHALLENGE THIS NETWORK (#10354): a network row's range, or its whole
 * ASN, challenged at the edges that can - Cloudflare's lists hold a range,
 * its IP Access Rules an ASN - for 24 hours unless the person says, or the
 * ladder's next step for a network challenged before.
 *
 * It asks the server first, and says what it will do and for how long -
 * or why not: a signed-in user's address in it lately (naming who), one of
 * your own, wider than the largest range or a whole ASN without a Security
 * Admin, nothing connected that challenges it. One OneUptime cannot check -
 * an ASN, or a scrub rule that hides addresses - a Security Admin may
 * challenge once they tick that they know it is unchecked; anyone else is
 * told who can. An ASN's row offers each of its ranges too, the largest
 * first for whoever is no Security Admin.
 */

export interface ComponentProps {
  network: SecurityAttackNetwork;
  // The window the page read: what OneUptime knows of an ASN's addresses.
  window: CampaignWindowRange;
  onClose: () => void;
  onChallenged: () => void;
}

const NETWORK_FIELD_ID: string = "challenge-network-value";
const DURATION_FIELD_ID: string = "challenge-network-duration";
const REASON_FIELD_ID: string = "challenge-network-reason";

const ChallengeNetworkModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const isAdmin: boolean = PermissionGate.holdsAnyOf(BLOCK_ADMIN_PERMISSIONS);
  const options: Array<NetworkChallengeOption> = getNetworkChallengeOptions({
    network: props.network,
    translator,
  });
  const [value, setValue] = useState<string>(
    getDefaultNetworkChallengeValue({ network: props.network, isAdmin }),
  );
  const [check, setCheck] = useState<SecurityNetworkChallengeCheck | null>(
    null,
  );
  const [isChecking, setIsChecking] = useState<boolean>(true);
  const [duration, setDuration] = useState<SecurityBlockDuration | null>(null);
  const [reason, setReason] = useState<string>("");
  const [isAcknowledged, setIsAcknowledged] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [isChallenging, setIsChallenging] = useState<boolean>(false);

  useEffect(() => {
    let isCurrent: boolean = true;

    setIsChecking(true);
    setIsAcknowledged(false);
    setError("");

    checkNetworkChallenge({ value, window: props.window })
      .then((result: SecurityNetworkChallengeCheck) => {
        if (isCurrent) {
          setCheck(result);
        }
      })
      .catch((err: unknown) => {
        if (isCurrent) {
          setCheck(null);
          setError(API.getFriendlyMessage(err));
        }
      })
      .finally(() => {
        if (isCurrent) {
          setIsChecking(false);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [value]);

  // The length the person chose, else the one the check offers: 24 hours, longer for a repeat offender.
  const length: SecurityBlockDuration =
    duration || check?.suggestedDuration || SecurityBlockDuration.OneDay;
  const durationOptions: Array<DropdownOption> =
    getBlockDurationOptions(translator);
  const networkOptions: Array<DropdownOption> = options.map(
    (option: NetworkChallengeOption): DropdownOption => {
      return { value: option.value, label: option.label, isUserContent: true };
    },
  );
  const words: NetworkCheckWords | null = check
    ? describeNetworkCheck({ check, translator })
    : null;
  const does: string | null = check
    ? writeNetworkChallengeDoes({ check, duration: length, translator })
    : null;
  const repeat: string | null = check?.repeat
    ? writeRepeatOffenderLine({ summary: check.repeat, translator })
    : null;
  const needsAcknowledgement: boolean =
    check?.standing === SecurityNetworkChallengeStanding.Unchecked;
  const mayChallenge: boolean = Boolean(
    check &&
      !isChecking &&
      maySecurityNetworkBeChallenged(check) &&
      (!needsAcknowledgement || isAcknowledged),
  );

  const submit: () => Promise<void> = async (): Promise<void> => {
    if (!check || !mayChallenge || isChallenging) {
      return;
    }

    setIsChallenging(true);
    setError("");

    try {
      const challenged: NetworkChallenged = await challengeNetwork({
        value: check.value,
        duration: length,
        reason: reason.trim() || undefined,
        acknowledgesUnchecked: needsAcknowledgement && isAcknowledged,
        window: props.window,
      });

      Toast.success(writeNetworkChallengedToast({ challenged, translator }));
      props.onChallenged();
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setIsChallenging(false);
    }
  };

  return (
    <Modal
      title={translator.translateTemplate(CHALLENGE_NETWORK_TITLE, {
        network: check?.value || value,
      })}
      isTitleTranslated={true}
      submitButtonText={CHALLENGE_THIS_NETWORK}
      onClose={props.onClose}
      onSubmit={() => {
        void submit();
      }}
      isLoading={isChallenging}
      disableSubmitButton={!mayChallenge}
      error={error || undefined}
      errorWhatFailed={
        check ? undefined : translator.translateText(CHECK_NETWORK_FAILED)
      }
    >
      <div className="space-y-5">
        {networkOptions.length > 1 ? (
          <div className="space-y-1">
            <label
              htmlFor={NETWORK_FIELD_ID}
              className="block text-sm font-medium text-gray-700"
            >
              {translator.translateText(WHAT_TO_CHALLENGE)}
            </label>
            <Dropdown
              inputId={NETWORK_FIELD_ID}
              options={networkOptions}
              value={networkOptions.find((option: DropdownOption) => {
                return option.value === value;
              })}
              isClearable={false}
              disabled={isChallenging}
              onChange={(
                picked: DropdownValue | Array<DropdownValue> | null,
              ) => {
                if (typeof picked === "string" && picked !== value) {
                  setValue(picked);
                }
              }}
            />
          </div>
        ) : (
          <></>
        )}

        <div
          className="space-y-2"
          data-testid={SECURITY_CAMPAIGN_TEST_IDS.networkStanding}
          data-standing={check?.standing || ""}
          aria-live="polite"
        >
          {isChecking ? (
            <InlineValueSkeleton widthClassName="w-2/3" />
          ) : (
            <>
              {does ? <p className="text-sm text-gray-700">{does}</p> : <></>}
              {repeat ? (
                <p
                  className="text-sm text-amber-700"
                  data-testid={SECURITY_CAMPAIGN_TEST_IDS.repeatLine}
                >
                  {repeat}
                </p>
              ) : (
                <></>
              )}
              {words &&
              (words.sentences.length > 0 || words.asWritten) &&
              words.tone !== NetworkCheckTone.None ? (
                <Alert
                  type={
                    words.tone === NetworkCheckTone.Danger
                      ? AlertType.DANGER
                      : AlertType.WARNING
                  }
                  title={
                    <span className="space-y-1">
                      {words.sentences.map(
                        (sentence: string, index: number): ReactElement => {
                          return (
                            <span key={index} className="block">
                              {sentence}
                            </span>
                          );
                        },
                      )}
                      {words.asWritten ? (
                        <span className="block" dir="auto">
                          {words.asWritten}
                        </span>
                      ) : (
                        <></>
                      )}
                    </span>
                  }
                />
              ) : (
                <></>
              )}
              {needsAcknowledgement && check?.isAdmin ? (
                <Checkbox
                  title={NETWORK_ACKNOWLEDGE}
                  value={isAcknowledged}
                  disabled={isChallenging}
                  dataTestId={SECURITY_CAMPAIGN_TEST_IDS.acknowledge}
                  onChange={(isChecked: boolean) => {
                    setIsAcknowledged(isChecked);
                  }}
                />
              ) : (
                <></>
              )}
            </>
          )}
        </div>

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
              return option.value === length;
            })}
            isClearable={false}
            disabled={isChallenging}
            onChange={(picked: DropdownValue | Array<DropdownValue> | null) => {
              if (typeof picked === "string") {
                setDuration(picked as SecurityBlockDuration);
              }
            }}
          />
        </div>

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
            onChange={(text: string) => {
              setReason(text.slice(0, SECURITY_BLOCK_REASON_MAX_LENGTH));
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

export default ChallengeNetworkModal;
