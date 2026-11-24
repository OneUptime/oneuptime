import { ProjectNotificationChannel } from "../NotificationMethods/ProjectNotificationChannelsCopy";
import SetupHealthQuickFixApi, {
  CREATE_ON_CALL_RULE_WORDS,
  SetupHealthPolicyChoice,
  SetupHealthQuickFixKind,
  TURN_ON_CHANNEL_UNDO,
  TURN_ON_CHANNEL_WORDS,
  canApplySetupHealthQuickFix,
  getEventKind,
  getSetupHealthQuickFixKind,
  getTurnOnChannelBalanceNote,
} from "./SetupHealthQuickFix";
import { ProductEventName } from "Common/Types/Analytics/ProductEvent";
import {
  SetupHealthEventKind,
  SetupHealthFinding,
} from "Common/Types/SetupHealth/SetupHealth";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { BILLING_ENABLED } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ProductEvents from "Common/UI/Utils/ProductEvents";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * A FINDING'S ONE-CLICK FIX (#7299, SetupHealthQuickFix): a button beside
 * the link to its page, for someone allowed to make the change, that opens
 * a dialog saying exactly what will change - and makes it only once they
 * confirm. Nothing is drawn for a finding with no one-click fix, or for
 * someone who may not apply it: they keep the link.
 */

// The fix done here: the row's one solid button, beside the tinted link.
export const QUICK_FIX_CLASS_NAME: string =
  "inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-2.5 py-1 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2";

export interface ComponentProps {
  finding: SetupHealthFinding;
  // Called once the change is made: the list reads again, without it.
  onApplied: () => void;
}

const SetupHealthQuickFixButton: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const kind: SetupHealthQuickFixKind | null = getSetupHealthQuickFixKind(
    props.finding,
  );

  /*
   * Read on every render rather than remembered: the permission snapshot
   * arrives on a response header, and may land after the first paint.
   */
  if (!kind || !canApplySetupHealthQuickFix(props.finding)) {
    return <></>;
  }

  const buttonText: string =
    kind === SetupHealthQuickFixKind.TurnOnChannel
      ? TURN_ON_CHANNEL_WORDS[
          props.finding.subject as ProjectNotificationChannel
        ].button
      : CREATE_ON_CALL_RULE_WORDS.button;

  const onApplied: () => void = (): void => {
    ProductEvents.send(ProductEventName.SetupHealthFixApplied, {
      check: props.finding.check,
      level: props.finding.level,
    });
    setIsOpen(false);
    props.onApplied();
  };

  return (
    <>
      <button
        type="button"
        className={QUICK_FIX_CLASS_NAME}
        data-testid="setup-health-quick-fix"
        data-quick-fix={kind}
        onClick={() => {
          setIsOpen(true);
        }}
      >
        {translator.translateText(buttonText) || buttonText}
      </button>
      {isOpen && kind === SetupHealthQuickFixKind.TurnOnChannel ? (
        <TurnOnChannelDialog
          channel={props.finding.subject as ProjectNotificationChannel}
          onClose={() => {
            setIsOpen(false);
          }}
          onApplied={onApplied}
        />
      ) : (
        <></>
      )}
      {isOpen && kind === SetupHealthQuickFixKind.CreateOnCallRule ? (
        <CreateOnCallRuleDialog
          finding={props.finding}
          onClose={() => {
            setIsOpen(false);
          }}
          onApplied={onApplied}
        />
      ) : (
        <></>
      )}
    </>
  );
};

/*
 * Turning a channel on, for the whole project: what will change, what it
 * costs on OneUptime Cloud, and where it is turned off again.
 */
const TurnOnChannelDialog: FunctionComponent<{
  channel: ProjectNotificationChannel;
  onClose: () => void;
  onApplied: () => void;
}> = (props: {
  channel: ProjectNotificationChannel;
  onClose: () => void;
  onApplied: () => void;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const [isApplying, setIsApplying] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const words: { button: string; whatChanges: string } =
    TURN_ON_CHANNEL_WORDS[props.channel];

  const apply: () => Promise<void> = async (): Promise<void> => {
    setIsApplying(true);
    setError("");

    try {
      await SetupHealthQuickFixApi.turnOnChannel(props.channel);
      setIsApplying(false);
      props.onApplied();
    } catch (err) {
      setError(API.getFriendlyMessage(err as Error));
      setIsApplying(false);
    }
  };

  return (
    <ConfirmModal
      title={words.button}
      description={
        <div className="space-y-2" data-testid="setup-health-quick-fix-dialog">
          <p
            className="text-sm text-gray-900"
            data-testid="setup-health-quick-fix-change"
          >
            {translator.translateText(words.whatChanges)}
          </p>
          {BILLING_ENABLED ? (
            <p
              className="text-sm text-gray-600"
              data-testid="setup-health-quick-fix-cost"
            >
              {translator.translateText(
                getTurnOnChannelBalanceNote(props.channel),
              )}
            </p>
          ) : (
            <></>
          )}
          <p
            className="text-sm text-gray-500"
            data-testid="setup-health-quick-fix-undo"
          >
            {translator.translateText(TURN_ON_CHANNEL_UNDO)}
          </p>
        </div>
      }
      submitButtonText={words.button}
      isLoading={isApplying}
      error={error || undefined}
      onSubmit={() => {
        void apply();
      }}
      onClose={() => {
        if (!isApplying) {
          props.onClose();
        }
      }}
    />
  );
};

type PolicyLoad =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; policies: Array<SetupHealthPolicyChoice> };

/*
 * An on-call rule for one monitor: the policy it pages - picked for them
 * when the project has only one, never guessed among several - the
 * sentence of what it will do, and where it is turned off or deleted.
 */
const CreateOnCallRuleDialog: FunctionComponent<{
  finding: SetupHealthFinding;
  onClose: () => void;
  onApplied: () => void;
}> = (props: {
  finding: SetupHealthFinding;
  onClose: () => void;
  onApplied: () => void;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const [load, setLoad] = useState<PolicyLoad>({ status: "loading" });
  const [picked, setPicked] = useState<SetupHealthPolicyChoice | null>(null);
  const [isApplying, setIsApplying] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const eventKind: SetupHealthEventKind = getEventKind(props.finding);
  const monitorName: string = props.finding.record.name;

  useEffect(() => {
    let isCurrent: boolean = true;

    SetupHealthQuickFixApi.getPolicies()
      .then((policies: Array<SetupHealthPolicyChoice>) => {
        if (!isCurrent) {
          return;
        }

        setLoad({ status: "loaded", policies: policies });

        if (policies.length === 1) {
          setPicked(policies[0]!);
        }
      })
      .catch((err: unknown) => {
        if (isCurrent) {
          setLoad({
            status: "error",
            message: API.getFriendlyMessage(err as Error),
          });
        }
      });

    return () => {
      isCurrent = false;
    };
  }, []);

  const apply: () => Promise<void> = async (): Promise<void> => {
    if (!picked) {
      return;
    }

    setIsApplying(true);
    setError("");

    try {
      await SetupHealthQuickFixApi.createOnCallRule({
        eventKind: eventKind,
        monitorId: props.finding.record.id,
        monitorName: monitorName,
        policy: picked,
        translator: translator,
      });
      setIsApplying(false);
      props.onApplied();
    } catch (err) {
      setError(API.getFriendlyMessage(err as Error));
      setIsApplying(false);
    }
  };

  const policies: Array<SetupHealthPolicyChoice> =
    load.status === "loaded" ? load.policies : [];

  const options: Array<DropdownOption> = policies.map(
    (policy: SetupHealthPolicyChoice): DropdownOption => {
      // A policy's name is the project's own, drawn as written.
      return {
        value: policy.id,
        label: policy.name,
        isUserContent: true,
        sharedName: policy.sharedName,
      };
    },
  );

  const getBody: () => ReactElement = (): ReactElement => {
    if (load.status === "loaded" && policies.length === 0) {
      return (
        <p className="text-sm text-gray-600">
          {translator.translateText(CREATE_ON_CALL_RULE_WORDS.noPolicy)}
        </p>
      );
    }

    return (
      <div className="space-y-3">
        {load.status === "loading" ? (
          <p
            className="text-sm text-gray-500"
            data-testid="setup-health-quick-fix-loading"
          >
            {translator.translateText("Loading...")}
          </p>
        ) : (
          <></>
        )}
        {policies.length > 1 ? (
          <div
            className="space-y-1"
            data-testid="setup-health-quick-fix-policy"
          >
            <label
              id="setup-health-quick-fix-policy-label"
              className="block text-sm font-medium text-gray-700"
            >
              {translator.translateText(CREATE_ON_CALL_RULE_WORDS.policyLabel)}
            </label>
            <Dropdown
              options={options}
              value={options.find((option: DropdownOption): boolean => {
                return option.value === picked?.id;
              })}
              isClearable={false}
              ariaLabelledby="setup-health-quick-fix-policy-label"
              onChange={(
                value: DropdownValue | Array<DropdownValue> | null,
              ): void => {
                setPicked(
                  policies.find((policy: SetupHealthPolicyChoice): boolean => {
                    return policy.id === value;
                  }) || null,
                );
              }}
            />
          </div>
        ) : (
          <></>
        )}
        {picked ? (
          <p
            className="text-sm text-gray-900"
            data-testid="setup-health-quick-fix-change"
          >
            <TranslatedSentence
              template={CREATE_ON_CALL_RULE_WORDS.whatChanges[eventKind]}
              slots={{
                monitor: <span className="font-semibold">{monitorName}</span>,
                policy: <span className="font-semibold">{picked.name}</span>,
              }}
            />
          </p>
        ) : (
          <></>
        )}
        <p
          className="text-sm text-gray-500"
          data-testid="setup-health-quick-fix-undo"
        >
          {translator.translateText(CREATE_ON_CALL_RULE_WORDS.undo[eventKind])}
        </p>
      </div>
    );
  };

  return (
    <ConfirmModal
      title={CREATE_ON_CALL_RULE_WORDS.button}
      description={
        <div data-testid="setup-health-quick-fix-dialog">{getBody()}</div>
      }
      submitButtonText={CREATE_ON_CALL_RULE_WORDS.button}
      isLoading={isApplying}
      disableSubmitButton={!picked}
      error={
        error ||
        (load.status === "error" ? load.message : undefined) ||
        undefined
      }
      onSubmit={() => {
        void apply();
      }}
      onClose={() => {
        if (!isApplying) {
          props.onClose();
        }
      }}
    />
  );
};

export default SetupHealthQuickFixButton;
