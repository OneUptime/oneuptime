import RunbookAgentEnvironmentType, {
  RunbookAgentEnvironmentTypeHelper,
} from "Common/Types/Runbook/RunbookAgentEnvironmentType";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  environmentType?: string | undefined;
}

/*
 * The environment tag for a Runbook Agent. Production renders in rose and
 * non-production in emerald so the two trust levels are distinguishable at a
 * glance — AI-proposed remediations may only ever auto-execute on agents
 * explicitly tagged non-production. An untagged agent renders as Production
 * because that is exactly how the remediation policy gate treats it
 * (RunbookAgentEnvironmentTypeHelper.isProduction is the fail-safe read).
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
