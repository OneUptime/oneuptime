/*
 * Which related resource a custom field copies its value from.
 *
 * A member here is only meaningful for a TARGET resource that actually has a
 * relation to it — an Alert has one Monitor, an Incident has many — so the
 * per-target list of usable sources lives in the server-side registry
 * (Common/Server/Utils/CustomField/CustomFieldMappingRegistry.ts) rather than
 * in this enum. The enum is the wire/storage vocabulary shared by the model
 * column, the settings form and the resolver.
 *
 * Values are persisted in the `mapFromResourceType` column of every
 * `*CustomField` definition table, so a member's VALUE is load-bearing: it
 * cannot be renamed without a data migration.
 */
enum CustomFieldMappingSourceResource {
  Monitor = "Monitor",
}

export default CustomFieldMappingSourceResource;
