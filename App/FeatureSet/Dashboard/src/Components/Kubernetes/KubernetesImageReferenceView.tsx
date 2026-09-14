import React, { FunctionComponent, ReactElement } from "react";
import {
  ParsedKubernetesImageReference,
  parseKubernetesImageReference,
} from "../../Pages/Kubernetes/Utils/KubernetesImageReference";

export interface ComponentProps {
  reference: string;
}

const badgeClassName: string =
  "inline-flex min-w-0 max-w-full break-all whitespace-normal rounded bg-indigo-50 px-1.5 py-0.5 text-xs font-medium text-indigo-700";

const KubernetesImageReferenceView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const parsedReference: ParsedKubernetesImageReference =
    parseKubernetesImageReference(props.reference);

  return (
    <div
      className="flex min-w-0 max-w-full flex-wrap items-center gap-2 text-sm"
      data-testid="kubernetes-image-reference"
    >
      <span
        className="min-w-0 max-w-full break-all whitespace-normal font-mono text-gray-900"
        data-testid="kubernetes-image-reference-name"
      >
        {parsedReference.name}
      </span>
      {parsedReference.tag && (
        <span
          className={badgeClassName}
          data-testid="kubernetes-image-reference-tag"
        >
          {parsedReference.tag}
        </span>
      )}
      {parsedReference.digest && (
        <span
          className={badgeClassName}
          data-testid="kubernetes-image-reference-digest"
        >
          @{parsedReference.digest}
        </span>
      )}
    </div>
  );
};

export default KubernetesImageReferenceView;
