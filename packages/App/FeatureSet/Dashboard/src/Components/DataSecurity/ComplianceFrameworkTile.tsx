import { DataSecurityComplianceFramework } from "Common/Types/DataSecurity/DataSecurityApiTypes";
import {
  ComplianceRequirementResult,
  ComplianceRequirementStatus,
} from "Common/Types/DataSecurity/ComplianceRequirementCatalog";
import {
  PluralTemplate,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * One framework on the Compliance page, as a tile to pick: its score - the
 * share of its evaluated requirements that pass - or "Not evaluated" when
 * no store in its scope was read yet, how many stores are in its scope and
 * how many requirements fail. Picking it lists every requirement below.
 */

export const NOT_EVALUATED: string = translationKey("Not evaluated");

const STORES_IN_SCOPE: PluralTemplate = {
  one: "{{count}} store in scope",
  other: "{{count}} stores in scope",
};

const FAILING_REQUIREMENTS: PluralTemplate = {
  one: "{{count}} requirement failing",
  other: "{{count}} requirements failing",
};

const NONE_FAILING: string = translationKey("No requirement failing");

export function getFailingRequirementCount(
  framework: DataSecurityComplianceFramework,
): number {
  return framework.requirements.filter(
    (requirement: ComplianceRequirementResult): boolean => {
      return requirement.status === ComplianceRequirementStatus.Failing;
    },
  ).length;
}

// A score as the reader's language writes a percentage: "86 %", "86%".
export function formatComplianceScore(
  score: number,
  translator: Translator,
): string {
  try {
    return new Intl.NumberFormat(translator.language, {
      style: "percent",
      maximumFractionDigits: 0,
    }).format(score / 100);
  } catch {
    return new Intl.NumberFormat(undefined, {
      style: "percent",
      maximumFractionDigits: 0,
    }).format(score / 100);
  }
}

// Green from 90, amber from 70, red under.
export function getComplianceScoreClassName(score: number | null): string {
  if (score === null) {
    return "text-gray-400";
  }

  if (score >= 90) {
    return "text-emerald-600";
  }

  if (score >= 70) {
    return "text-amber-600";
  }

  return "text-red-600";
}

export interface ComponentProps {
  framework: DataSecurityComplianceFramework;
  isSelected: boolean;
  onSelect: () => void;
}

const ComplianceFrameworkTile: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const framework: DataSecurityComplianceFramework = props.framework;
  const failing: number = getFailingRequirementCount(framework);

  return (
    <button
      type="button"
      aria-pressed={props.isSelected}
      data-testid="data-security-compliance-framework"
      onClick={props.onSelect}
      className={`flex h-full w-full min-w-0 flex-col items-start gap-1 rounded-lg border px-4 py-3 text-start transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
        props.isSelected
          ? "border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500"
          : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50"
      }`}
    >
      <span className="text-sm font-semibold text-gray-900">
        {framework.framework}
      </span>
      <span className="line-clamp-1 text-xs text-gray-500">
        {translator.translateText(framework.fullName) || framework.fullName}
      </span>
      <span
        className={`mt-1 text-2xl font-semibold tabular-nums ${getComplianceScoreClassName(
          framework.score,
        )}`}
      >
        {framework.score === null
          ? translator.translateText(NOT_EVALUATED)
          : formatComplianceScore(framework.score, translator)}
      </span>
      <span className="text-xs text-gray-600">
        {translator.translatePlural(STORES_IN_SCOPE, framework.storesInScope)}
      </span>
      <span
        className={`text-xs font-medium ${
          failing > 0 ? "text-red-600" : "text-gray-500"
        }`}
      >
        {failing > 0
          ? translator.translatePlural(FAILING_REQUIREMENTS, failing)
          : translator.translateText(NONE_FAILING)}
      </span>
    </button>
  );
};

export default ComplianceFrameworkTile;
