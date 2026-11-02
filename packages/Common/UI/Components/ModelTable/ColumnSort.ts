import FieldType from "../Types/FieldType";
import ModelTableColumn from "./Column";
import AnalyticsBaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";

/*
 * Whether a column draws something of its own from a record's id - its
 * owners, a link, a status it reads elsewhere - rather than a field of the
 * record. Such a column is keyed by the id only because it needs one: sorted,
 * it ordered the list by the id - a random order under its name. The Owners
 * column of some sixty lists sorted so from its header, and a list drawn as
 * cards offered "Sort by Owners" (Table's TableCardsHeader). A column that
 * shows the id itself (an ObjectID column, "Incident ID") still sorts by it.
 */
export const isDrawnFromRecordId: <
  TBaseModel extends BaseModel | AnalyticsBaseModel,
>(
  column: ModelTableColumn<TBaseModel>,
  key: keyof TBaseModel | null,
) => boolean = <TBaseModel extends BaseModel | AnalyticsBaseModel>(
  column: ModelTableColumn<TBaseModel>,
  key: keyof TBaseModel | null,
): boolean => {
  return key === "_id" && column.type === FieldType.Element;
};
