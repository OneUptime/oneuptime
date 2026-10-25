import { OverviewSection } from "../../../Utils/OverviewSection";
import LiveDuration from "../../EventView/LiveDuration";
import RelativeTime from "../../EpisodeView/RelativeTime";
import { ResourceOwnerEntry } from "../../ResourceOwners/OwnerEntry";
import OwnersCell from "../../ResourceOwners/OwnersCell";
import {
  canAddOwners,
  getOwnerKeys,
  OwnersChange,
  OwnersTarget,
} from "../../Owners/AddOwners";
import AddOwnersPopup, {
  AddOwnersPlaceButton,
  AddOwnersTextButton,
  useAddOwnersPopup,
} from "../../Owners/AddOwnersPopup";
import MonitorOwnerTeam from "Common/Models/DatabaseModels/MonitorOwnerTeam";
import MonitorOwnerUser from "Common/Models/DatabaseModels/MonitorOwnerUser";
import { AnchoredFieldPopup } from "Common/UI/Types/UseAnchoredFieldPopup";
import SloOverviewActionLink from "../../Slo/SloOverviewActionLink";
import MonitorOverviewActions, { LoadedAtTime } from "./MonitorOverviewActions";
import { getMonitorOverviewRoute } from "./MonitorOverviewLinks";
import {
  TONE_BADGE,
  TONE_TEXT_CLASS,
  TONE_TILE_CLASS,
  getFactGridClass,
} from "./MonitorOverviewTones";
import MonitorStatusDot from "./MonitorStatusDot";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import MonitorType, {
  MonitorTypeHelper,
  MonitorTypeProps,
} from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import StatusBadge from "Common/UI/Components/StatusBadge/StatusBadge";
import {
  isMonitorOverviewActionCallToAction,
  MonitorOverviewCallToAction,
  MonitorOverviewFact,
  MonitorOverviewPresentation,
  MonitorOverviewPulse,
  MonitorOverviewRunState,
  MonitorOverviewSecondaryBadge,
} from "Common/Utils/Monitor/MonitorOverviewPresentationUtil";
import { MonitorOverviewTarget } from "Common/Utils/Monitor/MonitorOverviewTargetUtil";
import { formatDurationCompactInLanguage } from "Common/Utils/Slo/SloDuration";
import React, { FunctionComponent, ReactElement, useMemo } from "react";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import {
  translatableTerm,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  TURN_MONITORING_ON_BUTTON_TEST_ID,
  TURN_MONITORING_ON_ERROR_TEST_ID,
} from "../MonitoringSwitchCopy";
import useTurnMonitoringOn, { TurnMonitoringOn } from "../useTurnMonitoringOn";

export interface ComponentProps {
  monitorId: ObjectID;
  monitorType: MonitorType;
  presentation: MonitorOverviewPresentation;
  owners: OverviewSection<Array<ResourceOwnerEntry>>;
  isRefreshing: boolean;
  refreshError: string;
  lastLoadedAt: Date | null;
  onRefresh: () => void;
  /*
   * Told after the hero's "Turn monitoring on" turned the monitor back on,
   * so the page reads it again.
   */
  onMonitoringTurnedOn?: (() => void) | undefined;
  /*
   * The status the monitor is in now: the More actions (⋯) menu's Change
   * status leaves it out.
   */
  currentStatusId?: string | undefined;
  // Told after that menu recorded a new status, so the page reads it again.
  onStatusChanged?: (() => void) | undefined;
  /*
   * Told after the owners' Add owners list added an owner (or the server
   * refused one), so the page reads the owners - and its feed - again.
   */
  onOwnersChanged?: ((change: OwnersChange) => void) | undefined;
}

/*
 * The icon in the hero's tile. A running monitor's icon follows its status
 * tone; every other run state has one icon, whatever the stored status says,
 * because the status is not what the hero is reporting then.
 */
const RUN_STATE_ICON: Record<
  Exclude<MonitorOverviewRunState, MonitorOverviewRunState.Running>,
  IconProp
> = {
  [MonitorOverviewRunState.Overdue]: IconProp.Clock,
  [MonitorOverviewRunState.Paused]: IconProp.PauseCircle,
  [MonitorOverviewRunState.NotChecking]: IconProp.SignalSlash,
  [MonitorOverviewRunState.NotConfigured]: IconProp.WrenchScrewdriver,
  [MonitorOverviewRunState.AwaitingFirstData]: IconProp.Clock,
  [MonitorOverviewRunState.Manual]: IconProp.Pencil,
};

export const getMonitorOverviewIcon: (
  presentation: MonitorOverviewPresentation,
) => IconProp = (presentation: MonitorOverviewPresentation): IconProp => {
  if (presentation.runState !== MonitorOverviewRunState.Running) {
    return RUN_STATE_ICON[presentation.runState];
  }

  switch (presentation.tone) {
    case "good":
      return IconProp.CheckCircle;
    case "warning":
      return IconProp.Alert;
    case "danger":
      return IconProp.ExclaimationCircle;
    default:
      return IconProp.Info;
  }
};

/*
 * The top of the monitor overview: what state the monitor is in, in words,
 * how fresh that is, and the handful of facts behind it. Everything it says
 * comes from MonitorOverviewPresentationUtil, so the per-type and per-state
 * rules are tested once in Common and this only lays them out.
 *
 * Its actions keep to the top right at every width (MonitorOverviewActions:
 * when the page last loaded, Refresh, and the More actions menu), on the
 * badges' line: a grid, so on a phone they stay in that corner instead of
 * falling under the text, and from lg the pulse sits under them.
 */
const MonitorOverviewHero: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const presentation: MonitorOverviewPresentation = props.presentation;

  // Only pressed on a monitor someone turned off (its call to action).
  const turnMonitoringOn: TurnMonitoringOn = useTurnMonitoringOn({
    monitorId: props.monitorId,
    onTurnedOn: props.onMonitoringTurnedOn,
  });

  /*
   * The owners are added right here: "Add owners" on a monitor nobody owns,
   * the empty place after the avatars on one that has owners, each opening
   * the Add owners list under it - offered to a reader who may add one.
   */
  const monitorIdString: string = props.monitorId.toString();
  const ownersTarget: OwnersTarget = useMemo((): OwnersTarget => {
    return {
      ownerUserModelType: MonitorOwnerUser,
      ownerTeamModelType: MonitorOwnerTeam,
      resourceIdField: "monitorId",
      resourceId: props.monitorId,
    };
  }, [monitorIdString]);
  const knownOwners: Array<ResourceOwnerEntry> | null = props.owners.value;
  const ownersPopup: AnchoredFieldPopup = useAddOwnersPopup(
    knownOwners?.length || 0,
  );
  const ownerKeys: Set<string> = useMemo((): Set<string> => {
    return getOwnerKeys(knownOwners || undefined);
  }, [knownOwners]);
  const mayAddOwners: boolean = canAddOwners(ownersTarget);

  const typeProps: MonitorTypeProps | undefined = useMemo(() => {
    return MonitorTypeHelper.getAllMonitorTypeProps().find(
      (item: MonitorTypeProps) => {
        return item.monitorType === props.monitorType;
      },
    );
  }, [props.monitorType]);

  const typeTitle: string = typeProps?.title || props.monitorType;
  const typeIcon: IconProp = typeProps?.icon || IconProp.Activity;

  type GetCallToActionFunction = (
    callToAction: MonitorOverviewCallToAction,
  ) => ReactElement;

  /*
   * A link to the page that fixes the state, or - for a monitor someone
   * turned off - a button that turns monitoring back on in place. The
   * button is left out only while there is nothing honest to say about it
   * (the permission snapshot has not arrived); someone who may not turn
   * monitoring on sees it locked, with why.
   */
  const getCallToAction: GetCallToActionFunction = (
    callToAction: MonitorOverviewCallToAction,
  ): ReactElement => {
    if (!isMonitorOverviewActionCallToAction(callToAction)) {
      return (
        <div data-testid="monitor-overview-call-to-action" className="mt-4">
          <SloOverviewActionLink
            variant="secondary"
            title={callToAction.text}
            to={getMonitorOverviewRoute({
              key: callToAction.linkKey,
              monitorId: props.monitorId,
            })}
          />
        </div>
      );
    }

    if (
      !turnMonitoringOn.gate.isAllowed &&
      !turnMonitoringOn.gate.disabledReason
    ) {
      return <></>;
    }

    /*
     * Button carries a left margin meant for a dialog's footer (md:ml-3),
     * which set "Turn monitoring on" 12px in from the text above it. It is
     * cleared on the button, or on the span a locked button's tooltip
     * wraps it in, as the card headers clear it on their actions.
     */
    return (
      <div
        data-testid="monitor-overview-call-to-action"
        className="mt-4 [&>button]:ml-0 [&>button]:md:ml-0 [&>*>button]:ml-0 [&>*>button]:md:ml-0"
      >
        <Button
          title={callToAction.text}
          icon={IconProp.Play}
          buttonStyle={ButtonStyleType.NORMAL}
          dataTestId={TURN_MONITORING_ON_BUTTON_TEST_ID}
          isLoading={turnMonitoringOn.isSaving}
          disabled={!turnMonitoringOn.gate.isAllowed}
          tooltip={turnMonitoringOn.gate.disabledReason}
          onClick={turnMonitoringOn.turnOn}
        />
        {turnMonitoringOn.error ? (
          <p
            role="alert"
            data-testid={TURN_MONITORING_ON_ERROR_TEST_ID}
            className="mt-2 text-sm text-red-700"
          >
            {turnMonitoringOn.error}
          </p>
        ) : (
          <></>
        )}
      </div>
    );
  };

  type GetBadgeRowFunction = () => ReactElement;

  const getBadgeRow: GetBadgeRowFunction = (): ReactElement => {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {presentation.badge.statusColor ? (
          <MonitorStatusDot
            dataTestId="monitor-overview-status-dot"
            color={presentation.badge.statusColor}
            className="h-2.5 w-2.5"
          />
        ) : (
          <></>
        )}
        <span data-testid="monitor-overview-badge">
          <StatusBadge
            text={presentation.badge.text}
            type={TONE_BADGE[presentation.badge.tone]}
          />
        </span>
        {presentation.secondaryBadges.map(
          (badge: MonitorOverviewSecondaryBadge, index: number) => {
            return (
              <span
                key={`${badge.text}-${index}`}
                data-testid="monitor-overview-secondary-badge"
              >
                <StatusBadge text={badge.text} type={TONE_BADGE[badge.tone]} />
              </span>
            );
          },
        )}
      </div>
    );
  };

  type GetTargetFunction = () => ReactElement;

  const getTarget: GetTargetFunction = (): ReactElement => {
    const target: MonitorOverviewTarget | null = presentation.target;
    const extraStepCount: number = target ? target.extraStepCount : 0;

    /*
     * A div, not a paragraph: Icon renders a div, and a div inside a <p> is
     * invalid markup that React warns about on every render.
     */
    return (
      <div
        data-testid="monitor-overview-target"
        className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-500"
      >
        <Icon icon={typeIcon} className="h-4 w-4 flex-shrink-0 text-gray-400" />
        <span>{typeTitle}</span>
        {target ? (
          <>
            <span aria-hidden="true">·</span>
            <span
              data-testid="monitor-overview-target-value"
              className={
                target.isMono
                  ? "break-all font-mono text-gray-700"
                  : "break-all text-gray-700"
              }
              title={target.value}
            >
              {target.value}
            </span>
          </>
        ) : (
          <></>
        )}
        {extraStepCount > 0 ? (
          <span>
            {translator.translatePlural(
              {
                one: "(+{{count}} more step)",
                other: "(+{{count}} more steps)",
              },
              extraStepCount,
            )}
          </span>
        ) : (
          <></>
        )}
      </div>
    );
  };

  type GetPulseFunction = () => ReactElement;

  const getPulse: GetPulseFunction = (): ReactElement => {
    const pulse: MonitorOverviewPulse = presentation.pulse;

    let lastLine: ReactElement = (
      <p className="text-xs text-gray-600">{pulse.emptyText}</p>
    );

    if (pulse.label !== null && pulse.isUnavailable) {
      /*
       * The source could not be read, so this must not say "never": it says
       * the time is unknown instead.
       */
      lastLine = (
        <p className="text-xs text-gray-400">
          {translator.translateTemplate("{{label}}: unavailable", {
            label: translatableTerm(pulse.label),
          })}
        </p>
      );
    } else if (pulse.label !== null && pulse.at) {
      lastLine = (
        <p className="text-xs text-gray-600">
          <TranslatedSentence
            template="{{label}} {{time}}"
            values={{ label: translatableTerm(pulse.label) }}
            slots={{ time: <RelativeTime date={pulse.at} /> }}
          />
        </p>
      );
    }

    // Under the text until lg, then under the actions at the right.
    return (
      <div
        data-testid="monitor-overview-pulse"
        className="min-w-0 text-left lg:text-right"
      >
        {lastLine}
        {pulse.cadenceText ? (
          <p
            data-testid="monitor-overview-cadence"
            className="mt-1 text-xs text-gray-500"
          >
            {pulse.nextAt ? (
              <TranslatedSentence
                template="{{cadence}} · next {{time}}"
                values={{ cadence: pulse.cadenceText }}
                slots={{ time: <RelativeTime date={pulse.nextAt} /> }}
              />
            ) : (
              pulse.cadenceText
            )}
          </p>
        ) : (
          <></>
        )}
        {pulse.overdueSeconds !== undefined ? (
          <p
            data-testid="monitor-overview-overdue"
            className="mt-1 text-xs font-medium text-amber-700"
          >
            {translator.translateTemplate("Overdue by {{duration}}", {
              duration: formatDurationCompactInLanguage(
                pulse.overdueSeconds,
                translator.language,
              ),
            })}
          </p>
        ) : (
          <></>
        )}
      </div>
    );
  };

  type GetOwnersFunction = () => ReactElement;

  const getOwners: GetOwnersFunction = (): ReactElement => {
    const owners: Array<ResourceOwnerEntry> | null = props.owners.value;

    if (props.owners.status === "loading" && !owners) {
      return <OwnersCell owners={undefined} isLoading={true} maxVisible={3} />;
    }

    // Unknown is not "nobody": a failed or forbidden read says so.
    if (!owners) {
      return (
        <span className="text-base font-semibold text-gray-400">
          {translator.translateText("Unavailable")}
        </span>
      );
    }

    if (owners.length === 0) {
      return (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className="text-gray-500">
            {translator.translateText("No owners")}
          </span>
          {mayAddOwners ? (
            <AddOwnersTextButton
              popup={ownersPopup}
              dataTestId="monitor-overview-add-owners"
            />
          ) : (
            <></>
          )}
        </div>
      );
    }

    /*
     * A partial read (owner users readable, owner teams not) or a failed
     * refresh still shows who is known, but must not read as the complete,
     * current list.
     */
    if (props.owners.refreshError) {
      return (
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <OwnersCell owners={owners} maxVisible={3} />
          <span
            data-testid="monitor-overview-owners-partial"
            className="text-xs font-normal text-gray-500"
            title={props.owners.refreshError}
          >
            {translator.translateText("List may be incomplete")}
          </span>
        </span>
      );
    }

    /*
     * The next owner's place after the avatars. Not after a list that may
     * be incomplete (above): it would offer whoever the unread half names.
     */
    return (
      <div className="flex items-center gap-1.5">
        <OwnersCell owners={owners} maxVisible={3} />
        {mayAddOwners ? (
          <AddOwnersPlaceButton
            popup={ownersPopup}
            dataTestId="monitor-overview-add-more-owners"
          />
        ) : (
          <></>
        )}
      </div>
    );
  };

  type GetFactValueFunction = (fact: MonitorOverviewFact) => ReactElement;

  const getFactValue: GetFactValueFunction = (
    fact: MonitorOverviewFact,
  ): ReactElement => {
    if (fact.valueDate) {
      return <RelativeTime date={fact.valueDate} />;
    }

    if (fact.linkKey) {
      return (
        <Link
          to={getMonitorOverviewRoute({
            key: fact.linkKey,
            monitorId: props.monitorId,
            linkId: fact.linkId,
          })}
          className="hover:underline"
        >
          {fact.value}
        </Link>
      );
    }

    return <>{fact.value}</>;
  };

  type GetFactFunction = (fact: MonitorOverviewFact) => ReactElement;

  const getFact: GetFactFunction = (
    fact: MonitorOverviewFact,
  ): ReactElement => {
    if (fact.key === "owners") {
      return (
        <div
          key={fact.key}
          className="min-w-0"
          data-testid="monitor-overview-fact-owners"
        >
          <dt className="text-xs font-medium text-gray-500">{fact.label}</dt>
          <dd className="mt-1">
            {getOwners()}
            {mayAddOwners && knownOwners ? (
              <AddOwnersPopup
                popup={ownersPopup}
                target={ownersTarget}
                ownerKeys={ownerKeys}
                onOwnersChanged={props.onOwnersChanged}
              />
            ) : (
              <></>
            )}
          </dd>
        </div>
      );
    }

    const colorClassName: string = fact.isMuted
      ? "text-gray-400"
      : TONE_TEXT_CLASS[fact.tone || "neutral"];

    return (
      <div
        key={fact.key}
        className="min-w-0"
        data-testid={"monitor-overview-fact-" + fact.key}
      >
        <dt className="text-xs font-medium text-gray-500">{fact.label}</dt>
        <dd
          className={`mt-1 text-base font-semibold tabular-nums ${colorClassName}${
            fact.isMono ? " break-all font-mono" : ""
          }`}
        >
          {getFactValue(fact)}
          {fact.secondary ? (
            <span className="mt-0.5 block break-words text-xs font-normal text-gray-500">
              {fact.secondary}
            </span>
          ) : (
            <></>
          )}
        </dd>
      </div>
    );
  };

  return (
    <section
      aria-label={translator.translateText("Monitor status")}
      data-testid="monitor-overview-hero"
      className="rounded-xl border border-gray-200 bg-white shadow-sm"
    >
      <div className="p-5 sm:p-6">
        <div className="flex items-start gap-4">
          <div
            data-testid="monitor-overview-icon"
            className={`max-sm:hidden h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl sm:flex ${
              TONE_TILE_CLASS[presentation.tone]
            }`}
          >
            <Icon
              icon={getMonitorOverviewIcon(presentation)}
              className="h-6 w-6"
            />
          </div>
          {/*
           * Two columns: the badges, then the state in words, on the left;
           * the actions on the badges' line at the right, and from lg the
           * pulse under them. Below lg the pulse follows the text. Every
           * cell is placed by the grid, so the markup can keep the order a
           * screen reader and the Tab key should take: the state, its call
           * to action, then the actions and the pulse.
           */}
          <div
            data-testid="monitor-overview-layout"
            className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] gap-x-4 lg:gap-x-8"
          >
            <div
              data-testid="monitor-overview-badges-cell"
              className="col-start-1 row-start-1 min-w-0 self-center"
            >
              {getBadgeRow()}
            </div>
            <div
              data-testid="monitor-overview-state-cell"
              className="col-span-2 col-start-1 row-start-2 min-w-0 lg:col-span-1"
            >
              <h2
                data-testid="monitor-overview-headline"
                className="mt-2 text-xl font-semibold tracking-tight text-gray-900"
              >
                {presentation.headline.since ? (
                  <TranslatedSentence
                    template="{{headline}} for {{duration}}"
                    values={{ headline: presentation.headline.text }}
                    slots={{
                      duration: (
                        <span
                          title={OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                            presentation.headline.since,
                          )}
                        >
                          <LiveDuration
                            startDate={presentation.headline.since}
                          />
                        </span>
                      ),
                    }}
                  />
                ) : (
                  presentation.headline.text
                )}
              </h2>
              {presentation.explanation ? (
                <p
                  data-testid="monitor-overview-explanation"
                  className="mt-1.5 max-w-3xl text-sm leading-6 text-gray-600"
                >
                  {presentation.explanation}
                </p>
              ) : (
                <></>
              )}
              {presentation.lastKnownStatus ? (
                <p
                  data-testid="monitor-overview-last-known"
                  className="mt-1 text-sm text-gray-500"
                >
                  {presentation.lastKnownStatus}
                </p>
              ) : (
                <></>
              )}
              {getTarget()}
              {presentation.callToAction ? (
                getCallToAction(presentation.callToAction)
              ) : (
                <></>
              )}
            </div>
            <div
              data-testid="monitor-overview-actions-cell"
              className="col-start-2 row-start-1 self-start"
            >
              <MonitorOverviewActions
                key={props.monitorId.toString()}
                monitorId={props.monitorId}
                isRefreshing={props.isRefreshing}
                refreshError={props.refreshError}
                lastLoadedAt={props.lastLoadedAt}
                onRefresh={props.onRefresh}
                moreActions={presentation.moreActions}
                currentStatusId={props.currentStatusId}
                onStatusChanged={props.onStatusChanged}
              />
            </div>
            <div
              data-testid="monitor-overview-pulse-cell"
              className="col-span-2 col-start-1 row-start-3 mt-3 min-w-0 lg:col-span-1 lg:col-start-2 lg:row-start-2 lg:mt-4"
            >
              {getPulse()}
            </div>
          </div>
        </div>

        {/*
         * A clock time, not "3 minutes ago": an alert is re-read in full
         * whenever its text changes, so a relative time ticking inside it
         * interrupted a screen reader user once a minute for as long as
         * refreshes kept failing.
         */}
        {props.refreshError ? (
          <p
            role="alert"
            data-testid="monitor-overview-refresh-error"
            className="mt-4 text-sm text-red-700"
          >
            {props.lastLoadedAt ? (
              <TranslatedSentence
                template="Couldn't refresh. Showing what loaded at {{time}}. {{error}}"
                values={{ error: props.refreshError }}
                slots={{
                  time: <LoadedAtTime loadedAt={props.lastLoadedAt} />,
                }}
              />
            ) : (
              translator.translateTemplate(
                "Couldn't refresh. Showing what loaded earlier. {{error}}",
                { error: props.refreshError },
              )
            )}
          </p>
        ) : (
          <></>
        )}
      </div>

      <dl
        aria-label={translator.translateText("Monitor at a glance")}
        data-testid="monitor-overview-facts"
        className={`grid gap-5 rounded-b-xl border-t border-gray-100 bg-gray-50 px-5 py-4 sm:px-6 ${getFactGridClass(
          presentation.facts.length,
        )}`}
      >
        {presentation.facts.map((fact: MonitorOverviewFact) => {
          return getFact(fact);
        })}
      </dl>
    </section>
  );
};

export default MonitorOverviewHero;
