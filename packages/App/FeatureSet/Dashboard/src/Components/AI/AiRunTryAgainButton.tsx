import IconProp from "Common/Types/Icon/IconProp";
import { getHandDrawnButtonStateClassName } from "Common/UI/Components/Button/ButtonStates";
import Icon from "Common/UI/Components/Icon/Icon";
import API from "Common/UI/Utils/API/API";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * Try again, for an AI run that did not finish (issue #6438): the one
 * button every AI card offers it with - an insight's triage, an incident's
 * or alert's investigation, and any other kind of run. The card says what
 * starting the run again means (onTryAgain posts to the server and reads
 * the card again); this button is what pressing it looks like: locked
 * while it works, and what stopped it - the server's words - under it.
 *
 * Offer it only to who may start the run: the server checks again.
 */

export interface ComponentProps {
  /*
   * Start the run again. Resolves once the server answered and the card
   * read where the run stands; rejects with the refusal to show.
   */
  onTryAgain: () => Promise<void>;
  // English, translated here. "Try again" unless the card says otherwise.
  label?: string | undefined;
  testId?: string | undefined;
}

const AiRunTryAgainButton: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isBusy, setIsBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef: React.MutableRefObject<boolean> = useRef<boolean>(true);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const testId: string = props.testId || "ai-run-try-again";

  const tryAgain: () => Promise<void> = async (): Promise<void> => {
    if (isBusy) {
      return;
    }

    setIsBusy(true);
    setError(null);

    try {
      await props.onTryAgain();
    } catch (err) {
      if (isMountedRef.current) {
        setError(
          API.getFriendlyMessage(err) ||
            (translator.translateText(
              "The run could not start again. Try again in a moment.",
            ) as string),
        );
      }
    } finally {
      if (isMountedRef.current) {
        setIsBusy(false);
      }
    }
  };

  return (
    <div className="space-y-1">
      <button
        type="button"
        data-testid={testId}
        disabled={isBusy}
        aria-busy={isBusy}
        className={`inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-indigo-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${getHandDrawnButtonStateClassName(
          {
            isBusy,
            hoverClassName: "hover:text-indigo-700 hover:underline",
          },
        )}`}
        onClick={() => {
          void tryAgain();
        }}
      >
        <Icon
          icon={IconProp.ArrowPath}
          className={`h-4 w-4 flex-shrink-0 ${isBusy ? "animate-spin" : ""}`}
        />
        {isBusy
          ? translator.translateText("Starting again…")
          : translator.translateText(props.label || "Try again")}
      </button>
      {error ? (
        <p
          role="alert"
          data-testid={`${testId}-error`}
          className="break-words text-sm text-red-700"
        >
          {error}
        </p>
      ) : (
        <></>
      )}
    </div>
  );
};

export default AiRunTryAgainButton;
