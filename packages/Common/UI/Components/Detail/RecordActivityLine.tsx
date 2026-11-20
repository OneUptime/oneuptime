import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import { RecordActivity } from "./DetailRecordActivity";
import DetailRecordLine from "./DetailRecordLine";
import { RecordTime } from "./DetailRecordTime";
import RecordHistoryContext, {
  GetRecordHistoryRoute,
} from "./RecordHistoryContext";
import useRecordActivity from "./UseRecordActivity";
import React, {
  FunctionComponent,
  ReactElement,
  useContext,
  useMemo,
} from "react";

/*
 * A RECORD'S LINE, FOR A PAGE THAT DRAWS IT ITSELF (#10290).
 *
 * A details card drawn by ModelDetail reads who created the record and who
 * last modified it along with the record, and ends with its line. A page
 * that draws its own details - a resource's Overview (ResourceOverview), a
 * monitor's, an incident's - draws this instead: the same line, the record's
 * ID first, reading those columns of the record in one small read
 * (UseRecordActivity) and linking to its history where the front end has a
 * page of it (RecordHistoryContext).
 */
export interface ComponentProps {
  modelType: { new (): BaseModel };
  recordId: string | ObjectID;
  // When it was created or last updated, where the page has read it already.
  times?: Array<RecordTime> | undefined;
  // The record's own ID first, as every record line has it.
  isIdShown?: boolean | undefined;
  className?: string | undefined;
}

const RecordActivityLine: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const recordIdText: string = props.recordId.toString();

  const activity: RecordActivity | null = useRecordActivity({
    modelType: props.modelType,
    modelId: recordIdText,
  });

  const getRecordHistoryRoute: GetRecordHistoryRoute | null =
    useContext(RecordHistoryContext);

  const historyRoute: Route | null = useMemo(() => {
    if (!getRecordHistoryRoute || !recordIdText) {
      return null;
    }

    return getRecordHistoryRoute({
      modelType: props.modelType,
      modelId: new ObjectID(recordIdText),
    });
  }, [getRecordHistoryRoute, props.modelType, recordIdText]);

  return (
    <DetailRecordLine
      recordId={props.isIdShown === false ? undefined : recordIdText}
      times={props.times}
      activity={activity}
      historyRoute={historyRoute}
      className={props.className}
    />
  );
};

export default RecordActivityLine;
