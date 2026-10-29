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
  SAVE_CHANGES,
  SCHEDULE_LABELS,
  SCHEDULE_SENTENCES,
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
 * The top of a hunt's page, laid out as a case's and an entity's are
 * (SecurityCaseHeaderLayout): what it is - a hunt, and how often it runs -
 * its name, and its actions; under them its search, what it is for, who it
 * tells and when it runs next, and what its runs found - the last time they
 * found something, with the way to show it, or why the last one could not
 * be made.
 *
 * Changing the search on the explorer below is a change to the hunt: the
 * header says so, with Save Changes (the main move while there is one) and
 * Discard Changes. Edit changes its name, its search, its window, its
 * schedule and who it tells; Delete Hunt waits in the ⋯.
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

  const updateGate: PermissionGateResult = PermissionGate.check(
    new SecurityHunt(),
    ModelAction.Update,
  );
  const deleteGate: PermissionGateResult = PermissionGate.check(
    new SecurityHunt(),
    ModelAction.Delete,
  );

  const actions: Array<HeaderAction> = [
    ...(props.isChanged
      ? [
          {
            title: SAVE_CHANGES,
            icon: IconProp.Check,
            isPrimary: true,
            isDisabled: !updateGate.isAllowed || props.isSaving,
            tooltip: updateGate.isAllowed
              ? undefined
              : updateGate.disabledReason,
            dataTestId: HUNTS_TEST_IDS.saveChanges,
            onClick: props.onSaveChanges,
          },
          {
            title: DISCARD_CHANGES,
            icon: IconProp.ArrowUturnLeft,
            isDisabled: props.isSaving,
            dataTestId: HUNTS_TEST_IDS.discardChanges,
            onClick: props.onDiscardChanges,
          },
        ]
      : []),
    {
      title: EDIT_HUNT,
      icon: IconProp.Edit,
      isDisabled: !updateGate.isAllowed,
      tooltip: updateGate.isAllowed ? undefined : updateGate.disabledReason,
      dataTestId: HUNTS_TEST_IDS.edit,
      onClick: props.onEdit,
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
              {actions.map((action: HeaderAction): ReactElement => {
                return (
                  <HeaderActionButton key={action.dataTestId} action={action} />
                );
              })}
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

        <div
          className="mt-3 space-y-1.5 text-sm text-gray-600"
          data-testid={HUNTS_TEST_IDS.headerFacts}
        >
          <HuntSearchLine
            searchQuery={hunt.searchQuery}
            filters={hunt.filters}
          />
          {hunt.description ? (
            <p className="break-words text-gray-700">{hunt.description}</p>
          ) : (
            <></>
          )}
          {/* How often it runs, who it tells and when it runs next, one line wrapping. */}
          <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-500">
            <span>
              {translator.translateText(SCHEDULE_SENTENCES[schedule]) ||
                SCHEDULE_SENTENCES[schedule]}
            </span>
            {isScheduled ? (
              <>
                <span aria-hidden="true">·</span>
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
              </>
            ) : (
              <></>
            )}
          </p>
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
            <p
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
            </p>
          ) : (
            <></>
          )}
        </div>

        {props.isChanged ? (
          <div
            className="mt-3 flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-inset ring-amber-200"
            data-testid={HUNTS_TEST_IDS.changed}
          >
            <Icon icon={IconProp.Info} className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0 space-y-1">
              <p>
                {translator.translateText(SEARCH_CHANGED) || SEARCH_CHANGED}
              </p>
              {props.saveError ? (
                <p className="text-red-700" role="alert">
                  {props.saveError}
                </p>
              ) : (
                <></>
              )}
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
