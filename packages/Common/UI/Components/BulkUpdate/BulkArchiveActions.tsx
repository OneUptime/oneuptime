import React from "react";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import BadDataException from "../../../Types/Exception/BadDataException";
import { ErrorFunction, VoidFunction } from "../../../Types/FunctionTypes";
import IconProp from "../../../Types/Icon/IconProp";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import API from "../../Utils/API/API";
import ModelAPI from "../../Utils/ModelAPI/ModelAPI";
import { getRecordDisplayName } from "../../Utils/ModelDisplayName";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "../../Utils/PermissionGate";
import {
  PluralTemplate,
  TemplateValues,
  translatableTerm,
  translationKey,
  Translator,
} from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import ActionButtonSchema, {
  ActionButtonPlacement,
  RowActionConfirmation,
  RowActionContext,
} from "../ActionButton/ActionButtonSchema";
import { ButtonStyleType } from "../Button/Button";
import NamedSentence from "../DeleteConfirmation/NamedSentence";
import { BULK_ACTION_CONCURRENCY, runBulkAction } from "./BulkActionRunner";
import {
  BulkActionButtonSchema,
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
  /*
   * Confirmation bodies that replace the defaults outright. The defaults
   * describe a telemetry resource, which keeps ingesting while archived; a
   * model whose archive does more (an archived SLO stops being evaluated)
   * must be able to say so. Written to read correctly for one item or many -
   * the title above them already carries the count.
   */
  archiveConfirmMessage?: string | undefined;
  unarchiveConfirmMessage?: string | undefined;
  // How a row's question names the row; its name column otherwise.
  getItemName?: ((item: T) => string) | undefined;
  /*
   * How many rows a bulk Archive or Unarchive writes at once:
   * BULK_ACTION_CONCURRENCY unless the list says otherwise. 1 for a list
   * whose rows' writes recompute something they share - network devices
   * roll up into their site's health.
   */
  concurrency?: number | undefined;
}

export interface BulkArchiveActionsResult<T extends BaseModel> {
  archiveBulkActions: Array<BulkActionButtonSchema<T>>;
  unarchiveBulkActions: Array<BulkActionButtonSchema<T>>;
  /*
   * The same two in a row's ⋯ menu: Archive on a live list, Unarchive on
   * its Archived page. Each asks first, naming the row and saying what
   * archiving does (the list's sentence, or the telemetry one), and the
   * list is read again once it is saved - the row leaves it.
   */
  archiveRowActions: Array<ActionButtonSchema<T>>;
  unarchiveRowActions: Array<ActionButtonSchema<T>>;
}

export const ROW_ARCHIVE_TITLE: string = translationKey("Archive {{itemName}}");
export const ROW_UNARCHIVE_TITLE: string = translationKey(
  "Unarchive {{itemName}}",
);
export const ROW_ARCHIVE_QUESTION: string = translationKey(
  "Are you sure you want to archive {{name}}?",
);
export const ROW_UNARCHIVE_QUESTION: string = translationKey(
  "Are you sure you want to unarchive {{name}}?",
);

/*
 * What archiving one telemetry resource does, said under a row's question
 * on a list that gives no sentence of its own - the same as the bulk one.
 */
export const ROW_ARCHIVE_TELEMETRY_SENTENCE: string = translationKey(
  "It will be hidden from this list but will keep collecting telemetry. You can unarchive it at any time.",
);
export const ROW_UNARCHIVE_SENTENCE: string = translationKey(
  "It will reappear in the main list.",
);

/*
 * The bulk dialog's title, with how many are selected: "Archive 3 hosts?".
 * Its question mark is the question a resource's own sentence under it
 * (an SLO's "Archived SLOs are hidden ...") does not ask.
 */
export const BULK_ARCHIVE_TITLE: PluralTemplate = {
  one: "Archive {{count}} {{itemName}}?",
  other: "Archive {{count}} {{itemsName}}?",
};

export const BULK_UNARCHIVE_TITLE: PluralTemplate = {
  one: "Unarchive {{count}} {{itemName}}?",
  other: "Unarchive {{count}} {{itemsName}}?",
};

/*
 * The bulk dialog's question on a list that gives no sentence of its own,
 * about a telemetry resource: one selected, or several. No count is said,
 * so these are two sentences, not a plural - "the selected hosts" for 21 of
 * them in Russian too, where 21 takes the "one" form of a count.
 */
export const BULK_ARCHIVE_TELEMETRY_SENTENCE_ONE: string = translationKey(
  "Are you sure you want to archive the selected {{itemName}}? It will be hidden from the list but will keep collecting telemetry. You can unarchive it anytime from the Archived tab.",
);

export const BULK_ARCHIVE_TELEMETRY_SENTENCE: string = translationKey(
  "Are you sure you want to archive the selected {{itemsName}}? They will be hidden from the list but will keep collecting telemetry. You can unarchive them anytime from the Archived tab.",
);

export const BULK_UNARCHIVE_SENTENCE_ONE: string = translationKey(
  "Are you sure you want to unarchive the selected {{itemName}}? It will reappear in the main list.",
);

export const BULK_UNARCHIVE_SENTENCE: string = translationKey(
  "Are you sure you want to unarchive the selected {{itemsName}}? They will reappear in the main list.",
);

type ArchiveMode = "archive" | "unarchive";

/**
 * Reusable hook that provides "Archive" and "Unarchive" bulk actions for any
 * ModelTable whose model has an `isArchived` boolean column. For telemetry
 * resources archiving is a pure visibility flag — telemetry keeps being
 * ingested — and the default confirmation copy says so; models whose archive
 * does more pass `archiveConfirmMessage` / `unarchiveConfirmMessage`.
 *
 * The client only ever sends `{ isArchived: true | false }`; the server stamps
 * `archivedAt` / `archivedByUserId` (see DatabaseService.stampSwitchAttribution).
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
  const translator: Translator = useTranslator();
  const model: T = new config.modelType();
  const singularName: string =
    config.singularName || model.singularName || "resource";
  const pluralName: string =
    config.pluralName || model.pluralName || "resources";

  /*
   * The names as the dialog's title ("Archive 3 services?") and its
   * question ("... the selected services?") say them: in the reader's
   * language - both are keys of the Dashboard's locales - and cased as in
   * the middle of a sentence, as the Settings card's title says the one
   * ("Archive service") and the lists with sentences of their own say
   * theirs ("Archive 3 workflows?"). The title used to say the label as
   * written ("Archive 3 Services?"), so most languages put it in brackets
   * after a word of their own, which said the word twice for inventory
   * items in French ("Archiver 3 éléments (Éléments d'inventaire) ?") and
   * left the name in the nominative after من in Arabic (#7387).
   */
  const names: TemplateValues = {
    itemName: translatableTerm(singularName, { inSentence: true }),
    itemsName: translatableTerm(pluralName, { inSentence: true }),
  };

  // The dialog's title for this many: "Archive 3 hosts?", "Archive 1 SLO?".
  const getConfirmTitle: (mode: ArchiveMode, count: number) => string = (
    mode: ArchiveMode,
    count: number,
  ): string => {
    return translator.translatePlural(
      mode === "archive" ? BULK_ARCHIVE_TITLE : BULK_UNARCHIVE_TITLE,
      count,
      names,
    );
  };

  /*
   * The dialog's question on a list that gives no sentence of its own: the
   * one-selected sentence for one, the several-selected one otherwise.
   */
  const getDefaultConfirmMessage: (
    mode: ArchiveMode,
    count: number,
  ) => string = (mode: ArchiveMode, count: number): string => {
    const isOne: boolean = count === 1;

    if (mode === "archive") {
      return translator.translateTemplate(
        isOne
          ? BULK_ARCHIVE_TELEMETRY_SENTENCE_ONE
          : BULK_ARCHIVE_TELEMETRY_SENTENCE,
        names,
      );
    }

    return translator.translateTemplate(
      isOne ? BULK_UNARCHIVE_SENTENCE_ONE : BULK_UNARCHIVE_SENTENCE,
      names,
    );
  };

  const applyArchive: (
    mode: ArchiveMode,
    props: BulkActionOnClickProps<T>,
  ) => Promise<void> = async (
    mode: ArchiveMode,
    props: BulkActionOnClickProps<T>,
  ): Promise<void> => {
    // Each row its own update, several at once (runBulkAction).
    await runBulkAction<T>({
      actionProps: props,
      concurrency: config.concurrency ?? BULK_ACTION_CONCURRENCY,
      step: async (item: T): Promise<void> => {
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
      },
    });
  };

  /*
   * Bulk actions are handed straight to the table's action bar, which never
   * looks at permissions - so a viewer on an otherwise gated table could still
   * relabel, reassign or archive every row they had selected. Each of these
   * actions is an update of the records it touches.
   */
  const updateGate: PermissionGateResult = PermissionGate.check(
    new config.modelType(),
    ModelAction.Update,
  );

  type GateActionFunction = (
    action: BulkActionButtonSchema<T>,
  ) => BulkActionButtonSchema<T>;

  const gateAction: GateActionFunction = (
    action: BulkActionButtonSchema<T>,
  ): BulkActionButtonSchema<T> => {
    if (updateGate.isAllowed || !updateGate.disabledReason) {
      return action;
    }

    return {
      ...action,
      disabled: true,
      tooltip: updateGate.disabledReason,
    };
  };

  const archiveAction: BulkActionButtonSchema<T> = {
    title: "Archive",
    icon: IconProp.Archive,
    buttonStyleType: ButtonStyleType.NORMAL,
    confirmTitle: (items: Array<T>): string => {
      return getConfirmTitle("archive", items.length);
    },
    /*
     * A list's own sentence is an English key: the dialog (ConfirmModal)
     * looks it up, so it reaches the reader in their language.
     */
    confirmMessage: (items: Array<T>): string => {
      if (config.archiveConfirmMessage) {
        return config.archiveConfirmMessage;
      }

      return getDefaultConfirmMessage("archive", items.length);
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
      return getConfirmTitle("unarchive", items.length);
    },
    confirmMessage: (items: Array<T>): string => {
      if (config.unarchiveConfirmMessage) {
        return config.unarchiveConfirmMessage;
      }

      return getDefaultConfirmMessage("unarchive", items.length);
    },
    onClick: async (props: BulkActionOnClickProps<T>): Promise<void> => {
      await applyArchive("unarchive", props);
    },
  };

  type BuildRowActionFunction = (mode: ArchiveMode) => ActionButtonSchema<T>;

  const buildRowAction: BuildRowActionFunction = (
    mode: ArchiveMode,
  ): ActionButtonSchema<T> => {
    const isArchiving: boolean = mode === "archive";

    const getConfirmation: (item: T) => RowActionConfirmation = (
      item: T,
    ): RowActionConfirmation => {
      const name: string =
        (config.getItemName ? config.getItemName(item).trim() : "") ||
        getRecordDisplayName(item, { model: model }) ||
        translator.translateTerm(singularName);

      const sentence: string = isArchiving
        ? config.archiveConfirmMessage || ROW_ARCHIVE_TELEMETRY_SENTENCE
        : config.unarchiveConfirmMessage || ROW_UNARCHIVE_SENTENCE;

      return {
        title: translator.translateTemplate(
          isArchiving ? ROW_ARCHIVE_TITLE : ROW_UNARCHIVE_TITLE,
          { itemName: translatableTerm(singularName) },
        ),
        description: (
          <NamedSentence
            template={
              isArchiving ? ROW_ARCHIVE_QUESTION : ROW_UNARCHIVE_QUESTION
            }
            name={name}
            dataTestId="row-archive-name"
          />
        ),
        details: (
          <p
            data-testid="row-archive-consequence"
            className="text-sm leading-6 text-gray-600"
          >
            {translator.translateText(sentence) || sentence}
          </p>
        ),
        submitButtonText: isArchiving ? "Archive" : "Unarchive",
        submitButtonType: ButtonStyleType.PRIMARY,
      };
    };

    const rowAction: ActionButtonSchema<T> = {
      title: isArchiving ? "Archive" : "Unarchive",
      icon: isArchiving ? IconProp.Archive : IconProp.Unarchive,
      buttonStyleType: ButtonStyleType.OUTLINE,
      // In the ⋯ menu, above Delete: the row's one button stays View.
      placement: ActionButtonPlacement.MoreMenu,
      // Not offered on a row already where it would put it.
      isVisible: (item: T): boolean => {
        const archived: unknown = (item as unknown as JSONObject)["isArchived"];

        return isArchiving ? archived !== true : archived !== false;
      },
      getConfirmation: getConfirmation,
      onClick: async (
        item: T,
        onCompleteAction: VoidFunction,
        onError: ErrorFunction,
        context?: RowActionContext | undefined,
      ): Promise<void> => {
        try {
          if (!item.id) {
            throw new BadDataException("Item ID not found");
          }

          await ModelAPI.updateById<T>({
            id: item.id as ObjectID,
            modelType: config.modelType,
            data: {
              isArchived: isArchiving,
            } as any,
          });

          context?.refresh();
          onCompleteAction();
        } catch (err) {
          onError(new Error(API.getFriendlyMessage(err)));
        }
      },
    };

    if (updateGate.isAllowed || !updateGate.disabledReason) {
      return rowAction;
    }

    return {
      ...rowAction,
      disabled: true,
      tooltip: updateGate.disabledReason,
    };
  };

  return {
    archiveBulkActions: [gateAction(archiveAction)],
    unarchiveBulkActions: [gateAction(unarchiveAction)],
    archiveRowActions: [buildRowAction("archive")],
    unarchiveRowActions: [buildRowAction("unarchive")],
  };
}

export default useBulkArchiveActions;
