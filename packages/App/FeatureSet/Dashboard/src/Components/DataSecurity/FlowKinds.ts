import DataSecurityFlow from "Common/Models/DatabaseModels/DataSecurityFlow";
import DataSensitivity, {
  DATA_SENSITIVITY_RANK,
} from "Common/Types/DataSecurity/DataSensitivity";

/*
 * THE FOUR KINDS OF FLOW, AND HOW RISKY EACH ONE IS.
 *
 * A flow (DataSecurityFlow) is one edge OneUptime worked out from traces
 * and scans (DataSecurityFlows on the server):
 *
 *   - Uses: a service reads or writes a store (the service map);
 *   - AI Provider: a service sends prompts - and what is in its AI
 *     conversations - to an AI provider;
 *   - External Host: a service calls a host outside your systems;
 *   - Copy: a store holds copies of another store's values (fingerprints).
 *
 * Kept apart from the components that draw flows, so a page, the chains
 * (FlowChain) and a store's data paths (DataPathModel) rank them alike.
 */

export const FLOW_KIND_USES: string = "Uses";
export const FLOW_KIND_AI_PROVIDER: string = "AI Provider";
export const FLOW_KIND_EXTERNAL_HOST: string = "External Host";
export const FLOW_KIND_COPY: string = "Copy";

// The kinds, the ones that leave your systems first.
export const FLOW_KINDS: ReadonlyArray<string> = [
  FLOW_KIND_AI_PROVIDER,
  FLOW_KIND_EXTERNAL_HOST,
  FLOW_KIND_COPY,
  FLOW_KIND_USES,
];

// How much a kind adds to a flow's risk: leaving your systems is worst.
const KIND_WEIGHT: Record<string, number> = {
  [FLOW_KIND_AI_PROVIDER]: 3,
  [FLOW_KIND_EXTERNAL_HOST]: 3,
  [FLOW_KIND_COPY]: 2,
  [FLOW_KIND_USES]: 0,
};

/*
 * How risky a flow is, to rank chains by: the sensitivity of what can
 * travel along it first, then whether it leaves your systems, whether a
 * scan confirmed the data got there, and how busy it is.
 */
export function getFlowRisk(flow: DataSecurityFlow): number {
  const sensitivity: DataSensitivity =
    (flow.sensitivity as DataSensitivity | undefined) || DataSensitivity.Public;

  return (
    DATA_SENSITIVITY_RANK[sensitivity] * 100 +
    (KIND_WEIGHT[flow.kind || ""] || 0) * 10 +
    (flow.isConfirmed ? 5 : 0) +
    Math.min(4, Math.log10(Math.max(1, flow.callCount || 0)))
  );
}

export function rankFlowsByRisk(
  flows: Array<DataSecurityFlow>,
): Array<DataSecurityFlow> {
  return [...flows].sort((a: DataSecurityFlow, b: DataSecurityFlow): number => {
    return getFlowRisk(b) - getFlowRisk(a);
  });
}
