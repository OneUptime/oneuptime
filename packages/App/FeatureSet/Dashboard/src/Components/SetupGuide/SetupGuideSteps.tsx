import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { SetupGuideStepVariant } from "./SetupGuide";
import SetupGuideMarkdown from "./SetupGuideMarkdown";

/*
 * The numbered steps of a guide, joined by a line down the left — the same
 * layout as the telemetry ingestion guides, so every "get this connected"
 * page in the product reads the same way.
 */

export interface SetupGuideStepView {
  title: string;
  description?: string | undefined;
  content: ReactElement;
}

export interface ComponentProps {
  steps: Array<SetupGuideStepView>;
}

const SetupGuideSteps: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <ol className="list-none p-0 m-0" data-testid="setup-guide-steps">
      {props.steps.map((step: SetupGuideStepView, index: number) => {
        const isLast: boolean = index === props.steps.length - 1;
        const stepNumber: number = index + 1;

        return (
          <li
            key={`${stepNumber}-${step.title}`}
            className="relative flex gap-4 sm:gap-5"
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
              <h3 className="text-sm font-semibold leading-9 text-gray-900">
                <span className="sr-only">Step {stepNumber}: </span>
                {step.title}
              </h3>
              {step.description && (
                <p className="mb-3 mt-0.5 text-sm leading-relaxed text-gray-500">
                  {step.description}
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
 * as tabs, so only one set of commands is on screen at a time.
 */
export interface SetupGuideStepVariantsProps {
  variants: Array<SetupGuideStepVariant>;
}

export const SetupGuideStepVariants: FunctionComponent<
  SetupGuideStepVariantsProps
> = (props: SetupGuideStepVariantsProps): ReactElement => {
  const baseId: string = `setup-guide-variant-${useId()}`;
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const tabRefs: React.MutableRefObject<Array<HTMLButtonElement | null>> =
    useRef<Array<HTMLButtonElement | null>>([]);

  const labels: string = props.variants
    .map((variant: SetupGuideStepVariant): string => {
      return variant.label;
    })
    .join("\n");

  // A different set of tabs (another option picked above) starts on the first.
  useEffect(() => {
    setSelectedIndex(0);
  }, [labels]);

  if (props.variants.length === 0) {
    return <></>;
  }

  const safeIndex: number =
    selectedIndex < props.variants.length ? selectedIndex : 0;
  const selected: SetupGuideStepVariant = props.variants[safeIndex]!;

  if (props.variants.length === 1) {
    return <SetupGuideMarkdown text={selected.markdown} />;
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
    setSelectedIndex(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <div>
      <div
        role="tablist"
        className="mb-3 inline-flex max-w-full flex-wrap gap-0.5 rounded-lg border border-gray-200 bg-gray-50 p-0.5"
      >
        {props.variants.map((variant: SetupGuideStepVariant, index: number) => {
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
                setSelectedIndex(index);
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
        })}
      </div>
      <div
        role="tabpanel"
        id={`${baseId}-panel`}
        aria-labelledby={`${baseId}-tab-${safeIndex}`}
      >
        <SetupGuideMarkdown text={selected.markdown} />
      </div>
    </div>
  );
};
