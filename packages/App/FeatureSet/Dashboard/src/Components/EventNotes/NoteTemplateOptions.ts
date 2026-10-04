import Query from "Common/Types/BaseDatabase/Query";
import Select from "Common/Types/BaseDatabase/Select";
import Sort from "Common/Types/BaseDatabase/Sort";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { NoteTemplateModel } from "./EventNoteKind";
import { NoteTemplateOption } from "./NoteTemplateMenu";

/*
 * The project's note templates of one kind (incident, alert, scheduled
 * maintenance), by name, as NoteTemplateMenu lists them. The composer hands
 * this to its Templates menu; any other place that offers note templates -
 * a state change's note, say - can hand the same menu the same loader.
 */
export async function loadNoteTemplateOptions(templateModelType: {
  new (): NoteTemplateModel;
}): Promise<Array<NoteTemplateOption>> {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  const result: ListResult<NoteTemplateModel> =
    await ModelAPI.getList<NoteTemplateModel>({
      modelType: templateModelType,
      query: (projectId ? { projectId } : {}) as Query<NoteTemplateModel>,
      select: {
        _id: true,
        templateName: true,
        note: true,
      } as Select<NoteTemplateModel>,
      sort: {
        templateName: SortOrder.Ascending,
      } as Sort<NoteTemplateModel>,
      limit: LIMIT_PER_PROJECT,
      skip: 0,
    });

  return result.data
    .map((template: NoteTemplateModel): NoteTemplateOption => {
      return {
        id: template.id?.toString() || template._id?.toString() || "",
        name: template.templateName || "",
        note: template.note || "",
      };
    })
    .filter((template: NoteTemplateOption) => {
      return Boolean(template.id);
    });
}
