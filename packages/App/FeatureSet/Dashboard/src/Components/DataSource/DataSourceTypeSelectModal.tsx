import DataSourceType, {
  DataSourceTypeCategories,
  DataSourceTypeCategory,
  DataSourceTypeProps,
  DataSourceTypeUtil,
} from "Common/Types/DataSource/DataSourceType";
import Icon, { SizeProp } from "Common/UI/Components/Icon/Icon";
import Input from "Common/UI/Components/Input/Input";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import React, { FunctionComponent, ReactElement, useState } from "react";
import DataSourceTypeUIUtil from "../../Utils/DataSourceType";

export interface ComponentProps {
  onSelect: (dataSourceType: DataSourceType) => void;
  onClose: () => void;
}

interface TypeGroup {
  title: string;
  types: Array<DataSourceType>;
}

const DataSourceTypeSelectModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [searchText, setSearchText] = useState<string>("");

  const search: string = searchText.trim().toLowerCase();

  const matchesSearch: (dataSourceType: DataSourceType) => boolean = (
    dataSourceType: DataSourceType,
  ): boolean => {
    if (!search) {
      return true;
    }

    const typeProps: DataSourceTypeProps =
      DataSourceTypeUtil.getProps(dataSourceType);

    return [
      dataSourceType as string,
      typeProps.title,
      typeProps.description,
      typeProps.category as string,
      typeProps.queryLanguageTitle,
    ].some((value: string) => {
      return value.toLowerCase().includes(search);
    });
  };

  const matchingTypes: Array<DataSourceType> =
    DataSourceTypeUtil.getAllDataSourceTypes().filter(matchesSearch);

  /*
   * Grouped by category so the picker stays readable as connectors are
   * added. A category with no matches renders nothing.
   */
  const groups: Array<TypeGroup> = DataSourceTypeCategories.map(
    (category: DataSourceTypeCategory): TypeGroup => {
      return {
        title: category,
        types: matchingTypes.filter((dataSourceType: DataSourceType) => {
          return DataSourceTypeUtil.getCategory(dataSourceType) === category;
        }),
      };
    },
  );

  return (
    <Modal
      title="Choose a Data Source Type"
      description="Pick the system you want to connect. We will then ask for the connection details for that type."
      onClose={props.onClose}
      closeButtonText="Cancel"
      modalWidth={ModalWidth.Large}
    >
      <div>
        {/*
         * The modal body is already the scroll container, so this must not
         * open a second one -- a nested box would cap the list well short of
         * the room the modal has spare and stop the body's scroll shadows
         * from ever appearing. Sticking the search to the top of that body
         * keeps it reachable through a long list without nesting a scroller.
         * The negative margins let its background cover the body's padding
         * so rows do not show through the gutters as they scroll under it.
         */}
        <div className="sticky -top-5 z-10 -mx-5 -mt-5 bg-white px-5 pb-4 pt-5 sm:-mx-6 sm:px-6">
          <Input
            autoFocus={true}
            placeholder="Search data source types..."
            value={searchText}
            onChange={(value: string) => {
              setSearchText(value);
            }}
            dataTestId="data-source-type-search"
          />
        </div>

        <div className="space-y-6">
          {matchingTypes.length === 0 ? (
            <div className="text-center py-10">
              <Icon
                icon={DataSourceTypeUIUtil.getIcon(DataSourceType.RestApi)}
                className="mx-auto h-8 w-8 text-gray-400"
              />
              <h3 className="mt-2 text-sm font-medium text-gray-900">
                No data source types match your search
              </h3>
              <p className="mt-1 text-sm text-gray-500">
                Try a different name, like Prometheus or SQL.
              </p>
            </div>
          ) : (
            groups.map((group: TypeGroup): ReactElement => {
              if (group.types.length === 0) {
                return <React.Fragment key={group.title}></React.Fragment>;
              }

              return (
                <div key={group.title}>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">
                    {group.title}
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {group.types.map(
                      (dataSourceType: DataSourceType): ReactElement => {
                        const typeProps: DataSourceTypeProps =
                          DataSourceTypeUtil.getProps(dataSourceType);

                        return (
                          <div
                            key={dataSourceType}
                            className="cursor-pointer border border-gray-200 rounded-lg p-4 hover:border-indigo-500 hover:shadow-md transition-all duration-200 bg-white"
                            role="button"
                            tabIndex={0}
                            data-testid={`data-source-type-${dataSourceType}`}
                            onClick={() => {
                              props.onSelect(dataSourceType);
                            }}
                            onKeyDown={(e: React.KeyboardEvent) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                props.onSelect(dataSourceType);
                              }
                            }}
                          >
                            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-indigo-50 mb-3">
                              <Icon
                                icon={DataSourceTypeUIUtil.getIcon(
                                  dataSourceType,
                                )}
                                size={SizeProp.Large}
                                className="text-indigo-500 h-5 w-5"
                              />
                            </div>
                            <h4 className="text-sm font-semibold text-gray-900 mb-1">
                              {typeProps.title}
                            </h4>
                            <p className="text-xs text-gray-500 leading-relaxed">
                              {typeProps.description}
                            </p>
                          </div>
                        );
                      },
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </Modal>
  );
};

export default DataSourceTypeSelectModal;
