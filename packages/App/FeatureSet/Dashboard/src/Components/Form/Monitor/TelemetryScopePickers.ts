import InventoryItem from "Common/Models/DatabaseModels/InventoryItem";
import Service from "Common/Models/DatabaseModels/Service";
import { JSONObject } from "Common/Types/JSON";
import Field from "Common/UI/Components/Forms/Types/Field";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * A TELEMETRY MONITOR'S "FILTER BY SERVICE" AND "FILTER BY INFRASTRUCTURE
 * ENTITY", SEARCHED ON THE SERVER (#10646).
 *
 * The Logs, Traces, Metrics, Exceptions, Profiles, LLM and Security Events
 * monitors' steps offered the project's first 10,000 services and inventory
 * items by name, read when the step opened. A project's pods and
 * containers pass that easily: one past it could not be picked, and one a
 * monitor already filtered on showed as nothing, and was dropped the next
 * time the field was changed.
 *
 * Both fields search the server as they are typed in (a form field's
 * dropdownModal: EntityDropdown), 50 by name; what the step holds is read by
 * its value - a service by its id, an inventory item by its entityKey, the
 * value the criteria compile into hasAny(entityKeys, [...]) - so it is named
 * however many the project has. One that is gone reads "No longer
 * available", to keep or take out.
 */

// A value the step holds that no record answers to any more.
export const TELEMETRY_SCOPE_NOT_FOUND_LABEL: string = translationKey(
  "No longer available",
);

type DropdownModal = NonNullable<Field<JSONObject>["dropdownModal"]>;

// The services a step reads telemetry from, by their ids.
export const TELEMETRY_SERVICE_PICKER: DropdownModal = {
  type: Service,
  labelField: "name",
  valueField: "_id",
  notFoundLabel: TELEMETRY_SCOPE_NOT_FOUND_LABEL,
};

/*
 * The hosts, clusters, pods and containers a step reads telemetry from, by
 * their entityKey: found by name or by key, each with its type beside it
 * ("Pod"), so two of one name are told apart.
 */
export const INFRASTRUCTURE_ENTITY_PICKER: DropdownModal = {
  type: InventoryItem,
  labelField: "displayName",
  valueField: "entityKey",
  searchFields: ["displayName", "entityKey"],
  descriptionField: "entityType",
  notFoundLabel: TELEMETRY_SCOPE_NOT_FOUND_LABEL,
};
