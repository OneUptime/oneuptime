import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import React from "react";

/*
 * WHERE A RECORD'S OWN PAGE IS (#10761).
 *
 * A form that warns its name is another record's links to that record
 * (DuplicateNameNotice), and Project Settings lists the names a project
 * holds twice with a link to each. Which kinds have a page, and at what
 * address, is the front end's to say - the Dashboard knows its routes; the
 * shared components do not - so the front end hands every component one
 * answer through this: the record's page, or null for a kind with none
 * (the component then names the record without a link).
 */
export type GetRecordPageRoute = (data: {
  // The kind, by its table: "Monitor".
  tableName: string;
  modelId: ObjectID;
}) => Route | null;

const RecordPageContext: React.Context<GetRecordPageRoute | null> =
  React.createContext<GetRecordPageRoute | null>(null);

export default RecordPageContext;
