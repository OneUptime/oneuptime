import React, {
  FunctionComponent,
  ReactElement,
  useMemo,
  useRef,
  useState,
} from "react";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Icon from "Common/UI/Components/Icon/Icon";
import useTranslateValue from "Common/UI/Utils/Translation";
import IconProp from "Common/Types/Icon/IconProp";
import DashboardComponentType from "Common/Types/Dashboard/DashboardComponentType";
import {
  WIDGET_CATALOG,
  WidgetCatalogCategory,
  WidgetCatalogItem,
  WidgetCategoryGroupSection,
  countWidgets,
  findCategoryByName,
  getFirstWidget,
  groupWidgetCategories,
  searchWidgetCatalog,
} from "./WidgetCatalog";

export interface ComponentProps {
  onAddComponentClick: (type: DashboardComponentType) => void;
  onClose: () => void;
}

const AddWidgetModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [selectedCategoryName, setSelectedCategoryName] = useState<
    string | null
  >(null);
  const searchInputRef: React.RefObject<HTMLInputElement> =
    useRef<HTMLInputElement>(null);

  const isSearching: boolean = searchTerm.trim().length > 0;

  // Everything the current search matches. Drives both panes.
  const matchingCatalog: Array<WidgetCatalogCategory> = useMemo(() => {
    return searchWidgetCatalog(searchTerm, WIDGET_CATALOG);
  }, [searchTerm]);

  const totalMatches: number = countWidgets(matchingCatalog);

  /*
   * A search can filter away the category the rail has selected. Rather than
   * showing an empty pane next to a list of live results, fall back to showing
   * every match — the rail selection is picked back up as soon as the search
   * matches it again.
   */
  const selectedCategory: WidgetCatalogCategory | null = findCategoryByName(
    matchingCatalog,
    selectedCategoryName,
  );

  const visibleCategories: Array<WidgetCatalogCategory> = selectedCategory
    ? [selectedCategory]
    : matchingCatalog;

  const railSections: Array<WidgetCategoryGroupSection> = useMemo(() => {
    return groupWidgetCategories(matchingCatalog);
  }, [matchingCatalog]);

  type AddWidgetFunction = (type: DashboardComponentType) => void;

  const addWidget: AddWidgetFunction = (type: DashboardComponentType): void => {
    props.onAddComponentClick(type);
    props.onClose();
  };

  type SearchKeyDownFunction = (
    event: React.KeyboardEvent<HTMLInputElement>,
  ) => void;

  /*
   * Command-palette behaviour: type a few characters, hit Enter, get the top
   * match. Only while searching, so Enter can never add a widget by accident
   * on an untouched picker.
   */
  const onSearchKeyDown: SearchKeyDownFunction = (
    event: React.KeyboardEvent<HTMLInputElement>,
  ): void => {
    if (event.key !== "Enter" || !isSearching) {
      return;
    }

    const firstWidget: WidgetCatalogItem | null =
      getFirstWidget(visibleCategories);

    if (!firstWidget) {
      return;
    }

    event.preventDefault();
    addWidget(firstWidget.type);
  };

  type ClearSearchFunction = () => void;

  const clearSearch: ClearSearchFunction = (): void => {
    setSearchTerm("");
    searchInputRef.current?.focus();
  };

  type RenderRailButtonFunction = (options: {
    key: string;
    label: string;
    icon: IconProp;
    count: number;
    isSelected: boolean;
    onClick: () => void;
    testId: string;
  }) => ReactElement;

  const renderRailButton: RenderRailButtonFunction = (options: {
    key: string;
    label: string;
    icon: IconProp;
    count: number;
    isSelected: boolean;
    onClick: () => void;
    testId: string;
  }): ReactElement => {
    return (
      <button
        key={options.key}
        type="button"
        data-testid={options.testId}
        aria-pressed={options.isSelected}
        onClick={options.onClick}
        className={`flex shrink-0 items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors focus:outline-none focus:ring-1 focus:ring-indigo-300 md:w-full ${
          options.isSelected
            ? "bg-indigo-50 font-medium text-indigo-700"
            : "text-gray-600 hover:bg-gray-100"
        }`}
      >
        <Icon
          icon={options.icon}
          className={`h-4 w-4 shrink-0 ${
            options.isSelected ? "text-indigo-500" : "text-gray-400"
          }`}
        />
        <span className="flex-1 truncate">
          {translateString(options.label)}
        </span>
        <span
          className={`ml-1 shrink-0 text-xs tabular-nums ${
            options.isSelected ? "text-indigo-400" : "text-gray-400"
          }`}
        >
          {options.count}
        </span>
      </button>
    );
  };

  return (
    <Modal
      title="Add Widget"
      description="Pick a widget to add to your dashboard."
      modalWidth={ModalWidth.Large}
      onClose={props.onClose}
      closeButtonText="Cancel"
    >
      <div className="flex flex-col gap-4">
        {/* Search bar */}
        <div className="relative">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
            <Icon icon={IconProp.Search} className="h-4 w-4 text-gray-400" />
          </div>
          <input
            ref={searchInputRef}
            type="text"
            value={searchTerm}
            aria-label="Search widgets"
            data-testid="add-widget-search"
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              setSearchTerm(e.target.value);
            }}
            onKeyDown={onSearchKeyDown}
            placeholder="Search widgets by name, e.g. chart, logs, pods..."
            className="block w-full rounded-md border border-gray-200 bg-white py-2 pl-9 pr-9 text-sm text-gray-700 placeholder-gray-400 focus:border-indigo-300 focus:outline-none focus:ring-1 focus:ring-indigo-300"
            autoFocus={true}
          />
          {isSearching && (
            <button
              type="button"
              aria-label="Clear search"
              data-testid="add-widget-search-clear"
              onClick={clearSearch}
              className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600 focus:outline-none"
            >
              <Icon icon={IconProp.Close} className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex flex-col gap-4 md:flex-row md:gap-5">
          {/* Category rail. Horizontal chips on small screens, a vertical
              list with group headings from md up. Hidden entirely when a
              search matched nothing — there is nothing to navigate to. */}
          <nav
            aria-label="Widget categories"
            className={`shrink-0 flex-row gap-1 overflow-x-auto pb-1 md:max-h-[60vh] md:w-52 md:flex-col md:overflow-x-visible md:overflow-y-auto md:pb-0 md:pr-1 ${
              totalMatches === 0 ? "hidden" : "flex"
            }`}
          >
            {renderRailButton({
              key: "all",
              testId: "widget-category-all",
              label: "All widgets",
              icon: IconProp.Squares,
              count: totalMatches,
              isSelected: selectedCategory === null,
              onClick: () => {
                setSelectedCategoryName(null);
              },
            })}

            {railSections.map((section: WidgetCategoryGroupSection) => {
              return (
                <div key={section.group} className="contents md:block">
                  <h5 className="mt-4 hidden px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400 md:block">
                    {translateString(section.group)}
                  </h5>
                  {section.categories.map((category: WidgetCatalogCategory) => {
                    return renderRailButton({
                      key: category.name,
                      testId: `widget-category-${category.name}`,
                      label: category.name,
                      icon: category.icon,
                      count: category.items.length,
                      isSelected: selectedCategoryName === category.name,
                      onClick: () => {
                        setSelectedCategoryName(category.name);
                      },
                    });
                  })}
                </div>
              );
            })}
          </nav>

          {/* Widget grid — its own scroll container so the modal footer
              (close button) is always reachable. */}
          <div className="min-w-0 flex-1 space-y-6 overflow-y-auto md:max-h-[60vh] md:pr-1">
            {isSearching && totalMatches > 0 && (
              <p
                aria-live="polite"
                data-testid="add-widget-result-count"
                className="text-xs text-gray-400"
              >
                {totalMatches}{" "}
                {totalMatches === 1 ? "widget matches" : "widgets match"}
                &nbsp;&ldquo;{searchTerm.trim()}&rdquo;. Press Enter to add the
                first one.
              </p>
            )}

            {totalMatches === 0 && (
              <div
                data-testid="add-widget-empty"
                className="flex flex-col items-center justify-center py-12 text-center text-gray-400"
              >
                <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-gray-50">
                  <Icon
                    icon={IconProp.Search}
                    className="h-5 w-5 text-gray-300"
                  />
                </div>
                <p className="text-sm">
                  No widgets match &ldquo;{searchTerm.trim()}&rdquo;.
                </p>
                <button
                  type="button"
                  data-testid="add-widget-empty-clear"
                  onClick={clearSearch}
                  className="mt-3 rounded-md px-2 py-1 text-sm font-medium text-indigo-600 hover:bg-indigo-50 focus:outline-none focus:ring-1 focus:ring-indigo-300"
                >
                  Clear search
                </button>
              </div>
            )}

            {visibleCategories.map((category: WidgetCatalogCategory) => {
              return (
                <section key={category.name}>
                  <div className="mb-2 flex items-start gap-2">
                    <Icon
                      icon={category.icon}
                      className="mt-0.5 h-4 w-4 shrink-0 text-gray-400"
                    />
                    <div className="min-w-0">
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                        {translateString(category.name)}
                      </h4>
                      <p className="mt-0.5 text-xs text-gray-400">
                        {translateString(category.description)}
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {category.items.map((item: WidgetCatalogItem) => {
                      return (
                        <button
                          key={item.type}
                          type="button"
                          data-testid={`widget-card-${item.type}`}
                          title={translateString(item.description)}
                          onClick={() => {
                            addWidget(item.type);
                          }}
                          className="group relative flex items-start gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-left transition-colors hover:border-indigo-300 hover:bg-indigo-50/30 focus:outline-none focus:ring-1 focus:ring-indigo-300"
                        >
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-gray-50 text-gray-500 transition-colors group-hover:bg-indigo-50 group-hover:text-indigo-500">
                            <Icon icon={item.icon} className="h-4 w-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium text-gray-800">
                              {translateString(item.label)}
                            </div>
                            <div className="mt-0.5 line-clamp-2 text-xs text-gray-500">
                              {translateString(item.description)}
                            </div>
                          </div>
                          <Icon
                            icon={IconProp.Add}
                            className="mt-0.5 h-4 w-4 shrink-0 text-indigo-400 opacity-0 transition-opacity group-hover:opacity-100"
                          />
                        </button>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default AddWidgetModal;
