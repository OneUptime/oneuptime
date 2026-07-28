import RunbookAgentAccessLevel, {
  RunbookAgentAccessLevelHelper,
} from "Common/Types/Runbook/RunbookAgentAccessLevel";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  accessLevel?: string | undefined;
}

/*
 * The AI access grant for a Runbook Agent — deliberately styled unlike the
 * environment badge, because this is the one that actually decides
 * something. ReadWrite is the higher-trust state (amber: AI may change
 * things on this host) and ReadOnly is the calm default (slate: AI may only
 * look). An unset grant renders as ReadOnly because that is exactly how the
 * dispatch gate treats it (RunbookAgentAccessLevelHelper.canWrite is the
 * fail-safe read).
 */
const RunbookAgentAccessLevelBadge: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const canWrite: boolean = RunbookAgentAccessLevelHelper.canWrite(
    props.accessLevel,
  );

  const label: string = canWrite
    ? RunbookAgentAccessLevel.ReadWrite
    : RunbookAgentAccessLevel.ReadOnly;

  const badgeClasses: string = canWrite
    ? "bg-amber-50 text-amber-700 ring-amber-600/20"
    : "bg-slate-50 text-slate-600 ring-slate-500/20";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${badgeClasses}`}
      title={
        canWrite
          ? "AI may run diagnostics and remediations on this agent unattended when an Auto Remediation Rule matches."
          : "AI may run diagnostics on this agent unattended. It may never run remediations here."
      }
    >
      {label}
    </span>
  );
};

export default RunbookAgentAccessLevelBadge;
