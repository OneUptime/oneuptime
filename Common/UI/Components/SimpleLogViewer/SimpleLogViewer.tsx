import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  children: ReactElement | string | Array<ReactElement>;
  showLineNumbers?: boolean | undefined;
  height?: string | undefined;
}

const SimpleLogViewer: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const showLineNumbers: boolean = props.showLineNumbers !== false;
  const height: string = props.height || "400px";

  const renderContent: () => ReactElement = (): ReactElement => {
    if (typeof props.children === "string") {
      const lines: Array<string> = props.children.split("\n");
      return (
        <>
          {lines.map((line: string, index: number) => {
            return (
              <div
                key={index}
                className="flex hover:bg-slate-800/50 transition-colors"
              >
                {showLineNumbers && (
                  <span className="select-none text-slate-600 text-right pr-4 w-12 flex-shrink-0 border-r border-slate-800 mr-4">
                    {index + 1}
                  </span>
                )}
                <span className="text-slate-300 whitespace-pre-wrap break-all flex-1">
                  {line || " "}
                </span>
              </div>
            );
          })}
        </>
      );
    }

    if (Array.isArray(props.children)) {
      return (
        <>
          {props.children.map(
            (child: ReactElement, index: number): ReactElement => {
              return (
                <div
                  key={index}
                  className="flex hover:bg-slate-800/50 transition-colors"
                >
                  {showLineNumbers && (
                    <span className="select-none text-slate-600 text-right pr-4 w-12 flex-shrink-0 border-r border-slate-800 mr-4">
                      {index + 1}
                    </span>
                  )}
                  <span className="text-slate-300 whitespace-pre-wrap break-all flex-1">
                    {child}
                  </span>
                </div>
              );
            },
          )}
        </>
      );
    }

    return (
      <div className="text-slate-300 whitespace-pre-wrap break-all">
        {props.children}
      </div>
    );
  };

  return (
    <div className="rounded-lg overflow-hidden border border-slate-700 bg-slate-900 shadow-lg">
      {/* Log Content */}
      <div
        className="overflow-auto font-mono text-sm leading-6 p-4"
        style={{ maxHeight: height }}
      >
        {renderContent()}
      </div>
    </div>
  );
};

export default SimpleLogViewer;
