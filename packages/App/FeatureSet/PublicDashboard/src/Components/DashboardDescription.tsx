import {
  DESCRIPTION_COPY,
  DESCRIPTION_TEST_ID,
  DESCRIPTION_TOGGLE_TEST_ID,
} from "./PublicDashboardCopy";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

export interface ComponentProps {
  text: string;
}

/*
 * A dashboard's description under its name in the header: two lines, and
 * Show more when it holds more than two (#9132). It was cut to one line with
 * an ellipsis, and a phone, with no pointer to hover, had no way to read the
 * rest.
 *
 * Whether there is more is measured, not guessed from a length: the same
 * words take two lines on a laptop and five on a phone. Measured again as
 * the header's width changes. Open, the whole description is shown, with no
 * cap (Folds: a fold never cuts off what it holds), and Show less folds it.
 */
const DashboardDescription: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const textId: string = useId();
  const textRef: React.RefObject<HTMLParagraphElement> =
    useRef<HTMLParagraphElement>(null);
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [isCut, setIsCut] = useState<boolean>(false);

  const measure: () => void = useCallback((): void => {
    const element: HTMLParagraphElement | null = textRef.current;

    // Open, nothing is cut: keep what the folded text measured.
    if (!element || isOpen) {
      return;
    }

    setIsCut(element.scrollHeight > element.clientHeight + 1);
  }, [isOpen]);

  useEffect(() => {
    measure();

    const element: HTMLParagraphElement | null = textRef.current;

    if (!element || typeof ResizeObserver === "undefined") {
      return;
    }

    const observer: ResizeObserver = new ResizeObserver(() => {
      measure();
    });

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [measure, props.text]);

  return (
    <div>
      <p
        ref={textRef}
        id={textId}
        className={`break-words text-sm text-gray-500 ${
          isOpen ? "" : "line-clamp-2"
        }`}
        data-testid={DESCRIPTION_TEST_ID}
      >
        {props.text}
      </p>
      {isCut || isOpen ? (
        <button
          type="button"
          className="mt-0.5 rounded text-xs font-medium text-indigo-600 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          aria-expanded={isOpen}
          aria-controls={textId}
          data-testid={DESCRIPTION_TOGGLE_TEST_ID}
          onClick={() => {
            setIsOpen(!isOpen);
          }}
        >
          {isOpen
            ? translator.translateText(DESCRIPTION_COPY.showLess)
            : translator.translateText(DESCRIPTION_COPY.showMore)}
        </button>
      ) : (
        <></>
      )}
    </div>
  );
};

export default DashboardDescription;
