import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import Card from "Common/UI/Components/Card/Card";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { fetchRawK8sObject } from "../../Pages/Kubernetes/Utils/KubernetesObjectFetcher";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
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
          lines.push(`${prefix}- ${firstKey}: ${toYaml(firstVal, indent + 2)}`);
          for (let i: number = 1; i < entries.length; i++) {
            const [key, val] = entries[i]!;
            lines.push(`${prefix}  ${key}: ${toYaml(val, indent + 2)}`);
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
        const result: Record<string, unknown> | null = await fetchRawK8sObject({
          clusterIdentifier: props.clusterIdentifier,
          resourceType: props.resourceType,
          resourceName: props.resourceName,
          namespace: props.namespace,
        });

        if (result && Object.keys(result).length > 0) {
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

  const lines: Array<string> = yamlContent.split("\n");

  /**
   * Simple YAML syntax highlighter.
   * Returns an array of React elements with colored spans for keys, values, etc.
   */
  const highlightYamlLine: (line: string) => ReactElement = (
    line: string,
  ): ReactElement => {
    // Empty or whitespace-only line
    if (line.trim() === "") {
      return <span>{line}</span>;
    }

    // Comment lines
    if (line.trimStart().startsWith("#")) {
      return <span className="text-gray-400 italic">{line}</span>;
    }

    // Array item prefix "  - "
    const arrayMatch: RegExpMatchArray | null = line.match(/^(\s*)(- )(.*)$/);
    if (arrayMatch) {
      const [, indent, dash, rest] = arrayMatch;
      // Check if rest has a key: value pattern
      const kvMatch: RegExpMatchArray | null = (rest || "").match(
        /^([^:]+):\s*(.*)$/,
      );
      if (kvMatch) {
        const [, key, val] = kvMatch;
        return (
          <span>
            {indent}
            <span className="text-gray-500">{dash}</span>
            <span className="text-indigo-700 font-medium">{key}</span>
            <span className="text-gray-500">: </span>
            <span className="text-emerald-700">{val}</span>
          </span>
        );
      }
      return (
        <span>
          {indent}
          <span className="text-gray-500">{dash}</span>
          <span className="text-emerald-700">{rest}</span>
        </span>
      );
    }

    // Key: value lines
    const kvLineMatch: RegExpMatchArray | null = line.match(
      /^(\s*)([^:]+):\s*(.+)$/,
    );
    if (kvLineMatch) {
      const [, indent, key, val] = kvLineMatch;
      return (
        <span>
          {indent}
          <span className="text-indigo-700 font-medium">{key}</span>
          <span className="text-gray-500">: </span>
          <span className="text-emerald-700">{val}</span>
        </span>
      );
    }

    // Key-only lines (e.g., "metadata:")
    const keyOnlyMatch: RegExpMatchArray | null =
      line.match(/^(\s*)([^:]+):(\s*)$/);
    if (keyOnlyMatch) {
      const [, indent, key] = keyOnlyMatch;
      return (
        <span>
          {indent}
          <span className="text-indigo-700 font-medium">{key}</span>
          <span className="text-gray-500">:</span>
        </span>
      );
    }

    // Fallback
    return <span className="text-gray-800">{line}</span>;
  };

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
      <div className="overflow-auto max-h-[600px] bg-gray-50 rounded-lg border border-gray-200">
        <table className="w-full">
          <tbody>
            {lines.map((line: string, index: number) => {
              return (
                <tr key={index} className="hover:bg-gray-100/50">
                  <td className="px-4 py-0 text-right text-xs text-gray-400 select-none w-12 align-top font-mono border-r border-gray-200">
                    {index + 1}
                  </td>
                  <td className="px-4 py-0 text-sm font-mono whitespace-pre">
                    {highlightYamlLine(line)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
};

export default KubernetesYamlTab;
