import {
  DiscoveryImportStatus,
  DiscoveryImportView,
  countSettledDevices,
} from "Common/Types/NetworkDevice/DiscoveryImport";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A scan's running import, on its row of the scans table: how far it has
 * got, and the way back to its progress. The import runs on the server, so
 * a reviewer who closed the dialog - or a colleague who never opened it -
 * sees it moving here.
 */

export interface DiscoveryImportRowStatusProps {
  view: DiscoveryImportView;
  onView: () => void;
}

const DiscoveryImportRowStatus: FunctionComponent<
  DiscoveryImportRowStatusProps
> = (props: DiscoveryImportRowStatusProps): ReactElement => {
  const translator: Translator = useTranslator();
  const total: number = props.view.progress.hosts;
  const done: number = countSettledDevices(props.view.progress);
  const percent: number =
    total > 0 ? Math.min(100, Math.floor((done * 100) / total)) : 0;
  const isQueued: boolean = props.view.status === DiscoveryImportStatus.Queued;

  return (
    <div
      className="max-w-56 space-y-1"
      data-testid={`discovery-import-row-${props.view.scanId}`}
    >
      <p className="text-xs font-medium text-indigo-700">
        {isQueued
          ? translator.translatePlural(
              {
                one: "Waiting to import {{count}} device",
                other: "Waiting to import {{count}} devices",
              },
              total,
              { count: translator.formatNumber(total) },
            )
          : translator.translateTemplate(
              "Importing devices: {{done}} of {{total}}",
              {
                done: translator.formatNumber(done),
                total: translator.formatNumber(total),
              },
            )}
      </p>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-indigo-100"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={translator.translateTemplate(
          "Import progress: {{percent}}%",
          { percent: percent },
        )}
      >
        <div
          className="h-1.5 rounded-full bg-indigo-600 transition-all duration-300 ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>
      <button
        type="button"
        className="text-xs font-medium text-indigo-600 hover:text-indigo-700 focus:outline-none focus-visible:underline"
        data-testid={`discovery-import-row-view-${props.view.scanId}`}
        onClick={props.onView}
      >
        {translator.translateText("View progress")}
      </button>
    </div>
  );
};

export default DiscoveryImportRowStatus;
