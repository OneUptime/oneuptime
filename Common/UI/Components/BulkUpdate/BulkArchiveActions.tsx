import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import BadDataException from "../../../Types/Exception/BadDataException";
import IconProp from "../../../Types/Icon/IconProp";
import ObjectID from "../../../Types/ObjectID";
import API from "../../Utils/API/API";
import ModelAPI from "../../Utils/ModelAPI/ModelAPI";
import { ButtonStyleType } from "../Button/Button";
import {
  BulkActionButtonSchema,
  BulkActionFailed,
  BulkActionOnClickProps,
} from "./BulkUpdateForm";

export interface BulkArchiveActionsConfig<T extends BaseModel> {
  modelType: { new (): T };
  /**
   * Singular/plural labels used in the confirmation copy, e.g. "service" /
   * "services". Defaults to the model's own singular/plural names.
   */
  singularName?: string | undefined;
  pluralName?: string | undefined;
}

export interface BulkArchiveActionsResult<T extends BaseModel> {
  archiveBulkActions: Array<BulkActionButtonSchema<T>>;
  unarchiveBulkActions: Array<BulkActionButtonSchema<T>>;
}

type ArchiveMode = "archive" | "unarchive";

/**
 * Reusable hook that provides "Archive" and "Unarchive" bulk actions for any
 * ModelTable whose model has an `isArchived` boolean column. Archiving is a
 * pure visibility flag — telemetry keeps being ingested for archived resources.
 *
 * The client only ever sends `{ isArchived: true | false }`; the server stamps
 * `archivedAt` / `archivedByUserId` (see DatabaseService.sanitizeCreateOrUpdate).
 *
 * No form modal is needed — these actions use the confirm flow built into
 * BulkUpdateForm (confirmMessage / confirmTitle).
 *
 * Usage:
 *   const { archiveBulkActions } = useBulkArchiveActions({ modelType: Service });
 *   <ModelTable bulkActions={{ buttons: [...archiveBulkActions] }} />
 */
function useBulkArchiveActions<T extends BaseModel>(
  config: BulkArchiveActionsConfig<T>,
): BulkArchiveActionsResult<T> {
  const model: T = new config.modelType();
  const singularName: string =
    config.singularName || model.singularName || "resource";
  const pluralName: string =
    config.pluralName || model.pluralName || "resources";

  const applyArchive: (
    mode: ArchiveMode,
    props: BulkActionOnClickProps<T>,
  ) => Promise<void> = async (
    mode: ArchiveMode,
    props: BulkActionOnClickProps<T>,
  ): Promise<void> => {
    const { items, onProgressInfo, onBulkActionStart, onBulkActionEnd } = props;

    onBulkActionStart();

    const totalItems: Array<T> = [...items];
    const inProgressItems: Array<T> = [...items];
    const successItems: Array<T> = [];
    const failedItems: Array<BulkActionFailed<T>> = [];

    for (const item of totalItems) {
      inProgressItems.splice(inProgressItems.indexOf(item), 1);

      try {
        if (!item.id) {
          throw new BadDataException("Item ID not found");
        }

        await ModelAPI.updateById<T>({
          id: item.id as ObjectID,
          modelType: config.modelType,
          data: {
            isArchived: mode === "archive",
          } as any,
        });

        successItems.push(item);
      } catch (err) {
        failedItems.push({
          item: item,
          failedMessage: API.getFriendlyMessage(err),
        });
      }

      onProgressInfo({
        totalItems: totalItems,
        failed: failedItems,
        successItems: successItems,
        inProgressItems: inProgressItems,
      });
    }

    onBulkActionEnd();
  };

  const archiveAction: BulkActionButtonSchema<T> = {
    title: "Archive",
    icon: IconProp.Archive,
    buttonStyleType: ButtonStyleType.NORMAL,
    confirmTitle: (items: Array<T>): string => {
      return `Archive ${items.length} ${
        items.length === 1 ? singularName : pluralName
      }?`;
    },
    confirmMessage: (items: Array<T>): string => {
      return `Are you sure you want to archive the selected ${
        items.length === 1 ? singularName : pluralName
      }? They will be hidden from the list but will keep collecting telemetry. You can unarchive them anytime from the Archived tab.`;
    },
    onClick: async (props: BulkActionOnClickProps<T>): Promise<void> => {
      await applyArchive("archive", props);
    },
  };

  const unarchiveAction: BulkActionButtonSchema<T> = {
    title: "Unarchive",
    icon: IconProp.Unarchive,
    buttonStyleType: ButtonStyleType.NORMAL,
    confirmTitle: (items: Array<T>): string => {
      return `Unarchive ${items.length} ${
        items.length === 1 ? singularName : pluralName
      }?`;
    },
    confirmMessage: (items: Array<T>): string => {
      return `Are you sure you want to unarchive the selected ${
        items.length === 1 ? singularName : pluralName
      }? They will reappear in the main list.`;
    },
    onClick: async (props: BulkActionOnClickProps<T>): Promise<void> => {
      await applyArchive("unarchive", props);
    },
  };

  return {
    archiveBulkActions: [archiveAction],
    unarchiveBulkActions: [unarchiveAction],
  };
}

export default useBulkArchiveActions;
