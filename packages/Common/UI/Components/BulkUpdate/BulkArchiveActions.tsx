import React, { ReactElement } from "react";
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
  BulkActionConfirmControls,
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
  /*
   * The list's Archived page, as its side menu names it under Advanced
   * (an English key): "Archived" unless the list says otherwise, as
   * Network's "Archived Devices" does. The default sentences send the
   * reader there to unarchive.
   */
  archivedPageTitle?: string | undefined;
  // How a row's question names the row; its name column otherwise.
  getItemName?: ((item: T) => string) | undefined;
  /*
   * How many rows a bulk Archive or Unarchive writes at once:
   * BULK_ACTION_CONCURRENCY unless the list says otherwise. 1 for a list
   * whose rows' writes recompute something they share - network devices
   * roll up into their site's health.
   */
  concurrency?: number | undefined;
  /*
   * Drawn in the bulk Archive's dialog under its question: what still uses
   * the selected rows, read when the dialog opens (a list's Used by,
   * #7435), which may hold the dialog's Archive meanwhile.
   */
  archiveConfirmDetails?:
    | ((
        items: Array<T>,
        controls: BulkActionConfirmControls,
      ) => ReactElement | undefined)
    | undefined;
  // The same for a row's own Archive, under its sentence.
  getArchiveConfirmationDetails?:
    | ((item: T) => ReactElement | undefined)
    | undefined;
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
 * WHAT ARCHIVING A TELEMETRY RESOURCE DOES, ON A LIST THAT GIVES NO
 * SENTENCE OF ITS OWN (#8033).
 *
 * Said under the dialog's question - the bulk dialog's title, "Archive 3
 * hosts?", or a row's "Are you sure you want to archive web-01?" - and
 * never asking it again: the row leaves the list, keeps collecting
 * telemetry and loses nothing, and the way back is the list's Archived
 * page, under Advanced in its side menu ({{page}}, as the side menu names
 * it: ARCHIVED_PAGE_TITLE, or the list's own). The bulk sentence used to
 * open with "Are you sure you want to archive the selected hosts?" under a
 * title that had just asked it, and sent the reader to "the Archived tab",
 * which is no tab: it is a page of the side menu, folded under Advanced.
 * One selected row and a row's own Archive say the one-row sentence; the
 * five archivable kinds say their own (ResourceArchiveCopy).
 */
export const ROW_ARCHIVE_TELEMETRY_SENTENCE: string = translationKey(
  "It leaves this list but keeps collecting telemetry, and nothing is deleted. Unarchive it at any time from Advanced > {{page}}.",
);
export const ROW_UNARCHIVE_SENTENCE: string = translationKey(
  "It will reappear in the main list.",
);

// The Archived page's name in a list's side menu, under Advanced.
export const ARCHIVED_PAGE_TITLE: string = translationKey("Archived");

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
 * The bulk dialog's sentence under its title, on a list that gives no
 * sentence of its own: one selected, or several. No count is said - the
 * title says it - so these are two sentences, not a plural: "they" for 21
 * hosts in Russian too, where 21 takes the "one" form of a count.
 */
export const BULK_ARCHIVE_TELEMETRY_SENTENCE_ONE: string =
  ROW_ARCHIVE_TELEMETRY_SENTENCE;

export const BULK_ARCHIVE_TELEMETRY_SENTENCE: string = translationKey(
  "They leave this list but keep collecting telemetry, and nothing is deleted. Unarchive them at any time from Advanced > {{page}}.",
);

// Unarchiving from the Archived page: the title asks, the sentence says.
export const BULK_UNARCHIVE_SENTENCE_ONE: string = ROW_UNARCHIVE_SENTENCE;

export const BULK_UNARCHIVE_SENTENCE: string = translationKey(
  "They will reappear in the main list.",
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
   * The names as the dialog's title says them ("Archive 3 services?"): in
   * the reader's language - keys of the Dashboard's locales - and cased as
   * in the middle of a sentence, as the Settings card's title says the one
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

  /*
   * Where the default sentences send the reader to unarchive: the list's
   * Archived page as its side menu names it, in the reader's words
   * ("Advanced > Archiviert").
   */
  const archivedPage: TemplateValues = {
    page: translatableTerm(config.archivedPageTitle || ARCHIVED_PAGE_TITLE),
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
   * The dialog's sentence under its title on a list that gives no sentence
   * of its own: the one-selected sentence for one, the several-selected one
   * otherwise.
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
        archivedPage,
      );
    }

    return translator.translateTemplate(
      isOne ? BULK_UNARCHIVE_SENTENCE_ONE : BULK_UNARCHIVE_SENTENCE,
      {},
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
    confirmDetails: config.archiveConfirmDetails,
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

      /*
       * A list's own sentence is drawn as its key words it; the telemetry
       * one names where to unarchive (archivedPage).
       */
      const ownSentence: string | undefined = isArchiving
        ? config.archiveConfirmMessage
        : config.unarchiveConfirmMessage;
      const sentence: string = ownSentence
        ? translator.translateText(ownSentence) || ownSentence
        : translator.translateTemplate(
            isArchiving
              ? ROW_ARCHIVE_TELEMETRY_SENTENCE
              : ROW_UNARCHIVE_SENTENCE,
            archivedPage,
          );

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
          <>
            <p
              data-testid="row-archive-consequence"
              className="text-sm leading-6 text-gray-600"
            >
              {sentence}
            </p>
            {isArchiving && config.getArchiveConfirmationDetails ? (
              <div className="mt-3">
                {config.getArchiveConfirmationDetails(item)}
              </div>
            ) : (
              <></>
            )}
          </>
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
