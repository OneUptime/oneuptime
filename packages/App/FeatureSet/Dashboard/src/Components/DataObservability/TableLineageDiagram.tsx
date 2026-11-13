import DataObservabilityApi from "./DataObservabilityApi";
import {
  LineageDiagramBody,
  LineageRead,
  LineageStepSwitch,
  useLineageRead,
} from "./LineageDiagram";
import { LineagePlace, isLineageEmpty } from "./LineageGraphModel";
import {
  DEFAULT_DATA_LINEAGE_DEPTH,
  DataTableLineage,
} from "Common/Types/DataObservability/DataTableLineage";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

export { LINEAGE_DEPTH_OPTIONS } from "./LineageDiagram";

export interface ComponentProps {
  dataAssetId: ObjectID;
  // The table's columns in its own order, as its last collection read them: the order a column is offered to follow in.
  columnOrder?: ReadonlyArray<string> | undefined;
}

const READ_FAILED: string = translationKey(
  "Could not read this table's lineage.",
);

/*
 * A table's lineage as a diagram, at the top of its Lineage tab: what it is
 * built from on the left, what is built from it on the right, three steps
 * each way unless the reader picks another number, with how each table
 * and pipeline is now. It is read with the columns each arrow carries, so
 * one of the table's columns can be followed up and down it. The lists
 * under it still say every edge one step away, and where each was seen.
 */
const TableLineageDiagram: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [depth, setDepth] = useState<number>(DEFAULT_DATA_LINEAGE_DEPTH);
  const read: LineageRead<DataTableLineage> = useLineageRead<DataTableLineage>(
    `${props.dataAssetId.toString()}:${depth}`,
    (): Promise<DataTableLineage> => {
      return DataObservabilityApi.getTableLineage(
        props.dataAssetId,
        depth,
        true,
      );
    },
    READ_FAILED,
  );

  let body: ReactElement;

  if (read.isLoading) {
    body = <ComponentLoader />;
  } else if (read.error || !read.answer) {
    body = (
      <ErrorMessage message={read.error || ""} onRefreshClick={read.retry} />
    );
  } else if (isLineageEmpty(read.answer)) {
    body = (
      <p className="text-sm text-gray-500" data-testid="lineage-empty">
        {translator.translateText(
          "No lineage has been seen for this table yet. It comes from OpenLineage events, dbt, Fivetran and Airbyte syncs, jobs in your traces, views and each database's query history.",
        )}
      </p>
    );
  } else {
    body = (
      <LineageDiagramBody
        lineage={read.answer}
        place={LineagePlace.Table}
        withColumns={true}
        columnOrder={props.columnOrder}
      />
    );
  }

  return (
    <Card
      title="Lineage"
      description="Where this table's data comes from and where it goes, a few steps each way, with how each table and pipeline is now. Open a table to center the diagram on it."
      rightElement={<LineageStepSwitch depth={depth} onChange={setDepth} />}
    >
      <div data-testid="table-lineage-diagram">{body}</div>
    </Card>
  );
};

export default TableLineageDiagram;
