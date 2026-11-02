import React, { FunctionComponent, ReactElement } from "react";

/*
 * A plain label selector, as a Service or a DeploymentConfig writes it: which
 * pods it picks, one key=value each.
 */

export interface ComponentProps {
  selector: Record<string, string>;
}

const KubernetesLabelSelector: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const keys: Array<string> = Object.keys(props.selector).sort();

  if (keys.length === 0) {
    return <span>—</span>;
  }

  return (
    <div className="flex flex-wrap gap-1">
      {keys.map((key: string): ReactElement => {
        return (
          <span
            key={key}
            dir="ltr"
            className="inline-flex max-w-full break-all rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-700"
          >
            {`${key}=${props.selector[key]}`}
          </span>
        );
      })}
    </div>
  );
};

export default KubernetesLabelSelector;
