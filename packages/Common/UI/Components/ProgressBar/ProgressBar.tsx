import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import { Logger } from "../../Utils/Logger";
import { translatableTerm, Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";

export enum ProgressBarSize {
  Small = "small",
  Medium = "medium",
  Large = "large",
}

export interface ComponentProps {
  count: number;
  totalCount: number;
  suffix: string;
  size?: ProgressBarSize;
}

/*
 * How far along, as the reader's language writes a percentage: "15%",
 * "15 %" in German and French, "۱۵٪" in Persian - in the digits the count
 * beside it is written in (Translator.formatNumber), so a Persian bar no
 * longer read "۱ از ۷" next to "15%".
 */
export const formatProgressPercent: (
  percent: number,
  language: string,
) => string = (percent: number, language: string): string => {
  try {
    return new Intl.NumberFormat(language, {
      style: "percent",
      maximumFractionDigits: 0,
    }).format(percent / 100);
  } catch {
    return `${percent}%`;
  }
};

const ProgressBar: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [percent, setPercent] = useState<number>(0);

  useEffect(() => {
    let percent: number = 0;

    try {
      /*
       * Dividing by zero does not throw in JavaScript — it yields NaN, which
       * the catch below never sees. `Math.ceil(NaN)` is NaN, and NaN then
       * reaches the DOM three times over: as `width: NaN%` (which the browser
       * silently discards, leaving an empty track), as aria-valuenow, and as
       * the visible "NaN%" readout beside the count. Every caller that had
       * noticed guarded its own render on a non-zero total; the ones that had
       * not simply showed it.
       */
      if (props.totalCount > 0) {
        percent = (props.count * 100) / props.totalCount;
      }
    } catch (err) {
      Logger.error(err as Error);
      // do nothing.
    }

    if (percent > 100) {
      percent = 100;
    }

    setPercent(Math.ceil(percent));
  }, [props.count, props.totalCount]);

  let progressBarSize: string = "h-4";

  if (props.size === ProgressBarSize.Small) {
    progressBarSize = "h-2.5";
  } else if (props.size === ProgressBarSize.Large) {
    progressBarSize = "h-6";
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-2">
        <div
          data-testid="progress-bar-count"
          className="text-sm font-medium text-gray-700"
        >
          {translator.translateTemplate("{{count}} of {{total}} {{suffix}}", {
            count: translator.formatNumber(props.count),
            total: translator.formatNumber(props.totalCount),
            suffix: translatableTerm(props.suffix),
          })}
        </div>
        <div
          data-testid="progress-bar-percent"
          className="text-sm font-medium text-indigo-600"
        >
          {formatProgressPercent(percent, translator.language)}
        </div>
      </div>
      <div
        className={`w-full ${progressBarSize} bg-gray-200 rounded-full overflow-hidden`}
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={translator.translateTemplate(
          "Progress: {{count}} of {{total}} {{suffix}} ({{percent}}%)",
          {
            count: translator.formatNumber(props.count),
            total: translator.formatNumber(props.totalCount),
            suffix: translatableTerm(props.suffix),
            percent: translator.formatNumber(percent),
          },
        )}
      >
        <div
          data-testid="progress-bar"
          className={`${progressBarSize} bg-indigo-600 rounded-full transition-all duration-300 ease-out`}
          style={{ width: percent + "%" }}
        ></div>
      </div>
    </div>
  );
};

export default ProgressBar;
