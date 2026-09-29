import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Select from "Common/Types/BaseDatabase/Select";
import ObjectID from "Common/Types/ObjectID";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { useEffect, useState } from "react";

export interface UseParentNotifyDefaultProps<TParent extends BaseModel> {
  modelType: { new (): TParent };
  id: ObjectID;
  // Only the parent's own "notified subscribers when it started" flag.
  select: Select<TParent>;
  resolve: (parent: TParent | null) => boolean;
}

export interface UseParentNotifyDefaultResult {
  /*
   * Where "Notify status page subscribers" starts on a new public note. Null
   * until the parent loads: the composer reads it once, so it must not open
   * before this is known.
   */
  isNotifyingByDefault: boolean | null;
  error: string;
}

interface LoadedSetting {
  // The event the answer belongs to.
  id: string;
  isNotifyingByDefault: boolean | null;
  error: string;
}

/*
 * An event created without notifying status page subscribers should not have
 * its first public note be what tells them. Public note pages read the
 * event's own setting through this before they draw the composer, and start
 * the box unticked when the event was quiet.
 *
 * Every answer is kept with the id of the event it is for, and only handed
 * out for that event. Moving to another event therefore reads as "not loaded
 * yet" from the very first render - there is no render in between that pairs
 * the new event with the last one's setting - and a slow answer for an event
 * the page has already left is dropped.
 */
export default function useParentNotifyDefault<TParent extends BaseModel>(
  props: UseParentNotifyDefaultProps<TParent>,
): UseParentNotifyDefaultResult {
  const id: string = props.id.toString();

  const [loaded, setLoaded] = useState<LoadedSetting | null>(null);

  useEffect(() => {
    let isStale: boolean = false;

    ModelAPI.getItem<TParent>({
      modelType: props.modelType,
      id: props.id,
      select: props.select,
    })
      .then((parent: TParent | null) => {
        if (!isStale) {
          setLoaded({
            id,
            isNotifyingByDefault: props.resolve(parent),
            error: "",
          });
        }
      })
      .catch((err: unknown) => {
        if (!isStale) {
          setLoaded({
            id,
            isNotifyingByDefault: null,
            error: API.getFriendlyMessage(err),
          });
        }
      });

    return () => {
      isStale = true;
    };
  }, [id]);

  if (!loaded || loaded.id !== id) {
    return { isNotifyingByDefault: null, error: "" };
  }

  return {
    isNotifyingByDefault: loaded.isNotifyingByDefault,
    error: loaded.error,
  };
}
