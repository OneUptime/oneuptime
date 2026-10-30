import {
  DELETE_HUNT,
  DISCARD_CHANGES,
  EDIT_HUNT,
  HUNTS_TEST_IDS,
  HUNT_ACTIONS_LABEL,
  HUNT_SINGULAR,
  LAST_FOUND,
  LAST_RUN_FAILED,
  MORE_ACTIONS,
  NEXT_RUN,
  RUNS_FOUND_NOTHING_YET,
  SAVED_SEARCH,
  SAVE_CHANGES,
  SCHEDULE_LABELS,
  SEARCH_CHANGED,
  SHOW_THEM,
} from "./HuntsCopy";
import {
  HuntRecipients,
  HuntSearchLine,
  getHuntRecipientNames,
} from "./HuntCells";
import {
  HuntRunState,
  getHuntLastFoundWindow,
  getHuntRunState,
} from "./HuntsModel";
import RelativeTime from "../../EpisodeView/RelativeTime";
import ResourceHeroDescription from "../../TelemetryResource/ResourceHeroDescription";
import {
  HeaderAction,
  HeaderActionButton,
} from "../../SecurityCase/SecurityCaseHeader";
import {
  SECURITY_CASE_HEADER_ACTIONS_CLASS_NAME,
  SECURITY_CASE_HEADER_BUTTONS_CLASS_NAME,
  SECURITY_CASE_HEADER_CHIPS_CLASS_NAME,
  SECURITY_CASE_HEADER_CLASS_NAME,
  SECURITY_CASE_HEADER_MORE_PLACE_CLASS_NAME,
  SECURITY_CASE_HEADER_MORE_TRIGGER_CLASS_NAME,
  SECURITY_CASE_HEADER_TITLE_CLASS_NAME,
  SECURITY_CASE_HEADER_TOP_ROW_CLASS_NAME,
} from "../../SecurityCase/SecurityCaseHeaderLayout";
import SecurityHunt from "Common/Models/DatabaseModels/SecurityHunt";
import IconProp from "Common/Types/Icon/IconProp";
import {
  SecurityHuntRunWindow,
  SecurityHuntSchedule,
  isScheduledSecurityHunt,
} from "Common/Types/SecurityEvent/SecurityHunt";
import Icon from "Common/UI/Components/Icon/Icon";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import MoreMenu from "Common/UI/Components/MoreMenu/MoreMenu";
import MoreMenuItem from "Common/UI/Components/MoreMenu/MoreMenuItem";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  hunt: SecurityHunt;
  // The page searches something other than what the hunt keeps.
  isChanged: boolean;
  isSaving: boolean;
  saveError?: string | undefined;
  onSaveChanges: () => void;
  onDiscardChanges: () => void;
  onEdit: () => void;
  onDelete: () => void;
  // Show what the last run that found something found: its window, on the explorer.
  onShowWindow: (window: SecurityHuntRunWindow) => void;
}

/*
 * The actions over a changed search, in the notice that says so: beside
 * its words on a wide header, at the line's end; under them where they do
 * not fit beside, still at the end, as the header's own buttons go under
 * its title; and on a phone a row of their own, each button growing to
 * fill it (SECURITY_CASE_HEADER_BUTTON_CLASS_NAME), one under the other
 * where two do not fit.
 */
export const HUNT_CHANGE_ACTIONS_CLASS_NAME: string =
  "ml-auto flex w-full flex-wrap items-center justify-end gap-2 [@container(min-width:36rem)]:w-auto [@container(min-width:36rem)]:shrink-0";

/*
 * The top of a hunt's page, laid out as a case's and an entity's are
 * (SecurityCaseHeaderLayout): what it is - a hunt, and how often it runs -
 * its name, and its actions; under them what it is for, who it tells and
 * when it runs next, and what its runs found - the last time they found
 * something, with the way to show it, or why the last one could not be
 * made. Its search is the explorer's search bar, under the header.
 *
 * Changing the search on the explorer below is a change to the hunt: a
 * notice at the header's foot - right over the search bar the change was
 * made in - says so, names the search the hunt keeps (what Save Changes
 * replaces and Discard Changes goes back to), and holds both buttons, Save
 * Changes the main one. The header's own actions stay where they were:
 * Edit changes its name, its search, its window, its schedule and who it
 * tells; Delete Hunt waits in the ⋯.
 */
const HuntHeader: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const hunt: SecurityHunt = props.hunt;
  const schedule: SecurityHuntSchedule =
    hunt.schedule || SecurityHuntSchedule.NotScheduled;
  const isScheduled: boolean = isScheduledSecurityHunt(schedule);
  const runState: HuntRunState = getHuntRunState(hunt);
  const lastFoundWindow: SecurityHuntRunWindow | null =
    getHuntLastFoundWindow(hunt);
  const hasFacts: boolean =
    Boolean(hunt.description) ||
    isScheduled ||
    (runState === HuntRunState.Found && Boolean(hunt.lastFoundAt)) ||
    runState === HuntRunState.NothingFound ||
    runState === HuntRunState.Failed;

  const updateGate: PermissionGateResult = PermissionGate.check(
    new SecurityHunt(),
    ModelAction.Update,
  );
  const deleteGate: PermissionGateResult = PermissionGate.check(
    new SecurityHunt(),
    ModelAction.Delete,
  );

  const editAction: HeaderAction = {
    title: EDIT_HUNT,
    icon: IconProp.Edit,
    isDisabled: !updateGate.isAllowed,
    tooltip: updateGate.isAllowed ? undefined : updateGate.disabledReason,
    dataTestId: HUNTS_TEST_IDS.edit,
    onClick: props.onEdit,
  };

  // In the notice over a changed search: Discard Changes, then the main move.
  const changeActions: Array<HeaderAction> = [
    {
      title: DISCARD_CHANGES,
      icon: IconProp.ArrowUturnLeft,
      isDisabled: props.isSaving,
      dataTestId: HUNTS_TEST_IDS.discardChanges,
      onClick: props.onDiscardChanges,
    },
    {
      title: SAVE_CHANGES,
      icon: IconProp.Check,
      isPrimary: true,
      isDisabled: !updateGate.isAllowed || props.isSaving,
      tooltip: updateGate.isAllowed ? undefined : updateGate.disabledReason,
      dataTestId: HUNTS_TEST_IDS.saveChanges,
      onClick: props.onSaveChanges,
    },
  ];

  const scheduleLabel: string = SCHEDULE_LABELS[schedule] || schedule;

  return (
    <section
      className={SECURITY_CASE_HEADER_CLASS_NAME}
      data-testid={HUNTS_TEST_IDS.header}
    >
      <div className="px-4 py-4 sm:px-5">
        <div className={SECURITY_CASE_HEADER_TOP_ROW_CLASS_NAME}>
          <div className={SECURITY_CASE_HEADER_CHIPS_CLASS_NAME}>
            <span className="inline-flex items-center gap-1.5 rounded-md bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-700">
              <Icon
                icon={IconProp.ViewfinderCircle}
                className="h-3.5 w-3.5 flex-shrink-0 text-gray-500"
              />
              {translator.translateText(HUNT_SINGULAR) || HUNT_SINGULAR}
            </span>
            <span
              className={
                isScheduled
                  ? "inline-flex items-center gap-1 rounded-md bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700"
                  : "inline-flex items-center gap-1 rounded-md bg-gray-50 px-2 py-0.5 text-xs font-medium text-gray-500 ring-1 ring-inset ring-gray-200"
              }
            >
              {isScheduled ? (
                <Icon icon={IconProp.Clock} className="h-3.5 w-3.5 shrink-0" />
              ) : (
                <></>
              )}
              {translator.translateText(scheduleLabel) || scheduleLabel}
            </span>
          </div>

          {/* Before the actions, as it is read; drawn under them on a wide header. */}
          <h1
            className={`${SECURITY_CASE_HEADER_TITLE_CLASS_NAME} break-words`}
            data-testid="security-hunt-title"
          >
            <IsolatedText text={hunt.name || ""} />
          </h1>

          <div
            role="group"
            aria-label={translator.translateText(HUNT_ACTIONS_LABEL)}
            className={SECURITY_CASE_HEADER_ACTIONS_CLASS_NAME}
          >
            <div className={SECURITY_CASE_HEADER_BUTTONS_CLASS_NAME}>
              <HeaderActionButton action={editAction} />
            </div>
            <div className={SECURITY_CASE_HEADER_MORE_PLACE_CLASS_NAME}>
              <MoreMenu
                ariaLabel={translator.translateText(MORE_ACTIONS)}
                dataTestId={HUNTS_TEST_IDS.more}
                elementToBeShownInsteadOfButton={
                  <Icon
                    icon={IconProp.EllipsisHorizontal}
                    className="h-4 w-4"
                  />
                }
                triggerClassName={SECURITY_CASE_HEADER_MORE_TRIGGER_CLASS_NAME}
                isMenuPortaled={true}
              >
                {[
                  <MoreMenuItem
                    key="delete-hunt"
                    icon={IconProp.Trash}
                    text={DELETE_HUNT}
                    isDestructive={true}
                    isDisabled={!deleteGate.isAllowed}
                    tooltip={
                      deleteGate.isAllowed
                        ? undefined
                        : deleteGate.disabledReason
                    }
                    dataTestId={HUNTS_TEST_IDS.delete}
                    onClick={props.onDelete}
                  />,
                ]}
              </MoreMenu>
            </div>
          </div>
        </div>

        {/* Nothing to say - a hunt opened by hand, with no description - leaves no gap. */}
        {hasFacts ? (
          <div
            className="mt-3 space-y-1.5 text-sm text-gray-600"
            data-testid={HUNTS_TEST_IDS.headerFacts}
          >
            {hunt.description ? (
              /*
               * The team's own words, read the way they are written, as a
               * resource's hero draws its description: two lines, and
               * "Show more" for the rest. A description runs to 2,000
               * characters, and the explorer the hunt opens on is under
               * this header: drawn whole, it pushed the search and the
               * events below the fold.
               */
              <div data-testid={HUNTS_TEST_IDS.headerDescription}>
                <ResourceHeroDescription text={hunt.description} />
              </div>
            ) : (
              <></>
            )}
            {/*
             * Who a scheduled hunt tells and when it runs next, one line
             * wrapping. How often it runs is its chip's to say, over the
             * name; a hunt opened by hand has nothing more to say here.
             */}
            {isScheduled ? (
              <p
                className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-500"
                data-testid={HUNTS_TEST_IDS.headerSchedule}
              >
                <HuntRecipients names={getHuntRecipientNames(hunt)} />
                {hunt.nextRunAt ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>
                      <TranslatedSentence
                        template={NEXT_RUN}
                        slots={{
                          time: (
                            <RelativeTime
                              date={hunt.nextRunAt}
                              className="whitespace-nowrap"
                            />
                          ),
                        }}
                      />
                    </span>
                  </>
                ) : (
                  <></>
                )}
              </p>
            ) : (
              <></>
            )}
            {runState === HuntRunState.Found && hunt.lastFoundAt ? (
              <p
                className="flex flex-wrap items-center gap-x-2 text-xs text-gray-700"
                data-testid={HUNTS_TEST_IDS.lastFound}
              >
                <span>
                  <TranslatedSentence
                    template={LAST_FOUND}
                    count={hunt.lastFoundEventCount || 0}
                    slots={{
                      time: (
                        <RelativeTime
                          date={hunt.lastFoundAt}
                          className="whitespace-nowrap"
                        />
                      ),
                    }}
                  />
                </span>
                {lastFoundWindow ? (
                  <button
                    type="button"
                    className="font-medium text-indigo-600 hover:text-indigo-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                    data-testid={HUNTS_TEST_IDS.showThem}
                    onClick={() => {
                      props.onShowWindow(lastFoundWindow);
                    }}
                  >
                    {translator.translateText(SHOW_THEM) || SHOW_THEM}
                  </button>
                ) : (
                  <></>
                )}
              </p>
            ) : (
              <></>
            )}
            {runState === HuntRunState.NothingFound ? (
              <p
                className="text-xs text-gray-500"
                data-testid={HUNTS_TEST_IDS.lastFound}
              >
                {translator.translateText(RUNS_FOUND_NOTHING_YET) ||
                  RUNS_FOUND_NOTHING_YET}
              </p>
            ) : (
              <></>
            )}
            {runState === HuntRunState.Failed ? (
              <div
                className="flex items-start gap-1.5 text-xs text-red-700"
                role="alert"
                data-testid={HUNTS_TEST_IDS.lastFound}
              >
                <Icon
                  icon={IconProp.Alert}
                  className="mt-0.5 h-3.5 w-3.5 shrink-0"
                />
                <span>
                  {translator.translateTemplate(LAST_RUN_FAILED, {
                    error:
                      translator.translateText(hunt.lastRunError || "") ||
                      hunt.lastRunError ||
                      "",
                  })}
                </span>
              </div>
            ) : (
              <></>
            )}
          </div>
        ) : (
          <></>
        )}

        {props.isChanged ? (
          <div
            className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-md bg-amber-50 px-3 py-2.5 ring-1 ring-inset ring-amber-200"
            data-testid={HUNTS_TEST_IDS.changed}
          >
            <div className="flex min-w-0 flex-1 basis-64 items-start gap-2">
              <Icon
                icon={IconProp.Info}
                className="mt-0.5 h-4 w-4 shrink-0 text-amber-700"
              />
              <div className="min-w-0 flex-1 space-y-1">
                <p className="text-sm font-medium text-amber-900">
                  {translator.translateText(SEARCH_CHANGED) || SEARCH_CHANGED}
                </p>
                {/*
                 * What the hunt keeps, as its row in the list says it: what
                 * Save Changes replaces, and Discard Changes goes back to.
                 * Beside its label where there is room for it, else under
                 * it, wrapped between its words: squeezed beside the label
                 * on a phone it broke "powershel" / "l.exe".
                 */}
                <p
                  className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-xs text-amber-900"
                  data-testid={HUNTS_TEST_IDS.savedSearch}
                >
                  <span className="shrink-0">
                    {translator.translateText(SAVED_SEARCH) || SAVED_SEARCH}
                  </span>
                  <HuntSearchLine
                    searchQuery={hunt.searchQuery}
                    filters={hunt.filters}
                    isWrapped={true}
                  />
                </p>
                {props.saveError ? (
                  <p className="text-sm text-red-700" role="alert">
                    {props.saveError}
                  </p>
                ) : (
                  <></>
                )}
              </div>
            </div>
            <div className={HUNT_CHANGE_ACTIONS_CLASS_NAME}>
              {changeActions.map((action: HeaderAction): ReactElement => {
                return (
                  <HeaderActionButton key={action.dataTestId} action={action} />
                );
              })}
            </div>
          </div>
        ) : (
          <></>
        )}
      </div>
    </section>
  );
};

export default HuntHeader;
