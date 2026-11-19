import IconProp from "Common/Types/Icon/IconProp";
import { Translator } from "Common/Types/Translator";
import Icon from "Common/UI/Components/Icon/Icon";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  TotpCodeWindow,
  TotpSecretReading,
  getTotpCodeWindow,
  readTotpSecret,
} from "Common/Utils/Totp/TotpSecret";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

export interface ComponentProps {
  // The setup key or otpauth:// link as it is being typed.
  value: unknown;
  // The clock the code is read from: this computer's, unless a test's.
  now?: (() => number) | undefined;
}

// How often the countdown moves.
const TICK_IN_MS: number = 1000;

/*
 * A code as an authenticator app shows it, in two halves: 492 039, and
 * 4920 3912 for eight digits. Easier to compare at a glance.
 */
export function groupTotpCode(code: string): string {
  const half: number = Math.ceil(code.length / 2);

  return `${code.slice(0, half)} ${code.slice(half)}`;
}

/*
 * The code a one-time code secret makes right now, under its setup key
 * field while it is typed (issue #9703), to check against the authenticator
 * app before saving: the same code there means the key was copied whole and
 * its link's settings were read right.
 *
 * It is made here, in the browser, from the key the person has just typed -
 * a key they already hold - and never from a stored secret, whose key is
 * never sent back. It follows this computer's clock, as the app follows the
 * phone's, and draws nothing while the value cannot make a code: the field's
 * own error says why.
 */
const TotpCodePreview: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const now: () => number =
    props.now ||
    ((): number => {
      return Date.now();
    });
  const [moment, setMoment] = useState<number>(now());

  useEffect(() => {
    const timer: ReturnType<typeof setInterval> = setInterval(() => {
      setMoment(now());
    }, TICK_IN_MS);

    return () => {
      clearInterval(timer);
    };
  }, [props.now]);

  const reading: TotpSecretReading = readTotpSecret(props.value);

  if (!reading.parameters) {
    return <></>;
  }

  const codeWindow: TotpCodeWindow = getTotpCodeWindow(
    reading.parameters,
    moment,
  );
  const secondsLeft: number = Math.max(
    1,
    Math.ceil((codeWindow.endsAtInMs - moment) / 1000),
  );

  return (
    <div
      data-testid="totp-code-preview"
      className="mt-3 flex items-start gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3"
    >
      <Icon
        icon={IconProp.DevicePhoneMobile}
        className="mt-0.5 h-5 w-5 flex-none text-gray-500"
      />
      <div className="min-w-0">
        <p className="text-xs font-medium text-gray-600">
          {translator.translateText("Current code")}
        </p>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p
            data-testid="totp-code-preview-code"
            dir="ltr"
            className="whitespace-nowrap font-mono text-2xl font-semibold tracking-widest text-gray-900"
          >
            {groupTotpCode(codeWindow.code)}
          </p>
          <p
            data-testid="totp-code-preview-countdown"
            className="text-xs text-gray-600"
          >
            {translator.translatePlural(
              {
                one: "New code in {{count}} second",
                other: "New code in {{count}} seconds",
              },
              secondsLeft,
            )}
          </p>
        </div>
        <p className="mt-1 text-sm text-gray-600">
          {translator.translateText(
            "Check that it matches the code your authenticator app shows now.",
          )}
        </p>
      </div>
    </div>
  );
};

export default TotpCodePreview;
