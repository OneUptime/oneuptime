import PageComponentProps from "../../PageComponentProps";
import MetricsViewer from "../../../Components/Metrics/MetricsViewer";
import { useTableViewContext } from "./TableViewContext";
import { DataObservabilityAttribute } from "Common/Types/DataObservability/DataObservabilityMetric";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The table's history: its row count, size, time since its last change and
 * schema changes, every collection, as metrics - scoped to this table by
 * the id every row carries, with the explorer's charts and its
 * create-monitor action.
 */
const TableMetricsPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { dataAssetId, dataAsset } = useTableViewContext();

  return (
    <MetricsViewer
      attributeFilters={{
        [DataObservabilityAttribute.TableId]: dataAssetId.toString(),
      }}
      attributeFilterDisplayKeys={{
        [DataObservabilityAttribute.TableId]: "Table",
      }}
      attributeFilterDisplayValues={
        dataAsset?.assetKey
          ? { [DataObservabilityAttribute.TableId]: dataAsset.assetKey }
          : undefined
      }
    />
  );
};

export default TableMetricsPage;
