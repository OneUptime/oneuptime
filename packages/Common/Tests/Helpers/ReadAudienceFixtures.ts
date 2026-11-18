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
 * (ReadAudiencePermission.getConditions, whose SQL its own suite reads),
 * for the suites that stub a service's reads in memory. A read for an
 * audience drops, of the rows the subject does not name:
 *
 *   - the private ones (`privateIds`), always;
 *   - the ones set apart by an owner or a label (`setApartIds`), when some
 *     role reads the model only by owner or label.
 *
 * Any other read - a person's, OneUptime's own - returns them all.
 */
export function keptForAudience<TRow extends { id?: ObjectID | null }>(data: {
  modelType: { new (): unknown };
  rows: Array<TRow>;
  props: DatabaseCommonInteractionProps | undefined;
  setApartIds?: Array<string> | undefined;
  privateIds?: Array<string> | undefined;
}): Array<TRow> {
  const audience: ReadAudience | null = ReadAudiencePermission.getAudience(
    data.props,
  );
  const modelType: { new (): never } = data.modelType as {
    new (): never;
  };

  if (!audience) {
    return data.rows;
  }

  const isNarrowed: boolean = ReadAudiencePermission.isKind(modelType)
    ? ReadAudiencePermission.isNarrowed(modelType, audience)
    : ReadAudiencePermission.getConditions(modelType, audience).length > 0;
  const lowerCased: (ids: Array<string> | undefined) => Set<string> = (
    ids: Array<string> | undefined,
  ): Set<string> => {
    return new Set<string>(
      (ids || []).map((id: string): string => {
        return id.toLowerCase();
      }),
    );
  };
  const setApart: Set<string> = lowerCased(data.setApartIds);
  const isPrivate: Set<string> = lowerCased(data.privateIds);

  return data.rows.filter((row: TRow): boolean => {
    const id: string = row.id?.toString().toLowerCase() || "";

    if (ReadAudiencePermission.isNamed(modelType, id, audience)) {
      return true;
    }

    return !isPrivate.has(id) && !(isNarrowed && setApart.has(id));
  });
}
