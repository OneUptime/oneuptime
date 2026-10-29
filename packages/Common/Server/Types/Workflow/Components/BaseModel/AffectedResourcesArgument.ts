import IncidentTemplateService from "../../../../Services/IncidentTemplateService";
import AffectedResourceReferences, {
  AffectedResourceReferenceResolution,
  ResolvedAffectedResource,
} from "../../../../Utils/AffectedResources/AffectedResourceReferences";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { AffectedResourceKind } from "../../../../../Types/AffectedResources/AffectedResourceSearch";
import {
  AI_AFFECTED_RESOURCE_KINDS,
  AiAffectedResourceKindInfo,
  getAiAffectedResourceKindInfo,
} from "../../../../../Types/AI/AiAffectedResources";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { TableColumnMetadata } from "../../../../../Types/Database/TableColumn";
import ObjectID from "../../../../../Types/ObjectID";
import {
  MAX_AFFECTED_RESOURCE_REFERENCES,
  MAX_LINKED_AFFECTED_RESOURCES,
  getAffectedResourcesArgument,
  readAffectedResourceReferences,
} from "../../../../../Types/Workflow/AffectedResourcesSetting";

/*
 * CREATE ONE INCIDENT'S AND CREATE ONE ALERT'S AFFECTED RESOURCES, AT RUN
 * TIME (issue #5341; the setting is Types/Workflow/AffectedResourcesSetting).
 *
 * The references the setting holds are looked up across every kind of
 * resource the record can be linked to (AffectedResourceReferences), as
 * the step - a Project Admin of the workflow's project - and what they name
 * is ADDED to the record's lists: to what JSON Object sets, and, for a
 * list JSON Object leaves out on an incident declared from a template, to
 * the template's. A reference that names nothing never fails the step: the
 * incident or alert is still what the workflow is for, and the run log says
 * which references linked what and which named nothing.
 */

// The kinds the record can be linked to by the setting: every list it has.
export function getLinkableKinds(
  record: BaseModel,
): Array<AiAffectedResourceKindInfo> {
  return AI_AFFECTED_RESOURCE_KINDS.filter(
    (info: AiAffectedResourceKindInfo): boolean => {
      return record.hasColumn(info.relation);
    },
  );
}

// "network device WAN-RTR-01", for the run log.
function describe(resource: ResolvedAffectedResource): string {
  const noun: string = getAiAffectedResourceKindInfo(
    resource.kind as unknown as AiAffectedResourceKindInfo["kind"],
  ).noun;

  return resource.name ? `${noun} ${resource.name}` : `${noun} ${resource.id}`;
}

// The ids a list on the record already holds, as text.
function readListIds(value: unknown): Array<string> {
  if (!Array.isArray(value)) {
    return [];
  }

  const ids: Array<string> = [];

  for (const item of value) {
    const id: string =
      typeof item === "string"
        ? item
        : item && typeof item === "object"
          ? String(
              (item as { _id?: unknown; id?: unknown })._id ||
                (item as { _id?: unknown; id?: unknown }).id ||
                "",
            )
          : "";

    if (id && !ids.includes(id.toLowerCase())) {
      ids.push(id.toLowerCase());
    }
  }

  return ids;
}

/*
 * The lists of the template a step declares an incident from, for the
 * relations the setting adds to: read as the step, so a template it may
 * not read gives nothing here (and the declaration itself is refused).
 */
async function readTemplateLists(data: {
  tableName: string;
  templateId: ObjectID;
  projectId: ObjectID;
  relations: Array<string>;
  props: DatabaseCommonInteractionProps;
}): Promise<Record<string, Array<string>>> {
  if (data.tableName !== "Incident") {
    return {};
  }

  const template: BaseModel = IncidentTemplateService.getModel();
  const relations: Array<string> = data.relations.filter(
    (relation: string): boolean => {
      return template.hasColumn(relation);
    },
  );

  if (relations.length === 0) {
    return {};
  }

  const select: Record<string, unknown> = { _id: true };

  for (const relation of relations) {
    select[relation] = { _id: true };
  }

  const found: BaseModel | null = await IncidentTemplateService.findOneBy({
    query: {
      _id: data.templateId.toString(),
      projectId: data.projectId,
    },
    select: select as never,
    props: data.props,
  });

  const lists: Record<string, Array<string>> = {};

  for (const relation of relations) {
    lists[relation] = readListIds(
      found ? (found as unknown as Record<string, unknown>)[relation] : [],
    );
  }

  return lists;
}

/*
 * Links what the setting names to `record`, in place, before it is
 * created. A no-op for a table without the setting, or a setting left
 * empty. Never throws for what the setting holds.
 */
export async function linkAffectedResourcesFromSetting(data: {
  record: BaseModel;
  tableName: string | undefined;
  value: unknown;
  projectId: ObjectID;
  props: DatabaseCommonInteractionProps;
  templateId: ObjectID | null;
  log: (message: string) => void;
}): Promise<AffectedResourceReferenceResolution | null> {
  if (!getAffectedResourcesArgument(data.tableName)) {
    return null;
  }

  const read: { references: Array<string>; leftOut: number } =
    readAffectedResourceReferences(data.value);

  if (read.references.length === 0) {
    return null;
  }

  if (read.leftOut > 0) {
    data.log(
      `Affected Resources: only the first ${MAX_AFFECTED_RESOURCE_REFERENCES} entries are looked up; ${read.leftOut} more were left out.`,
    );
  }

  const kinds: Array<AiAffectedResourceKindInfo> = getLinkableKinds(
    data.record,
  );

  const resolution: AffectedResourceReferenceResolution =
    await AffectedResourceReferences.resolve({
      projectId: data.projectId,
      props: data.props,
      references: read.references,
      kinds: kinds.map(
        (info: AiAffectedResourceKindInfo): AffectedResourceKind => {
          return info.kind as unknown as AffectedResourceKind;
        },
      ),
    });

  // The ids to add, by the list each goes in.
  const additions: Map<string, Array<string>> = new Map<
    string,
    Array<string>
  >();

  for (const resource of resolution.resolved) {
    const info: AiAffectedResourceKindInfo | undefined = kinds.find(
      (candidate: AiAffectedResourceKindInfo): boolean => {
        return (candidate.kind as string) === (resource.kind as string);
      },
    );

    if (!info) {
      continue;
    }

    additions.set(info.relation, [
      ...(additions.get(info.relation) || []),
      resource.id,
    ]);
  }

  const recordJson: Record<string, unknown> = data.record as unknown as Record<
    string,
    unknown
  >;

  // Lists JSON Object leaves out start from the template's, when there is one.
  const fromTemplate: Record<string, Array<string>> = data.templateId &&
  additions.size > 0
    ? await readTemplateLists({
        tableName: data.tableName || "",
        templateId: data.templateId,
        projectId: data.projectId,
        relations: Array.from(additions.keys()).filter(
          (relation: string): boolean => {
            return recordJson[relation] === undefined;
          },
        ),
        props: data.props,
      })
    : {};

  for (const [relation, ids] of additions) {
    const metadata: TableColumnMetadata | undefined =
      data.record.getTableColumnMetadata(relation);
    const modelType: { new (): BaseModel } | undefined = metadata?.modelType;

    if (!modelType) {
      continue;
    }

    const existing: Array<string> =
      recordJson[relation] === undefined
        ? fromTemplate[relation] || []
        : readListIds(recordJson[relation]);

    const merged: Array<string> = [...existing];

    for (const id of ids) {
      if (!merged.includes(id)) {
        merged.push(id);
      }
    }

    recordJson[relation] = merged.map((id: string): BaseModel => {
      const related: BaseModel = new modelType();
      related._id = id;
      return related;
    });
  }

  if (resolution.resolved.length > 0) {
    data.log(
      `Affected Resources: linked ${resolution.resolved
        .map((resource: ResolvedAffectedResource): string => {
          return describe(resource);
        })
        .join(", ")}.`,
    );
  }

  for (const reference of resolution.notFound) {
    data.log(
      `Affected Resources: nothing in this project is called "${reference}", so it was not linked.`,
    );
  }

  if (resolution.unreadableKinds.length > 0) {
    data.log(
      `Affected Resources: this workflow may not read ${resolution.unreadableKinds
        .map((kind: AffectedResourceKind): string => {
          return getAiAffectedResourceKindInfo(
            kind as unknown as AiAffectedResourceKindInfo["kind"],
          ).noun;
        })
        .join(", ")} records, so none of them was looked up.`,
    );
  }

  if (resolution.leftOverCap > 0) {
    data.log(
      `Affected Resources: only ${MAX_LINKED_AFFECTED_RESOURCES} resources are linked at once; ${resolution.leftOverCap} more were left out.`,
    );
  }

  return resolution;
}
