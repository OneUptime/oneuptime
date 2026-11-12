import DataObservabilityApi from "./DataObservabilityApi";
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
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
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
      return DataObservabilityApi.getPipelineLineage(
        props.dataPipelineId,
        depth,
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
          "No table has been seen read or written by this pipeline yet. Its runs say which, through OpenLineage events, dbt, Fivetran and Airbyte syncs, and the database calls in its traces.",
        )}
      </p>
    );
  } else {
    body = (
      <LineageDiagramBody lineage={read.answer} place={LineagePlace.Pipeline} />
    );
  }

  return (
    <Card
      title="Lineage"
      description="The tables this pipeline reads and the tables it writes, with how each is now. Pick more steps to see what they are built from and what is built from them."
      rightElement={<LineageStepSwitch depth={depth} onChange={setDepth} />}
    >
      <div data-testid="pipeline-lineage-diagram">{body}</div>
    </Card>
  );
};

export default PipelineLineageDiagram;
