import ToolImportLogo from "./ToolImportLogo";
import { TOOL_IMPORT_KIND_TERMS, TOOL_IMPORT_PLURALS } from "./ToolImportText";
import IconProp from "Common/Types/Icon/IconProp";
import {
  getToolImportSourceDefinition,
  isToolImportStatusPageHost,
  ToolImportCategory,
  ToolImportSourceDefinition,
} from "Common/Types/ToolImport/ToolImportCatalog";
import { ToolImportRunView } from "Common/Types/ToolImport/ToolImportPlan";
import ToolImportRunStatus from "Common/Types/ToolImport/ToolImportRunStatus";
import Icon from "Common/UI/Components/Icon/Icon";
import {
  translatableTerm,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A run at work: reading the tool, or bringing what was ticked over. The
 * page asks the server again every few seconds while this shows; the run
 * goes on without the page, so it says the person may leave.
 */

export interface ComponentProps {
  run: ToolImportRunView;
}

/*
 * What the person's own import is doing, in the words of what the tool
 * holds: a team, monitors, or status pages.
 */
function getBringingOverTitle(
  definition: ToolImportSourceDefinition,
  translator: Translator,
): string {
  const values: { tool: string } = { tool: definition.title };

  if (isToolImportStatusPageHost(definition)) {
    return translator.translateTemplate(
      "Bringing your status pages over from {{tool}}",
      values,
    );
  }

  if (definition.category === ToolImportCategory.Monitoring) {
    return translator.translateTemplate(
      "Bringing your monitors over from {{tool}}",
      values,
    );
  }

  return translator.translateTemplate(
    "Bringing your team over from {{tool}}",
    values,
  );
}

const ToolImportProgressPanel: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const run: ToolImportRunView = props.run;
  const definition: ToolImportSourceDefinition = getToolImportSourceDefinition(
    run.source,
  );
  const tool: string = definition.title;
  const isReading: boolean = run.status === ToolImportRunStatus.Reading;
  const done: number = run.progress?.done || 0;
  const total: number = run.progress?.total || 0;
  const percent: number =
    total > 0 ? Math.min(100, Math.round((done * 100) / total)) : 0;

  const title: string = isReading
    ? run.isMine
      ? translator.translateTemplate("Reading your {{tool}} account", {
          tool: tool,
        })
      : translator.translateTemplate("{{name}} is reading a {{tool}} account", {
          tool: tool,
          name: run.createdByUserName || translatableTerm("Someone"),
        })
    : run.isMine
      ? getBringingOverTitle(definition, translator)
      : translator.translateTemplate("{{name}} is importing from {{tool}}", {
          tool: tool,
          name: run.createdByUserName || translatableTerm("Someone"),
        });

  const now: string | null = run.progress?.kind
    ? isReading
      ? translator.translateTemplate("Now reading {{kind}}.", {
          kind: translatableTerm(TOOL_IMPORT_KIND_TERMS[run.progress.kind], {
            inSentence: true,
          }),
        })
      : translator.translateTemplate("Now bringing over {{kind}}.", {
          kind: translatableTerm(TOOL_IMPORT_KIND_TERMS[run.progress.kind], {
            inSentence: true,
          }),
        })
    : null;

  return (
    <div data-testid="tool-import-progress" aria-live="polite">
      <div className="flex items-center gap-3">
        <ToolImportLogo source={run.source} size="lg" />
        <div className="min-w-0">
          <p className="text-base font-semibold text-gray-900">{title}</p>
          {run.accountName && (
            <p className="text-sm text-gray-500">{run.accountName}</p>
          )}
        </div>
      </div>

      <div className="mt-6 flex items-center gap-3">
        <div className="flex-shrink-0 text-indigo-600">
          <Icon icon={IconProp.Spinner} className="h-5 w-5 animate-spin" />
        </div>
        <p className="text-sm text-gray-700" data-testid="tool-import-now">
          {now ||
            (isReading
              ? translator.translateText("Connecting…")
              : translator.translateText("Starting…"))}
        </p>
      </div>

      {!isReading && total > 0 && (
        <div className="mt-4 max-w-xl" data-testid="tool-import-progress-bar">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-gray-700">
              {translator.translatePlural(TOOL_IMPORT_PLURALS.done, done, {
                total: translator.formatNumber(total),
              })}
            </span>
            <span className="font-medium text-indigo-600">{percent}%</span>
          </div>
          <div
            className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-gray-200"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={done}
          >
            <div
              className="h-2.5 rounded-full bg-indigo-600 transition-all"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
      )}

      <p className="mt-6 text-sm text-gray-500">
        {!run.isMine
          ? translator.translateText(
              "Only one import runs at a time. When this one finishes, you can start yours.",
            )
          : isReading
            ? translator.translateText(
                "A large account takes a few minutes. You can leave this page: the read goes on, and what it found waits for you here.",
              )
            : translator.translateText(
                "You can leave this page: the import goes on, and the report waits for you here.",
              )}
      </p>
    </div>
  );
};

export default ToolImportProgressPanel;
