import {
  MerakiTestWords,
  TEST_COUNT_LABELS,
  drawMerakiTemplate,
  getMerakiTestWords,
} from "./MerakiWords";
import IconProp from "Common/Types/Icon/IconProp";
import { NetworkControllerTestResult } from "Common/Types/NetworkController/NetworkControllerConnectionTest";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * What a test of a Meraki key found, as the connect dialog shows it: a
 * pass with what a read will cover (networks, appliances), a warning that
 * says what will be missing, or a failure with what to do about it - and
 * Meraki's own answer under it, in English, as Meraki gave it.
 */

export interface ComponentProps {
  result: NetworkControllerTestResult;
  organizationName: string;
  onTryAgain: () => void;
}

const TONES: Record<
  MerakiTestWords["tone"],
  { box: string; icon: IconProp; iconColor: string }
> = {
  pass: {
    box: "bg-emerald-50 ring-emerald-200 text-emerald-900",
    icon: IconProp.CheckCircle,
    iconColor: "text-emerald-600",
  },
  warn: {
    box: "bg-amber-50 ring-amber-200 text-amber-900",
    icon: IconProp.Alert,
    iconColor: "text-amber-600",
  },
  fail: {
    box: "bg-red-50 ring-red-200 text-red-900",
    icon: IconProp.Error,
    iconColor: "text-red-600",
  },
};

const MerakiTestResultPanel: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const words: MerakiTestWords = getMerakiTestWords({
    result: props.result,
    organizationName: props.organizationName,
  });
  const tone: { box: string; icon: IconProp; iconColor: string } =
    TONES[words.tone];

  return (
    <div
      className={`rounded-md px-3 py-3 text-sm ring-1 ${tone.box}`}
      role={words.tone === "fail" ? "alert" : "status"}
      data-testid="meraki-test-result"
      data-status={words.tone}
    >
      <div className="flex items-start gap-2">
        <Icon
          icon={tone.icon}
          className={`mt-0.5 h-4 w-4 flex-shrink-0 ${tone.iconColor}`}
        />
        <div className="min-w-0 flex-1">
          <div className="font-medium">
            {drawMerakiTemplate(translator, words.headline)}
          </div>
          {words.counts ? (
            <dl
              className="mt-2 flex flex-wrap gap-x-6 gap-y-1"
              data-testid="meraki-test-counts"
            >
              <div className="flex items-baseline gap-1.5">
                <dt className="text-xs opacity-80">
                  {translator.translateText(TEST_COUNT_LABELS.networks)}
                </dt>
                <dd className="font-semibold tabular-nums">
                  {translator.formatNumber(words.counts.networks)}
                </dd>
              </div>
              <div className="flex items-baseline gap-1.5">
                <dt className="text-xs opacity-80">
                  {translator.translateText(TEST_COUNT_LABELS.appliances)}
                </dt>
                <dd className="font-semibold tabular-nums">
                  {translator.formatNumber(words.counts.appliances)}
                </dd>
              </div>
            </dl>
          ) : (
            <></>
          )}
          {words.advice ? (
            <p className="mt-1">{translator.translateText(words.advice)}</p>
          ) : (
            <></>
          )}
          {words.details ? (
            <p
              className="mt-2 break-words font-mono text-xs opacity-80"
              data-testid="meraki-test-details"
            >
              {words.details}
            </p>
          ) : (
            <></>
          )}
          {words.tone === "fail" ? (
            <div className="mt-3">
              <Button
                title="Try again"
                icon={IconProp.Refresh}
                buttonSize={ButtonSize.Small}
                buttonStyle={ButtonStyleType.NORMAL}
                onClick={props.onTryAgain}
                dataTestId="meraki-test-try-again"
              />
            </div>
          ) : (
            <></>
          )}
        </div>
      </div>
    </div>
  );
};

export default MerakiTestResultPanel;
