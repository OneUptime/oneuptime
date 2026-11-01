import UserPreferences, {
  UserPreferenceType,
} from "../../../Utils/UserPreferences";
import { JSONObject } from "../../../Types/JSON";
import IconProp from "../../../Types/Icon/IconProp";
import User from "../../Utils/User";
import { translationKey } from "../../Utils/TranslateTemplate";
import { useEffect, useState } from "react";

/*
 * HOW TALL A TABLE'S ROWS ARE: the person's choice, for every table.
 *
 * Comfortable is the table as the product draws it - a row 48px tall, its
 * 24px line with 12px above and below. Compact takes 4px off each side: a
 * row of 40px, the header's band 32px, so a long list - incidents, logs of
 * a policy, a project's monitors - shows a fifth more rows in the same room.
 *
 * Chosen in a table's ⋯ ("Compact rows"), kept for the person in this
 * browser, and the same for every table: a density is how someone likes to
 * read lists, not a setting of one list. A phone's cards are not rows, and
 * keep their room.
 */
export enum TableDensity {
  Comfortable = "comfortable",
  Compact = "compact",
}

// The attribute a table carries while its rows are compact.
export const TABLE_DENSITY_ATTRIBUTE: string = "data-density";

// What the ⋯ says and shows, in English: looked up as the menu draws it.
export const TABLE_DENSITY_MENU_TEXT: string = translationKey("Compact rows");

export const TABLE_DENSITY_MENU_ICON: IconProp = IconProp.Bars4;

// The key every table's item shares in a card's ⋯: one item for them all.
export const TABLE_DENSITY_MENU_KEY: string = "table-density";

export const TABLE_DENSITY_TEST_ID: string = "table-density";

const getPreferenceKey: () => string = (): string => {
  let personId: string = "";

  try {
    personId = User.getUserId()?.toString() || "";
  } catch {
    personId = "";
  }

  return personId || "everyone";
};

const isTableDensity: (value: unknown) => value is TableDensity = (
  value: unknown,
): value is TableDensity => {
  return value === TableDensity.Comfortable || value === TableDensity.Compact;
};

// The person's density, as kept; Comfortable when nothing (or junk) is.
export const readTableDensity: () => TableDensity = (): TableDensity => {
  try {
    const stored: JSONObject | null =
      UserPreferences.getUserPreferenceByTypeAsJSON({
        key: getPreferenceKey(),
        userPreferenceType: UserPreferenceType.TableDensity,
      });
    const density: unknown = stored ? stored["density"] : undefined;

    return isTableDensity(density) ? density : TableDensity.Comfortable;
  } catch {
    return TableDensity.Comfortable;
  }
};

// Every table drawn now, told when the density changes.
const listeners: Set<(density: TableDensity) => void> = new Set();

export const writeTableDensity: (density: TableDensity) => void = (
  density: TableDensity,
): void => {
  try {
    if (density === TableDensity.Comfortable) {
      UserPreferences.removeUserPreferenceByType({
        key: getPreferenceKey(),
        userPreferenceType: UserPreferenceType.TableDensity,
      });
    } else {
      UserPreferences.saveUserPreferenceByTypeAsJSON({
        key: getPreferenceKey(),
        userPreferenceType: UserPreferenceType.TableDensity,
        value: { density: density },
      });
    }
  } catch {
    // Not kept: the tables drawn now still change.
  }

  listeners.forEach((listener: (density: TableDensity) => void) => {
    listener(density);
  });
};

/*
 * The density every table draws its rows at: read as the table is first
 * drawn (a compact list never paints a frame of tall rows), and again when
 * the person changes it - in this table, another, or another tab.
 */
export const useTableDensity: () => TableDensity = (): TableDensity => {
  const [density, setDensity] = useState<TableDensity>(readTableDensity);

  useEffect(() => {
    const listener: (next: TableDensity) => void = (
      next: TableDensity,
    ): void => {
      setDensity(next);
    };

    listeners.add(listener);

    // Another tab's change.
    const onStorage: (event: StorageEvent) => void = (): void => {
      setDensity(readTableDensity());
    };

    window.addEventListener("storage", onStorage);

    return () => {
      listeners.delete(listener);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return density;
};
