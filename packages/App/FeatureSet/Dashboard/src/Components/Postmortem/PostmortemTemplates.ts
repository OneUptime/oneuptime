import IncidentPostmortemTemplate from "Common/Models/DatabaseModels/IncidentPostmortemTemplate";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { JSONObject } from "Common/Types/JSON";
import { AITemplate } from "Common/UI/Components/AI/GenerateFromAIModal";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * The project's postmortem templates (Incidents → Settings → Postmortem
 * Templates), as the Postmortem pages of incidents and incident episodes
 * offer them: Apply Template lists them, and Generate with AI offers them
 * beside its built-in outlines.
 */
export interface PostmortemTemplateOption {
  id: string;
  name: string;
  note: string;
}

// The Apply Postmortem Template dialog's one field.
export const POSTMORTEM_TEMPLATE_PICKER_FIELD: string =
  "incidentPostmortemTemplateId";

/*
 * Every postmortem template of the project, by name. The pages load them
 * once, when they open: whether there is any decides whether Apply Template
 * is offered at all.
 */
export async function loadPostmortemTemplates(): Promise<
  Array<PostmortemTemplateOption>
> {
  const result: ListResult<IncidentPostmortemTemplate> =
    await ModelAPI.getList<IncidentPostmortemTemplate>({
      modelType: IncidentPostmortemTemplate,
      query: {},
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      select: {
        _id: true,
        templateName: true,
        postmortemNote: true,
      },
      sort: {
        templateName: SortOrder.Ascending,
      },
    });

  return result.data
    .map((template: IncidentPostmortemTemplate): PostmortemTemplateOption => {
      return {
        id: template._id?.toString() || "",
        name: template.templateName || "",
        note: template.postmortemNote || "",
      };
    })
    .filter((template: PostmortemTemplateOption): boolean => {
      return Boolean(template.id);
    });
}

// The templates as Generate with AI lists them, after its built-in ones.
export function toAITemplates(
  templates: Array<PostmortemTemplateOption>,
): Array<AITemplate> {
  return templates.map((template: PostmortemTemplateOption): AITemplate => {
    const aiTemplate: AITemplate = {
      id: template.id,
      name: template.name || "Unnamed Template",
    };

    if (template.note) {
      aiTemplate.content = template.note;
    }

    return aiTemplate;
  });
}

/*
 * What the template picker starts with. A project with one template has
 * nothing to choose between, so that one is picked already and Apply
 * Template is one click; with several, the reader picks.
 */
export function getPostmortemTemplatePickerInitialValues(
  templates: Array<PostmortemTemplateOption>,
): JSONObject {
  if (templates.length !== 1) {
    return {};
  }

  return {
    [POSTMORTEM_TEMPLATE_PICKER_FIELD]: templates[0]!.id,
  };
}

// The template the picker's value names, if it is one of these.
export function findPostmortemTemplate(
  templates: Array<PostmortemTemplateOption>,
  pickedValue: unknown,
): PostmortemTemplateOption | null {
  if (pickedValue === undefined || pickedValue === null) {
    return null;
  }

  const pickedId: string = pickedValue.toString();

  return (
    templates.find((template: PostmortemTemplateOption): boolean => {
      return template.id === pickedId;
    }) || null
  );
}
