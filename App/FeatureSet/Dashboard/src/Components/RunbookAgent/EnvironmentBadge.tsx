import RunbookAgentEnvironmentType, {
  RunbookAgentEnvironmentTypeHelper,
} from "Common/Types/Runbook/RunbookAgentEnvironmentType";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  environmentType?: string | undefined;
}

/*
 * The environment tag for a Runbook Agent — informational context, not a
 * gate. Production renders in rose and non-production in emerald so an
 * approver can see at a glance where an action would land; what AI is
 * actually allowed to do is decided by Auto Remediation Rules and the
 * agent's AI access grant (see AccessLevelBadge). An untagged agent renders
 * as Production because that is the conservative read
 * (RunbookAgentEnvironmentTypeHelper.isProduction).
 */
const RunbookAgentEnvironmentBadge: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const isProduction: boolean = RunbookAgentEnvironmentTypeHelper.isProduction(
    props.environmentType,
  );

  const label: string =
    props.environmentType || RunbookAgentEnvironmentType.Production;

  const badgeClasses: string = isProduction
    ? "bg-rose-50 text-rose-700 ring-rose-600/20"
    : "bg-emerald-50 text-emerald-700 ring-emerald-600/20";

  const dotClasses: string = isProduction ? "bg-rose-500" : "bg-emerald-500";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${badgeClasses}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dotClasses}`} />
      {label}
    </span>
  );
};

export default RunbookAgentEnvironmentBadge;
