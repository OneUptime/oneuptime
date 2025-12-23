import Icon from "../Icon/Icon";
import Input from "../Input/Input";
import IconProp from "../../../Types/Icon/IconProp";
import ComponentMetadata, {
  ComponentCategory,
  ComponentType,
} from "../../../Types/Workflow/Component";
import ComponentCategorySection from "./ComponentCategorySection";
import React, { FunctionComponent, useEffect, useState } from "react";

export interface ComponentProps {
  components: Array<ComponentMetadata>;
  categories: Array<ComponentCategory>;
  onTriggerSelect?: (component: ComponentMetadata) => void;
  hasTrigger: boolean;
}

const WorkflowComponentsSidebar: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
) => {
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);
  const [filteredComponents, setFilteredComponents] = useState<
    Array<ComponentMetadata>
  >([]);

  // Separate triggers and components
  const triggers: Array<ComponentMetadata> = props.components.filter(
    (c: ComponentMetadata) => {
      return c.componentType === ComponentType.Trigger;
    },
  );
  const components: Array<ComponentMetadata> = props.components.filter(
    (c: ComponentMetadata) => {
      return c.componentType === ComponentType.Component;
    },
  );

  useEffect(() => {
    if (!searchTerm.trim()) {
      setFilteredComponents(props.components);
      return;
    }

    const searchLower: string = searchTerm.toLowerCase().trim();
    const filtered: Array<ComponentMetadata> = props.components.filter(
      (component: ComponentMetadata) => {
        return (
          component.title.toLowerCase().includes(searchLower) ||
          component.description.toLowerCase().includes(searchLower) ||
          component.category.toLowerCase().includes(searchLower)
        );
      },
    );
    setFilteredComponents(filtered);
  }, [searchTerm, props.components]);

  // Get filtered components by type
  const getFilteredByType = (
    type: ComponentType,
  ): Array<ComponentMetadata> => {
    return filteredComponents.filter((c: ComponentMetadata) => {
      return c.componentType === type;
    });
  };

  // Get components for a specific category
  const getComponentsForCategory = (
    categoryName: string,
    type: ComponentType,
  ): Array<ComponentMetadata> => {
    return getFilteredByType(type).filter((c: ComponentMetadata) => {
      return c.category === categoryName;
    });
  };

  // Get unique categories that have components
  const getCategoriesWithComponents = (
    type: ComponentType,
  ): Array<ComponentCategory> => {
    const componentsOfType: Array<ComponentMetadata> = getFilteredByType(type);
    const categoryNames: Set<string> = new Set(
      componentsOfType.map((c: ComponentMetadata) => {
        return c.category;
      }),
    );
    return props.categories.filter((cat: ComponentCategory) => {
      return categoryNames.has(cat.name);
    });
  };

  if (isCollapsed) {
    return (
      <div className="w-12 bg-gray-50 border-r border-gray-200 flex flex-col items-center py-4">
        <button
          onClick={() => {
            setIsCollapsed(false);
          }}
          className="p-2 rounded-md hover:bg-gray-200 transition-colors"
          title="Expand sidebar"
        >
          <Icon icon={IconProp.ChevronRight} className="w-5 h-5 text-gray-600" />
        </button>
        <div className="mt-4 flex flex-col gap-2">
          <div
            className="p-2 rounded-md bg-gray-200"
            title="Drag components from sidebar"
          >
            <Icon icon={IconProp.Cube} className="w-5 h-5 text-gray-600" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-72 bg-gray-50 border-r border-gray-200 flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-800">Components</h3>
          <button
            onClick={() => {
              setIsCollapsed(true);
            }}
            className="p-1 rounded hover:bg-gray-200 transition-colors"
            title="Collapse sidebar"
          >
            <Icon icon={IconProp.ChevronLeft} className="w-4 h-4 text-gray-500" />
          </button>
        </div>
        <Input
          placeholder="Search components..."
          value={searchTerm}
          onChange={(value: string) => {
            setSearchTerm(value);
          }}
        />
      </div>

      {/* Drag hint */}
      <div className="px-4 py-2 bg-indigo-50 border-b border-indigo-100">
        <p className="text-xs text-indigo-600 flex items-center gap-1">
          <Icon icon={IconProp.Info} className="w-3 h-3" />
          Drag components onto the canvas
        </p>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto p-4">
        {/* Triggers section - only show if no trigger exists */}
        {!props.hasTrigger && triggers.length > 0 && (
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <Icon icon={IconProp.Bolt} className="w-4 h-4 text-amber-500" />
              <h4 className="text-sm font-medium text-gray-700">
                Triggers
              </h4>
              <span className="text-xs text-gray-400">
                (Start your workflow)
              </span>
            </div>
            {getCategoriesWithComponents(ComponentType.Trigger).length > 0 ? (
              getCategoriesWithComponents(ComponentType.Trigger).map(
                (category: ComponentCategory, index: number) => {
                  return (
                    <ComponentCategorySection
                      key={index}
                      category={category}
                      components={getComponentsForCategory(
                        category.name,
                        ComponentType.Trigger,
                      )}
                      defaultExpanded={true}
                    />
                  );
                },
              )
            ) : (
              <p className="text-sm text-gray-400 text-center py-4">
                No triggers found
              </p>
            )}
          </div>
        )}

        {/* Components section */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Icon icon={IconProp.Cube} className="w-4 h-4 text-indigo-500" />
            <h4 className="text-sm font-medium text-gray-700">
              Actions
            </h4>
          </div>
          {getCategoriesWithComponents(ComponentType.Component).length > 0 ? (
            getCategoriesWithComponents(ComponentType.Component).map(
              (category: ComponentCategory, index: number) => {
                return (
                  <ComponentCategorySection
                    key={index}
                    category={category}
                    components={getComponentsForCategory(
                      category.name,
                      ComponentType.Component,
                    )}
                    defaultExpanded={index < 3}
                  />
                );
              },
            )
          ) : (
            <p className="text-sm text-gray-400 text-center py-4">
              No components match your search
            </p>
          )}
        </div>
      </div>

      {/* Footer with count */}
      <div className="p-3 border-t border-gray-200 bg-gray-100">
        <p className="text-xs text-gray-500 text-center">
          {components.length} components available
        </p>
      </div>
    </div>
  );
};

export default WorkflowComponentsSidebar;
