import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Select from "../../../Types/BaseDatabase/Select";
import ArchivedValuePicker from "../../Utils/ArchivedValuePicker";
import RecordsById from "../../Utils/RecordsById";
import {
  getSharedNameFacts,
  getSharedNameSelect,
} from "../../Utils/SharedNameOptions";
import { DropdownOption } from "../Dropdown/Dropdown";
import { useEffect, useState } from "react";

/*
 * WHAT A SEARCHED PICKER HOLDS, NAMED BEFORE IT IS DRAWN (#10646, #10689,
 * #10690).
 *
 * A picker that searches the server (EntityDropdown) reads a held value it
 * has no name for by its id itself - drawing the bare id until the read
 * lands. A page that held the project's whole list named them at once, from
 * the first 10,000 by name: one past them never was.
 *
 * The held values are read here instead, by their ids, before the picker
 * is drawn (the page draws a placeholder until then): each by its name,
 * an archived one marked, one of records that share a name with what sets
 * it apart (#10064), and one no record answers to any more as a chip in
 * the page's words (notFoundLabel). Values picked since are named by the
 * search that offered them (remember), and never read again.
 */

export interface HeldValueOptions {
  // Each held value, by its lower-cased id; null until they are read.
  options: Map<string, DropdownOption> | null;
  // Names a pick brought: kept, so they are never read.
  remember: (options: Array<DropdownOption>) => void;
}

// What a held value is read with: its name, and how it is marked.
export const getHeldValueSelect: (modelType: {
  new (): BaseModel;
}) => Select<BaseModel> = (modelType: {
  new (): BaseModel;
}): Select<BaseModel> => {
  return {
    _id: true,
    name: true,
    ...ArchivedValuePicker.getSelectedValueSelect(modelType),
    ...getSharedNameSelect(modelType),
  } as Select<BaseModel>;
};

// A held record as its chip draws it.
export const toHeldValueOption: (
  record: BaseModel,
  colorField?: string | undefined,
) => DropdownOption | null = (
  record: BaseModel,
  colorField?: string | undefined,
): DropdownOption | null => {
  const id: string = record._id?.toString().toLowerCase() || "";
  const raw: Record<string, unknown> = record as unknown as Record<
    string,
    unknown
  >;

  if (!id) {
    return null;
  }

  const option: DropdownOption = {
    value: id,
    label: (raw["name"] as string | undefined)?.toString() || id,
    // A record's name is its owner's, drawn as written.
    isUserContent: true,
  };

  if (colorField && raw[colorField]) {
    option.color = raw[colorField] as NonNullable<DropdownOption["color"]>;
  }

  if (raw["isArchived"] === true) {
    option.isArchived = true;
  }

  const sharedName: DropdownOption["sharedName"] = getSharedNameFacts(record);

  if (sharedName) {
    option.sharedName = sharedName;
  }

  return option;
};

export const useHeldValueOptions: (data: {
  modelType: { new (): BaseModel };
  ids: Array<string>;
  // Unset: the name, whether it is archived and what tells twins apart.
  select?: Select<BaseModel> | undefined;
  colorField?: string | undefined;
  // In words to look up: never a name as written.
  notFoundLabel: string;
}) => HeldValueOptions = (data: {
  modelType: { new (): BaseModel };
  ids: Array<string>;
  select?: Select<BaseModel> | undefined;
  colorField?: string | undefined;
  notFoundLabel: string;
}): HeldValueOptions => {
  const [options, setOptions] = useState<Map<string, DropdownOption> | null>(
    null,
  );

  const idsKey: string = data.ids
    .map((id: string): string => {
      return id.toLowerCase();
    })
    .join("|");

  useEffect(() => {
    let isCurrent: boolean = true;

    const read: () => Promise<void> = async (): Promise<void> => {
      const known: Map<string, DropdownOption> = new Map(options || []);
      const toRead: Array<string> = data.ids.filter((id: string): boolean => {
        return !known.has(id.toLowerCase());
      });

      if (toRead.length === 0) {
        if (!options) {
          setOptions(known);
        }

        return;
      }

      try {
        const records: Array<BaseModel> = await RecordsById.read<BaseModel>({
          modelType: data.modelType,
          ids: toRead,
          select: data.select || getHeldValueSelect(data.modelType),
        });

        for (const record of records) {
          const option: DropdownOption | null = toHeldValueOption(
            record,
            data.colorField,
          );

          if (option) {
            known.set(String(option.value), option);
          }
        }

        // Asked for by its id, and not there: deleted since.
        for (const id of RecordsById.getValuesToRead({ ids: toRead })) {
          if (!known.has(id)) {
            known.set(id, {
              value: id,
              label: data.notFoundLabel,
              isUserContent: false,
              isNotFound: true,
            });
          }
        }
      } catch {
        /*
         * Naming them is the picker's to do then: it reads a held value by
         * its id itself, and its search must not fail with this read.
         */
      }

      if (isCurrent) {
        setOptions(known);
      }
    };

    void read();

    return () => {
      isCurrent = false;
    };
  }, [idsKey, data.modelType]);

  return {
    options: options,
    remember: (picked: Array<DropdownOption>): void => {
      const known: Map<string, DropdownOption> = new Map(options || []);

      for (const option of picked) {
        const id: string = String(option.value).toLowerCase();

        if (!known.has(id)) {
          known.set(id, { ...option, value: id });
        }
      }

      setOptions(known);
    },
  };
};

// The picker's value: each held id, named where its name was read.
export const getHeldValue: (data: {
  ids: Array<string>;
  options: Map<string, DropdownOption> | null;
}) => Array<DropdownOption | string> = (data: {
  ids: Array<string>;
  options: Map<string, DropdownOption> | null;
}): Array<DropdownOption | string> => {
  return data.ids.map((id: string): DropdownOption | string => {
    const option: DropdownOption | undefined = data.options?.get(
      id.toLowerCase(),
    );

    // As the condition holds it: the id in its own letter case.
    return option ? { ...option, value: id } : id;
  });
};
