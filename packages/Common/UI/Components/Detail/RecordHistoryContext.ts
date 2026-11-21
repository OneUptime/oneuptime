import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import React from "react";

/*
 * WHERE A RECORD'S HISTORY IS (#10290).
 *
 * A record's line ends with "History" where the record has a page of its
 * changes - a monitor's, an incident's or a dashboard's Audit Logs - and the
 * reader may read it. Which records have one, and at what address, is the
 * front end's to say (the Dashboard knows its routes; the shared components
 * do not), so the front end hands every record line one answer through this:
 * the record's history page, or null for a record that has none or a reader
 * who may not open it.
 */
export type GetRecordHistoryRoute = (data: {
  modelType: { new (): BaseModel };
  modelId: ObjectID;
}) => Route | null;

const RecordHistoryContext: React.Context<GetRecordHistoryRoute | null> =
  React.createContext<GetRecordHistoryRoute | null>(null);

export default RecordHistoryContext;
