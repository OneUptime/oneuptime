import type { JSONObject } from "./JSON";

/*
 * THE TYPES JSON READING BUILDS THAT JOIN IT WHEN THEIR OWN MODULE LOADS.
 *
 * SerializableObjectDictionary imports every type JSONFunctions reads back
 * from its `_type`, and every frontend reads JSON: what the dictionary
 * imports is in the first load of every page. A monitor's steps and criteria
 * (MonitorSteps, MonitorStep, MonitorCriteria, MonitorCriteriaInstance)
 * bring every monitor type with them - its step settings, its default
 * criteria and their sentences - some 147 KB before gzip that the sign-in
 * and sign-up pages, a status page and a public dashboard never read
 * (issue #8821).
 *
 * So those join the dictionary from their own module instead: each calls
 * joinSerializableObjectDictionary as it loads, and the dictionary looks it
 * up here when JSON names it. A program that reads a monitor loads them:
 * on the server the Monitor, MonitorTemplate and MonitorTest models do
 * (MonitorStepsColumnTransformer), and the Dashboard loads them from its
 * entry (Types/Monitor/MonitorJsonTypes). Until one
 * has loaded, a value that names it reads as the plain object it was sent
 * as, as a value of a type JSON reading does not know does.
 *
 * This module imports nothing it runs, so it is never part of an import
 * cycle: whichever module loads first, it is there before anything joins.
 */

// What JSON reading asks of a type: to build one from its JSON.
export interface JoinedSerializableObject {
  fromJSON: (json: JSONObject) => unknown;
}

const joined: Map<string, JoinedSerializableObject> = new Map<
  string,
  JoinedSerializableObject
>();

// A type's own module, as it loads: JSON naming `type` is read with it.
export const joinSerializableObjectDictionary: (
  type: string,
  serializable: JoinedSerializableObject,
) => void = (type: string, serializable: JoinedSerializableObject): void => {
  joined.set(type, serializable);
};

// The type that joined as `type`, or undefined while its module has not loaded.
export const getJoinedSerializableObject: (
  type: string,
) => JoinedSerializableObject | undefined = (
  type: string,
): JoinedSerializableObject | undefined => {
  return joined.get(type);
};
