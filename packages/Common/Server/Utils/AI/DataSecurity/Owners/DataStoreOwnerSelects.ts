import type DataStore from "../../../../../Models/DatabaseModels/DataStore";
import type { AiStoreRecord } from "../DataSecurityAiInput";

/*
 * THE COLUMNS OF A STORE THE OWNERS WORK READS (#10374).
 *
 * Kept apart from the reader and the planner, and importing nothing that
 * runs: the planner's select is built from the reader's when this file
 * loads, and both of those reach services that reach back to them, so a
 * select built there could be built while the other is still loading -
 * and quietly miss the evidence's columns.
 */

// The columns of a store the evidence reader needs.
export type DataStoreForOwnerEvidence = Pick<
  DataStore,
  | "_id"
  | "id"
  | "name"
  | "cloudTags"
  | "serviceId"
  | "cloudResourceId"
  | "providerResourceId"
  | "labels"
  | "createdByActorType"
  | "createdByUserId"
>;

export const DATA_STORE_FOR_OWNER_EVIDENCE_SELECT: {
  _id: true;
  name: true;
  cloudTags: true;
  serviceId: true;
  cloudResourceId: true;
  providerResourceId: true;
  labels: { _id: true };
  createdByActorType: true;
  createdByUserId: true;
} = {
  _id: true,
  name: true,
  cloudTags: true,
  serviceId: true,
  cloudResourceId: true,
  providerResourceId: true,
  labels: { _id: true },
  createdByActorType: true,
  createdByUserId: true,
};

// The columns of a store the planner reads: the evidence's, and the builder's.
export type DataStoreForOwnerPlan = DataStoreForOwnerEvidence & AiStoreRecord;

export const DATA_STORE_FOR_OWNER_PLAN_SELECT: typeof DATA_STORE_FOR_OWNER_EVIDENCE_SELECT & {
  kind: true;
  provider: true;
  region: true;
  environment: true;
  sensitivity: true;
  sensitivityOverride: true;
  dataTypeIds: true;
  dataCategories: true;
  exposure: true;
  isPublicByDesign: true;
} = {
  ...DATA_STORE_FOR_OWNER_EVIDENCE_SELECT,
  kind: true,
  provider: true,
  region: true,
  environment: true,
  sensitivity: true,
  sensitivityOverride: true,
  dataTypeIds: true,
  dataCategories: true,
  exposure: true,
  isPublicByDesign: true,
};
