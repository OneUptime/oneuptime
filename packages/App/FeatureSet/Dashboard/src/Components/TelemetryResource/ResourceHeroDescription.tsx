import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  RESOURCE_HERO_DESCRIPTION_CLASS_NAME,
  RESOURCE_HERO_DESCRIPTION_COLLAPSED_CLASS_NAME,
  RESOURCE_HERO_DESCRIPTION_TEST_ID,
  RESOURCE_HERO_DESCRIPTION_TOGGLE_CLASS_NAME,
  RESOURCE_HERO_DESCRIPTION_TOGGLE_TEST_ID,
} from "./ResourceHeroLayout";

/*
 * A resource's description under its name in its hero: what the resource
 * is, in its owner's words (ResourceHeroLayout says how it is laid out and
 * why). Nothing at all when the resource has none, so a hero without one
 * keeps its height.
 *
 * Two lines, and when it is longer than that, "Show more" under them opens
 * the rest - on a phone, a tablet and from the keyboard alike, which a hover
 * title never reached.
 */

export interface ComponentProps {
  text: string | null | undefined;
}

const ResourceHeroDescription: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const textId: string = useId();
  const textRef: React.RefObject<HTMLParagraphElement> =
    useRef<HTMLParagraphElement>(null);
  const text: string = (props.text || "").trim();
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [isLong, setIsLong] = useState<boolean>(false);
  const [shownText, setShownText] = useState<string>(text);

  // A different description (the resource was edited): start it collapsed.
  if (shownText !== text) {
    setShownText(text);
    setIsExpanded(false);
  }

  /*
   * Whether the words run past their two lines is measured: the hero is a
   * phone's column, a row beside the side menu or a wide monitor's, and
   * the same words take two lines in one and four in another. Measured
   * again when the paragraph's box changes (a turned phone, the side menu)
   * and once the page's font has loaded. While expanded, the last
   * measurement stands, which keeps "Show less" on screen for the reader
   * who opened it.
   */
  useLayoutEffect(() => {
    const element: HTMLParagraphElement | null = textRef.current;

    if (!element || isExpanded) {
      return undefined;
    }

    let isCurrent: boolean = true;

    const measure: () => void = (): void => {
      if (!isCurrent) {
        return;
      }

      // The extra pixel absorbs sub-pixel rounding between the two heights.
      setIsLong(element.scrollHeight > element.clientHeight + 1);
    };

    measure();

    if (typeof document !== "undefined" && document.fonts) {
      document.fonts.ready
        .then(() => {
          measure();
        })
        .catch(() => {
          // A font that never loads changes nothing measured already.
        });
    }

    // ResizeObserver is missing in jsdom and in older browsers.
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);

      return () => {
        isCurrent = false;
        window.removeEventListener("resize", measure);
      };
    }

    const observer: ResizeObserver = new ResizeObserver(measure);
    observer.observe(element);

    return () => {
      isCurrent = false;
      observer.disconnect();
    };
  }, [isExpanded, text]);

  if (!text) {
    return <></>;
  }

  const textClassName: string = isExpanded
    ? RESOURCE_HERO_DESCRIPTION_CLASS_NAME
    : `${RESOURCE_HERO_DESCRIPTION_CLASS_NAME} ${RESOURCE_HERO_DESCRIPTION_COLLAPSED_CLASS_NAME}`;

  return (
    <>
      <p
        ref={textRef}
        id={textId}
        data-testid={RESOURCE_HERO_DESCRIPTION_TEST_ID}
        dir="auto"
        className={textClassName}
      >
        {text}
      </p>
      {isLong ? (
        <button
          type="button"
          data-testid={RESOURCE_HERO_DESCRIPTION_TOGGLE_TEST_ID}
          onClick={() => {
            setIsExpanded(!isExpanded);
          }}
          aria-expanded={isExpanded}
          aria-controls={textId}
          className={RESOURCE_HERO_DESCRIPTION_TOGGLE_CLASS_NAME}
        >
          {isExpanded
            ? translator.translateText("Show less")
            : translator.translateText("Show more")}
          <Icon
            icon={IconProp.ChevronDown}
            className={`h-3.5 w-3.5 motion-safe:transition-transform ${
              isExpanded ? "rotate-180" : ""
            }`}
          />
        </button>
      ) : (
        <></>
      )}
    </>
  );
};

export default ResourceHeroDescription;
