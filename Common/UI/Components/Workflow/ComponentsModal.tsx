// Show a large modal full of components.
import ErrorMessage from "../ErrorMessage/ErrorMessage";
import Icon from "../Icon/Icon";
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
  useRef,
  useState,
} from "react";

export interface ComponentProps {
  componentsType: ComponentType;
  onCloseModal: () => void;
  onComponentClick: (componentMetadata: ComponentMetadata) => void;
  components: Array<ComponentMetadata>;
  categories: Array<ComponentCategory>;
}

const escapeRegExp: (value: string) => string = (value: string): string => {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

const getSearchScore: (
  componentMetadata: ComponentMetadata,
  searchTerm: string,
) => number = (
  componentMetadata: ComponentMetadata,
  searchTerm: string,
): number => {
  const title: string = componentMetadata.title.toLowerCase();
  const description: string = componentMetadata.description.toLowerCase();
  const category: string = componentMetadata.category.toLowerCase();

  let score: number = 0;

  if (title.startsWith(searchTerm)) {
    score += 140;
  } else if (title.includes(searchTerm)) {
    score += 100;
  }

  if (category.startsWith(searchTerm)) {
    score += 75;
  } else if (category.includes(searchTerm)) {
    score += 55;
  }

  if (description.includes(searchTerm)) {
    score += 35;
  }

  if (
    title.split(" ").some((word: string) => {
      return word.trim().startsWith(searchTerm);
    })
  ) {
    score += 15;
  }

  return score;
};

const ComponentsModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [search, setSearch] = useState<string>("");
  const searchInputRef: React.RefObject<HTMLInputElement | null> =
    useRef<HTMLInputElement | null>(null);

  const [components, setComponents] = useState<Array<ComponentMetadata>>([]);
  const [categories, setCategories] = useState<Array<ComponentCategory>>([]);
  const [componentsToShow, setComponentsToShow] = useState<
    Array<ComponentMetadata>
  >([]);
  const [selectedComponentMetadata, setSelectedComponentMetadata] =
    useState<ComponentMetadata | null>(null);

  useEffect(() => {
    setComponents(props.components);
    setComponentsToShow([...props.components]);
    setCategories(props.categories);
  }, [props.categories, props.components]);

  useEffect(() => {
    const normalizedSearch: string = search.trim().toLowerCase();

    const filteredComponents: Array<ComponentMetadata> = components
      .filter((componentMetadata: ComponentMetadata) => {
        return componentMetadata.componentType === props.componentsType;
      })
      .filter((componentMetadata: ComponentMetadata) => {
        if (!normalizedSearch) {
          return true;
        }

        return (
          componentMetadata.title.toLowerCase().includes(normalizedSearch) ||
          componentMetadata.description
            .toLowerCase()
            .includes(normalizedSearch) ||
          componentMetadata.category.toLowerCase().includes(normalizedSearch)
        );
      })
      .sort((componentA: ComponentMetadata, componentB: ComponentMetadata) => {
        if (!normalizedSearch) {
          return componentA.title.localeCompare(componentB.title);
        }

        const scoreDifference: number =
          getSearchScore(componentB, normalizedSearch) -
          getSearchScore(componentA, normalizedSearch);

        if (scoreDifference !== 0) {
          return scoreDifference;
        }

        return componentA.title.localeCompare(componentB.title);
      });

    setComponentsToShow(filteredComponents);
  }, [components, props.componentsType, search]);

  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown: (event: KeyboardEvent) => void = (
      event: KeyboardEvent,
    ): void => {
      const target: HTMLElement | null = event.target as HTMLElement | null;

      const isTypingContext: boolean = Boolean(
        target &&
          (target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            target.getAttribute("contenteditable") === "true"),
      );

      if (
        event.key === "/" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !isTypingContext
      ) {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const hasSearchTerm: boolean = search.trim().length > 0;
  const normalizedSearch: string = search.trim().toLowerCase();
  const totalComponentCount: number = components.length;
  const componentTypeLabel: string = `${props.componentsType.toLowerCase()}${
    totalComponentCount === 1 ? "" : "s"
  }`;
  const suggestedCategories: Array<ComponentCategory> = categories
    .filter((category: ComponentCategory) => {
      return components.some((componentMetadata: ComponentMetadata) => {
        return componentMetadata.category === category.name;
      });
    })
    .slice(0, 4);

  const renderHighlightedText: (
    text: string,
    markClassName?: string,
  ) => React.ReactNode = (
    text: string,
    markClassName?: string,
  ): React.ReactNode => {
    if (!hasSearchTerm) {
      return text;
    }

    const highlightedParts: Array<string> = text.split(
      new RegExp(`(${escapeRegExp(search.trim())})`, "ig"),
    );

    return (
      <>
        {highlightedParts.map((part: string, index: number) => {
          if (part.toLowerCase() === normalizedSearch) {
            return (
              <mark
                key={`${part}-${index}`}
                className={
                  markClassName || "rounded bg-amber-100 px-0.5 text-current"
                }
              >
                {part}
              </mark>
            );
          }

          return (
            <React.Fragment key={`${part}-${index}`}>{part}</React.Fragment>
          );
        })}
      </>
    );
  };

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
          <div className="mt-4 mb-5">
            <div className="rounded-3xl border border-slate-200 bg-gradient-to-br from-white via-indigo-50 to-slate-50 p-3 shadow-sm">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <label
                    htmlFor="workflow-component-search"
                    className="block text-xs font-semibold uppercase tracking-wide text-slate-500"
                  >
                    Search {componentTypeLabel}
                  </label>
                  <p className="mt-1 text-sm text-slate-600">
                    {hasSearchTerm
                      ? "Showing the closest matches first across title, description, and category."
                      : `Find the right ${props.componentsType.toLowerCase()} by name, category, or the job you need it to do.`}
                  </p>
                </div>
                <div className="inline-flex flex-shrink-0 items-center rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-slate-500 ring-1 ring-slate-200">
                  {hasSearchTerm
                    ? `${componentsToShow.length} match${
                        componentsToShow.length === 1 ? "" : "es"
                      }`
                    : `${totalComponentCount} available`}
                </div>
              </div>

              <div className="relative flex items-center gap-3 rounded-2xl border border-slate-200 bg-white/90 px-3 py-3 shadow-sm transition-all duration-200 hover:border-slate-300 focus-within:border-indigo-500 focus-within:ring-4 focus-within:ring-indigo-100">
                <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-white via-indigo-50 to-sky-100 text-indigo-600 ring-1 ring-indigo-100 shadow-sm">
                  <Icon icon={IconProp.Search} className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <input
                    id="workflow-component-search"
                    ref={searchInputRef}
                    type="text"
                    value={search}
                    placeholder={`Search ${componentTypeLabel} by name, description, or category`}
                    autoComplete="off"
                    className="block w-full border-0 bg-transparent p-0 text-base font-semibold text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-0"
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                      setSearch(event.target.value);
                    }}
                    onKeyDown={(
                      event: React.KeyboardEvent<HTMLInputElement>,
                    ) => {
                      if (event.key === "Escape" && hasSearchTerm) {
                        setSearch("");
                        searchInputRef.current?.focus();
                      }
                    }}
                  />
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span>
                      {hasSearchTerm
                        ? `Showing ${componentsToShow.length} of ${totalComponentCount} ${componentTypeLabel}.`
                        : "Searches title, description, and category."}
                    </span>
                    {!hasSearchTerm && (
                      <span className="hidden items-center gap-1 rounded-full bg-slate-100 px-2 py-1 font-medium text-slate-500 sm:inline-flex">
                        <kbd className="rounded bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 ring-1 ring-slate-200">
                          /
                        </kbd>
                        Quick focus
                      </span>
                    )}
                    {hasSearchTerm && (
                      <span className="hidden items-center gap-1 rounded-full bg-indigo-50 px-2 py-1 font-medium text-indigo-600 sm:inline-flex">
                        <kbd className="rounded bg-white px-1.5 py-0.5 text-[10px] font-semibold text-indigo-600 ring-1 ring-indigo-100">
                          Esc
                        </kbd>
                        Clear search
                      </span>
                    )}
                  </div>
                </div>

                {hasSearchTerm && (
                  <div className="flex flex-shrink-0 items-center gap-2">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded-full bg-slate-900 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-colors duration-150 hover:bg-slate-700"
                      onClick={() => {
                        setSearch("");
                        searchInputRef.current?.focus();
                      }}
                    >
                      <Icon icon={IconProp.Close} className="h-3 w-3" />
                      Clear
                    </button>
                  </div>
                )}
              </div>

              {suggestedCategories.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-slate-500">
                    Quick filters:
                  </span>
                  {suggestedCategories.map((category: ComponentCategory) => {
                    const isActive: boolean =
                      normalizedSearch === category.name.toLowerCase();

                    return (
                      <button
                        key={category.name}
                        type="button"
                        onClick={() => {
                          setSearch(category.name);
                          searchInputRef.current?.focus();
                        }}
                        className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors duration-150 ${
                          isActive
                            ? "border-indigo-200 bg-indigo-50 text-indigo-700"
                            : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                        }`}
                      >
                        <Icon icon={category.icon} className="h-3 w-3" />
                        {category.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="overflow-y-auto overflow-x-hidden flex-1">
            {!componentsToShow ||
              (componentsToShow.length === 0 && (
                <div className="mt-20 flex w-full flex-col items-center justify-center gap-4 px-4">
                  <div className="max-w-2xl">
                    <ErrorMessage message="No components that match your search. If you are looking for an integration that does not exist currently - you can use Custom Code or API component to build anything you like." />
                  </div>
                  {hasSearchTerm && (
                    <button
                      type="button"
                      className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 shadow-sm transition-colors duration-150 hover:bg-slate-50 hover:text-slate-800"
                      onClick={() => {
                        setSearch("");
                        searchInputRef.current?.focus();
                      }}
                    >
                      <Icon icon={IconProp.Close} className="h-3.5 w-3.5" />
                      Reset search
                    </button>
                  )}
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
                                <div className="flex items-start justify-between gap-2">
                                  <p
                                    style={{
                                      fontSize: "0.8125rem",
                                      fontWeight: 600,
                                      color: isSelected ? "#4338ca" : "#1e293b",
                                      margin: 0,
                                      lineHeight: "1.25rem",
                                    }}
                                  >
                                    {renderHighlightedText(
                                      componentMetadata.title,
                                      isSelected
                                        ? "rounded bg-white/80 px-0.5 text-current"
                                        : "rounded bg-amber-100 px-0.5 text-current",
                                    )}
                                  </p>

                                  {hasSearchTerm && (
                                    <span
                                      className={`mt-0.5 inline-flex flex-shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                                        isSelected
                                          ? "bg-white/80 text-indigo-700"
                                          : "bg-slate-100 text-slate-500"
                                      }`}
                                    >
                                      {renderHighlightedText(
                                        componentMetadata.category,
                                        isSelected
                                          ? "rounded bg-indigo-100 px-0.5 text-current"
                                          : "rounded bg-white px-0.5 text-current",
                                      )}
                                    </span>
                                  )}
                                </div>
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
                                  {renderHighlightedText(
                                    componentMetadata.description,
                                    isSelected
                                      ? "rounded bg-white/80 px-0.5 text-current"
                                      : "rounded bg-amber-100 px-0.5 text-current",
                                  )}
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
