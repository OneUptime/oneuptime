import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  title: string;
  children: ReactElement;
}

const TinyFormDocumentation: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div className="mt-2 text-xs text-gray-500">
      <details className="cursor-pointer">
        <summary className="hover:text-gray-700">{props.title}</summary>
        <div className="mt-2 space-y-1">{props.children}</div>
      </details>
    </div>
  );
};

export default TinyFormDocumentation;
