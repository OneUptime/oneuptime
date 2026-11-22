import DropFilterImpactApi, {
  DropFilterImpactRule,
  getDropFilterImpactRequest,
  getDropFilterImpactRequestKey,
} from "./DropFilterImpactApi";
import DropFilterImpactSummary from "./DropFilterImpactSummary";
import { IMPACT_UNCHECKED } from "./DropFilterImpactWords";
import {
  DropFilterImpact,
  DropFilterImpactRequest,
} from "Common/Types/Telemetry/DropFilterImpact";
import { TelemetryFieldSignal } from "Common/Types/Telemetry/TelemetryFieldReaders";
import InlineValueSkeleton from "Common/UI/Components/Skeleton/InlineValueSkeleton";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * WHAT A DROP OR SAMPLE FILTER BEING WRITTEN WOULD TAKE, AS IT IS WRITTEN
 * (#10436).
 *
 * The drop filter forms draw this under the filter's query and under its
 * action, and a filter's Enable in its question: the filter as the form or
 * the row holds it now, asked of the server a moment after it stops
 * changing (DropFilterImpactApi), and drawn by DropFilterImpactSummary. The
 * answer it has stays on screen, faded, while a newer one is on its way,
 * so the line never jumps out from under the person typing. It never
 * blocks anything: a question that fails says it could not check, and the
 * form saves as ever. A filter with no query yet, or a sample with no share
 * to keep, draws nothing: the form says what is missing there.
 */

// How long the filter must stay as it is before the server is asked.
export const DROP_FILTER_IMPACT_DELAY_IN_MS: number = 500;

export interface ComponentProps {
  signal: TelemetryFieldSignal;
  rule: DropFilterImpactRule;
  // Start with the details open.
  isDetailsOpen?: boolean | undefined;
  dataTestId?: string | undefined;
}

const DropFilterImpactPreview: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const request: DropFilterImpactRequest | null = getDropFilterImpactRequest(
    props.signal,
    props.rule,
  );
  const requestKey: string = request
    ? getDropFilterImpactRequestKey(request)
    : "";
  const [impact, setImpact] = useState<DropFilterImpact | null>(null);
  const [answeredKey, setAnsweredKey] = useState<string>("");
  const [error, setError] = useState<string>("");
  const dataTestId: string = props.dataTestId || "drop-filter-impact-preview";

  useEffect(() => {
    if (!request) {
      setImpact(null);
      setAnsweredKey("");
      setError("");
      return;
    }

    let isCurrent: boolean = true;
    const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
      DropFilterImpactApi.getImpact(request)
        .then((answer: DropFilterImpact) => {
          if (isCurrent) {
            setImpact(answer);
            setAnsweredKey(requestKey);
            setError("");
          }
        })
        .catch((err: unknown) => {
          if (isCurrent) {
            setImpact(null);
            setAnsweredKey(requestKey);
            setError(err instanceof Error ? err.message : String(err));
          }
        });
    }, DROP_FILTER_IMPACT_DELAY_IN_MS);

    return () => {
      isCurrent = false;
      clearTimeout(timer);
    };
  }, [requestKey]);

  if (!request) {
    return <></>;
  }

  if (error && answeredKey === requestKey) {
    return (
      <p
        className="mt-2 text-sm text-gray-600"
        data-testid={`${dataTestId}-unchecked`}
      >
        {translator.translateText(IMPACT_UNCHECKED)}
      </p>
    );
  }

  if (!impact) {
    return (
      <div className="mt-2" data-testid={`${dataTestId}-loading`}>
        <InlineValueSkeleton widthClassName="w-72 max-w-full" />
      </div>
    );
  }

  return (
    <div className="mt-2" data-testid={dataTestId}>
      <DropFilterImpactSummary
        impact={impact}
        isDetailsOpen={props.isDetailsOpen}
        isUpdating={answeredKey !== requestKey}
      />
    </div>
  );
};

export default DropFilterImpactPreview;
