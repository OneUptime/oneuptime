import ScrubRuleAddressesApi from "./ScrubRuleAddressesApi";
import {
  HASH_INSTEAD,
  HASH_INSTEAD_NOT_ALLOWED,
  HASH_INSTEAD_TOOLTIP,
  HASHED_INSTEAD,
  HIDES_ADDRESSES_FROM_SECURITY_EVENTS,
  RULE_HIDES_ADDRESSES_FROM_SECURITY_EVENTS,
} from "./HashInsteadWords";
import LogScrubRule from "Common/Models/DatabaseModels/LogScrubRule";
import TraceScrubRule from "Common/Models/DatabaseModels/TraceScrubRule";
import IconProp from "Common/Types/Icon/IconProp";
import { ScrubRuleHidingAddresses } from "Common/Types/Telemetry/ScrubRuleAddresses";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import API from "Common/UI/Utils/API/API";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import Toast from "Common/UI/Utils/Toast";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * A SCRUB RULE THAT HIDES ADDRESSES FROM SECURITY EVENTS, SAID WHERE IT IS
 * (#10396).
 *
 * An IP Address rule that redacts or masks, on logs or traces Security
 * Events reads, leaves every attack there without an address. This says so
 * in one line - on the rule's own row ("This rule also hides ..."), or on
 * a finding the rule covers, naming it - with Hash Instead beside it: the
 * rule's action becomes Hash, people still read a token, and Security
 * Events' address vault names the address behind it. Once switched, the
 * page reads the rules again and the notice goes.
 *
 * The button is the scrub rule's own edit: a reader who may not edit rules
 * of its kind is told so where the button would be. A switch can be
 * switched back from the rule form, so it asks nothing first.
 */

export interface ComponentProps {
  rule: ScrubRuleHidingAddresses;
  // Name the rule (a finding's notice); on the rule's own row it is "this rule".
  namesRule?: boolean | undefined;
  // The rule now hashes: the page reads its rules again.
  onSwitched: (rule: ScrubRuleHidingAddresses) => void;
  dataTestId?: string | undefined;
}

export function getHashInsteadGate(
  signal: ScrubRuleHidingAddresses["signal"],
): PermissionGateResult {
  return PermissionGate.check(
    signal === "log" ? new LogScrubRule() : new TraceScrubRule(),
    ModelAction.Update,
    { sentence: HASH_INSTEAD_NOT_ALLOWED },
  );
}

/*
 * Hash Instead, the one switch (#10396): the rule's action becomes Hash, as
 * the person who pressed it, said in a toast. The notice beside a rule and
 * Security Events' setup item both draw it. A reader who may not edit rules
 * of its kind is told why where it is; with no permissions read yet, it is
 * not drawn.
 */
export const HashInsteadButton: FunctionComponent<{
  rule: Pick<ScrubRuleHidingAddresses, "signal" | "ruleId" | "ruleName">;
  onSwitched: (rule: ScrubRuleHidingAddresses) => void;
  buttonStyle?: ButtonStyleType | undefined;
  buttonSize?: ButtonSize | undefined;
  dataTestId: string;
}> = (props: {
  rule: Pick<ScrubRuleHidingAddresses, "signal" | "ruleId" | "ruleName">;
  onSwitched: (rule: ScrubRuleHidingAddresses) => void;
  buttonStyle?: ButtonStyleType | undefined;
  buttonSize?: ButtonSize | undefined;
  dataTestId: string;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const [isSwitching, setIsSwitching] = useState<boolean>(false);
  const gate: PermissionGateResult = getHashInsteadGate(props.rule.signal);

  const switchToHash: () => Promise<void> = async (): Promise<void> => {
    if (isSwitching || !gate.isAllowed) {
      return;
    }

    setIsSwitching(true);

    try {
      const switched: ScrubRuleHidingAddresses =
        await ScrubRuleAddressesApi.hashInstead({
          signal: props.rule.signal,
          ruleId: props.rule.ruleId,
        });

      Toast.success(
        translator.translateTemplate(HASHED_INSTEAD, {
          rule: switched.ruleName || props.rule.ruleName,
        }),
      );
      setIsSwitching(false);
      props.onSwitched(switched);
    } catch (err) {
      Toast.error(API.getFriendlyMessage(err));
      setIsSwitching(false);
    }
  };

  if (!gate.isAllowed && !gate.disabledReason) {
    return <></>;
  }

  return (
    <Button
      title={HASH_INSTEAD}
      icon={IconProp.Hashtag}
      buttonStyle={props.buttonStyle ?? ButtonStyleType.OUTLINE}
      buttonSize={props.buttonSize ?? ButtonSize.Normal}
      isLoading={isSwitching}
      disabled={!gate.isAllowed || isSwitching}
      tooltip={gate.isAllowed ? HASH_INSTEAD_TOOLTIP : gate.disabledReason}
      dataTestId={props.dataTestId}
      onClick={() => {
        void switchToHash();
      }}
    />
  );
};

const HashInsteadNotice: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const dataTestId: string = props.dataTestId || "hash-instead-notice";

  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2"
      data-testid={dataTestId}
      role="note"
    >
      <div className="flex min-w-0 flex-1 items-start gap-2">
        <Icon
          icon={IconProp.ShieldExclamation}
          className="mt-0.5 h-4 w-4 shrink-0 text-amber-600"
        />
        <p
          className="min-w-0 text-sm text-amber-900 [overflow-wrap:anywhere]"
          data-testid={`${dataTestId}-sentence`}
        >
          {props.namesRule ? (
            <TranslatedSentence
              template={RULE_HIDES_ADDRESSES_FROM_SECURITY_EVENTS}
              slots={{
                rule: (
                  <span className="font-medium">{props.rule.ruleName}</span>
                ),
              }}
            />
          ) : (
            translator.translateText(HIDES_ADDRESSES_FROM_SECURITY_EVENTS)
          )}
        </p>
      </div>
      <HashInsteadButton
        rule={props.rule}
        buttonSize={ButtonSize.Small}
        onSwitched={props.onSwitched}
        dataTestId={`${dataTestId}-button`}
      />
    </div>
  );
};

/*
 * The same line under the rule form's action choices, for a rule not saved
 * yet: the person picks Hash right above it.
 */
export const HashInsteadFormNote: FunctionComponent<{
  dataTestId?: string | undefined;
}> = (props: { dataTestId?: string | undefined }): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div
      className="mt-2 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2"
      data-testid={props.dataTestId || "hash-instead-form-note"}
      role="note"
    >
      <Icon
        icon={IconProp.ShieldExclamation}
        className="mt-0.5 h-4 w-4 shrink-0 text-amber-600"
      />
      <p className="min-w-0 text-sm text-amber-900">
        {translator.translateText(HIDES_ADDRESSES_FROM_SECURITY_EVENTS)}
      </p>
    </div>
  );
};

export default HashInsteadNotice;
