import ToolImportLogo from "./ToolImportLogo";
import {
  formatToolImportDateTime,
  TOOL_IMPORT_OUTCOME_COUNTS,
  TOOL_IMPORT_STATUS_LABELS,
} from "./ToolImportText";
import Color from "Common/Types/Color";
import {
  Blue,
  Gray500,
  Green,
  Red,
  Slate500,
  Yellow,
} from "Common/Types/BrandColors";
import { getToolImportSourceDefinition } from "Common/Types/ToolImport/ToolImportCatalog";
import {
  ToolImportOutcome,
  ToolImportRunView,
} from "Common/Types/ToolImport/ToolImportPlan";
import ToolImportRunStatus from "Common/Types/ToolImport/ToolImportRunStatus";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Pill, { PillSize } from "Common/UI/Components/Pill/Pill";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The project's imports, newest first: the tool, who ran it and when, how
 * it ended and what it brought over. Project owners and admins see every
 * import; anyone else sees their own. Opening one shows its report.
 */

const STATUS_COLORS: Record<ToolImportRunStatus, Color> = {
  [ToolImportRunStatus.Reading]: Blue,
  [ToolImportRunStatus.ReadyToReview]: Yellow,
  [ToolImportRunStatus.Importing]: Blue,
  [ToolImportRunStatus.Completed]: Green,
  [ToolImportRunStatus.Failed]: Red,
  [ToolImportRunStatus.Cancelled]: Gray500,
  [ToolImportRunStatus.Expired]: Slate500,
};

// The outcomes a row sums up, when there are any.
const SUMMED_OUTCOMES: Array<ToolImportOutcome> = [
  ToolImportOutcome.Created,
  ToolImportOutcome.Invited,
  ToolImportOutcome.Failed,
];

export interface ComponentProps {
  runs: Array<ToolImportRunView>;
  // The run the page shows now, which is not offered again.
  shownRunId: string | null;
  onOpen: (runId: string) => void;
}

const ToolImportHistory: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <ul className="divide-y divide-gray-200" data-testid="tool-import-history">
      {props.runs.map((run: ToolImportRunView): ReactElement => {
        const tool: string = getToolImportSourceDefinition(run.source).title;
        const summary: Array<string> = SUMMED_OUTCOMES.filter(
          (outcome: ToolImportOutcome): boolean => {
            return Boolean(run.counts && run.counts[outcome] > 0);
          },
        ).map((outcome: ToolImportOutcome): string => {
          return translator.translatePlural(
            TOOL_IMPORT_OUTCOME_COUNTS[outcome],
            run.counts ? run.counts[outcome] : 0,
          );
        });
        const canOpen: boolean =
          run.id !== props.shownRunId &&
          (run.isMine || run.status !== ToolImportRunStatus.ReadyToReview);

        return (
          <li
            key={run.id}
            className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3"
            data-testid={`tool-import-history-${run.id}`}
          >
            <ToolImportLogo source={run.source} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-gray-900">
                  {run.accountName ? `${tool} · ${run.accountName}` : tool}
                </span>
                <Pill
                  text={TOOL_IMPORT_STATUS_LABELS[run.status]}
                  color={STATUS_COLORS[run.status]}
                  size={PillSize.Small}
                />
              </div>
              <p className="mt-0.5 text-sm text-gray-500">
                {[
                  run.createdByUserName
                    ? translator.translateTemplate("Started by {{name}}", {
                        name: run.createdByUserName,
                      })
                    : null,
                  formatToolImportDateTime(run.createdAt, translator.language),
                  ...summary,
                ]
                  .filter((part: string | null): part is string => {
                    return Boolean(part);
                  })
                  .join(" · ")}
              </p>
            </div>
            {canOpen && (
              <Button
                title="Open"
                buttonStyle={ButtonStyleType.NORMAL}
                onClick={() => {
                  props.onOpen(run.id);
                }}
                dataTestId={`tool-import-history-open-${run.id}`}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
};

export default ToolImportHistory;
