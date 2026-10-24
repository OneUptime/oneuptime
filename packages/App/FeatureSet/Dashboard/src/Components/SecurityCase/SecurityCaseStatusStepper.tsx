import SecurityCaseStatus from "Common/Models/DatabaseModels/SecurityCaseStatus";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { isArchivedValue } from "Common/Utils/ArchivableValues";
import SecurityCaseStatuses from "Common/Utils/SecurityCase/SecurityCaseStatuses";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  // The project's case statuses (Security Events > Settings > Case Statuses).
  statuses: ReadonlyArray<SecurityCaseStatus>;
  statusId: ObjectID | string | undefined;
  // Undefined: the stepper only shows where the case is.
  onSelect?: ((status: SecurityCaseStatus) => void) | undefined;
  isDisabled?: boolean | undefined;
  disabledReason?: string | undefined;
}

/*
 * The steps a case shows: the project's statuses in their order, but for
 * the archived ones - nobody moves a case to one again - unless the case is
 * in it.
 */
export function getSecurityCaseSteps(data: {
  statuses: ReadonlyArray<SecurityCaseStatus>;
  statusId: ObjectID | string | undefined;
}): Array<SecurityCaseStatus> {
  const current: string = data.statusId ? data.statusId.toString() : "";

  return SecurityCaseStatuses.sort(data.statuses).filter(
    (status: SecurityCaseStatus): boolean => {
      return !isArchivedValue(status) || status.id?.toString() === current;
    },
  );
}

// Where the case is among its steps; 0 (the first) for a status it cannot find.
export function getSecurityCaseStepIndex(
  steps: ReadonlyArray<SecurityCaseStatus>,
  statusId: ObjectID | string | undefined,
): number {
  const current: string = statusId ? statusId.toString() : "";
  const index: number = steps.findIndex(
    (status: SecurityCaseStatus): boolean => {
      return status.id?.toString() === current;
    },
  );

  return index === -1 ? 0 : index;
}

/*
 * The grid the steps sit on: one row of up to four, then rows of three on a
 * tablet and the whole list on a wide screen, two to a row on a phone. The
 * classes are spelled out so Tailwind finds them.
 */
export function getSecurityCaseStepsGridClassName(count: number): string {
  if (count <= 1) {
    return "grid-cols-1";
  }

  if (count === 2) {
    return "grid-cols-2";
  }

  if (count === 3) {
    return "grid-cols-2 sm:grid-cols-3";
  }

  if (count === 4) {
    return "grid-cols-2 sm:grid-cols-4";
  }

  if (count === 5) {
    return "grid-cols-2 sm:grid-cols-3 xl:grid-cols-5";
  }

  if (count === 6) {
    return "grid-cols-2 sm:grid-cols-3 xl:grid-cols-6";
  }

  return "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4";
}

/*
 * Where a case is in its life, as the project's statuses an analyst moves it
 * through, in their order. The steps behind it are ticked, its own is lit
 * (green once it counts as closed), and any step is a button: a case may
 * skip ahead (a false positive goes straight to Closed) or be reopened.
 * Each step says what it is for on hover: the status's own description.
 */
const SecurityCaseStatusStepper: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const steps: Array<SecurityCaseStatus> = getSecurityCaseSteps({
    statuses: props.statuses,
    statusId: props.statusId,
  });
  const currentIndex: number = getSecurityCaseStepIndex(steps, props.statusId);
  const isClosed: boolean = SecurityCaseStatuses.isClosed(
    props.statuses,
    props.statusId,
  );

  return (
    <ol
      className={`grid gap-2 ${getSecurityCaseStepsGridClassName(steps.length)}`}
      aria-label={translator.translateText("Case status")}
      data-testid="security-case-status-steps"
    >
      {steps.map((status: SecurityCaseStatus, index: number): ReactElement => {
        const isCurrent: boolean = index === currentIndex;
        const isDone: boolean = index < currentIndex || (isClosed && isCurrent);
        const canSelect: boolean =
          Boolean(props.onSelect) && !props.isDisabled && !isCurrent;
        const name: string = translator.translateText(status.name) || "";
        const description: string = status.description
          ? translator.translateText(status.description) || ""
          : "";

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
            {translator.formatNumber(index + 1)}
          </span>
        );

        return (
          <li key={status.id?.toString() || status.name || index} className="min-w-0">
            <button
              type="button"
              data-testid={`security-case-step-${index}`}
              aria-current={isCurrent ? "step" : undefined}
              disabled={!canSelect}
              title={
                props.isDisabled && props.disabledReason
                  ? props.disabledReason
                  : description || name
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
              <span className="truncate">{name}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
};

export default SecurityCaseStatusStepper;
