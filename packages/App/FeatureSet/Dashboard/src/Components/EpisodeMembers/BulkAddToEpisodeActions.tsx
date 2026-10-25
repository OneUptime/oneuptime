import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Route from "Common/Types/API/Route";
import EpisodeMembersAdd, {
  ALERT_NOT_FOUND_REASON,
  ALREADY_IN_EPISODE_REASON,
  EpisodeMemberNotAdded,
  EpisodeMembersAddResult,
  INCIDENT_NOT_FOUND_REASON,
  MAX_EPISODE_MEMBERS_PER_ADD,
} from "Common/Types/Episode/EpisodeMembersAdd";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import {
  BULK_ITEM_CHANGED,
  BulkItemOutcome,
  bulkItemUnchanged,
  runBulkAction,
} from "Common/UI/Components/BulkUpdate/BulkActionRunner";
import {
  BulkActionButtonSchema,
  BulkActionOnClickProps,
} from "Common/UI/Components/BulkUpdate/BulkUpdateForm";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { MutableRefObject, ReactElement, useRef, useState } from "react";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import AddToExistingEpisodeModal from "./AddToExistingEpisodeModal";
import AddToNewEpisodeModal, { NewEpisodeValues } from "./AddToNewEpisodeModal";
import {
  EpisodeMemberKind,
  EpisodeMemberKindConfig,
} from "./EpisodeMemberKinds";
import {
  CreatedEpisode,
  EpisodeRow,
  addToEpisode,
  createEpisodeWith,
} from "./EpisodeMembersApi";

/*
 * "Add to Existing Episode" and "Add to New Episode" on the alerts and
 * incidents lists: what is selected goes into an episode, in one request
 * (EpisodeMembersAdd), and the result says what happened to each - added,
 * in the episode already (left as it was), or not added and why - with the
 * episode to open next.
 *
 * Both are gated on what the server asks: adding needs the member model's
 * create permission, and picking an existing episode needs to read
 * episodes; a new one needs to create episodes too. A known missing
 * permission locks the action and says which one, as every bulk action
 * does. Both are capped at MAX_EPISODE_MEMBERS_PER_ADD: above it they stay
 * on the menu, locked, saying why.
 */

export const ADD_TO_EXISTING_EPISODE_ACTION_TITLE: string = translationKey(
  "Add to Existing Episode",
);
export const ADD_TO_NEW_EPISODE_ACTION_TITLE: string =
  translationKey("Add to New Episode");

// The two sit together in Bulk Actions, a run of their own (ActionMenuGroup).
export const EPISODE_MENU_GROUP: string = "episodes";

/*
 * The server's reasons, as keys the dashboard translates where the result
 * lists them (BulkUpdateForm translates a reason it has words for). A test
 * pins them to the server's own words (EpisodeMembersAdd).
 */
export const EPISODE_MEMBERS_ADD_REASON_KEYS: Array<string> = [
  translationKey("Already in this episode."),
  translationKey(
    "This alert does not exist in this project, or you do not have access to it.",
  ),
  translationKey(
    "This incident does not exist in this project, or you do not have access to it.",
  ),
  // In another episode, in a project that allows one in only one.
  translationKey(
    "Already in another episode. An alert can be in only one episode in this project.",
  ),
  translationKey(
    "Already in another episode. An incident can be in only one episode in this project.",
  ),
];

export const EPISODE_ADD_CAP_TOOLTIP_KEY: string = translationKey(
  "Select {{count}} or fewer to add them to an episode.",
);

export interface BulkAddToEpisodeActionsResult<T extends BaseModel> {
  bulkActions: Array<BulkActionButtonSchema<T>>;
  modals: ReactElement;
}

enum OpenDialog {
  None = "none",
  Existing = "existing",
  New = "new",
}

// The selected rows' ids, each once, in the order they were selected.
export const getSelectedIds: (items: Array<BaseModel>) => Array<string> = (
  items: Array<BaseModel>,
): Array<string> => {
  const ids: Array<string> = [];

  for (const item of items) {
    const id: string = item._id
      ? EpisodeMembersAdd.normalizeId(item._id.toString())
      : "";

    if (id && !ids.includes(id)) {
      ids.push(id);
    }
  }

  return ids;
};

/*
 * What happened to one selected row, read from the one answer the request
 * gave for all of them.
 */
export const getItemOutcome: (data: {
  id: string;
  result: EpisodeMembersAddResult;
  config: EpisodeMemberKindConfig;
}) => BulkItemOutcome = (data: {
  id: string;
  result: EpisodeMembersAddResult;
  config: EpisodeMemberKindConfig;
}): BulkItemOutcome => {
  const id: string = EpisodeMembersAdd.normalizeId(data.id);

  if (data.result.added.includes(id)) {
    return BULK_ITEM_CHANGED;
  }

  if (data.result.alreadyInEpisode.includes(id)) {
    return bulkItemUnchanged(ALREADY_IN_EPISODE_REASON);
  }

  const notAdded: EpisodeMemberNotAdded | undefined = data.result.notAdded.find(
    (entry: EpisodeMemberNotAdded): boolean => {
      return entry.id === id;
    },
  );

  throw new Error(
    notAdded?.reason ||
      (data.config.kind === EpisodeMemberKind.Alert
        ? ALERT_NOT_FOUND_REASON
        : INCIDENT_NOT_FOUND_REASON),
  );
};

type GateActionFunction = <T extends BaseModel>(
  action: BulkActionButtonSchema<T>,
  gates: Array<PermissionGateResult>,
) => BulkActionButtonSchema<T>;

/*
 * Same convention as the other bulk-action hooks: a known missing permission
 * locks the action and says which one; an unknown answer (the permission
 * snapshot has not landed yet) leaves it alone.
 */
const gateAction: GateActionFunction = <T extends BaseModel>(
  action: BulkActionButtonSchema<T>,
  gates: Array<PermissionGateResult>,
): BulkActionButtonSchema<T> => {
  for (const gate of gates) {
    if (!gate.isAllowed && gate.disabledReason) {
      return {
        ...action,
        disabled: true,
        tooltip: gate.disabledReason,
      };
    }
  }

  return action;
};

type CapActionFunction = <T extends BaseModel>(
  action: BulkActionButtonSchema<T>,
  tooltip: string,
) => Array<BulkActionButtonSchema<T>>;

/*
 * The action bar only tells an action which rows are selected through
 * `isVisible`, and `disabled` is fixed. So a capped action is two entries,
 * exactly one of which is visible for any selection: the working one up to
 * the cap, and a locked twin with the reason above it. An action already
 * locked for permission stays a single entry - that reason wins.
 */
const capAction: CapActionFunction = <T extends BaseModel>(
  action: BulkActionButtonSchema<T>,
  tooltip: string,
): Array<BulkActionButtonSchema<T>> => {
  if (action.disabled) {
    return [action];
  }

  return [
    {
      ...action,
      isVisible: (items: Array<T>): boolean => {
        return items.length <= MAX_EPISODE_MEMBERS_PER_ADD;
      },
    },
    {
      ...action,
      isVisible: (items: Array<T>): boolean => {
        return items.length > MAX_EPISODE_MEMBERS_PER_ADD;
      },
      disabled: true,
      tooltip: tooltip,
    },
  ];
};

function useBulkAddToEpisodeActions<T extends BaseModel>(
  config: EpisodeMemberKindConfig,
): BulkAddToEpisodeActionsResult<T> {
  const translator: Translator = useTranslator();
  const [openDialog, setOpenDialog] = useState<OpenDialog>(OpenDialog.None);
  const [actionProps, setActionProps] =
    useState<BulkActionOnClickProps<T> | null>(null);

  /*
   * The episode the last run added to, for the result's link. A ref, not
   * state: the result reads it when it is drawn, after the run.
   */
  const resultEpisodeRef: MutableRefObject<CreatedEpisode | null> =
    useRef<CreatedEpisode | null>(null);

  const closeDialog: () => void = (): void => {
    setOpenDialog(OpenDialog.None);
    setActionProps(null);
  };

  const getEpisodeRoute: (episodeId: string) => Route = (
    episodeId: string,
  ): Route => {
    return RouteUtil.populateRouteParams(
      RouteMap[config.episodeViewPage] as Route,
      { modelId: new ObjectID(episodeId) },
    );
  };

  const resultDetails: () => ReactElement | undefined = ():
    | ReactElement
    | undefined => {
    const episode: CreatedEpisode | null = resultEpisodeRef.current;

    if (!episode?.id) {
      return undefined;
    }

    return (
      <Link
        to={getEpisodeRoute(episode.id)}
        className="inline-flex items-center gap-1 rounded-sm text-sm font-medium text-indigo-600 hover:text-indigo-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
      >
        <span>
          {episode.number
            ? translator.translateTemplate("Open episode {{number}}", {
                number: episode.number,
              })
            : translator.translateText("Open the episode")}
        </span>
        <Icon icon={IconProp.ArrowRight} className="h-3.5 w-3.5" />
      </Link>
    );
  };

  const runAddToExisting: (episode: EpisodeRow) => Promise<void> = async (
    episode: EpisodeRow,
  ): Promise<void> => {
    const props: BulkActionOnClickProps<T> | null = actionProps;
    closeDialog();

    if (!props) {
      return;
    }

    const ids: Array<string> = getSelectedIds(props.items);
    resultEpisodeRef.current = null;

    // One request for every selected row; each row reads its own outcome.
    let request: Promise<EpisodeMembersAddResult> | null = null;

    await runBulkAction<T>({
      actionProps: props,
      concurrency: Math.max(1, props.items.length),
      step: async (item: T): Promise<BulkItemOutcome> => {
        if (!request) {
          request = addToEpisode({
            config: config,
            episodeId: episode.id,
            ids: ids,
          }).then((result: EpisodeMembersAddResult) => {
            /*
             * The way to the episode, once some of them are in it: a
             * refusal of every one leaves nothing there to open.
             */
            if (result.added.length > 0 || result.alreadyInEpisode.length > 0) {
              resultEpisodeRef.current = {
                id: episode.id,
                number: episode.number,
              };
            }

            return result;
          });
        }

        return getItemOutcome({
          id: item._id?.toString() || "",
          result: await request,
          config: config,
        });
      },
    });
  };

  const runAddToNew: (values: NewEpisodeValues) => Promise<void> = async (
    values: NewEpisodeValues,
  ): Promise<void> => {
    const props: BulkActionOnClickProps<T> | null = actionProps;
    closeDialog();

    if (!props) {
      return;
    }

    /*
     * In a project that allows one in only one episode, the ones in an
     * episode already are left out of the new one (the dialog said so):
     * not asked for, and each reported as not added, with the reason the
     * server gives for one (EpisodeSingleMembership).
     */
    const leftOutIds: Set<string> = new Set(
      (values.leftOutIds || []).map((id: string): string => {
        return EpisodeMembersAdd.normalizeId(id);
      }),
    );

    const ids: Array<string> = getSelectedIds(props.items).filter(
      (id: string): boolean => {
        return !leftOutIds.has(id);
      },
    );
    resultEpisodeRef.current = null;

    /*
     * One request: the episode's create, with every selected row. The
     * server checks them all before the episode exists, so the answer is
     * the same for each - all added, or none and why.
     */
    let request: Promise<CreatedEpisode> | null = null;

    await runBulkAction<T>({
      actionProps: props,
      concurrency: Math.max(1, props.items.length),
      step: async (item: T): Promise<BulkItemOutcome> => {
        const id: string = EpisodeMembersAdd.normalizeId(
          item._id?.toString() || "",
        );

        if (leftOutIds.has(id) || ids.length === 0) {
          throw new Error(config.inAnotherEpisodeReason);
        }

        if (!request) {
          request = createEpisodeWith({
            config: config,
            title: values.title,
            severityId: values.severityId,
            ids: ids,
          }).then((created: CreatedEpisode) => {
            resultEpisodeRef.current = created;
            return created;
          });
        }

        await request;

        return BULK_ITEM_CHANGED;
      },
    });
  };

  const memberCreateGate: PermissionGateResult = PermissionGate.check(
    new config.membershipModelType(),
    ModelAction.Create,
  );

  const episodeReadGate: PermissionGateResult = PermissionGate.check(
    new config.episodeModelType(),
    ModelAction.Read,
  );

  const episodeCreateGate: PermissionGateResult = PermissionGate.check(
    new config.episodeModelType(),
    ModelAction.Create,
  );

  const capTooltip: string = translator.translateTemplate(
    EPISODE_ADD_CAP_TOOLTIP_KEY,
    { count: translator.formatNumber(MAX_EPISODE_MEMBERS_PER_ADD) },
  );

  const addToExistingAction: BulkActionButtonSchema<T> = {
    title: ADD_TO_EXISTING_EPISODE_ACTION_TITLE,
    buttonStyleType: ButtonStyleType.NORMAL,
    menuGroup: EPISODE_MENU_GROUP,
    icon: IconProp.Layers,
    resultLabels: {
      succeeded: {
        one: "{{count}} {{itemName}} added to the episode",
        other: "{{count}} {{itemsName}} added to the episode",
      },
      failed: {
        one: "{{count}} {{itemName}} not added",
        other: "{{count}} {{itemsName}} not added",
      },
    },
    resultDetails: resultDetails,
    onClick: async (props: BulkActionOnClickProps<T>): Promise<void> => {
      if (props.items.length > MAX_EPISODE_MEMBERS_PER_ADD) {
        return;
      }

      setActionProps(props);
      setOpenDialog(OpenDialog.Existing);
    },
  };

  const addToNewAction: BulkActionButtonSchema<T> = {
    title: ADD_TO_NEW_EPISODE_ACTION_TITLE,
    buttonStyleType: ButtonStyleType.NORMAL,
    menuGroup: EPISODE_MENU_GROUP,
    icon: IconProp.PlusCircle,
    resultLabels: {
      succeeded: {
        one: "{{count}} {{itemName}} added to the new episode",
        other: "{{count}} {{itemsName}} added to the new episode",
      },
      failed: {
        one: "{{count}} {{itemName}} not added",
        other: "{{count}} {{itemsName}} not added",
      },
    },
    resultDetails: resultDetails,
    onClick: async (props: BulkActionOnClickProps<T>): Promise<void> => {
      if (props.items.length > MAX_EPISODE_MEMBERS_PER_ADD) {
        return;
      }

      setActionProps(props);
      setOpenDialog(OpenDialog.New);
    },
  };

  const mayCreateEpisode: boolean =
    episodeCreateGate.isAllowed || !episodeCreateGate.disabledReason;

  const selectedIds: Array<string> = actionProps
    ? getSelectedIds(actionProps.items)
    : [];

  const modals: ReactElement = (
    <>
      {openDialog === OpenDialog.Existing && actionProps && (
        <AddToExistingEpisodeModal
          config={config}
          recordIds={selectedIds}
          onClose={closeDialog}
          onPick={(episode: EpisodeRow) => {
            void runAddToExisting(episode);
          }}
          onCreateNewEpisodeInstead={
            mayCreateEpisode
              ? () => {
                  setOpenDialog(OpenDialog.New);
                }
              : undefined
          }
        />
      )}
      {openDialog === OpenDialog.New && actionProps && (
        <AddToNewEpisodeModal
          config={config}
          recordIds={selectedIds}
          onClose={closeDialog}
          onCreate={(values: NewEpisodeValues) => {
            void runAddToNew(values);
          }}
        />
      )}
    </>
  );

  return {
    bulkActions: [
      ...capAction(
        gateAction(addToExistingAction, [memberCreateGate, episodeReadGate]),
        capTooltip,
      ),
      ...capAction(
        gateAction(addToNewAction, [episodeCreateGate, memberCreateGate]),
        capTooltip,
      ),
    ],
    modals: modals,
  };
}

export default useBulkAddToEpisodeActions;
