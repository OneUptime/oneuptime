import CopyTextButton from "../CopyTextButton/CopyTextButton";
import Icon from "../Icon/Icon";
import { getLineDirection } from "../../Utils/LineDirection";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import IconProp from "../../../Types/Icon/IconProp";
import { ReadingDirection } from "../../../Types/ReadingDirection";
import React, {
  FunctionComponent,
  ReactElement,
  useId,
  useState,
} from "react";

/*
 * ANOTHER SYSTEM'S OWN WORDS, FOLDED UNDER "DETAILS" (#7268).
 *
 * When an SMTP server, Twilio, a chat tool, a cloud, an LLM provider or the
 * website a probe checks fails, OneUptime says what happened and what to
 * do next in its own words first, in the reader's language - an Alert's
 * title, a dialog's description, a test's verdict. That system's own words
 * come second, here: folded until asked for, exactly as the system gave
 * them, never translated, and copyable for a support ticket or the
 * system's own help pages (Common/Types/Exception/OtherSystemFailure).
 *
 * Drawn under the Alert or the dialog's sentence that says what happened.
 * The words read the way they are written: an English mail server's answer
 * on an Arabic or Persian page keeps its own direction, its full stop at
 * its end. Long words scroll in their box, which keeps the page's height.
 *
 * Nothing is drawn when the system said nothing.
 */

export interface ComponentProps {
  // The other system's own words, as it gave them.
  details: string | null | undefined;
  /*
   * Drawn open: where no sentence of OneUptime's says what happened, the
   * system's words are all there is to read.
   */
  isOpenByDefault?: boolean | undefined;
  className?: string | undefined;
  dataTestId?: string | undefined;
}

const OtherSystemDetails: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isOpen, setIsOpen] = useState<boolean>(Boolean(props.isOpenByDefault));
  const wordsId: string = useId();

  const details: string = (props.details || "").trim();

  if (!details) {
    return <></>;
  }

  const testId: string = props.dataTestId || "other-system-details";

  // The fold's name, in the reader's language.
  const title: string = translator.translateText("Details") || "Details";

  // The way the system's words read, when it is not the page's way.
  const direction: ReadingDirection | undefined = getLineDirection(
    details,
    translator.language,
  );

  return (
    <div className={props.className || "mt-3"} data-testid={testId}>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md text-sm font-medium text-gray-700 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          aria-expanded={isOpen}
          aria-controls={wordsId}
          data-testid={`${testId}-toggle`}
          onClick={() => {
            setIsOpen(!isOpen);
          }}
        >
          <Icon
            icon={isOpen ? IconProp.ChevronDown : IconProp.ChevronRight}
            className="h-4 w-4 flex-shrink-0 text-gray-500"
          />
          {title}
        </button>
        {isOpen ? (
          <CopyTextButton
            textToBeCopied={details}
            size="xs"
            variant="soft"
          />
        ) : (
          <></>
        )}
      </div>
      {isOpen ? (
        <pre
          id={wordsId}
          dir={direction}
          tabIndex={0}
          aria-label={title}
          className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-gray-50 p-3 font-mono text-xs leading-5 text-gray-800 ring-1 ring-inset ring-gray-200"
          data-testid={`${testId}-words`}
        >
          {details}
        </pre>
      ) : (
        <></>
      )}
    </div>
  );
};

export default OtherSystemDetails;
