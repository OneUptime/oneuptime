import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import IconProp from "Common/Types/Icon/IconProp";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import API from "Common/UI/Utils/API/API";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { describeAiRunRefusal } from "./AiRunFailureWords";
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
 * the card again); this button is what pressing it looks like: the
 * product's outline button, busy while it works, and what stopped it - the
 * server's words - on a line of its own under the notice's actions.
 *
 * Offer it only to who may start the run: the server checks again.
 */

export interface ComponentProps {
  /*
   * Start the run again. Resolves once the server answered and the card
   * read where the run stands; rejects with the refusal to show.
   */
  onTryAgain: () => Promise<void>;
  // English, translated by the button. "Try again" unless the card says otherwise.
  label?: string | undefined;
  testId?: string | undefined;
}

/*
 * The refusal's line: in a notice's row of actions (a wrapping flex row) it
 * takes a whole line after the last of them - never between Try again and
 * Details, which it pushed onto a line of their own. Anywhere else it is a
 * paragraph under the button.
 */
export const TRY_AGAIN_ERROR_CLASS_NAME: string =
  "order-last basis-full break-words text-sm leading-6 text-red-700";

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
        /*
         * The server's refusal says why ("... is queued or running
         * already"), in the reader's language when the Dashboard words it
         * (describeAiRunRefusal); anything else gets the button's own words.
         */
        setError(
          err instanceof HTTPErrorResponse || err instanceof Error
            ? describeAiRunRefusal(API.getFriendlyMessage(err), translator)
            : (translator.translateText(
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
    <>
      <Button
        title={isBusy ? "Starting again…" : props.label || "Try again"}
        icon={IconProp.Refresh}
        buttonStyle={ButtonStyleType.OUTLINE}
        buttonSize={ButtonSize.Small}
        isLoading={isBusy}
        dataTestId={testId}
        onClick={() => {
          void tryAgain();
        }}
      />
      {/*
       * A refusal the Dashboard does not word stays in the server's
       * English, the button's own words are in the reader's language:
       * dir="auto" lays each out by its first letter, so an English refusal
       * on a page that reads right to left keeps its full stop at the end.
       */}
      {error ? (
        <p
          role="alert"
          dir="auto"
          data-testid={`${testId}-error`}
          className={TRY_AGAIN_ERROR_CLASS_NAME}
        >
          {error}
        </p>
      ) : (
        <></>
      )}
    </>
  );
};

export default AiRunTryAgainButton;
