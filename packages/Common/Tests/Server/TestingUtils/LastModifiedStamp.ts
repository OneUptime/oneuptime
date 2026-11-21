import { LAST_MODIFIED_COLUMNS } from "../../../Types/Database/RecordActor";

/*
 * A row's write without who last modified the record (#10290). Every change
 * a person, an API key, a workflow or an MCP client makes carries that stamp
 * in the same write, so a test that holds a write to the columns it changes
 * reads the stamp apart. DatabaseServiceRecordActors holds the stamp itself.
 */
export function withoutLastModifiedStamp(
  set: Record<string, unknown>,
): Record<string, unknown> {
  const rest: Record<string, unknown> = { ...set };

  for (const column of LAST_MODIFIED_COLUMNS) {
    delete rest[column];
  }

  return rest;
}
