import DataAssetKind, {
  DATA_ASSET_KINDS,
} from "Common/Types/DataObservability/DataAssetKind";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";

/*
 * A DATA ASSET'S KIND, IN WORDS (#7781, #8078).
 *
 * Every kind is a key of the Dashboard's locales, and two of them name
 * their meaning (Common/Types/MeaningKeys): "View" alone is every View
 * button's verb ("Ver", "Anzeigen", "Voir"), and "Table" a table on the
 * page (French "Tableau", Chinese 表格), so a database's view and table are
 * "View (database object)" and "Table (database object)", worded as the
 * database's object in every language - "Vista", "Sicht", "Vue"; French
 * "Table", Chinese 表. English reads "View" and "Table".
 *
 * The Kind filter's menu and its chip, the line under a table's name in the
 * lists, a table's Kind on its Overview and the line under a card's name in
 * the lineage graph all read them from here.
 */
export const DATA_ASSET_KIND_LABELS: Record<DataAssetKind, string> = {
  [DataAssetKind.Table]: translationKey("Table (database object)"),
  [DataAssetKind.View]: translationKey("View (database object)"),
  [DataAssetKind.MaterializedView]: translationKey("Materialized View"),
  [DataAssetKind.PartitionedTable]: translationKey("Partitioned Table"),
  [DataAssetKind.ForeignTable]: translationKey("Foreign Table"),
  [DataAssetKind.StoragePath]: translationKey("Storage Path"),
};

/*
 * A kind in the reader's language. One a newer server added reads as it is
 * stored, looked up as it always was.
 */
export function getDataAssetKindText(
  translator: Translator,
  kind: DataAssetKind | string,
): string {
  const label: string = DATA_ASSET_KIND_LABELS[kind as DataAssetKind] || kind;

  return translator.translateText(label) || label;
}

// The Kind filter: every kind, in the words its rows draw it in.
export const DATA_ASSET_KIND_OPTIONS: Array<DropdownOption> =
  DATA_ASSET_KINDS.map((kind: DataAssetKind): DropdownOption => {
    return { value: kind, label: DATA_ASSET_KIND_LABELS[kind] };
  });
