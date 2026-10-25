import SecurityEventSeverityPill from "../SecurityEventSeverityPill";
import MitreAttackChips from "../../SecurityCase/MitreAttackChips";
import { getSecurityDetectionSourceIcon } from "../../SecurityCase/SecurityCasePills";
import {
  ENTITY_RISK_TEST_IDS,
  FIRED_COLUMN_TITLE,
  FIRED_TIMES,
  LAST_SEEN_COLUMN_TITLE,
  POINTS_COLUMN_TITLE,
  SEVERITY_COLUMN_TITLE,
  SOURCES_CARD_DESCRIPTION,
  SOURCES_CARD_TITLE,
  SOURCES_EMPTY,
  SOURCE_COLUMN_TITLE,
  TACTICS_COLUMN_TITLE,
} from "./EntityRiskCopy";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { SecurityEntityRiskContribution } from "Common/Types/SecurityCase/SecurityEntityRisk";
import Card from "Common/UI/Components/Card/Card";
import Icon from "Common/UI/Components/Icon/Icon";
import LocalTable from "Common/UI/Components/Table/LocalTable";
import TableEmptyState, {
  TableEmptyStateKind,
} from "Common/UI/Components/Table/TableEmptyState";
import FieldType from "Common/UI/Components/Types/FieldType";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  // The most first, as the score counts them.
  sources: Array<SecurityEntityRiskContribution>;
}

// A source as the table lists it: the stored entry, with its times as dates.
interface SourceRow extends SecurityEntityRiskContribution {
  lastSeen: Date;
}

/*
 * What adds to an entity's risk: each detection rule, threat intel feed and
 * connected product's rule that found it in the last week, with the most it
 * added - which is what it counts for - its worst severity, how often it
 * fired and when it last did, the most first.
 */
const EntityRiskSources: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const rows: Array<SourceRow> = props.sources.map(
    (source: SecurityEntityRiskContribution): SourceRow => {
      return { ...source, lastSeen: new Date(source.lastSeenAt) };
    },
  );

  return (
    <Card title={SOURCES_CARD_TITLE} description={SOURCES_CARD_DESCRIPTION}>
      <div data-testid={ENTITY_RISK_TEST_IDS.sources}>
        {rows.length === 0 ? (
          <TableEmptyState
            kind={TableEmptyStateKind.Empty}
            icon={IconProp.Fire}
            title={SOURCES_EMPTY}
            isCompact={true}
          />
        ) : (
          <LocalTable<SourceRow>
            id="entity-risk-sources-table"
            data={rows}
            singularLabel="Source"
            pluralLabel="Sources"
            columns={[
              {
                key: "sourceName",
                title: SOURCE_COLUMN_TITLE,
                type: FieldType.Element,
                disableSort: true,
                wrapContent: true,
                wrapMaxWidthClassName: "max-w-xs",
                getElement: (row: SourceRow): ReactElement => {
                  return (
                    <div className="flex min-w-0 items-start gap-2">
                      <Icon
                        icon={getSecurityDetectionSourceIcon(row.source)}
                        className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400"
                      />
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-gray-900 [overflow-wrap:anywhere]">
                          {row.sourceName ||
                            translator.translateText(row.source) ||
                            row.source}
                        </div>
                        <div className="text-xs text-gray-500">
                          {translator.translateText(row.source) || row.source}
                        </div>
                      </div>
                    </div>
                  );
                },
              },
              {
                key: "severity",
                title: SEVERITY_COLUMN_TITLE,
                type: FieldType.Element,
                disableSort: true,
                getElement: (row: SourceRow): ReactElement => {
                  return (
                    <SecurityEventSeverityPill severityName={row.severity} />
                  );
                },
              },
              {
                key: "points",
                title: POINTS_COLUMN_TITLE,
                type: FieldType.Element,
                disableSort: true,
                getElement: (row: SourceRow): ReactElement => {
                  return (
                    <span className="text-sm font-semibold tabular-nums text-gray-900">
                      {translator.formatNumber(row.points)}
                    </span>
                  );
                },
              },
              {
                // How often it fired, as a case's Detections say it: "14 times".
                key: "hits",
                title: FIRED_COLUMN_TITLE,
                type: FieldType.Element,
                disableSort: true,
                hideOnMobile: true,
                getElement: (row: SourceRow): ReactElement => {
                  return (
                    <span className="whitespace-nowrap text-sm tabular-nums text-gray-700">
                      {translator.translatePlural(FIRED_TIMES, row.hits)}
                    </span>
                  );
                },
              },
              {
                key: "lastSeen",
                title: LAST_SEEN_COLUMN_TITLE,
                type: FieldType.Element,
                disableSort: true,
                hideOnMobile: true,
                getElement: (row: SourceRow): ReactElement => {
                  return (
                    <span
                      className="whitespace-nowrap text-sm text-gray-700"
                      title={OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                        row.lastSeen,
                      )}
                    >
                      {OneUptimeDate.fromNow(row.lastSeen)}
                    </span>
                  );
                },
              },
              {
                key: "mitreTactics",
                title: TACTICS_COLUMN_TITLE,
                type: FieldType.Element,
                disableSort: true,
                hideOnMobile: true,
                wrapContent: true,
                wrapMaxWidthClassName: "max-w-[15rem]",
                getElement: (row: SourceRow): ReactElement => {
                  return (
                    <MitreAttackChips
                      tactics={row.mitreTactics}
                      techniques={row.mitreTechniques}
                      emptyText="-"
                    />
                  );
                },
              },
            ]}
          />
        )}
      </div>
    </Card>
  );
};

export default EntityRiskSources;
