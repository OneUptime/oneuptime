import ConnectDatabaseModal from "./ConnectDatabaseModal";
import {
  BiLineageStep,
  BiSourceStanding,
  getBiLineageFacts,
  getBiLineageStep,
  getBiSourceFacts,
  getBiSourceStanding,
} from "./BiLineageWords";
import { getStoreAlertsRoute } from "./OverviewAttention";
import URL from "Common/Types/API/URL";
import {
  DataBiLineageProblem,
  DataBiLineageSource,
  DataBiLineageSummary,
  getDataBiSourceName,
} from "Common/Types/DataObservability/DataBiLineage";
import {
  DataObservabilitySourceOrigin,
  DataObservabilitySourceSuggestion,
} from "Common/Types/DataObservability/DataObservabilityApiTypes";
import ObjectID from "Common/Types/ObjectID";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import Link from "Common/UI/Components/Link/Link";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import { DOCS_URL } from "Common/UI/Config";
import Navigation from "Common/UI/Utils/Navigation";
import {
  PluralTemplate,
  Translator,
  formatInline,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * WHY A BI TOOL'S TABLES MATCHED IS WHAT IT IS (#9507).
 *
 * Opened from Tables Matched on the BI Tools list and from the Lineage Map:
 * what the last read found, then what keeps the dashboards off their
 * tables as steps to take - a Power BI tenant setting, a database to
 * connect, tables to watch - and where the data comes from, each source
 * with whether OneUptime watches it. A database OneUptime could watch and
 * does not is one Connect Database away, its kind and address filled in;
 * connecting it leaves this dialog for the database's form, and back
 * again on Cancel.
 */

export const BI_LINEAGE_DOCS_URL: URL = URL.fromString(
  `${DOCS_URL.toString()}/data-observability/lineage-and-pipelines#power-bi-lineage`,
);

const WHAT_TO_DO: string = translationKey("What to Do");
const WHERE_FROM: string = translationKey("Where the Data Comes From");
const ALL_MATCHED: string = translationKey(
  "Every table these dashboards read is watched.",
);
const MORE_SOURCES: PluralTemplate = {
  one: "And {{count}} more data source.",
  other: "And {{count}} more data sources.",
};

const STANDING_CLASS_NAMES: Readonly<Record<BiSourceStanding, string>> = {
  [BiSourceStanding.Watched]: "text-green-700",
  [BiSourceStanding.NotConnected]: "text-amber-700",
  [BiSourceStanding.Elsewhere]: "text-gray-500",
};

export interface ComponentProps {
  // The BI tool's name, as the project named it.
  name: string;
  summary: DataBiLineageSummary;
  onClose: () => void;
}

// A database a dashboard reads, as Connect Database starts from it.
export function getBiSourceSuggestion(
  source: DataBiLineageSource,
): DataObservabilitySourceSuggestion {
  return {
    id: `bi:${getDataBiSourceName(source)}`,
    dataStoreId: null,
    name: source.database || source.server || source.type,
    kind: source.connectKind || null,
    origin: DataObservabilitySourceOrigin.BiTool,
    connectionExample: source.connectionExample || null,
  };
}

const BiLineageDialog: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [connecting, setConnecting] =
    useState<DataObservabilitySourceSuggestion | null>(null);
  const summary: DataBiLineageSummary = props.summary;

  // One dialog at a time: Connect Database in place of this one, and back on Cancel.
  if (connecting) {
    return (
      <ConnectDatabaseModal
        suggestion={connecting}
        onClose={() => {
          setConnecting(null);
        }}
        onConnected={(dataStoreId: ObjectID) => {
          setConnecting(null);
          props.onClose();
          // Its tables are watched now; its alerts are what to look at next, as after any connection.
          Navigation.navigate(getStoreAlertsRoute(dataStoreId.toString()));
        }}
      />
    );
  }

  const steps: Array<BiLineageStep> = summary.problems.map(
    (problem: DataBiLineageProblem): BiLineageStep => {
      return getBiLineageStep(translator, problem, summary);
    },
  );

  return (
    <Modal
      title="Tables Matched"
      description={props.name}
      modalWidth={ModalWidth.Large}
      closeButtonText="Close"
      onClose={props.onClose}
    >
      <div className="space-y-6" data-testid="bi-lineage-dialog">
        <p className="text-sm text-gray-700" data-testid="bi-lineage-facts">
          {formatInline(getBiLineageFacts(translator, summary), translator)}
        </p>

        {steps.length > 0 ? (
          <section aria-label={translator.translateText(WHAT_TO_DO)}>
            <h3 className="text-sm font-semibold text-gray-900">
              {translator.translateText(WHAT_TO_DO)}
            </h3>
            <ol className="mt-3 space-y-4" data-testid="bi-lineage-steps">
              {steps.map((step: BiLineageStep, index: number): ReactElement => {
                return (
                  <li key={step.title} className="flex gap-3">
                    <span
                      aria-hidden="true"
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-xs font-semibold text-indigo-700"
                    >
                      {translator.formatNumber(index + 1)}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900">
                        {step.title}
                      </p>
                      <p className="mt-0.5 text-sm text-gray-600 [overflow-wrap:anywhere]">
                        {step.text}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        ) : (
          <p className="text-sm text-gray-600">
            {translator.translateText(ALL_MATCHED)}
          </p>
        )}

        {summary.sources.length > 0 ? (
          <section aria-label={translator.translateText(WHERE_FROM)}>
            <h3 className="text-sm font-semibold text-gray-900">
              {translator.translateText(WHERE_FROM)}
            </h3>
            <ul
              className="mt-3 divide-y divide-gray-100 rounded-md border border-gray-200"
              data-testid="bi-lineage-sources"
            >
              {summary.sources.map(
                (source: DataBiLineageSource, index: number): ReactElement => {
                  const standing: {
                    standing: BiSourceStanding;
                    text: string;
                  } = getBiSourceStanding(translator, source);

                  return (
                    <li
                      key={`${getDataBiSourceName(source)}-${index}`}
                      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-2"
                      data-testid="bi-lineage-source"
                    >
                      <div className="min-w-0">
                        <p className="text-sm text-gray-900 [overflow-wrap:anywhere]">
                          <IsolatedText text={getDataBiSourceName(source)} />
                        </p>
                        <p className="text-xs text-gray-500">
                          {formatInline(
                            [
                              source.type,
                              ...getBiSourceFacts(translator, summary, source),
                            ],
                            translator,
                          )}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <span
                          className={`text-xs font-medium ${STANDING_CLASS_NAMES[standing.standing]}`}
                        >
                          {standing.text}
                        </span>
                        {standing.standing === BiSourceStanding.NotConnected &&
                        source.connectKind ? (
                          <Button
                            title="Connect Database"
                            buttonStyle={ButtonStyleType.OUTLINE}
                            buttonSize={ButtonSize.Small}
                            dataTestId="bi-lineage-connect"
                            onClick={() => {
                              setConnecting(getBiSourceSuggestion(source));
                            }}
                          />
                        ) : (
                          <></>
                        )}
                      </div>
                    </li>
                  );
                },
              )}
            </ul>
            {summary.moreSourceCount > 0 ? (
              <p className="mt-2 text-xs text-gray-500">
                {translator.translatePlural(
                  MORE_SOURCES,
                  summary.moreSourceCount,
                )}
              </p>
            ) : (
              <></>
            )}
          </section>
        ) : (
          <></>
        )}

        <Link
          to={BI_LINEAGE_DOCS_URL}
          openInNewTab={true}
          className="inline-flex text-sm font-medium text-indigo-700 hover:underline"
          dataTestId="bi-lineage-docs"
        >
          <span>{translator.translateText("Read How BI Tools Are Read")}</span>
        </Link>
      </div>
    </Modal>
  );
};

export default BiLineageDialog;
