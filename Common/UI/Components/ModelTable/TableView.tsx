import React, { ReactElement, useEffect, useRef, useState } from "react";
import TableView from "../../../Models/DatabaseModels/TableView";
import ObjectID from "../../../Types/ObjectID";
import MoreMenu from "../MoreMenu/MoreMenu";
import MoreMenuItem from "../MoreMenu/MoreMenuItem";
import ModelAPI from "../../Utils/ModelAPI/ModelAPI";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import API from "../../../Utils/API";
import MoreMenuSection from "../MoreMenu/MoreMenuSection";
import { ButtonStyleType } from "../Button/Button";
import IconProp from "../../../Types/Icon/IconProp";
import { BarLoader } from "react-spinners";
import ConfirmModal from "../Modal/ConfirmModal";
import ModelFormModal from "../ModelFormModal/ModelFormModal";
import { FormType } from "../Forms/ModelForm";
import FormFieldSchemaType from "../Forms/Types/FormFieldSchemaType";
import { PromiseVoidFunction } from "../../../Types/FunctionTypes";
import { GetReactElementArrayFunction } from "../../Types/FunctionTypes";
import ProjectUtil from "../../Utils/Project";
import User from "../../Utils/User";
import Icon, { SizeProp, ThickProp } from "../Icon/Icon";
import GenericObject from "../../../Types/GenericObject";
import Query from "../../../Types/BaseDatabase/Query";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AnalyticsBaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Sort from "../../../Types/BaseDatabase/Sort";
import ListResult from "../../../Types/BaseDatabase/ListResult";

export interface ComponentProps<T extends GenericObject> {
  tableId: string;
  onViewChange: (tableView: TableView | null) => void;
  currentQuery: Query<T>;
  currentSortOrder: SortOrder | null;
  currentSortBy: keyof T | null;
  currentItemsOnPage: number;
  tableView: TableView | null;
}

const TableViewElement: <T extends DatabaseBaseModel | AnalyticsBaseModel>(
  props: ComponentProps<T>,
) => ReactElement = <T extends DatabaseBaseModel | AnalyticsBaseModel>(
  props: ComponentProps<T>,
): ReactElement => {
  const [error, setError] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [allTableViews, setAllTableViews] = useState<Array<TableView>>([]);
  const [tableViewToDelete, setTableViewToDelete] = useState<
    TableView | undefined
  >(undefined);
  const [tableViewToEdit, setTableViewToEdit] = useState<TableView | undefined>(
    undefined,
  );
  const [showCreateNewViewModal, setShowCreateNewViewModel] =
    useState<boolean>(false);

  const moreMenuRef: React.MutableRefObject<undefined> = useRef();

  const [currentlySelectedView, setCurrentlySelectedView] =
    useState<TableView | null>(null);

  useEffect(() => {
    setCurrentlySelectedView(props.tableView);
  }, [props.tableView]);

  // load all the filters for this user and for this project.
  const fetchTableViews: PromiseVoidFunction = async (): Promise<void> => {
    try {
      setError("");
      setIsLoading(true);

      const tableViews: ListResult<TableView> = await ModelAPI.getList({
        modelType: TableView,
        query: {
          projectId: ProjectUtil.getCurrentProjectId()!,
          createdByUserId: User.getUserId(),
          tableId: props.tableId,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: {
          sort: true,
          itemsOnPage: true,
          query: true,
          name: true,
        },
        sort: {
          name: SortOrder.Ascending,
        },
      });

      setAllTableViews(tableViews.data);
    } catch (err) {
      setError(API.getFriendlyErrorMessage(err as Error));
    }

    setIsLoading(false);
  };

  type DeleteTableViewFunction = (tableView: TableView) => Promise<void>;

  const deleteTableView: DeleteTableViewFunction = async (
    tableView: TableView,
  ): Promise<void> => {
    const tableViewId: ObjectID = tableView.id!;

    try {
      setError("");
      setIsLoading(true);

      await ModelAPI.deleteItem({
        modelType: TableView,
        id: tableViewId,
      });

      await fetchTableViews();
    } catch (err) {
      setError(API.getFriendlyErrorMessage(err as Error));
    }

    setIsLoading(false);
  };

  useEffect(() => {
    fetchTableViews().catch((err: Error) => {
      setError(API.getFriendlyErrorMessage(err as Error));
    });
  }, []);

  type GetRightElementForTableViewMenuItemFunction = (
    item: TableView,
  ) => React.JSX.Element;

  const getRightElementForTableViewMenuItem: GetRightElementForTableViewMenuItemFunction =
    (item: TableView): ReactElement => {
      return (
        <div className="flex">
          <div className="h-4 w-4 mr-2">
            <Icon
              icon={IconProp.Edit}
              className="text-gray-400 hover:text-gray-600"
              size={SizeProp.Regular}
              thick={ThickProp.Thick}
              onClick={() => {
                setTableViewToEdit(item);
              }}
            />
          </div>
          <div className="h-4 w-4">
            <Icon
              className="text-gray-400 hover:text-gray-600"
              icon={IconProp.Trash}
              size={SizeProp.Regular}
              thick={ThickProp.Thick}
              onClick={() => {
                setTableViewToDelete(item);
              }}
            />
          </div>
        </div>
      );
    };

  type GetViewItemsFunction = () => Array<ReactElement>;

  const getViewItems: GetViewItemsFunction = (): Array<ReactElement> => {
    return allTableViews.map((item: TableView, index: number) => {
      return (
        <MoreMenuItem
          key={index}
          rightElement={getRightElementForTableViewMenuItem(item)}
          text={item.name || ""}
          className="text-gray-600 hover:text-gray-800"
          icon={IconProp.Window}
          onClick={() => {
            props.onViewChange?.(item);
            setCurrentlySelectedView(item);
          }}
        />
      );
    });
  };

  const getMenuContents: GetReactElementArrayFunction =
    (): Array<ReactElement> => {
      if (isLoading) {
        return [<BarLoader key={-1} />];
      }

      const elements: Array<ReactElement> = [];

      if (allTableViews.length > 0) {
        elements.push(
          <MoreMenuSection title="Saved Views">
            {getViewItems()}
          </MoreMenuSection>,
        );
      }

      elements.push(
        <MoreMenuItem
          key={"save-new-view"}
          text="Save as New View"
          className="bg-gray-50 hover:bg-gray-100 text-gray-700 hover:text-gray-900 font-medium -mt-2"
          icon={IconProp.Add}
          iconClassName=""
          onClick={() => {
            setShowCreateNewViewModel(true);
          }}
        ></MoreMenuItem>,
      );

      return elements;
    };

  if (error) {
    return (
      <ConfirmModal
        title={`Something went wrong...`}
        description={error}
        isLoading={false}
        submitButtonText={"Close"}
        onSubmit={() => {
          return setError("");
        }}
      />
    );
  }

  if (tableViewToEdit) {
    return (
      <ModelFormModal<TableView>
        modelType={TableView}
        modelIdToEdit={tableViewToEdit.id!}
        name="Edit View"
        title="Edit View"
        description="You can rename this table view to any name you like."
        onClose={() => {
          setTableViewToEdit(undefined);
        }}
        submitButtonText="Save Changes"
        onSuccess={async () => {
          setTableViewToEdit(undefined);

          await fetchTableViews();
        }}
        formProps={{
          name: "Edit View",
          modelType: TableView,
          id: "edit-table-view",
          fields: [
            {
              field: {
                name: true,
              },
              fieldType: FormFieldSchemaType.Text,
              placeholder: "Name of the view",
              description: "Please enter the new name of the view",
              title: "Name",
              required: true,
            },
          ],
          formType: FormType.Update,
        }}
      />
    );
  }

  if (tableViewToDelete) {
    return (
      <ConfirmModal
        description={`Are you sure you want to delete view - ${tableViewToDelete.name}?`}
        title={`Delete ${tableViewToDelete.name}`}
        isLoading={isLoading}
        onSubmit={async () => {
          await deleteTableView(tableViewToDelete);
          setTableViewToDelete(undefined);
        }}
        onClose={() => {
          setTableViewToDelete(undefined);
        }}
        submitButtonText={`Delete`}
        submitButtonType={ButtonStyleType.DANGER}
      />
    );
  }

  if (showCreateNewViewModal) {
    return (
      <ModelFormModal<TableView>
        modelType={TableView}
        name="Save New View"
        title="Save New View"
        description="You can save the current table settings as a new view."
        onClose={() => {
          setShowCreateNewViewModel(false);
        }}
        submitButtonText="Save Changes"
        onBeforeCreate={(tableView: TableView) => {
          let sort: Sort<T> = {};

          if (props.currentSortOrder && props.currentSortBy) {
            sort = {
              [props.currentSortBy]: props.currentSortOrder,
            } as Sort<T>;
          }

          tableView.tableId = props.tableId;
          tableView.query =
            (props.currentQuery as Query<
              DatabaseBaseModel | AnalyticsBaseModel
            >) || {};
          tableView.itemsOnPage = props?.currentItemsOnPage || 10;
          tableView.sort = sort || {};
          return Promise.resolve(tableView);
        }}
        onSuccess={async (tableView: TableView) => {
          setShowCreateNewViewModel(false);
          await fetchTableViews();
          // set as current view
          props.onViewChange?.(tableView);
        }}
        formProps={{
          name: "Save New View",
          modelType: TableView,
          id: "save-table-view",
          fields: [
            {
              field: {
                name: true,
              },
              fieldType: FormFieldSchemaType.Text,
              placeholder: "Name of the view",
              description: "Please enter the new name of the view",
              title: "Name",
              required: true,
            },
          ],
          formType: FormType.Create,
        }}
      />
    );
  }

  type GetElementToBeShownInsteadOfButtonFunction = () => ReactElement;

  const getElementToBeShownInsteadOfButton: GetElementToBeShownInsteadOfButtonFunction =
    (): ReactElement => {
      if (currentlySelectedView) {
        return (
          <div
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-xs font-medium text-indigo-700 shadow-sm transition-colors hover:border-indigo-300 hover:bg-indigo-100"
            title={`Saved view: ${currentlySelectedView.name}`}
          >
            <Icon
              icon={IconProp.Window}
              size={SizeProp.Small}
              className="text-indigo-500"
            />
            <span className="max-w-[10rem] truncate">
              {currentlySelectedView.name}
            </span>
            <div
              role="button"
              tabIndex={0}
              aria-label="Clear saved view"
              className="-mr-1 ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full text-indigo-500 hover:bg-indigo-200 hover:text-indigo-800"
              onClick={(event: React.MouseEvent<HTMLDivElement>) => {
                event.stopPropagation();
                setCurrentlySelectedView(null);
                props.onViewChange?.(null);
                closeDropdownMenu();
              }}
              onKeyDown={(event: React.KeyboardEvent<HTMLDivElement>) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  event.stopPropagation();
                  setCurrentlySelectedView(null);
                  props.onViewChange?.(null);
                  closeDropdownMenu();
                }
              }}
            >
              <Icon
                icon={IconProp.Close}
                size={SizeProp.Small}
                thick={ThickProp.Thick}
              />
            </div>
          </div>
        );
      }

      return (
        <div
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 shadow-sm transition-colors hover:border-gray-300 hover:bg-gray-50"
          title="Saved Views"
        >
          <Icon
            icon={IconProp.Window}
            size={SizeProp.Small}
            className="text-gray-500"
          />
          <span>Saved Views</span>
          {allTableViews.length > 0 && (
            <span className="text-gray-400">
              {allTableViews.length.toLocaleString()}
            </span>
          )}
        </div>
      );
    };

  const closeDropdownMenu: VoidFunction = (): void => {
    if (moreMenuRef.current) {
      (moreMenuRef.current as any).closeDropdown();
    }
  };

  return (
    <MoreMenu
      elementToBeShownInsteadOfButton={getElementToBeShownInsteadOfButton()}
      ref={moreMenuRef}
    >
      {getMenuContents()}
    </MoreMenu>
  );
};

export default TableViewElement;
