import ApiKey from "../../../Models/DatabaseModels/ApiKey";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Workflow from "../../../Models/DatabaseModels/Workflow";
import Select from "../../../Types/BaseDatabase/Select";
import RecordActorType from "../../../Types/Database/RecordActor";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI from "../../Utils/ModelAPI/ModelAPI";
import PermissionGate from "../../Utils/PermissionGate";
import {
  getNamedActorIds,
  getRecordActivitySelect,
  RecordActivity,
  readRecordActivity,
  withActorNames,
} from "./DetailRecordActivity";
import { useEffect, useMemo, useState } from "react";

/*
 * WHO MADE A RECORD AND WHO LAST MODIFIED IT, READ FOR ITS LINE (#10290).
 *
 * Handed the record as a read with getRecordActivitySelect found it (`item`,
 * ModelDetail's own read), it reads what that says. Handed only the
 * record's id, it reads those columns alone, in one small read - for a page
 * that draws its record line itself (ResourceOverview). Either way it asks
 * only for what the reader may read, as the read of the record does.
 *
 * An API key or a workflow is named by its own name where the reader may
 * read it - the keys' and workflows' own readers - and by its kind alone
 * otherwise: a Monitor Viewer reads that an API key changed the monitor, and
 * never a key they may not read. A read that fails says what is known.
 */
export interface UseRecordActivityProps {
  modelType?: { new (): BaseModel } | undefined;
  // The record, read with getRecordActivitySelect's columns...
  item?: BaseModel | null | undefined;
  /*
   * ...and what that read asked for: a person it did not ask for is not
   * named, rather than read as gone.
   */
  select?: Select<BaseModel> | undefined;
  // Or its id, to read them.
  modelId?: ObjectID | string | null | undefined;
  // Nothing is read while false: no line to draw.
  isEnabled?: boolean | undefined;
}

// What a record type's read asks for its line, for this reader.
export const getRecordActivitySelectFor: (modelType: {
  new (): BaseModel;
}) => Select<BaseModel> = (modelType: {
  new (): BaseModel;
}): Select<BaseModel> => {
  const model: BaseModel = new modelType();

  return getRecordActivitySelect(model, (column: string): boolean => {
    return PermissionGate.canReadColumn(model, column);
  }) as Select<BaseModel>;
};

// The names of the API keys or workflows a reader may read, by id.
const readActorNames: (data: {
  modelType: { new (): BaseModel };
  ids: Array<string>;
}) => Promise<Map<string, string>> = async (data: {
  modelType: { new (): BaseModel };
  ids: Array<string>;
}): Promise<Map<string, string>> => {
  const names: Map<string, string> = new Map<string, string>();

  if (
    data.ids.length === 0 ||
    !PermissionGate.canReadColumn(new data.modelType(), "name")
  ) {
    return names;
  }

  await Promise.all(
    data.ids.map(async (id: string): Promise<void> => {
      try {
        const record: BaseModel | null = await ModelAPI.getItem({
          modelType: data.modelType,
          id: new ObjectID(id),
          select: { name: true } as Select<BaseModel>,
        });

        const name: unknown = record
          ? (record as unknown as { name?: unknown }).name
          : undefined;

        if (typeof name === "string" && name.trim()) {
          names.set(id, name.trim());
        }
      } catch {
        // Not readable, or gone: its kind still says what it was.
      }
    }),
  );

  return names;
};

const useRecordActivity: (
  props: UseRecordActivityProps,
) => RecordActivity | null = (
  props: UseRecordActivityProps,
): RecordActivity | null => {
  const [activity, setActivity] = useState<RecordActivity | null>(null);
  const isEnabled: boolean = props.isEnabled !== false;
  const modelIdText: string = props.modelId ? props.modelId.toString() : "";

  // The activity the item already holds: read once per item.
  const itemActivity: RecordActivity | null = useMemo(() => {
    if (!isEnabled || !props.item) {
      return null;
    }

    return readRecordActivity(props.item, props.select as never);
  }, [props.item, props.select, isEnabled]);

  useEffect(() => {
    let isCurrent: boolean = true;

    const load: () => Promise<void> = async (): Promise<void> => {
      let read: RecordActivity | null = itemActivity;

      if (!read && isEnabled && props.modelType && modelIdText) {
        const select: Select<BaseModel> = getRecordActivitySelectFor(
          props.modelType,
        );

        try {
          const record: BaseModel | null = await ModelAPI.getItem({
            modelType: props.modelType,
            id: new ObjectID(modelIdText),
            select: select,
          });

          read = record ? readRecordActivity(record, select as never) : null;
        } catch {
          read = null;
        }
      }

      if (!isCurrent) {
        return;
      }

      setActivity(read);

      if (!read) {
        return;
      }

      const [apiKeyNames, workflowNames] = await Promise.all([
        readActorNames({
          modelType: ApiKey,
          ids: getNamedActorIds(read, RecordActorType.ApiKey),
        }),
        readActorNames({
          modelType: Workflow,
          ids: getNamedActorIds(read, RecordActorType.Workflow),
        }),
      ]);

      if (!isCurrent || (apiKeyNames.size === 0 && workflowNames.size === 0)) {
        return;
      }

      setActivity(
        withActorNames(read, new Map([...apiKeyNames, ...workflowNames])),
      );
    };

    void load();

    return () => {
      isCurrent = false;
    };
  }, [itemActivity, props.modelType, modelIdText, isEnabled]);

  return activity;
};

export default useRecordActivity;
