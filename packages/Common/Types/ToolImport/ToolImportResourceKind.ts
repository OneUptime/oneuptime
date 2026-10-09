/*
 * What an import brings over, one kind per OneUptime record a source item
 * becomes. The value is stored on ToolImportRecord.kind and is part of every
 * plan item's key, so a value never changes once shipped.
 *
 * Tools added later bring kinds of their own (monitors, status pages): add
 * them here, give the applier a step for them, and give the page a section.
 */
enum ToolImportResourceKind {
  Person = "Person",
  Team = "Team",
  Service = "Service",
  IncidentSeverity = "IncidentSeverity",
  IncidentState = "IncidentState",
  IncidentRole = "IncidentRole",
  IncidentCustomField = "IncidentCustomField",
  OnCallSchedule = "OnCallSchedule",
  OnCallPolicy = "OnCallPolicy",
}

export default ToolImportResourceKind;

/*
 * The order an import creates things in, and the order the preview and the
 * report list them in: people first (everything else names them), teams next
 * (schedules, policies and services name their owner team), then what only
 * refers to those, and the escalation policies last, because they page the
 * schedules.
 */
export const ToolImportResourceKindOrder: Array<ToolImportResourceKind> = [
  ToolImportResourceKind.Person,
  ToolImportResourceKind.Team,
  ToolImportResourceKind.Service,
  ToolImportResourceKind.IncidentSeverity,
  ToolImportResourceKind.IncidentState,
  ToolImportResourceKind.IncidentRole,
  ToolImportResourceKind.IncidentCustomField,
  ToolImportResourceKind.OnCallSchedule,
  ToolImportResourceKind.OnCallPolicy,
];

export function isToolImportResourceKind(
  value: unknown,
): value is ToolImportResourceKind {
  return (
    typeof value === "string" &&
    (ToolImportResourceKindOrder as Array<string>).includes(value)
  );
}

/*
 * A plan item's key: its kind and the id the source tool gives it. The page
 * sends back the keys a person ticked, and the import finds the items by
 * them. The source id is the tool's own (an Opsgenie user id, an incident.io
 * schedule id), never a OneUptime id.
 */
export function getToolImportItemKey(
  kind: ToolImportResourceKind,
  sourceId: string,
): string {
  return `${kind}:${sourceId}`;
}
