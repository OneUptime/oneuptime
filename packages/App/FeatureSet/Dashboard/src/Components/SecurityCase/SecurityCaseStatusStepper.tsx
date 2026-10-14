import IconProp from "Common/Types/Icon/IconProp";
import SecurityCaseStatus, {
  SECURITY_CASE_STATUSES,
} from "Common/Types/SecurityCase/SecurityCaseStatus";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  status: SecurityCaseStatus | string | undefined;
  // Undefined: the stepper only shows where the case is.
  onSelect?: ((status: SecurityCaseStatus) => void) | undefined;
  isDisabled?: boolean | undefined;
  disabledReason?: string | undefined;
}

// What each step means, as its tooltip.
const STEP_DESCRIPTIONS: Record<SecurityCaseStatus, string> = {
  [SecurityCaseStatus.New]: translationKey("Nobody has looked at it yet."),
  [SecurityCaseStatus.Investigating]: translationKey(
    "Someone is working out what happened.",
  ),
  [SecurityCaseStatus.Contained]: translationKey(
    "The threat can no longer do harm; the cleanup is still to do.",
  ),
  [SecurityCaseStatus.Closed]: translationKey(
    "Done, with a verdict on what it was.",
  ),
};

export function getSecurityCaseStepIndex(
  status: SecurityCaseStatus | string | undefined,
): number {
  const index: number = SECURITY_CASE_STATUSES.indexOf(
    status as SecurityCaseStatus,
  );

  return index === -1 ? 0 : index;
}

/*
 * Where a case is in its life, as four steps an analyst moves it through.
 * The steps behind it are ticked, its own is lit, and any step is a button:
 * a case may skip ahead (a false positive goes straight to Closed) or be
 * reopened.
 */
const SecurityCaseStatusStepper: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const currentIndex: number = getSecurityCaseStepIndex(props.status);
  const isClosed: boolean = props.status === SecurityCaseStatus.Closed;

  return (
    <ol
      className="grid grid-cols-2 gap-2 sm:grid-cols-4"
      aria-label={translator.translateText("Case status")}
    >
      {SECURITY_CASE_STATUSES.map(
        (status: SecurityCaseStatus, index: number): ReactElement => {
          const isCurrent: boolean = index === currentIndex;
          const isDone: boolean =
            index < currentIndex || (isClosed && isCurrent);
          const canSelect: boolean =
            Boolean(props.onSelect) && !props.isDisabled && !isCurrent;

          const tone: string = isCurrent
            ? isClosed
              ? "border-emerald-300 bg-emerald-50 text-emerald-800"
              : "border-indigo-300 bg-indigo-50 text-indigo-800"
            : isDone
              ? "border-gray-200 bg-white text-gray-700"
              : "border-dashed border-gray-200 bg-white text-gray-500";

          const marker: ReactElement = isDone ? (
            <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
              <Icon icon={IconProp.Check} className="h-3 w-3" />
            </span>
          ) : (
            <span
              className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                isCurrent
                  ? "bg-indigo-600 text-white"
                  : "border border-gray-300 text-gray-500"
              }`}
            >
              {index + 1}
            </span>
          );

          return (
            <li key={status}>
              <button
                type="button"
                data-testid={`security-case-step-${index}`}
                aria-current={isCurrent ? "step" : undefined}
                disabled={!canSelect}
                title={
                  props.isDisabled && props.disabledReason
                    ? props.disabledReason
                    : translator.translateText(STEP_DESCRIPTIONS[status])
                }
                className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm font-medium transition-colors ${tone} ${
                  canSelect
                    ? "cursor-pointer hover:border-indigo-300 hover:bg-indigo-50/60"
                    : "cursor-default"
                }`}
                onClick={() => {
                  if (canSelect && props.onSelect) {
                    props.onSelect(status);
                  }
                }}
              >
                {marker}
                <span className="truncate">
                  {translator.translateText(status)}
                </span>
              </button>
            </li>
          );
        },
      )}
    </ol>
  );
};

export default SecurityCaseStatusStepper;
