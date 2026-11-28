import MonitorTemplate from "Common/Models/DatabaseModels/MonitorTemplate";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * WHAT A POLICY'S OR A RULE'S FORM READS BEFORE IT IS POINTED AT ANOTHER
 * TEMPLATE (issues #11452, #11451): the template its record is on, as the
 * Edit form opened it, the template the form now holds, and that template's
 * name for the question the form asks. React-free: tested from App.
 */

/*
 * A relation's id however a form or a fetch spells it: an id, an ObjectID,
 * or the related record ({ _id }); null for none.
 */
export function readRelationId(value: unknown): string | null {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    return value.trim() || null;
  }

  if (value instanceof ObjectID) {
    return value.toString();
  }

  if (typeof value === "object") {
    const record: Record<string, unknown> = value as Record<string, unknown>;
    const id: unknown = record["_id"] ?? record["id"];

    if (id && id !== value) {
      return readRelationId(id);
    }
  }

  return null;
}

// The template a policy or a rule names: under either of its names.
export function readTemplateIdOfRecord(record: {
  monitorTemplateId?: unknown;
  monitorTemplate?: unknown;
}): string | null {
  return (
    readRelationId(record.monitorTemplate) ||
    readRelationId(record.monitorTemplateId)
  );
}

// Whether a save points the record at another template than it is on.
export function isPointedAtAnotherTemplate(data: {
  storedTemplateId: string | null | undefined;
  writtenTemplateId: string | null | undefined;
}): boolean {
  return Boolean(
    data.storedTemplateId &&
      data.writtenTemplateId &&
      data.storedTemplateId.toLowerCase() !==
        data.writtenTemplateId.toLowerCase(),
  );
}

// A template's name, for the question; "" when it cannot be read.
export async function readTemplateName(templateId: string): Promise<string> {
  try {
    const template: MonitorTemplate | null =
      await ModelAPI.getItem<MonitorTemplate>({
        modelType: MonitorTemplate,
        id: new ObjectID(templateId),
        select: { _id: true, templateName: true, monitorType: true },
      });

    return template?.templateName || "";
  } catch {
    return "";
  }
}

// A template's name and type, for a rule's question.
export async function readTemplateNameAndType(templateId: string): Promise<{
  name: string;
  monitorType: string | undefined;
}> {
  try {
    const template: MonitorTemplate | null =
      await ModelAPI.getItem<MonitorTemplate>({
        modelType: MonitorTemplate,
        id: new ObjectID(templateId),
        select: { _id: true, templateName: true, monitorType: true },
      });

    return {
      name: template?.templateName || "",
      monitorType: template?.monitorType || undefined,
    };
  } catch {
    return { name: "", monitorType: undefined };
  }
}
