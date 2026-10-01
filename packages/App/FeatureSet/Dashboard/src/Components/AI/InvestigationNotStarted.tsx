import { InvestigationStatusIndicator } from "./InvestigationStatusBadge";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import InvestigationNotStartedReason, {
  InvestigationNotStartedCode,
} from "Common/Types/AI/InvestigationNotStartedReason";
import Project from "Common/Models/DatabaseModels/Project";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import Permission, { PermissionHelper } from "Common/Types/Permission";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import PermissionUtil from "Common/UI/Utils/Permission";
import React, { FunctionComponent, ReactElement } from "react";

interface ComponentProps {
  subjectType: "incident" | "alert";
  reason: InvestigationNotStartedReason | null;
  isLoading: boolean;
  hasError: boolean;
  hasSuccessfulResponse: boolean;
  isRefreshing: boolean;
  onRefresh: () => void;
}

export interface InvestigationNotStartedStatus {
  text: string;
  indicator: InvestigationStatusIndicator;
}

/*
 * What the card's status pill says while there is no run to show: the card
 * is still asking, the answer could not be loaded, or nothing ran.
 */
export function getInvestigationNotStartedStatus(data: {
  isLoading: boolean;
  hasError: boolean;
  hasSuccessfulResponse: boolean;
}): InvestigationNotStartedStatus {
  if (data.isLoading) {
    return { text: "Checking", indicator: "checking" };
  }

  if (data.hasError && !data.hasSuccessfulResponse) {
    return { text: "Unable to check", indicator: "attention" };
  }

  return { text: "Not investigated", indicator: "idle" };
}

export interface SettingsAction {
  label: string;
  page: PageMap;
  permissions: Array<Permission>;
  /*
   * Shown instead of the link to people who lack `permissions`, so it must
   * name who can act — a Project Admin cannot turn AI on or add credits.
   */
  whoCanAct: string;
}

const PROJECT_ADMIN_CAN_ACT: string =
  "A project administrator can review these settings.";

const KNOWN_REASON_CODES: Array<InvestigationNotStartedCode> = [
  "ai_disabled",
  "automatic_investigation_disabled",
  "provider_missing",
  "insufficient_ai_balance",
  "severity_below_threshold",
  "monitor_cooldown",
  "daily_budget_exhausted",
  "budget_check_failed",
  "enqueue_failed",
  "eligibility_check_failed",
  "no_run_recorded",
];

/*
 * Treat missing/malformed data from an older API replica as unknown, never as
 * a disabled feature. All server-authored copy is rendered as plain text.
 */
export function parseInvestigationNotStartedReason(
  value: unknown,
): InvestigationNotStartedReason | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const reason: Partial<InvestigationNotStartedReason> = value;
  if (
    !KNOWN_REASON_CODES.includes(reason.code as InvestigationNotStartedCode) ||
    typeof reason.title !== "string" ||
    !reason.title.trim() ||
    typeof reason.description !== "string" ||
    !reason.description.trim() ||
    typeof reason.nextStep !== "string" ||
    !reason.nextStep.trim() ||
    !["recorded", "current_configuration", "unknown"].includes(
      reason.source || "",
    ) ||
    typeof reason.evaluatedAt !== "string" ||
    !Number.isFinite(Date.parse(reason.evaluatedAt))
  ) {
    return null;
  }

  return reason as InvestigationNotStartedReason;
}

/*
 * Who may flip the project's AI switch, from the column's own update access
 * control, so the link is offered to exactly the people whose save the
 * server accepts.
 */
function getEnableAiUpdatePermissions(): Array<Permission> {
  return new Project().getColumnAccessControlFor("enableAi")?.update || [];
}

export function getSettingsAction(
  code: InvestigationNotStartedCode,
  subjectType: "incident" | "alert",
): SettingsAction | null {
  /*
   * The project's AI switch lives on Project Settings → AI Features, which
   * every install shows (AI Credits is listed only when billing is on).
   */
  if (code === "ai_disabled") {
    return {
      label: "Go to Project Settings → AI Features",
      page: PageMap.SETTINGS_AI_FEATURES,
      permissions: getEnableAiUpdatePermissions(),
      whoCanAct:
        "A project owner or someone with Manage Billing can turn AI on in Project Settings → AI Features.",
    };
  }

  /*
   * Only produced when billing is on, which is exactly when AI Credits is
   * in the settings menu. Recharging takes the permissions AIBillingAPI's
   * /ai/recharge checks.
   */
  if (code === "insufficient_ai_balance") {
    return {
      label: "Add AI credits",
      page: PageMap.SETTINGS_AI_CREDITS,
      permissions: [Permission.ProjectOwner, Permission.ManageProjectBilling],
      whoCanAct:
        "A project owner or someone with Manage Billing can add AI credits.",
    };
  }

  if (code === "provider_missing") {
    return {
      label: "Configure an AI provider",
      page: PageMap.SETTINGS_AI_LLM_PROVIDERS,
      permissions: [
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.ProjectMember,
        Permission.SettingsAdmin,
        Permission.SettingsMember,
        Permission.CreateProjectLlm,
      ],
      whoCanAct: PROJECT_ADMIN_CAN_ACT,
    };
  }

  if (
    code === "budget_check_failed" ||
    code === "enqueue_failed" ||
    code === "eligibility_check_failed"
  ) {
    return null;
  }

  return {
    label: `Review ${subjectType} AI settings`,
    page:
      subjectType === "alert"
        ? PageMap.ALERTS_SETTINGS_AI
        : PageMap.INCIDENTS_SETTINGS_AI,
    permissions: [Permission.ProjectOwner, Permission.ProjectAdmin],
    whoCanAct: PROJECT_ADMIN_CAN_ACT,
  };
}

/*
 * What the AI Investigation card says when there is no run to show: why
 * OneUptime AI did not investigate (or that the card is still asking, or
 * could not find out), and what a reader can do about it.
 *
 * It is the card's body, not a card: InvestigationPanel draws the one card,
 * its header and its status pill for every state, and closes it with the
 * conversation. This state used to be a card of its own, with the
 * conversation in a second card under it.
 */
const InvestigationNotStarted: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { subjectType, isLoading, hasError, hasSuccessfulResponse } = props;
  const isUnavailable: boolean = hasError && !hasSuccessfulResponse;
  const reason: InvestigationNotStartedReason | null = props.reason;
  const title: string = isLoading
    ? "Checking investigation status…"
    : isUnavailable
      ? "Investigation status is unavailable"
      : reason?.title || "No investigation has been recorded";
  const description: string = isLoading
    ? `Checking whether OneUptime AI has investigated this ${subjectType}.`
    : isUnavailable
      ? "We could not load the investigation status. This does not mean AI is disabled or that the investigation was skipped."
      : reason?.description ||
        `There is no AI investigation linked to this ${subjectType}, and no recorded explanation is available. It may have been created before automatic investigation was enabled, or before reasons were recorded.`;
  const nextStep: string =
    reason?.nextStep ||
    "Review the investigation settings and AI logs. Enabling automatic investigation applies to new events; it does not automatically investigate older ones.";
  const action: SettingsAction | null =
    !isLoading && !isUnavailable
      ? getSettingsAction(reason?.code || "no_run_recorded", subjectType)
      : null;
  const canReviewSettings: boolean = Boolean(
    action &&
      PermissionHelper.doesPermissionsIntersect(
        action.permissions,
        PermissionUtil.getAllPermissions(),
      ),
  );
  const sourceLabel: string =
    reason?.source === "recorded"
      ? "Decision recorded at creation"
      : reason?.source === "current_configuration"
        ? "Based on current settings"
        : "No recorded decision";
  const checkedAt: string | null = reason
    ? new Date(reason.evaluatedAt).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : null;

  return (
    <div
      aria-live="polite"
      data-testid="investigation-not-started"
      className="space-y-6"
    >
      <div>
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        <p className="mt-1 text-sm leading-6 text-gray-600">{description}</p>
        {!isLoading && !isUnavailable ? (
          <div className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs leading-relaxed text-gray-500">
            <Icon icon={IconProp.Clock} className="h-3.5 w-3.5" />
            <span>{sourceLabel}</span>
            {checkedAt && reason ? (
              <>
                <span aria-hidden="true">·</span>
                <time dateTime={reason.evaluatedAt}>{checkedAt}</time>
              </>
            ) : null}
          </div>
        ) : null}
        {reason?.source === "current_configuration" &&
        !isLoading &&
        !isUnavailable ? (
          <p className="mt-1 text-xs leading-relaxed text-gray-500">
            Settings may have changed since this {subjectType} was created; this
            is not a recorded decision from that time.
          </p>
        ) : null}
      </div>

      {!isLoading && !isUnavailable ? (
        <div>
          <h3 className="text-sm font-semibold text-gray-900">
            What you can do
          </h3>
          <p className="mt-1 text-sm leading-6 text-gray-600">{nextStep}</p>
          {action && canReviewSettings ? (
            <Link
              to={RouteUtil.populateRouteParams(RouteMap[action.page] as Route)}
              className="mt-2 inline-flex items-center gap-1.5 rounded text-sm font-medium text-indigo-600 hover:text-indigo-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
            >
              <span>{action.label}</span>
              <Icon icon={IconProp.ArrowRight} className="h-4 w-4" />
            </Link>
          ) : action ? (
            <p className="mt-2 text-xs leading-relaxed text-gray-500">
              {action.whoCanAct}
            </p>
          ) : null}
        </div>
      ) : null}

      {hasError && !isLoading ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 pt-5">
          {/* A div, not a p: Icon renders its own div around the svg. */}
          <div className="flex min-w-0 items-start gap-2 text-sm leading-6 text-gray-700">
            <Icon
              icon={IconProp.Alert}
              className="mt-1 h-4 w-4 flex-shrink-0 text-amber-500"
            />
            <p>
              {hasSuccessfulResponse
                ? "Could not refresh this status. Showing the last successful check."
                : "Try again to check this investigation."}
            </p>
          </div>
          <Button
            title="Retry"
            ariaLabel="Retry investigation status"
            icon={IconProp.Refresh}
            buttonSize={ButtonSize.Small}
            buttonStyle={ButtonStyleType.OUTLINE}
            isLoading={props.isRefreshing}
            disabled={props.isRefreshing}
            onClick={props.onRefresh}
            className="!ml-0"
          />
        </div>
      ) : null}
    </div>
  );
};

export default InvestigationNotStarted;
