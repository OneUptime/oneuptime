import { formatReaderNumber } from "Common/Types/DateLanguage";

/*
 * A count a Kubernetes part's page shows on its own - desired replicas,
 * completions, the jobs a CronJob keeps - in the reader's digits ("۳" in
 * Persian; issue #7106), and "N/A" when the object does not say. Anything
 * that is not a number (a value a newer Kubernetes writes another way) is
 * drawn as written.
 *
 * A module of its own, not a KubernetesResourceUtils method: the page
 * suites replace that class with a stub of the methods they read.
 */
export function formatKubernetesCount(value: unknown): string {
  if (value === null || value === undefined) {
    return "N/A";
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return formatReaderNumber(value);
  }

  return String(value);
}
