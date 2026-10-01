import { ComplianceAccess } from "./ComplianceAccess";
import ComplianceRuleFormModal from "./ComplianceRuleForm";
import ComplianceRulePresets from "./ComplianceRulePresets";
import {
  RulePassRate,
  RulePassRateText,
  getAllSeveritiesLabel,
  getChannelLabel,
  getRuleChannels,
  getRuleIcon,
  getRuleLabel,
  getRulePassRate,
  getRulePassRateText,
  getRuleSentence,
  getRuleTitle,
  hasNoSeveritiesLeft,
  hasServerId,
  isRuleKnown,
  CHANNEL_ICONS,
  NO_SEVERITIES_LEFT_LABEL,
  NO_SEVERITIES_LEFT_WARNING,
} from "./ComplianceView";
import TeamComplianceSetting from "Common/Models/DatabaseModels/TeamComplianceSetting";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import ComplianceNotificationChannel from "Common/Types/Team/ComplianceNotificationChannel";
import ComplianceRule from "Common/Types/Team/ComplianceRule";
import type {
  TeamComplianceRuleJSON,
  TeamComplianceSeverityJSON,
} from "Common/Types/Team/TeamComplianceStatus";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import Icon from "Common/UI/Components/Icon/Icon";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import Toggle from "Common/UI/Components/Toggle/Toggle";
import Tooltip from "Common/UI/Components/Tooltip/Tooltip";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * The team's compliance rules, one row per rule, each saying in plain words
 * what it demands, how many members meet it, and - for editors - letting
 * them pause, edit or delete it in place. With no rules yet the card turns
 * into a starting point: a short explanation and the recommended rules.
 *
 * Every change is followed by one re-read of the compliance status (the
 * page's onChanged), so the verdict, the pass rates and the members section
 * always describe the rules as they now are.
 */
export interface ComponentProps {
  rules: Array<TeamComplianceRuleJSON>;
  access: ComplianceAccess;
  teamId: ObjectID;
  projectId: ObjectID | null;
  // The rule whose failing members the members section is showing, if any.
  failingRuleId: string | null;
  onShowFailing: (settingId: string | null) => void;
  /*
   * Reads the status again. Resolves once the page shows a status read after
   * the change (true), or once that read has failed (false).
   */
  onChanged: () => Promise<boolean>;
}

type RuleFormState =
  | { mode: "create"; initialValues: FormValues<TeamComplianceSetting> }
  | { mode: "edit"; settingId: string };

/*
 * A rule's switch after its save went through, until the page shows a status
 * read after that save. `token` tells this save from a later one on the same
 * rule; `refreshFailed` says the read that should have followed it failed.
 */
interface SavedToggle {
  enabled: boolean;
  token: number;
  refreshFailed: boolean;
}

// What a rule's switch shows right now, and why.
interface ShownToggle {
  enabled: boolean;
  isSaving: boolean;
  refreshFailed: boolean;
}

const without: <T>(
  record: Record<string, T>,
  key: string,
) => Record<string, T> = <T,>(
  record: Record<string, T>,
  key: string,
): Record<string, T> => {
  if (!(key in record)) {
    return record;
  }

  const next: Record<string, T> = { ...record };
  delete next[key];
  return next;
};

// Readiness-style chips: rounded-md, ring, text-xs - never a full pill.
const NEUTRAL_CHIP_CLASS_NAME: string =
  "inline-flex items-center gap-1.5 rounded-md bg-gray-50 px-2 py-0.5 text-xs font-medium text-gray-700 ring-1 ring-inset ring-gray-200";
const WARNING_CHIP_CLASS_NAME: string =
  "inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-200";

const ComplianceRulesCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [formState, setFormState] = useState<RuleFormState | null>(null);

  const [ruleToDelete, setRuleToDelete] =
    useState<TeamComplianceRuleJSON | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [deleteError, setDeleteError] = useState<string>("");

  /*
   * The enabled value a rule's switch is being SAVED as, only while the write
   * is in flight: the switch moves the moment it is pressed, ignores presses
   * until the write settles, and moves back if it fails.
   */
  const [pendingEnabled, setPendingEnabled] = useState<Record<string, boolean>>(
    {},
  );

  /*
   * The enabled value a rule was SAVED as, kept until the page shows a status
   * read after the save. Without it the switch would fall back to the status
   * from before the save whenever the refresh that follows is slow, overtaken
   * or fails - showing a paused rule as checked, say. It does not lock the
   * switch: a failed refresh must never leave a rule that cannot be pressed.
   */
  const [savedEnabled, setSavedEnabled] = useState<Record<string, SavedToggle>>(
    {},
  );
  const saveCount: MutableRefObject<number> = useRef<number>(0);

  const [toggleErrors, setToggleErrors] = useState<Record<string, string>>({});

  /*
   * A status that arrives after a save's refresh failed was read after that
   * save, so it is the truth about the rule (another editor may have changed
   * it since): the saved values that were waiting for one give way to it.
   */
  useEffect(() => {
    setSavedEnabled(
      (current: Record<string, SavedToggle>): Record<string, SavedToggle> => {
        let next: Record<string, SavedToggle> = current;

        for (const settingId of Object.keys(current)) {
          if (current[settingId]!.refreshFailed) {
            next = without(next, settingId);
          }
        }

        return next;
      },
    );
  }, [props.rules]);

  const canUpdate: boolean = props.access.update.isAllowed;
  const canDelete: boolean = props.access.delete.isAllowed;

  const openCreateForm: (
    initialValues?: FormValues<TeamComplianceSetting>,
  ) => void = (initialValues?: FormValues<TeamComplianceSetting>): void => {
    setFormState({ mode: "create", initialValues: initialValues || {} });
  };

  const setRuleEnabled: (
    rule: TeamComplianceRuleJSON,
    enabled: boolean,
  ) => Promise<void> = async (
    rule: TeamComplianceRuleJSON,
    enabled: boolean,
  ): Promise<void> => {
    const settingId: string = rule.settingId;

    setPendingEnabled((current: Record<string, boolean>) => {
      return { ...current, [settingId]: enabled };
    });
    setToggleErrors((current: Record<string, string>) => {
      return without(current, settingId);
    });

    try {
      /*
       * Only `enabled` is sent: the settings service recognises an
       * enabled-only update and skips re-validating the rule's scope.
       */
      await ModelAPI.updateById({
        modelType: TeamComplianceSetting,
        id: new ObjectID(settingId),
        data: { enabled: enabled },
      });
    } catch (err) {
      setToggleErrors((current: Record<string, string>) => {
        return {
          ...current,
          [settingId]: `Could not ${enabled ? "turn on" : "pause"} this rule. ${API.getFriendlyMessage(err)}`,
        };
      });
      setPendingEnabled((current: Record<string, boolean>) => {
        return without(current, settingId);
      });
      return;
    }

    saveCount.current += 1;
    const token: number = saveCount.current;

    setSavedEnabled((current: Record<string, SavedToggle>) => {
      return {
        ...current,
        [settingId]: { enabled: enabled, token: token, refreshFailed: false },
      };
    });
    setPendingEnabled((current: Record<string, boolean>) => {
      return without(current, settingId);
    });

    let refreshed: boolean = false;

    try {
      refreshed = await props.onChanged();
    } catch {
      // onChanged reports its own failure on the page; treat it as not refreshed.
    }

    setSavedEnabled(
      (current: Record<string, SavedToggle>): Record<string, SavedToggle> => {
        const saved: SavedToggle | undefined = current[settingId];

        // A later press of the same switch owns the row now.
        if (!saved || saved.token !== token) {
          return current;
        }

        /*
         * Refreshed: the status on the page was read after this save, so it
         * says the same. Not refreshed: keep showing what was saved - and
         * say the results around it are older - until a status arrives.
         */
        return refreshed
          ? without(current, settingId)
          : { ...current, [settingId]: { ...saved, refreshFailed: true } };
      },
    );
  };

  const getShownToggle: (rule: TeamComplianceRuleJSON) => ShownToggle = (
    rule: TeamComplianceRuleJSON,
  ): ShownToggle => {
    const pending: boolean | undefined = pendingEnabled[rule.settingId];

    if (pending !== undefined) {
      return { enabled: pending, isSaving: true, refreshFailed: false };
    }

    const saved: SavedToggle | undefined = savedEnabled[rule.settingId];

    if (saved) {
      return {
        enabled: saved.enabled,
        isSaving: false,
        refreshFailed: saved.refreshFailed,
      };
    }

    return { enabled: rule.enabled, isSaving: false, refreshFailed: false };
  };

  const deleteRule: () => Promise<void> = async (): Promise<void> => {
    if (!ruleToDelete) {
      return;
    }

    setIsDeleting(true);
    setDeleteError("");

    try {
      await ModelAPI.deleteItem({
        modelType: TeamComplianceSetting,
        id: new ObjectID(ruleToDelete.settingId),
      });

      if (props.failingRuleId === ruleToDelete.settingId) {
        props.onShowFailing(null);
      }

      setRuleToDelete(null);
      await props.onChanged();
    } catch (err) {
      setDeleteError(API.getFriendlyMessage(err));
    } finally {
      setIsDeleting(false);
    }
  };

  const getSeverityChip: (
    severity: TeamComplianceSeverityJSON,
  ) => ReactElement = (severity: TeamComplianceSeverityJSON): ReactElement => {
    return (
      <li
        key={severity.id}
        data-testid={`compliance-rule-severity-${severity.id}`}
        className={NEUTRAL_CHIP_CLASS_NAME}
      >
        <span
          aria-hidden="true"
          className="h-2 w-2 flex-shrink-0 rounded-full bg-gray-400"
          style={
            severity.color ? { backgroundColor: severity.color } : undefined
          }
        />
        {severity.name || severity.id}
      </li>
    );
  };

  /*
   * One chip per channel the rule insists on - a member needs a rule on each
   * - or a single "Any channel" chip.
   */
  const getChannelChips: (rule: TeamComplianceRuleJSON) => ReactElement = (
    rule: TeamComplianceRuleJSON,
  ): ReactElement => {
    const channels: Array<ComplianceNotificationChannel> =
      getRuleChannels(rule);

    if (channels.length === 0) {
      return (
        <li
          data-testid="compliance-rule-channel"
          className={NEUTRAL_CHIP_CLASS_NAME}
        >
          <Icon icon={IconProp.BellRinging} className="h-3 w-3 text-gray-400" />
          {getChannelLabel(undefined)}
        </li>
      );
    }

    return (
      <>
        {channels.map(
          (channel: ComplianceNotificationChannel): ReactElement => {
            return (
              <li
                key={channel}
                data-testid="compliance-rule-channel"
                className={NEUTRAL_CHIP_CLASS_NAME}
              >
                <Icon
                  icon={CHANNEL_ICONS[channel]}
                  className="h-3 w-3 text-gray-400"
                />
                {getChannelLabel(channel)}
              </li>
            );
          },
        )}
      </>
    );
  };

  // Which severities and which channels an on-call rule covers.
  const getScopeChips: (rule: TeamComplianceRuleJSON) => ReactElement = (
    rule: TeamComplianceRuleJSON,
  ): ReactElement => {
    if (!ComplianceRule.isOnCallRule(rule.ruleType)) {
      return <></>;
    }

    const showsEverySeverity: boolean =
      rule.appliesToAllSeverities || rule.severities.length === 0;

    let severityChips: ReactElement | Array<ReactElement> =
      rule.severities.map(getSeverityChip);

    if (hasNoSeveritiesLeft(rule)) {
      /*
       * Not "All incident severities": its severities were deleted, and it
       * checks none of them. Amber, because it is waiting on an admin.
       */
      severityChips = (
        <li
          data-testid="compliance-rule-no-severities-left"
          className={WARNING_CHIP_CLASS_NAME}
        >
          <Icon icon={IconProp.Alert} className="h-3 w-3 text-amber-500" />
          {NO_SEVERITIES_LEFT_LABEL}
        </li>
      );
    } else if (showsEverySeverity) {
      severityChips = (
        <li
          data-testid="compliance-rule-all-severities"
          className={NEUTRAL_CHIP_CLASS_NAME}
        >
          <Icon icon={IconProp.Squares} className="h-3 w-3 text-gray-400" />
          {getAllSeveritiesLabel(
            rule.severityKind || ComplianceRule.getSeverityKind(rule.ruleType),
          )}
        </li>
      );
    }

    return (
      <ul
        aria-label="Rule scope"
        data-testid="compliance-rule-scope"
        className="mt-2.5 flex flex-wrap items-center gap-1.5"
      >
        {severityChips}
        {getChannelChips(rule)}
      </ul>
    );
  };

  /*
   * `shownEnabled` is what the rule's switch shows, which runs ahead of the
   * status while a change is saved and refreshed: a rule just paused reads as
   * paused at once, and a rule just turned on is "not checked yet" rather
   * than showing the empty counts of the paused rule it was.
   */
  const getPassRate: (
    rule: TeamComplianceRuleJSON,
    shownEnabled: boolean,
  ) => ReactElement = (
    rule: TeamComplianceRuleJSON,
    shownEnabled: boolean,
  ): ReactElement => {
    /*
     * Unrecognised, or on with no severities left: the server checks nobody
     * against either, so there is no pass rate to show.
     */
    if (!isRuleKnown(rule) || (shownEnabled && hasNoSeveritiesLeft(rule))) {
      return (
        <p
          data-testid="compliance-rule-pass-rate"
          className="text-xs text-gray-500"
        >
          Not checked
        </p>
      );
    }

    if (!shownEnabled) {
      return (
        <p
          data-testid="compliance-rule-pass-rate"
          className="text-xs text-gray-500"
        >
          Paused - not checked
        </p>
      );
    }

    if (!rule.enabled) {
      return (
        <p
          data-testid="compliance-rule-pass-rate"
          className="text-xs text-gray-500"
        >
          Not checked yet
        </p>
      );
    }

    const rate: RulePassRate = getRulePassRate(rule);

    if (rate.total === 0) {
      return (
        <p
          data-testid="compliance-rule-pass-rate"
          className="text-xs text-gray-500"
        >
          No members to check
        </p>
      );
    }

    const isShowingFailing: boolean = props.failingRuleId === rule.settingId;
    const text: RulePassRateText = getRulePassRateText(rate);

    return (
      <div data-testid="compliance-rule-pass-rate" className="w-full sm:w-40">
        <div className="flex items-baseline gap-1 text-xs">
          <span className="font-semibold tabular-nums text-gray-900">
            {text.count}
          </span>{" "}
          <span className="text-gray-500">{text.caption}</span>
        </div>
        <div
          role="img"
          aria-label={text.label}
          className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-gray-100"
        >
          {rate.passing > 0 ? (
            <div
              className="h-1.5 bg-emerald-500"
              style={{ width: `${(rate.passing / rate.total) * 100}%` }}
            />
          ) : (
            <></>
          )}
          {rate.failing > 0 ? (
            <div
              className="h-1.5 bg-red-500"
              style={{ width: `${(rate.failing / rate.total) * 100}%` }}
            />
          ) : (
            <></>
          )}
        </div>
        {rate.failing > 0 ? (
          <button
            type="button"
            data-testid={`compliance-rule-show-failing-${rule.settingId}`}
            aria-pressed={isShowingFailing}
            aria-controls="compliance-members"
            onClick={() => {
              props.onShowFailing(isShowingFailing ? null : rule.settingId);
            }}
            className="mt-1.5 inline-flex items-center gap-1 rounded text-xs font-medium text-red-700 underline-offset-4 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            {isShowingFailing
              ? "Showing who fails it"
              : `Show the ${rate.failing} who ${
                  rate.failing === 1 ? "fails" : "fail"
                } it`}
            <Icon icon={IconProp.ChevronRight} className="h-3 w-3" />
          </button>
        ) : (
          <></>
        )}
      </div>
    );
  };

  const getActions: (
    rule: TeamComplianceRuleJSON,
    label: string,
    shown: ShownToggle,
  ) => ReactElement = (
    rule: TeamComplianceRuleJSON,
    label: string,
    shown: ShownToggle,
  ): ReactElement => {
    if (!canUpdate && !canDelete) {
      return <></>;
    }

    /*
     * A rule listed by an older API, with no id of its own: any write would
     * name a rule that does not exist. The next read from a current server
     * brings its id - and its controls - back.
     */
    if (!hasServerId(rule)) {
      return (
        <p
          data-testid={`compliance-rule-read-only-${rule.settingId}`}
          className="text-xs text-gray-500"
        >
          Refresh the page to change this rule
        </p>
      );
    }

    const isSaving: boolean = shown.isSaving;
    const isEnabled: boolean = shown.enabled;
    const toggleLabelId: string = `compliance-rule-toggle-label-${rule.settingId}`;
    const openEditForm: () => void = (): void => {
      setFormState({ mode: "edit", settingId: rule.settingId });
    };

    /*
     * A rule with no severities left gets no switch. Turned on as it stands
     * it would check nothing it was written for - and, read as "every
     * severity", copy the team's every-severity rule. Choosing new severities
     * is the way back, so that is what is offered in the switch's place.
     */
    let enableControl: ReactElement = <></>;

    if (canUpdate && hasNoSeveritiesLeft(rule)) {
      enableControl = (
        <Button
          title="Choose severities"
          buttonStyle={ButtonStyleType.NORMAL}
          buttonSize={ButtonSize.Small}
          ariaLabel={`Choose severities for ${label}`}
          dataTestId={`compliance-rule-choose-severities-${rule.settingId}`}
          onClick={openEditForm}
        />
      );
    } else if (canUpdate) {
      enableControl = (
        <div
          className={isSaving ? "pointer-events-none opacity-60" : ""}
          aria-busy={isSaving}
        >
          <span id={toggleLabelId} className="sr-only">
            {`Check members against ${label}`}
          </span>
          {/*
           * initialValue as well as value: Toggle only mirrors `value`
           * from an effect, so without it the switch paints "off" for a
           * frame before flipping on. The request is built from what the
           * page shows, not from the switch's own copy of it.
           *
           * disabled while saving: the wrapper's pointer-events stop a
           * mouse, but not Space or Enter on the switch that still has
           * focus. Refused inside Toggle, such a press cannot flip the
           * switch's own copy of its value away from `value` either.
           */}
          <Toggle
            value={isEnabled}
            initialValue={isEnabled}
            disabled={isSaving}
            ariaLabelledby={toggleLabelId}
            dataTestId={`compliance-rule-toggle-${rule.settingId}`}
            onChange={() => {
              if (isSaving) {
                return;
              }

              setRuleEnabled(rule, !isEnabled).catch(() => {
                // setRuleEnabled reports its own failure on the row.
              });
            }}
          />
        </div>
      );
    }

    return (
      <div className="flex items-center gap-1">
        {enableControl}
        {canUpdate ? (
          <Button
            icon={IconProp.Edit}
            buttonStyle={ButtonStyleType.ICON}
            buttonSize={ButtonSize.Small}
            ariaLabel={`Edit ${label}`}
            tooltip="Edit rule"
            dataTestId={`compliance-rule-edit-${rule.settingId}`}
            onClick={openEditForm}
          />
        ) : (
          <></>
        )}
        {canDelete ? (
          <Button
            icon={IconProp.Trash}
            buttonStyle={ButtonStyleType.ICON}
            buttonSize={ButtonSize.Small}
            ariaLabel={`Delete ${label}`}
            tooltip="Delete rule"
            dataTestId={`compliance-rule-delete-${rule.settingId}`}
            onClick={() => {
              setDeleteError("");
              setRuleToDelete(rule);
            }}
          />
        ) : (
          <></>
        )}
      </div>
    );
  };

  const getRuleRow: (rule: TeamComplianceRuleJSON) => ReactElement = (
    rule: TeamComplianceRuleJSON,
  ): ReactElement => {
    const title: string = getRuleTitle(rule);
    const label: string = getRuleLabel(rule);
    const shown: ShownToggle = getShownToggle(rule);
    /*
     * A rule with no severities left says why on the row, in full: nobody
     * paused it on purpose, and it waits on an admin. Its warning is that
     * explanation, so it is not repeated behind a "Warning" chip as well.
     */
    const noSeveritiesLeft: boolean = hasNoSeveritiesLeft(rule);
    /*
     * Active as the switch shows it: known, with severities to check, and on
     * (or being turned on).
     */
    const isActive: boolean =
      shown.enabled && isRuleKnown(rule) && !noSeveritiesLeft;
    const titleId: string = `compliance-rule-title-${rule.settingId}`;
    const toggleError: string | undefined = toggleErrors[rule.settingId];

    return (
      <li
        key={rule.settingId}
        data-testid={`compliance-rule-${rule.settingId}`}
        /*
         * The row is named by its scoped label, not the heading: two rules
         * can share a heading ("Call for incidents"), never a label.
         */
        aria-label={label}
        className="py-4 first:pt-0 last:pb-0"
      >
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-6">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <div
              className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${
                isActive ? "bg-indigo-50" : "bg-gray-100"
              }`}
            >
              <Icon
                icon={getRuleIcon(rule)}
                className={`h-4 w-4 ${
                  isActive ? "text-indigo-600" : "text-gray-400"
                }`}
              />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3
                  id={titleId}
                  data-testid="compliance-rule-title"
                  className={`text-sm font-semibold ${
                    isActive ? "text-gray-900" : "text-gray-500"
                  }`}
                >
                  {title}
                </h3>
                {shown.enabled ? (
                  <></>
                ) : (
                  <span
                    data-testid="compliance-rule-paused"
                    className={NEUTRAL_CHIP_CLASS_NAME}
                  >
                    <Icon
                      icon={IconProp.PauseCircle}
                      className="h-3 w-3 text-gray-400"
                    />
                    Paused
                  </span>
                )}
                {rule.warnings.length > 0 && !noSeveritiesLeft ? (
                  <Tooltip text={rule.warnings.join(" ")}>
                    <span
                      tabIndex={0}
                      data-testid="compliance-rule-warning-chip"
                      aria-label={`Warning: ${rule.warnings.join(" ")}`}
                      className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                    >
                      <Icon
                        icon={IconProp.Alert}
                        className="h-3 w-3 text-amber-500"
                      />
                      {rule.warnings.length === 1
                        ? "Warning"
                        : `${rule.warnings.length} warnings`}
                    </span>
                  </Tooltip>
                ) : (
                  <></>
                )}
              </div>
              <p
                data-testid="compliance-rule-sentence"
                className="mt-0.5 text-sm leading-relaxed text-gray-600"
              >
                {getRuleSentence(rule)}
              </p>
              {getScopeChips(rule)}
              {noSeveritiesLeft ? (
                /* A div, not a p: Icon renders a div, which a p cannot hold. */
                <div
                  data-testid={`compliance-rule-no-severities-left-note-${rule.settingId}`}
                  className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-amber-700"
                >
                  <Icon
                    icon={IconProp.Alert}
                    className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-500"
                  />
                  <span>
                    {rule.warnings.join(" ") || NO_SEVERITIES_LEFT_WARNING}
                  </span>
                </div>
              ) : (
                <></>
              )}
              {toggleError ? (
                <p
                  role="alert"
                  data-testid={`compliance-rule-error-${rule.settingId}`}
                  className="mt-2 text-xs text-red-700"
                >
                  {toggleError}
                </p>
              ) : (
                <></>
              )}
              {shown.refreshFailed ? (
                <p
                  role="status"
                  data-testid={`compliance-rule-refresh-note-${rule.settingId}`}
                  className="mt-2 text-xs text-amber-700"
                >
                  {`${
                    shown.enabled ? "Turned on" : "Paused"
                  }. The results could not be refreshed, so the counts on this page are from before this change.`}
                </p>
              ) : (
                <></>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2 pl-12 md:flex-nowrap md:justify-end md:pl-0">
            {getPassRate(rule, shown.enabled)}
            {getActions(rule, label, shown)}
          </div>
        </div>
      </li>
    );
  };

  const getEmptyState: () => ReactElement = (): ReactElement => {
    const canCreate: boolean = props.access.create.isAllowed;

    return (
      <div data-testid="compliance-rules-empty">
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4">
          <EmptyState
            id="compliance-rules-empty-state"
            icon={IconProp.ShieldCheck}
            iconClassName="mx-auto h-10 w-10 text-gray-400"
            paddingClassName="py-8"
            title="No compliance rules yet"
            description={
              canCreate
                ? "A rule says what everyone on this team must have set up before they can be relied on - a phone call for critical incidents, say, or a verified push device. Start from a recommendation below or build your own."
                : "A rule says what everyone on this team must have set up before they can be relied on. Nobody has added one to this team yet - ask a project admin to add one."
            }
            footer={
              canCreate ? (
                <Button
                  title="Build a custom rule"
                  icon={IconProp.Add}
                  buttonStyle={ButtonStyleType.NORMAL}
                  dataTestId="compliance-rules-empty-add"
                  onClick={() => {
                    openCreateForm();
                  }}
                />
              ) : undefined
            }
          />
        </div>
        {canCreate ? (
          <ComplianceRulePresets
            onChoose={(initialValues: FormValues<TeamComplianceSetting>) => {
              openCreateForm(initialValues);
            }}
          />
        ) : (
          <></>
        )}
      </div>
    );
  };

  const buttons: Array<CardButtonSchema> = [];

  if (props.access.create.isAllowed || props.access.create.disabledReason) {
    buttons.push({
      title: "Add rule",
      icon: IconProp.Add,
      buttonStyle: ButtonStyleType.NORMAL,
      disabled: !props.access.create.isAllowed,
      tooltip: props.access.create.disabledReason,
      onClick: () => {
        if (props.access.create.isAllowed) {
          openCreateForm();
        }
      },
    });
  }

  return (
    <>
      <div data-testid="compliance-rules-card">
        <Card
          title="Compliance rules"
          description="What every member of this team must have set up. Each rule is checked against every member's own notification methods and on-call rules."
          buttons={buttons}
        >
          {props.rules.length === 0 ? (
            getEmptyState()
          ) : (
            <ul
              aria-label="Compliance rules"
              className="divide-y divide-gray-100"
            >
              {props.rules.map(getRuleRow)}
            </ul>
          )}
        </Card>
      </div>

      {formState ? (
        <ComplianceRuleFormModal
          teamId={props.teamId}
          projectId={props.projectId}
          modelIdToEdit={
            formState.mode === "edit"
              ? new ObjectID(formState.settingId)
              : undefined
          }
          initialValues={
            formState.mode === "create" ? formState.initialValues : undefined
          }
          onClose={() => {
            setFormState(null);
          }}
          onSuccess={() => {
            setFormState(null);
            props.onChanged().catch(() => {
              // onChanged reports its own failure on the page.
            });
          }}
        />
      ) : (
        <></>
      )}

      {ruleToDelete ? (
        <ConfirmModal
          title="Delete this rule?"
          description={
            hasNoSeveritiesLeft(ruleToDelete)
              ? `"${getRuleLabel(ruleToDelete)}" is removed from this team. This cannot be undone - to keep it, edit it to choose new severities instead.`
              : `"${getRuleLabel(ruleToDelete)}" stops being checked for everyone on this team. This cannot be undone - to stop checking it for a while, pause it instead.`
          }
          submitButtonText="Delete rule"
          submitButtonType={ButtonStyleType.DANGER}
          isLoading={isDeleting}
          error={deleteError || undefined}
          onClose={() => {
            if (!isDeleting) {
              setRuleToDelete(null);
              setDeleteError("");
            }
          }}
          onSubmit={() => {
            deleteRule().catch(() => {
              // deleteRule reports its own failure in the dialog.
            });
          }}
        />
      ) : (
        <></>
      )}
    </>
  );
};

export default ComplianceRulesCard;
