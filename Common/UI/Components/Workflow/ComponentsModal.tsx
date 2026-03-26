// Show a large modal full of components.
import ErrorMessage from "../ErrorMessage/ErrorMessage";
import Icon from "../Icon/Icon";
import Input from "../Input/Input";
import SideOver from "../SideOver/SideOver";
import IconProp from "../../../Types/Icon/IconProp";
import ComponentMetadata, {
  ComponentCategory,
  ComponentType,
} from "../../../Types/Workflow/Component";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

export interface ComponentProps {
  componentsType: ComponentType;
  onCloseModal: () => void;
  onComponentClick: (componentMetadata: ComponentMetadata) => void;
  components: Array<ComponentMetadata>;
  categories: Array<ComponentCategory>;
}

const ComponentsModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [search, setSearch] = useState<string>("");

  const [components, setComponents] = useState<Array<ComponentMetadata>>([]);
  const [categories, setCategories] = useState<Array<ComponentCategory>>([]);

  const [componentsToShow, setComponentsToShow] = useState<
    Array<ComponentMetadata>
  >([]);

  const [isSearching, setIsSearching] = useState<boolean>(false);

  const [selectedComponentMetadata, setSelectedComponentMetadata] =
    useState<ComponentMetadata | null>(null);

  useEffect(() => {
    setComponents(props.components);
    setComponentsToShow([...props.components]);
    setCategories(props.categories);
  }, []);

  useEffect(() => {
    if (!isSearching) {
      return;
    }
    if (!search) {
      setComponentsToShow([
        ...components.filter((componentMetadata: ComponentMetadata) => {
          return componentMetadata.componentType === props.componentsType;
        }),
      ]);
    }

    setComponentsToShow([
      ...components.filter((componentMetadata: ComponentMetadata) => {
        return (
          componentMetadata.componentType === props.componentsType &&
          (componentMetadata.title
            .toLowerCase()
            .includes(search.trim().toLowerCase()) ||
            componentMetadata.description
              .toLowerCase()
              .includes(search.trim().toLowerCase()) ||
            componentMetadata.category
              .toLowerCase()
              .includes(search.trim().toLowerCase()))
        );
      }),
    ]);
  }, [search]);

  return (
    <SideOver
      submitButtonText="Add to Workflow"
      title={`Add ${props.componentsType}`}
      description={`Choose a ${props.componentsType.toLowerCase()} to add to your workflow.`}
      onClose={props.onCloseModal}
      submitButtonDisabled={!selectedComponentMetadata}
      onSubmit={() => {
        return (
          selectedComponentMetadata &&
          props.onComponentClick(selectedComponentMetadata)
        );
      }}
    >
      <>
        <div className="flex flex-col h-full">
          {/* Search box */}
          <div className="mt-4 mb-4">
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Icon
                  icon={IconProp.Search}
                  className="h-4 w-4 text-gray-400"
                />
              </div>
              <div className="pl-9">
                <Input
                  placeholder={`Search ${props.componentsType.toLowerCase()}s...`}
                  onChange={(text: string) => {
                    setIsSearching(true);
                    setSearch(text);
                  }}
                />
              </div>
            </div>
          </div>

          <div className="overflow-y-auto overflow-x-hidden flex-1">
            {!componentsToShow ||
              (componentsToShow.length === 0 && (
                <div className="w-full flex justify-center mt-20 px-4">
                  <ErrorMessage message="No components that match your search. If you are looking for an integration that does not exist currently - you can use Custom Code or API component to build anything you like." />
                </div>
              ))}

            {categories &&
              categories.length > 0 &&
              categories.map((category: ComponentCategory, i: number) => {
                const categoryComponents: Array<ComponentMetadata> =
                  componentsToShow.filter(
                    (componentMetadata: ComponentMetadata) => {
                      return componentMetadata.category === category.name;
                    },
                  );

                if (categoryComponents.length === 0) {
                  return <div key={i}></div>;
                }

                return (
                  <div key={i} className="mb-6">
                    {/* Category header */}
                    <div className="flex items-center gap-2 mb-3 px-1">
                      <div
                        className="flex items-center justify-center rounded-md"
                        style={{
                          width: "28px",
                          height: "28px",
                          backgroundColor: "#f1f5f9",
                        }}
                      >
                        <Icon
                          icon={category.icon}
                          className="h-4 w-4 text-gray-500"
                        />
                      </div>
                      <div>
                        <h4 className="text-sm font-semibold text-gray-700 leading-tight">
                          {category.name}
                        </h4>
                        <p className="text-xs text-gray-400 leading-tight">
                          {category.description}
                        </p>
                      </div>
                    </div>

                    {/* Component cards grid */}
                    <div className="grid grid-cols-1 gap-2">
                      {categoryComponents.map(
                        (componentMetadata: ComponentMetadata, j: number) => {
                          const isSelected: boolean =
                            selectedComponentMetadata !== null &&
                            selectedComponentMetadata.id ===
                              componentMetadata.id;

                          return (
                            <div
                              key={j}
                              onClick={() => {
                                setSelectedComponentMetadata(componentMetadata);
                              }}
                              className="cursor-pointer transition-all duration-150"
                              style={{
                                padding: "0.75rem",
                                borderRadius: "10px",
                                border: isSelected
                                  ? "2px solid #6366f1"
                                  : "1px solid #e2e8f0",
                                backgroundColor: isSelected
                                  ? "#eef2ff"
                                  : "#ffffff",
                                display: "flex",
                                alignItems: "flex-start",
                                gap: "0.75rem",
                                boxShadow: isSelected
                                  ? "0 0 0 3px rgba(99, 102, 241, 0.1)"
                                  : "0 1px 2px 0 rgba(0, 0, 0, 0.03)",
                              }}
                            >
                              {/* Icon */}
                              <div
                                style={{
                                  width: "36px",
                                  height: "36px",
                                  borderRadius: "8px",
                                  backgroundColor: isSelected
                                    ? "#6366f1"
                                    : "#f1f5f9",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  flexShrink: 0,
                                  transition: "all 0.15s ease",
                                }}
                              >
                                <Icon
                                  icon={componentMetadata.iconProp}
                                  style={{
                                    color: isSelected ? "#ffffff" : "#64748b",
                                    width: "1rem",
                                    height: "1rem",
                                  }}
                                />
                              </div>

                              {/* Text */}
                              <div style={{ minWidth: 0, flex: 1 }}>
                                <p
                                  style={{
                                    fontSize: "0.8125rem",
                                    fontWeight: 600,
                                    color: isSelected ? "#4338ca" : "#1e293b",
                                    margin: 0,
                                    lineHeight: "1.25rem",
                                  }}
                                >
                                  {componentMetadata.title}
                                </p>
                                <p
                                  style={{
                                    fontSize: "0.75rem",
                                    color: isSelected ? "#6366f1" : "#94a3b8",
                                    margin: 0,
                                    marginTop: "2px",
                                    lineHeight: "1rem",
                                    display: "-webkit-box",
                                    WebkitLineClamp: 2,
                                    WebkitBoxOrient: "vertical",
                                    overflow: "hidden",
                                  }}
                                >
                                  {componentMetadata.description}
                                </p>
                              </div>

                              {/* Selection indicator */}
                              {isSelected && (
                                <div
                                  style={{
                                    width: "20px",
                                    height: "20px",
                                    borderRadius: "50%",
                                    backgroundColor: "#6366f1",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    flexShrink: 0,
                                    marginTop: "2px",
                                  }}
                                >
                                  <Icon
                                    icon={IconProp.Check}
                                    style={{
                                      color: "#ffffff",
                                      width: "0.625rem",
                                      height: "0.625rem",
                                    }}
                                  />
                                </div>
                              )}
                            </div>
                          );
                        },
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      </>
    </SideOver>
  );
};

export default ComponentsModal;
