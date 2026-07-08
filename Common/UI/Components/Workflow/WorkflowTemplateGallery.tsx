import Icon from "../Icon/Icon";
import { WorkflowTemplate } from "./WorkflowTemplates";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The blank-canvas cold start: instead of an empty graph with a lone
 * placeholder trigger, offer a few pre-wired starter workflows. Selecting one
 * drops a ready graph the author just fills in; "Start from scratch" dismisses
 * the gallery.
 */

export interface ComponentProps {
  templates: Array<WorkflowTemplate>;
  onSelect: (template: WorkflowTemplate) => void;
  onDismiss: () => void;
}

const WorkflowTemplateGallery: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 6,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(248, 250, 252, 0.85)",
        padding: "1.5rem",
      }}
    >
      <div className="w-full max-w-2xl rounded-xl border border-gray-200 bg-white p-6 shadow-lg">
        <h2 className="text-base font-semibold text-gray-900">
          Start with a template
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          Pick a starting point and fill in the details, or start from an empty
          canvas.
        </p>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {props.templates.map((template: WorkflowTemplate) => {
            return (
              <button
                key={template.id}
                type="button"
                className="flex items-start gap-3 rounded-lg border border-gray-200 p-3 text-left hover:border-indigo-300 hover:bg-indigo-50/40 cursor-pointer"
                onClick={() => {
                  props.onSelect(template);
                }}
              >
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-indigo-50 text-indigo-500">
                  <Icon icon={template.icon} className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-gray-900">
                    {template.name}
                  </span>
                  <span className="block text-xs text-gray-500">
                    {template.description}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-5 flex justify-end">
          <button
            type="button"
            className="text-sm font-medium text-gray-500 hover:text-gray-700 cursor-pointer"
            onClick={() => {
              props.onDismiss();
            }}
          >
            Start from scratch
          </button>
        </div>
      </div>
    </div>
  );
};

export default WorkflowTemplateGallery;
