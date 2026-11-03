import PageComponentProps from "../../PageComponentProps";
import {
  formatRowCount,
  formatSize,
  formatUpdateInterval,
} from "../../../Components/DataObservability/DataObservabilityFormat";
import FreshnessPill from "../../../Components/DataObservability/FreshnessPill";
import EventStatBar from "../../../Components/EventView/EventStatBar";
import EventStatTile from "../../../Components/EventView/EventStatTile";
import { useTableViewContext } from "./TableViewContext";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import Card from "Common/UI/Components/Card/Card";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/LazyMarkdownViewer";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A table at a glance: how many rows it holds, how big it is, when it last
 * changed and whether that is late for it, and how often it usually
 * changes - then where it lives and what it is for.
 */
const TableOverviewPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const { dataAsset } = useTableViewContext();

  if (!dataAsset) {
    return (
      <p className="text-sm text-gray-500">
        {translator.translateText("This table could not be read.")}
      </p>
    );
  }

  const fact: (label: string, value: string) => ReactElement = (
    label: string,
    value: string,
  ): ReactElement => {
    return (
      <div key={label}>
        <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">
          {translator.translateText(label)}
        </dt>
        <dd className="mt-1 break-words text-sm text-gray-900">
          {value || "-"}
        </dd>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <EventStatBar columns={4} ariaLabel="Table health">
        <EventStatTile
          label="Rows"
          value={formatRowCount(translator, dataAsset.rowCount)}
          icon={IconProp.TableCells}
        />
        <EventStatTile
          label="Size"
          value={formatSize(dataAsset.sizeInBytes)}
          icon={IconProp.Database}
        />
        <EventStatTile
          label="Last Changed"
          value={
            dataAsset.lastChangedAt
              ? OneUptimeDate.fromNow(
                  OneUptimeDate.fromString(dataAsset.lastChangedAt),
                )
              : translator.translateText("Not seen yet") || "Not seen yet"
          }
          note={
            <FreshnessPill
              kind={dataAsset.assetKind}
              lastChangedAt={dataAsset.lastChangedAt}
              updateIntervalInSeconds={dataAsset.updateIntervalInSeconds}
            />
          }
          icon={IconProp.Clock}
        />
        <EventStatTile
          label="Usually Changes"
          value={formatUpdateInterval(
            translator,
            dataAsset.updateIntervalInSeconds,
          )}
          icon={IconProp.Activity}
        />
      </EventStatBar>

      <Card
        title="Details"
        description="Where this table lives and when OneUptime last read it."
      >
        <dl className="grid grid-cols-1 gap-4 px-6 pb-6 sm:grid-cols-2 lg:grid-cols-3">
          {fact("Database", dataAsset.dataStoreName || "")}
          {fact("Engine", dataAsset.dataStoreKind || "")}
          {fact("Schema", dataAsset.schemaName || "")}
          {fact(
            "Kind",
            translator.translateText(dataAsset.assetKind || "") ||
              dataAsset.assetKind ||
              "",
          )}
          {fact(
            "Columns",
            dataAsset.columnCount === undefined ||
              dataAsset.columnCount === null
              ? ""
              : translator.formatNumber(dataAsset.columnCount),
          )}
          {fact(
            "First Seen",
            dataAsset.firstSeenAt
              ? OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                  OneUptimeDate.fromString(dataAsset.firstSeenAt),
                )
              : "",
          )}
          {fact(
            "Last Collected",
            dataAsset.lastCollectedAt
              ? OneUptimeDate.fromNow(
                  OneUptimeDate.fromString(dataAsset.lastCollectedAt),
                )
              : "",
          )}
        </dl>
      </Card>

      <Card
        title="Description"
        description="What this table holds and who relies on it. Edit it on Settings."
      >
        <div className="px-6 pb-6 text-sm text-gray-700">
          {dataAsset.description ? (
            <MarkdownViewer text={dataAsset.description} />
          ) : (
            <span className="text-gray-500">
              {translator.translateText("No description yet.")}
            </span>
          )}
        </div>
      </Card>
    </div>
  );
};

export default TableOverviewPage;
