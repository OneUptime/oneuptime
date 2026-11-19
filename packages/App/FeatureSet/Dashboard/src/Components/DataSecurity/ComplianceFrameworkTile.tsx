import {
  getNumberLocale,
  getReaderNumberLocale,
} from "Common/Types/DateLanguage";
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
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * One framework on the Compliance page, as a tile to pick: its score - the
 * share of its evaluated requirements that pass - or "Not evaluated" when
 * no store in its scope was read yet, how many stores are in its scope and
 * how many requirements fail. Picking it lists every requirement below.
 */

export const NOT_EVALUATED: string = translationKey("Not evaluated");

/*
 * Each requirement's status in the tone the product's chips use for it: a
 * requirement a resource turned off is someone's choice, grey with a hollow
 * dot, never red (Docs/ux/README.md#side-menus).
 */
export const REQUIREMENT_STATUS_TONES: Readonly<
  Record<ComplianceRequirementStatus, PillTone>
> = {
  [ComplianceRequirementStatus.Passing]: PillTone.Success,
  [ComplianceRequirementStatus.Failing]: PillTone.Danger,
  [ComplianceRequirementStatus.NotEvaluated]: PillTone.Neutral,
  [ComplianceRequirementStatus.TurnedOff]: PillTone.Paused,
};

// Stores a framework covers by their data, left out by the resources they are on.
export const STORES_TURNED_OFF: PluralTemplate = {
  one: "{{count}} store turned off on its resource",
  other: "{{count}} stores turned off on their resources",
};

const STORES_IN_SCOPE: PluralTemplate = {
  one: "{{count}} store in scope",
  other: "{{count}} stores in scope",
};

const FAILING_REQUIREMENTS: PluralTemplate = {
  one: "{{count}} requirement failing",
  other: "{{count}} requirements failing",
};

const NONE_FAILING: string = translationKey("No requirement failing");

/*
 * Why a framework has no score, in place of "No requirement failing", which
 * read as a pass: none of the project's stores holds the data it protects,
 * or the ones that do have not been read yet.
 */
const NOTHING_IN_SCOPE: string = translationKey(
  "No store holds the data it protects",
);

const NOT_READ_YET: string = translationKey("Its stores are not read yet");

export function getComplianceTileNote(
  framework: DataSecurityComplianceFramework,
  failing: number,
): { text: string; isFailing: boolean } {
  if (framework.score === null) {
    return {
      text: framework.storesInScope > 0 ? NOT_READ_YET : NOTHING_IN_SCOPE,
      isFailing: false,
    };
  }

  return { text: failing > 0 ? "" : NONE_FAILING, isFailing: failing > 0 };
}

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
    return new Intl.NumberFormat(getNumberLocale(translator.language), {
      style: "percent",
      maximumFractionDigits: 0,
    }).format(score / 100);
  } catch {
    return new Intl.NumberFormat(getReaderNumberLocale(), {
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

/*
 * What a tile shows of a framework: its name, its full name and its score.
 * A data framework's lines are worked out here, from its stores; a
 * Kubernetes cluster's own frameworks (#9627) are scored over workloads,
 * and hand the tile their lines in the reader's words (summary).
 */
export interface ComplianceTileFramework {
  framework: string;
  fullName: string;
  score: number | null;
}

export interface ComplianceTileSummary {
  // What it is scored over: "12 workloads evaluated".
  scope: string;
  // What fails, or that nothing does.
  note: string;
  isFailing: boolean;
}

export interface ComponentProps {
  framework: DataSecurityComplianceFramework | ComplianceTileFramework;
  isSelected: boolean;
  onSelect: () => void;
  // In the reader's words: the lines a framework not scored over stores shows.
  summary?: ComplianceTileSummary | undefined;
}

// The tile's two lines under the score, for a data framework.
function getDataFrameworkSummary(
  framework: DataSecurityComplianceFramework,
  translator: Translator,
): ComplianceTileSummary {
  const failing: number = getFailingRequirementCount(framework);
  const note: { text: string; isFailing: boolean } = getComplianceTileNote(
    framework,
    failing,
  );

  return {
    scope: translator.translatePlural(STORES_IN_SCOPE, framework.storesInScope),
    note: note.isFailing
      ? translator.translatePlural(FAILING_REQUIREMENTS, failing)
      : translator.translateText(note.text) || note.text,
    isFailing: note.isFailing,
  };
}

const ComplianceFrameworkTile: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const framework: ComplianceTileFramework = props.framework;
  const summary: ComplianceTileSummary =
    props.summary ||
    getDataFrameworkSummary(
      props.framework as DataSecurityComplianceFramework,
      translator,
    );
  const fullName: string =
    translator.translateText(framework.fullName) || framework.fullName;

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
      <span className="line-clamp-1 text-xs text-gray-500" title={fullName}>
        {fullName}
      </span>
      {/*
       * A score in large figures; "Not evaluated" quieter, on the score's
       * line, so a tile with no score is as tall as its neighbours.
       */}
      <span
        className={`mt-1 tabular-nums leading-8 ${
          framework.score === null
            ? "text-base font-medium"
            : "text-2xl font-semibold"
        } ${getComplianceScoreClassName(framework.score)}`}
      >
        {framework.score === null
          ? translator.translateText(NOT_EVALUATED)
          : formatComplianceScore(framework.score, translator)}
      </span>
      <span className="text-xs text-gray-600">{summary.scope}</span>
      <span
        className={`text-xs font-medium ${
          summary.isFailing ? "text-red-600" : "text-gray-500"
        }`}
      >
        {summary.note}
      </span>
    </button>
  );
};

export default ComplianceFrameworkTile;
