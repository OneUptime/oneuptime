import React, {
  FunctionComponent,
  ReactElement,
  RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { withUnbrokenFlags } from "./UnbrokenFlags";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  PAGE_ANCHOR_SCROLL_MARGIN_TOP,
  bringPageAnchorIntoView,
  getPageAnchor,
  markPageAnchorLanded,
} from "Common/UI/Utils/PageAnchor";

/*
 * The numbered steps of a guide, joined by a line down the left — the same
 * layout as the telemetry ingestion guides, so every "get this connected"
 * page in the product reads the same way.
 *
 * A step with a place of its own (`anchor`) is where a link that names it
 * lands: opened at ".../documentation#send-notifications", the page brings
 * that step under its sticky header - and keeps it there while step 1's key
 * picker loads above it - marks it for a moment and hands it the keyboard's
 * focus, as a link to a settings card does (Common/UI/Utils/PageAnchor).
 */

export interface SetupGuideStepView {
  title: string;
  // The step's place on the page: a plain name, unique in the guide.
  anchor?: string | undefined;
  description?: string | undefined;
  content: ReactElement;
}

// The step the page's address names, if this guide has it; else "".
export function getAnchoredSetupGuideStep(
  steps: Array<SetupGuideStepView>,
  anchor: string,
): string {
  if (!anchor) {
    return "";
  }
  return steps.some((step: SetupGuideStepView): boolean => {
    return step.anchor === anchor;
  })
    ? anchor
    : "";
}

export interface ComponentProps {
  steps: Array<SetupGuideStepView>;
}

const SetupGuideSteps: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const listRef: RefObject<HTMLOListElement> = useRef<HTMLOListElement>(null);

  const anchoredStep: string = getAnchoredSetupGuideStep(
    props.steps,
    getPageAnchor(),
  );

  /*
   * Opened at one of its steps: bring it into view and keep it there while
   * the guide above it settles, and mark it. The anchor is a plain name
   * (getPageAnchor reads no other), so it is safe in the selector as it is.
   */
  useEffect(() => {
    const list: HTMLOListElement | null = listRef.current;

    if (!anchoredStep || !list) {
      return undefined;
    }

    const step: HTMLElement | null = list.querySelector<HTMLElement>(
      `[id="${anchoredStep}"]`,
    );

    if (!step) {
      return undefined;
    }

    const stopBringingIntoView: () => void = bringPageAnchorIntoView(step);
    const unmark: () => void = markPageAnchorLanded(step);

    return (): void => {
      stopBringingIntoView();
      unmark();
    };
  }, [anchoredStep]);

  return (
    <ol
      ref={listRef}
      className="list-none p-0 m-0"
      data-testid="setup-guide-steps"
    >
      {props.steps.map((step: SetupGuideStepView, index: number) => {
        const isLast: boolean = index === props.steps.length - 1;
        const stepNumber: number = index + 1;

        return (
          <li
            key={`${stepNumber}-${step.title}`}
            id={step.anchor}
            // Its top lands under the page's sticky header, not behind it.
            style={
              step.anchor
                ? { scrollMarginTop: PAGE_ANCHOR_SCROLL_MARGIN_TOP }
                : undefined
            }
            className="relative flex gap-4 rounded-lg sm:gap-5"
            data-testid={`setup-guide-step-${stepNumber}`}
          >
            <div className="flex flex-shrink-0 flex-col items-center">
              <div
                aria-hidden="true"
                className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-indigo-500 bg-indigo-50 text-sm font-bold text-indigo-600"
              >
                {stepNumber}
              </div>
              {!isLast && <div className="mt-2 w-0.5 flex-1 bg-gray-200" />}
            </div>
            <div className={`min-w-0 flex-1 ${isLast ? "pb-0" : "pb-8"}`}>
              {/*
               * As tall as the number beside it (36px) for one line, its
               * text centred on the number; a title that wraps (a phone, a
               * long language) continues at the text's own line height.
               */}
              <h3 className="py-1.5 text-sm font-semibold leading-6 text-gray-900">
                {/* What a screen reader says before the title, in its language. */}
                <span className="sr-only">
                  {translator.translateTemplate("Step {{number}}:", {
                    number: String(stepNumber),
                  })}{" "}
                </span>
                {step.title}
              </h3>
              {step.description && (
                <p className="mb-3 mt-0.5 text-sm leading-relaxed text-gray-500">
                  {withUnbrokenFlags(step.description)}
                </p>
              )}
              {step.content}
            </div>
          </li>
        );
      })}
    </ol>
  );
};

export default SetupGuideSteps;

/*
 * Alternative ways of doing one step — install script or Docker Compose —
 * as tabs, so only one set of commands is on screen at a time. Each variant
 * arrives rendered: SetupGuideCard renders markdown variants into these, and
 * the telemetry guides pass their own code blocks.
 */
export interface SetupGuideStepVariantView {
  label: string;
  content: ReactElement;
}

export interface SetupGuideStepVariantsProps {
  variants: Array<SetupGuideStepVariantView>;
  /*
   * Link the tabs of several steps by label. `selectedLabels` is every tab
   * label the reader has picked anywhere in the guide, most recent first;
   * the step shows the first of them it has, and picking a tab reports its
   * label. A guide whose steps all offer "SDK direct" and "Sidecar
   * collector" then switches every step at once instead of asking the reader
   * to pick the same tab in each — and a later pick in an unrelated step
   * ("In Docker") does not undo it.
   */
  selectedLabels?: Array<string> | undefined;
  onSelectLabel?: ((label: string) => void) | undefined;
}

export const SetupGuideStepVariants: FunctionComponent<
  SetupGuideStepVariantsProps
> = (props: SetupGuideStepVariantsProps): ReactElement => {
  const baseId: string = `setup-guide-variant-${useId()}`;
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const tabRefs: React.MutableRefObject<Array<HTMLButtonElement | null>> =
    useRef<Array<HTMLButtonElement | null>>([]);

  const labels: string = props.variants
    .map((variant: SetupGuideStepVariantView): string => {
      return variant.label;
    })
    .join("\n");

  /*
   * A different set of tabs (another option picked above) starts on the
   * first. This is settled while rendering, not in an effect: an effect runs
   * once the tabs are already on screen, so a tab picked before it ran would
   * be switched back to the first one.
   */
  const [shownLabels, setShownLabels] = useState<string>(labels);
  if (shownLabels !== labels) {
    setShownLabels(labels);
    setSelectedIndex(0);
  }

  if (props.variants.length === 0) {
    return <></>;
  }

  let linkedIndex: number = -1;
  for (const label of props.selectedLabels || []) {
    linkedIndex = props.variants.findIndex(
      (variant: SetupGuideStepVariantView): boolean => {
        return variant.label === label;
      },
    );
    if (linkedIndex >= 0) {
      break;
    }
  }
  const safeIndex: number =
    linkedIndex >= 0
      ? linkedIndex
      : selectedIndex < props.variants.length
        ? selectedIndex
        : 0;
  const selected: SetupGuideStepVariantView = props.variants[safeIndex]!;

  const select: (index: number) => void = (index: number): void => {
    setSelectedIndex(index);
    if (props.onSelectLabel) {
      props.onSelectLabel(props.variants[index]!.label);
    }
  };

  if (props.variants.length === 1) {
    return selected.content;
  }

  const onKeyDown: (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => void = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ): void => {
    const last: number = props.variants.length - 1;
    let next: number | null = null;

    if (event.key === "ArrowRight") {
      next = index >= last ? 0 : index + 1;
    } else if (event.key === "ArrowLeft") {
      next = index <= 0 ? last : index - 1;
    } else if (event.key === "Home") {
      next = 0;
    } else if (event.key === "End") {
      next = last;
    }

    if (next === null) {
      return;
    }

    event.preventDefault();
    select(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <div>
      <div
        role="tablist"
        className="mb-3 inline-flex max-w-full flex-wrap gap-0.5 rounded-lg border border-gray-200 bg-gray-50 p-0.5"
      >
        {props.variants.map(
          (variant: SetupGuideStepVariantView, index: number) => {
            const isSelected: boolean = index === safeIndex;
            return (
              <button
                key={variant.label}
                ref={(element: HTMLButtonElement | null) => {
                  tabRefs.current[index] = element;
                }}
                type="button"
                role="tab"
                id={`${baseId}-tab-${index}`}
                aria-selected={isSelected}
                aria-controls={`${baseId}-panel`}
                tabIndex={isSelected ? 0 : -1}
                onClick={() => {
                  select(index);
                }}
                onKeyDown={(event: React.KeyboardEvent<HTMLButtonElement>) => {
                  onKeyDown(event, index);
                }}
                data-testid="setup-guide-step-variant"
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                  isSelected
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {variant.label}
              </button>
            );
          },
        )}
      </div>
      <div
        role="tabpanel"
        id={`${baseId}-panel`}
        aria-labelledby={`${baseId}-tab-${safeIndex}`}
      >
        {selected.content}
      </div>
    </div>
  );
};
