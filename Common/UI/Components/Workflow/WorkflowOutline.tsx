import Icon from "../Icon/Icon";
import {
  OutlineEntry,
  WorkflowOutline as OutlineData,
  buildOutline,
} from "./GraphUtils";
import IconProp from "../../../Types/Icon/IconProp";
import { Edge, Node } from "reactflow";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A read-only, plain-English "read back what this workflow does" panel. It
 * never edits the graph — it only renders the outline produced by
 * buildOutline(nodes, edges).
 */

export interface ComponentProps {
  nodes: Array<Node>;
  edges: Array<Edge>;
  onClose: () => void;
}

const WorkflowOutline: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const outline: OutlineData = buildOutline(props.nodes, props.edges);

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Outline</h2>
          <p className="text-xs text-gray-500">
            What this workflow does, in order.
          </p>
        </div>
        <button
          type="button"
          aria-label="Close outline"
          onClick={props.onClose}
          className="shrink-0 rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 cursor-pointer"
        >
          <Icon icon={IconProp.Close} className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {!outline.hasTrigger ? (
          <p className="text-sm text-gray-500">
            Add a trigger to see what this workflow does.
          </p>
        ) : (
          <ol className="space-y-2">
            {outline.entries.map((entry: OutlineEntry, index: number) => {
              return (
                <li
                  key={`${entry.nodeId}-${index}`}
                  style={{ marginLeft: `${entry.depth}rem` }}
                  className="text-sm"
                >
                  {entry.branchLabel && (
                    <span className="mr-1.5 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-500">
                      {entry.branchLabel}
                    </span>
                  )}
                  <span className="font-medium text-gray-900">
                    {entry.title}
                  </span>
                  {entry.repeated ? (
                    <span className="ml-1 text-xs text-gray-400">
                      (runs again here)
                    </span>
                  ) : (
                    entry.summary && (
                      <span className="ml-1 text-gray-500">
                        — {entry.summary}
                      </span>
                    )
                  )}
                </li>
              );
            })}
          </ol>
        )}

        {outline.hasMultiplePaths && (
          <p className="mt-4 text-xs text-gray-400">
            Some steps run from more than one path — the canvas shows the full
            shape.
          </p>
        )}
      </div>
    </div>
  );
};

export default WorkflowOutline;
