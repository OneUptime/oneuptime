import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import {
  fetchPodLogs,
  KubernetesLogEntry,
} from "../../Pages/Kubernetes/Utils/KubernetesObjectFetcher";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";

export interface ComponentProps {
  clusterIdentifier: string;
  podName: string;
  containerName?: string | undefined;
  namespace?: string | undefined;
}

const KubernetesLogsTab: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [logs, setLogs] = useState<Array<KubernetesLogEntry>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    const fetchLogs: () => Promise<void> = async (): Promise<void> => {
      setIsLoading(true);
      try {
        const result: Array<KubernetesLogEntry> = await fetchPodLogs({
          clusterIdentifier: props.clusterIdentifier,
          podName: props.podName,
          containerName: props.containerName,
          namespace: props.namespace,
          limit: 500,
        });
        setLogs(result);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to fetch logs",
        );
      }
      setIsLoading(false);
    };

    fetchLogs().catch(() => {});
  }, [
    props.clusterIdentifier,
    props.podName,
    props.containerName,
    props.namespace,
  ]);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (logs.length === 0) {
    return (
      <div className="text-gray-500 text-sm p-4">
        No application logs found for this pod in the last 6 hours. Logs will
        appear here once the kubernetes-agent&apos;s filelog receiver is collecting
        data.
      </div>
    );
  }

  const getSeverityColor: (severity: string) => string = (
    severity: string,
  ): string => {
    const s: string = severity.toUpperCase();
    if (s === "ERROR" || s === "FATAL" || s === "CRITICAL") {
      return "text-red-600";
    }
    if (s === "WARN" || s === "WARNING") {
      return "text-yellow-600";
    }
    if (s === "DEBUG" || s === "TRACE") {
      return "text-gray-400";
    }
    return "text-gray-700";
  };

  return (
    <div className="bg-gray-900 rounded-lg p-4 overflow-auto max-h-[600px] font-mono text-xs">
      {logs.map((log: KubernetesLogEntry, index: number) => {
        return (
          <div key={index} className="flex gap-2 py-0.5 hover:bg-gray-800">
            <span className="text-gray-500 whitespace-nowrap flex-shrink-0">
              {log.timestamp}
            </span>
            {log.containerName && (
              <span className="text-blue-400 whitespace-nowrap flex-shrink-0">
                [{log.containerName}]
              </span>
            )}
            <span
              className={`whitespace-nowrap flex-shrink-0 w-12 ${getSeverityColor(log.severity)}`}
            >
              {log.severity}
            </span>
            <span className="text-gray-200 whitespace-pre-wrap break-all">
              {log.body}
            </span>
          </div>
        );
      })}
    </div>
  );
};

export default KubernetesLogsTab;
