import DataObservabilityApi from "./DataObservabilityApi";
import ChartSkeleton from "Common/UI/Components/Skeleton/ChartSkeleton";
import {
  LineageDiagramBody,
  LineageRead,
  LineageStepSwitch,
  useLineageRead,
} from "./LineageDiagram";
import { LineagePlace, isLineageEmpty } from "./LineageGraphModel";
import {
  DEFAULT_DATA_PIPELINE_LINEAGE_DEPTH,
  DataTableLineage,
} from "Common/Types/DataObservability/DataTableLineage";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

export interface ComponentProps {
  dataPipelineId: ObjectID;
}

const READ_FAILED: string = translationKey(
  "Could not read this pipeline's lineage.",
);

/*
 * A pipeline's lineage as a diagram, on its page: the tables it reads on
 * the left, the tables it writes on the right, each with how it is now -
 * the first thing to look at when a run fails or is late. One step each
 * way unless the reader picks more: then what those tables are built from,
 * and what is built from them. Each table opens its own Lineage tab.
 *
 * It is read with the columns its runs moved (#6854), so a column it
 * writes can be picked - offered in the order of the first table it writes
 * them to - and followed across it: down to the tables it writes it to,
 * up to the columns it was built from, and on along the arrows between
 * tables. Nothing is followed until the reader picks a column.
 */
const PipelineLineageDiagram: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [depth, setDepth] = useState<number>(
    DEFAULT_DATA_PIPELINE_LINEAGE_DEPTH,
  );
  const read: LineageRead<DataTableLineage> = useLineageRead<DataTableLineage>(
    `${props.dataPipelineId.toString()}:${depth}`,
    (): Promise<DataTableLineage> => {
      // With the columns its runs moved, so one of them can be followed across it (#6854).
      return DataObservabilityApi.getPipelineLineage(
        props.dataPipelineId,
        depth,
        true,
      );
    },
    READ_FAILED,
  );

  let body: ReactElement;

  if (read.isLoading) {
    body = <ChartSkeleton hasLegend={false} />;
  } else if (read.error || !read.answer) {
    body = (
      <ErrorMessage message={read.error || ""} onRefreshClick={read.retry} />
    );
  } else if (isLineageEmpty(read.answer)) {
    body = (
      <p className="text-sm text-gray-500" data-testid="lineage-empty">
        {translator.translateText(
          "No table has been seen read or written by this pipeline yet. Its runs say which, through OpenLineage events, dbt, Fivetran and Airbyte syncs, and the database calls in its traces.",
        )}
      </p>
    );
  } else {
    body = (
      <LineageDiagramBody
        lineage={read.answer}
        place={LineagePlace.Pipeline}
        withColumns={true}
        columnOrder={read.answer.columnOrder}
      />
    );
  }

  return (
    <Card
      title="Lineage"
      description="The tables this pipeline reads and writes, with how each is now. Follow a column to see where it comes from and where it goes, or pick more steps to see what they are built from and what is built from them."
      rightElement={<LineageStepSwitch depth={depth} onChange={setDepth} />}
    >
      <div data-testid="pipeline-lineage-diagram">{body}</div>
    </Card>
  );
};

export default PipelineLineageDiagram;
