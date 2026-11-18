import ReadAudiencePermission from "../../Server/Types/Database/Permissions/ReadAudiencePermission";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ReadAudience from "../../Types/BaseDatabase/ReadAudience";
import Dictionary from "../../Types/Dictionary";
import ObjectID from "../../Types/ObjectID";

/*
 * Who reads an investigation's report (Types/BaseDatabase/ReadAudience,
 * #9576), for the suites of the starting contexts and the tools that read
 * for it: an audience of a project whose roles narrow nobody - everything
 * but private records read, as before - and one narrowed by owners or
 * labels on the permissions named.
 */
export function readAudienceOf(data: {
  projectId: ObjectID | string;
  ownedOnlyPermissions?: Array<string> | undefined;
  labelledPermissions?: Array<string> | undefined;
  named?: Dictionary<Array<string>> | undefined;
  telemetryBlockedIds?: Array<string> | undefined;
}): ReadAudience {
  return {
    _type: "ReadAudience",
    projectId: data.projectId.toString(),
    ownedOnlyPermissions: data.ownedOnlyPermissions || [],
    labelledPermissions: data.labelledPermissions || [],
    named: data.named || {},
    telemetryBlockedIds: data.telemetryBlockedIds || [],
  };
}

// The props a read made for an audience carries: root, the project, the audience.
export function readAudienceProps(
  audience: ReadAudience,
): DatabaseCommonInteractionProps {
  return ReadAudiencePermission.getReadProps(audience);
}

/*
 * What a read of `modelType` made with `props` returns of `rows`, as the
 * database returns it once the permission layer narrowed the read
 * (ReadAudiencePermission.getConditions, whose SQL its own suite reads):
 * a read for an audience that leaves records of the model out drops the
 * rows set apart (`setApartIds`, by owner or label) that the subject does
 * not name. Any other read - a person's, OneUptime's own - returns them
 * all. For the suites that stub a service's reads in memory.
 */
export function keptForAudience<TRow extends { id?: ObjectID | null }>(data: {
  modelType: { new (): unknown };
  rows: Array<TRow>;
  props: DatabaseCommonInteractionProps | undefined;
  setApartIds: Array<string>;
}): Array<TRow> {
  const audience: ReadAudience | null = ReadAudiencePermission.getAudience(
    data.props,
  );
  const modelType: { new (): never } = data.modelType as {
    new (): never;
  };

  if (
    !audience ||
    ReadAudiencePermission.getConditions(modelType, audience).length === 0
  ) {
    return data.rows;
  }

  const setApart: Set<string> = new Set<string>(
    data.setApartIds.map((id: string): string => {
      return id.toLowerCase();
    }),
  );

  return data.rows.filter((row: TRow): boolean => {
    const id: string = row.id?.toString().toLowerCase() || "";

    return (
      !setApart.has(id) ||
      ReadAudiencePermission.isNamed(modelType, id, audience)
    );
  });
}
