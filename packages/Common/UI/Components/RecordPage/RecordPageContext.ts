import Route from "../../../Types/API/Route";
import { RecordPageFields } from "../../../Types/Database/RecordPageFields";
import ObjectID from "../../../Types/ObjectID";
import React from "react";

/*
 * WHERE A RECORD'S OWN PAGE IS (#10761).
 *
 * A form that warns its name is another record's links to that record
 * (DuplicateNameNotice), and Project Settings lists the names a project
 * holds twice with a link to each. Which kinds have a page, and at what
 * address, is the front end's to say - the Dashboard knows its routes; the
 * shared components do not - so the front end hands every component its
 * answer through this: the record's page, or null for a kind with none
 * (the component then names the record without a link).
 *
 * A kind opened under another record or page - an OpenStack budget under
 * its cloud, a workspace summary under its workspace's page - is linked
 * from what the server sends beside the record (pageFields, Types/
 * Database/RecordPageFields, #11020). A kind the front end shows on no page
 * at all says so in words of its own (getNoPageNote), where a link would
 * have led nowhere: "AI agents have no page in the dashboard."
 */
export type GetRecordPageRoute = (data: {
  // The kind, by its table: "Monitor".
  tableName: string;
  modelId: ObjectID;
  // What the page needs beside the record's id, as the server sent it.
  pageFields?: RecordPageFields | undefined;
}) => Route | null;

/*
 * What the front end says of a kind it shows on no page at all, in
 * English, looked up where it is drawn; null for a kind with a page, or one
 * it does not know.
 */
export type GetNoRecordPageNote = (tableName: string) => string | null;

export interface RecordPages {
  getRoute: GetRecordPageRoute;
  getNoPageNote?: GetNoRecordPageNote | undefined;
}

const RecordPageContext: React.Context<RecordPages | null> =
  React.createContext<RecordPages | null>(null);

export default RecordPageContext;
