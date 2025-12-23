import Button, { ButtonStyleType } from "../Button/Button";
import IconProp from "../../../Types/Icon/IconProp";
import ComponentMetadata, {
  ComponentCategory,
  ComponentType,
  NodeDataProp,
} from "../../../Types/Workflow/Component";
import WorkflowComponentsSidebar from "./WorkflowComponentsSidebar";
import React, { FunctionComponent, ReactElement } from "react";
import { Node } from "reactflow";

export interface ComponentProps {
  children: ReactElement;
  components: Array<ComponentMetadata>;
  categories: Array<ComponentCategory>;
  nodes: Array<Node>;
  saveStatus: string;
  onRunWorkflow: () => void;
  onAutoLayout: () => void;
  isAutoLayouting?: boolean;
}

const WorkflowBuilderLayout: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
) => {
  // Check if workflow has a real trigger (not placeholder)
  const hasTrigger: boolean = props.nodes.some((node: Node) => {
    const data: NodeDataProp = node.data as NodeDataProp;
    return (
      data.componentType === ComponentType.Trigger &&
      data.metadataId !== "" &&
      data.id !== ""
    );
  });

  return (
    <div className="flex h-[52rem] border border-gray-200 rounded-lg overflow-hidden bg-white shadow-sm">
      {/* Left Sidebar */}
      <WorkflowComponentsSidebar
        components={props.components}
        categories={props.categories}
        hasTrigger={hasTrigger}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col">
        {/* Toolbar */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50">
          <div className="flex items-center gap-4">
            <h2 className="text-sm font-medium text-gray-700">
              Workflow Canvas
            </h2>
            {props.saveStatus && (
              <span className="text-xs text-gray-400">{props.saveStatus}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              title="Auto Layout"
              icon={IconProp.TableCells}
              buttonStyle={ButtonStyleType.OUTLINE}
              onClick={props.onAutoLayout}
              disabled={props.isAutoLayouting}
            />
            <Button
              title="Run Workflow"
              icon={IconProp.Play}
              buttonStyle={ButtonStyleType.PRIMARY}
              onClick={props.onRunWorkflow}
            />
          </div>
        </div>

        {/* Canvas Area */}
        <div className="flex-1 relative">{props.children}</div>
      </div>
    </div>
  );
};

export default WorkflowBuilderLayout;
