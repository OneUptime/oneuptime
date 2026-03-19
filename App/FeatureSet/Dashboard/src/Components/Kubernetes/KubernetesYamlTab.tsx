import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import Card from "Common/UI/Components/Card/Card";
import CodeEditor from "Common/UI/Components/CodeEditor/CodeEditor";
import CodeType from "Common/Types/Code/CodeType";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import {
  fetchLatestK8sObject,
  KubernetesObjectType,
} from "../../Pages/Kubernetes/Utils/KubernetesObjectFetcher";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";

export interface ComponentProps {
  clusterIdentifier: string;
  resourceType: string;
  resourceName: string;
  namespace?: string | undefined;
}

/**
 * Convert a JavaScript object to YAML string.
 */
function toYaml(obj: unknown, indent: number = 0): string {
  const prefix: string = "  ".repeat(indent);

  if (obj === null || obj === undefined) {
    return "null";
  }

  if (typeof obj === "string") {
    // Quote strings that contain special chars or look like numbers
    if (
      obj.includes(":") ||
      obj.includes("#") ||
      obj.includes("\n") ||
      obj.includes("'") ||
      obj.includes('"') ||
      obj === "" ||
      obj === "true" ||
      obj === "false" ||
      obj === "null" ||
      /^\d/.test(obj)
    ) {
      return `"${obj.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    }
    return obj;
  }

  if (typeof obj === "number" || typeof obj === "boolean") {
    return String(obj);
  }

  if (Array.isArray(obj)) {
    if (obj.length === 0) {
      return "[]";
    }
    const lines: Array<string> = [];
    for (const item of obj) {
      if (typeof item === "object" && item !== null && !Array.isArray(item)) {
        const entries: Array<[string, unknown]> = Object.entries(
          item as Record<string, unknown>,
        );
        if (entries.length > 0) {
          const [firstKey, firstVal] = entries[0]!;
          lines.push(
            `${prefix}- ${firstKey}: ${toYaml(firstVal, indent + 2)}`,
          );
          for (let i: number = 1; i < entries.length; i++) {
            const [key, val] = entries[i]!;
            lines.push(
              `${prefix}  ${key}: ${toYaml(val, indent + 2)}`,
            );
          }
        } else {
          lines.push(`${prefix}- {}`);
        }
      } else {
        lines.push(`${prefix}- ${toYaml(item, indent + 1)}`);
      }
    }
    return "\n" + lines.join("\n");
  }

  if (typeof obj === "object") {
    const record: Record<string, unknown> = obj as Record<string, unknown>;
    const keys: Array<string> = Object.keys(record);
    if (keys.length === 0) {
      return "{}";
    }
    const lines: Array<string> = [];
    for (const key of keys) {
      const val: unknown = record[key];
      if (
        val !== null &&
        val !== undefined &&
        typeof val === "object" &&
        !Array.isArray(val) &&
        Object.keys(val as Record<string, unknown>).length > 0
      ) {
        lines.push(`${prefix}${key}:`);
        lines.push(toYaml(val, indent + 1));
      } else if (Array.isArray(val) && val.length > 0) {
        lines.push(`${prefix}${key}:${toYaml(val, indent + 1)}`);
      } else {
        lines.push(`${prefix}${key}: ${toYaml(val, indent + 1)}`);
      }
    }
    return lines.join("\n");
  }

  return String(obj);
}

const KubernetesYamlTab: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [yamlContent, setYamlContent] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [copied, setCopied] = useState<boolean>(false);

  useEffect(() => {
    const fetchData: () => Promise<void> = async (): Promise<void> => {
      setIsLoading(true);
      setError("");
      try {
        const result: KubernetesObjectType | null =
          await fetchLatestK8sObject({
            clusterIdentifier: props.clusterIdentifier,
            resourceType: props.resourceType,
            resourceName: props.resourceName,
            namespace: props.namespace,
          });

        if (result) {
          const yaml: string = toYaml(result);
          setYamlContent(yaml);
        } else {
          setYamlContent("");
        }
      } catch {
        setError("Failed to fetch resource data.");
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, [
    props.clusterIdentifier,
    props.resourceType,
    props.resourceName,
    props.namespace,
  ]);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!yamlContent) {
    return (
      <ErrorMessage message="No resource spec data available. Ensure the kubernetes-agent has resourceSpecs.enabled set to true in the Helm values." />
    );
  }

  return (
    <Card
      title="Resource Specification"
      description="Full resource specification as collected by the kubernetes-agent."
      buttons={[
        {
          title: copied ? "Copied!" : "Copy",
          buttonStyle: ButtonStyleType.NORMAL,
          icon: IconProp.Copy,
          onClick: () => {
            navigator.clipboard.writeText(yamlContent);
            setCopied(true);
            setTimeout(() => {
              setCopied(false);
            }, 2000);
          },
        },
      ]}
    >
      <div className="-mt-2">
        <CodeEditor
          type={CodeType.YAML}
          value={yamlContent}
          readOnly={true}
          showLineNumbers={true}
        />
      </div>
    </Card>
  );
};

export default KubernetesYamlTab;
