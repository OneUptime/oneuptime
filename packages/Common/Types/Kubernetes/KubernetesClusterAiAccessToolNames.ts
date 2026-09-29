/*
 * Names of the AI tools that touch a cluster, shared with the dashboard so
 * the investigation panel can count "kubectl commands" from the run's
 * events without importing server code.
 */
export const RUN_KUBECTL_TOOL_NAME: string = "run_kubectl";
export const LIST_CLUSTER_ACCESS_TOOL_NAME: string = "list_cluster_access";

/*
 * How the run's persisted event starts for a kubectl command a Runner took
 * whose result never came back — whether kubectl ran is unknown, so it is
 * never counted as "did not run". The server writes it
 * (KubectlInvestigationToolkit) and the investigation panel reads it
 * (Components/AI/ClusterToolFormat); this is the one definition both use.
 */
export const KUBECTL_RESULT_UNKNOWN_EVENT_PREFIX: string =
  "kubectl result unknown:";
