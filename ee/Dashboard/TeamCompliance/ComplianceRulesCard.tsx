import { ComplianceAccess } from "./ComplianceAccess";
import ComplianceRuleFormModal from "./ComplianceRuleForm";
import ComplianceRulePresets from "./ComplianceRulePresets";
import {
  RulePassRate,
  getAllSeveritiesLabel,
  getChannelLabel,
  getRuleChannel,
  getRuleIcon,
  getRulePassRate,
  getRuleSentence,
  getRuleTitle,
  isRuleActive,
  isRuleKnown,
  CHANNEL_ICONS,
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
import React, { FunctionComponent, ReactElement, useState } from "react";

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
  onChanged: () => Promise<void>;
}

type RuleFormState =
  | { mode: "create"; initialValues: FormValues<TeamComplianceSetting> }
  | { mode: "edit"; settingId: string };

// Readiness-style chips: rounded-md, ring, text-xs - never a full pill.
const NEUTRAL_CHIP_CLASS_NAME: string =
  "inline-flex items-center gap-1.5 rounded-md bg-gray-50 px-2 py-0.5 text-xs font-medium text-gray-700 ring-1 ring-inset ring-gray-200";

const ComplianceRulesCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [formState, setFormState] = useState<RuleFormState | null>(null);

  const [ruleToDelete, setRuleToDelete] =
    useState<TeamComplianceRuleJSON | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [deleteError, setDeleteError] = useState<string>("");

  /*
   * The enabled value a toggle is being saved as, per rule, so the switch
   * moves the moment it is pressed and moves back if the save fails.
   */
  const [pendingEnabled, setPendingEnabled] = useState<Record<string, boolean>>(
    {},
  );
  const [toggleErrors, setToggleErrors] = useState<Record<string, string>>({});

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
      const next: Record<string, string> = { ...current };
      delete next[settingId];
      return next;
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

      await props.onChanged();
    } catch (err) {
      setToggleErrors((current: Record<string, string>) => {
        return {
          ...current,
          [settingId]: API.getFriendlyMessage(err),
        };
      });
    } finally {
      setPendingEnabled((current: Record<string, boolean>) => {
        const next: Record<string, boolean> = { ...current };
        delete next[settingId];
        return next;
      });
    }
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

  // Which severities and which channel an on-call rule covers.
  const getScopeChips: (rule: TeamComplianceRuleJSON) => ReactElement = (
    rule: TeamComplianceRuleJSON,
  ): ReactElement => {
    if (!ComplianceRule.isOnCallRule(rule.ruleType)) {
      return <></>;
    }

    const channel: ComplianceNotificationChannel | undefined =
      getRuleChannel(rule);
    const showsEverySeverity: boolean =
      rule.appliesToAllSeverities || rule.severities.length === 0;

    return (
      <ul
        aria-label="Rule scope"
        data-testid="compliance-rule-scope"
        className="mt-2.5 flex flex-wrap items-center gap-1.5"
      >
        {showsEverySeverity ? (
          <li
            data-testid="compliance-rule-all-severities"
            className={NEUTRAL_CHIP_CLASS_NAME}
          >
            <Icon icon={IconProp.Squares} className="h-3 w-3 text-gray-400" />
            {getAllSeveritiesLabel(
              rule.severityKind ||
                ComplianceRule.getSeverityKind(rule.ruleType),
            )}
          </li>
        ) : (
          rule.severities.map(getSeverityChip)
        )}
        <li
          data-testid="compliance-rule-channel"
          className={NEUTRAL_CHIP_CLASS_NAME}
        >
          <Icon
            icon={channel ? CHANNEL_ICONS[channel] : IconProp.BellRinging}
            className="h-3 w-3 text-gray-400"
          />
          {getChannelLabel(channel)}
        </li>
      </ul>
    );
  };

  const getPassRate: (rule: TeamComplianceRuleJSON) => ReactElement = (
    rule: TeamComplianceRuleJSON,
  ): ReactElement => {
    if (!isRuleKnown(rule)) {
      return (
        <p
          data-testid="compliance-rule-pass-rate"
          className="text-xs text-gray-500"
        >
          Not checked
        </p>
      );
    }

    if (!rule.enabled) {
      return (
        <p
          data-testid="compliance-rule-pass-rate"
          className="text-xs text-gray-500"
        >
          Paused - not checked
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

    return (
      <div data-testid="compliance-rule-pass-rate" className="w-full sm:w-40">
        <div className="flex items-baseline justify-between gap-2 text-xs">
          <span className="font-semibold tabular-nums text-gray-900">
            {`${rate.passing} of ${rate.total}`}
          </span>
          <span className="text-gray-500">
            {rate.failing === 0 ? "all meet it" : "members meet it"}
          </span>
        </div>
        <div
          role="img"
          aria-label={`${rate.passing} of ${rate.total} ${
            rate.total === 1 ? "member meets" : "members meet"
          } this rule`}
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
    title: string,
  ) => ReactElement = (
    rule: TeamComplianceRuleJSON,
    title: string,
  ): ReactElement => {
    if (!canUpdate && !canDelete) {
      return <></>;
    }

    const pending: boolean | undefined = pendingEnabled[rule.settingId];
    const isSaving: boolean = pending !== undefined;
    const isEnabled: boolean = isSaving ? Boolean(pending) : rule.enabled;
    const toggleLabelId: string = `compliance-rule-toggle-label-${rule.settingId}`;

    return (
      <div className="flex items-center gap-1">
        {canUpdate ? (
          <div
            className={isSaving ? "pointer-events-none opacity-60" : ""}
            aria-busy={isSaving}
          >
            <span id={toggleLabelId} className="sr-only">
              {`Check members against ${title}`}
            </span>
            {/*
             * initialValue as well as value: Toggle only mirrors `value`
             * from an effect, so without it the switch paints "off" for a
             * frame before flipping on. The request is built from what the
             * page shows, not from the switch's own copy of it.
             */}
            <Toggle
              value={isEnabled}
              initialValue={isEnabled}
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
        ) : (
          <></>
        )}
        {canUpdate ? (
          <Button
            icon={IconProp.Edit}
            buttonStyle={ButtonStyleType.ICON}
            buttonSize={ButtonSize.Small}
            ariaLabel={`Edit ${title}`}
            tooltip="Edit rule"
            dataTestId={`compliance-rule-edit-${rule.settingId}`}
            onClick={() => {
              setFormState({ mode: "edit", settingId: rule.settingId });
            }}
          />
        ) : (
          <></>
        )}
        {canDelete ? (
          <Button
            icon={IconProp.Trash}
            buttonStyle={ButtonStyleType.ICON}
            buttonSize={ButtonSize.Small}
            ariaLabel={`Delete ${title}`}
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
    const isActive: boolean = isRuleActive(rule);
    const titleId: string = `compliance-rule-title-${rule.settingId}`;
    const toggleError: string | undefined = toggleErrors[rule.settingId];

    return (
      <li
        key={rule.settingId}
        data-testid={`compliance-rule-${rule.settingId}`}
        aria-labelledby={titleId}
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
                {rule.enabled ? (
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
                {rule.warnings.length > 0 ? (
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
              {toggleError ? (
                <p
                  role="alert"
                  data-testid={`compliance-rule-error-${rule.settingId}`}
                  className="mt-2 text-xs text-red-700"
                >
                  {`Could not ${rule.enabled ? "pause" : "turn on"} this rule. ${toggleError}`}
                </p>
              ) : (
                <></>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2 pl-12 md:flex-nowrap md:justify-end md:pl-0">
            {getPassRate(rule)}
            {getActions(rule, title)}
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
          description={`"${getRuleTitle(ruleToDelete)}" stops being checked for everyone on this team. This cannot be undone - to stop checking it for a while, pause it instead.`}
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
