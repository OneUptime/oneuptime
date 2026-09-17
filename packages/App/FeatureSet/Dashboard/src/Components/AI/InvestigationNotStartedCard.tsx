import { AI_INVESTIGATION_PANEL_ID } from "./AIInvestigationStatus";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import InvestigationNotStartedReason, {
  InvestigationNotStartedCode,
} from "Common/Types/AI/InvestigationNotStartedReason";
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

interface SettingsAction {
  label: string;
  page: PageMap;
  permissions: Array<Permission>;
}

const KNOWN_REASON_CODES: Array<InvestigationNotStartedCode> = [
  "ai_disabled",
  "automatic_investigation_disabled",
  "provider_missing",
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

function getSettingsAction(
  code: InvestigationNotStartedCode,
  subjectType: "incident" | "alert",
): SettingsAction | null {
  if (code === "ai_disabled") {
    return {
      label: "Review project AI settings",
      page: PageMap.SETTINGS_AI_CREDITS,
      permissions: [Permission.ProjectOwner, Permission.ManageProjectBilling],
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
  };
}

const InvestigationNotStartedCard: FunctionComponent<ComponentProps> = (
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
    <section
      id={AI_INVESTIGATION_PANEL_ID}
      tabIndex={-1}
      aria-label="AI Investigation"
      aria-busy={isLoading}
      className="mb-6 scroll-mt-32 overflow-hidden rounded-xl border border-indigo-100 bg-white shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 ring-1 ring-inset ring-indigo-100">
            <Icon icon={IconProp.Sparkles} className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-gray-900">
              AI Investigation
            </h2>
            <p className="mt-0.5 text-xs text-gray-500">
              Automatic root cause analysis
            </p>
          </div>
        </div>
        <div
          aria-label="Investigation status"
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${
            isLoading
              ? "bg-indigo-50 text-indigo-700 ring-indigo-200"
              : isUnavailable
                ? "bg-amber-50 text-amber-800 ring-amber-200"
                : "bg-gray-50 text-gray-600 ring-gray-200"
          }`}
        >
          <Icon
            icon={isLoading ? IconProp.Refresh : IconProp.Info}
            className={`h-3.5 w-3.5 ${isLoading ? "motion-safe:animate-spin" : ""}`}
          />
          {isLoading
            ? "Checking"
            : isUnavailable
              ? "Unable to check"
              : "Not investigated"}
        </div>
      </div>

      <div
        aria-live="polite"
        className="border-t border-gray-100 bg-gray-50/40 px-5 py-4"
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:gap-6">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-gray-600">
              {description}
            </p>
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
                Settings may have changed since this {subjectType} was created;
                this is not a recorded decision from that time.
              </p>
            ) : null}
          </div>

          {!isLoading && !isUnavailable ? (
            <div className="min-w-0 border-t border-gray-200/70 pt-4 lg:w-2/5 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                What you can do
              </p>
              <p className="mt-1.5 text-sm leading-relaxed text-gray-600">
                {nextStep}
              </p>
              {action && canReviewSettings ? (
                <Link
                  to={RouteUtil.populateRouteParams(
                    RouteMap[action.page] as Route,
                  )}
                  className="mt-3 inline-flex items-center gap-1.5 rounded text-sm font-medium text-indigo-600 hover:text-indigo-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
                >
                  <span>{action.label}</span>
                  <Icon icon={IconProp.ArrowRight} className="h-4 w-4" />
                </Link>
              ) : action ? (
                <p className="mt-2 text-xs leading-relaxed text-gray-500">
                  A project administrator can review these settings.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        {hasError && !isLoading ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
            <p className="text-xs leading-relaxed text-amber-900">
              {hasSuccessfulResponse
                ? "Could not refresh this status. Showing the last successful check."
                : "Try again to check this investigation."}
            </p>
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
    </section>
  );
};

export default InvestigationNotStartedCard;
