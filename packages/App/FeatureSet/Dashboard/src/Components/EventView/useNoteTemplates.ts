import Query from "Common/Types/BaseDatabase/Query";
import Select from "Common/Types/BaseDatabase/Select";
import Sort from "Common/Types/BaseDatabase/Sort";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import DatabaseBaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { useEffect, useState } from "react";
import { BulkStateChangeNoteTemplate } from "../../Utils/BulkStateChange";

type NoteTemplateModel = DatabaseBaseModel & {
  templateName?: string | undefined;
  note?: string | undefined;
};

export interface UseNoteTemplatesProps<TTemplate extends NoteTemplateModel> {
  modelType: { new (): TTemplate };
}

export interface UseNoteTemplatesResult {
  noteTemplates: Array<BulkStateChangeNoteTemplate>;
}

/**
 * Load this project's note templates so a bulk state change can offer the same
 * "pick a template" shortcut the single-event change-state modal offers.
 * Template loading is best effort: the note textbox stays usable when the
 * fetch fails, the dropdown just does not show up.
 */
export default function useNoteTemplates<TTemplate extends NoteTemplateModel>(
  props: UseNoteTemplatesProps<TTemplate>,
): UseNoteTemplatesResult {
  const [noteTemplates, setNoteTemplates] = useState<
    Array<BulkStateChangeNoteTemplate>
  >([]);

  useEffect(() => {
    let isCancelled: boolean = false;

    const fetchNoteTemplates: () => Promise<void> = async (): Promise<void> => {
      try {
        const result: ListResult<TTemplate> = await ModelAPI.getList<TTemplate>(
          {
            modelType: props.modelType,
            query: {
              projectId: ProjectUtil.getCurrentProjectId()!,
            } as Query<TTemplate>,
            limit: 99,
            skip: 0,
            select: {
              _id: true,
              templateName: true,
              note: true,
            } as Select<TTemplate>,
            sort: {
              templateName: SortOrder.Ascending,
            } as Sort<TTemplate>,
          },
        );

        if (isCancelled) {
          return;
        }

        setNoteTemplates(
          result.data.map(
            (template: TTemplate): BulkStateChangeNoteTemplate => {
              return {
                id: template.id?.toString() || "",
                templateName: template.templateName || "",
                note: template.note || "",
              };
            },
          ),
        );
      } catch {
        if (!isCancelled) {
          setNoteTemplates([]);
        }
      }
    };

    fetchNoteTemplates().catch(() => {
      if (!isCancelled) {
        setNoteTemplates([]);
      }
    });

    return () => {
      isCancelled = true;
    };
  }, [props.modelType]);

  return {
    noteTemplates,
  };
}
