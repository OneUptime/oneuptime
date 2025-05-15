import React, { ReactElement } from "react";
import GenericObject from "../../../Types/GenericObject";
import Columns from "./Types/Columns";
import Table from "./Table";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";

export interface ComponentProps<T extends GenericObject> {
  data: Array<T>;
  columns: Columns<T>;
  id: string;
  singularLabel: string;
  pluralLabel: string;
}

type TableFunction = <T extends GenericObject>(
  props: ComponentProps<T>,
) => ReactElement;

const LocalTable: TableFunction = <T extends GenericObject>(
  props: ComponentProps<T>,
): ReactElement => {
  const [currentPage, setCurrentPage] = React.useState<number>(1);
  const [itemsPerPage, setItemsPerPage] = React.useState<number>(10);
  const [sortOrder, setSortOrder] = React.useState<SortOrder>(
    SortOrder.Ascending,
  );
  const [sortBy, setSortBy] = React.useState<keyof T | null>(null);

  const [dataSlice, setDataSlice] = React.useState<Array<T>>(
    props.data.slice(0, itemsPerPage),
  );

  React.useEffect(() => {
    const startIndex: number = (currentPage - 1) * itemsPerPage;
    const endIndex: number = startIndex + itemsPerPage;
    setDataSlice(props.data.slice(startIndex, endIndex));
  }, [currentPage, itemsPerPage, props.data]);

  return (
    <Table
      data={dataSlice}
      columns={props.columns}
      totalItemsCount={props.data.length}
      currentPageNumber={currentPage}
      error={""}
      isLoading={false}
      itemsOnPage={itemsPerPage}
      onNavigateToPage={(pageNumber: number, itemsPerPage: number) => {
        setCurrentPage(pageNumber);
        setItemsPerPage(itemsPerPage);
      }}
      id={props.id}
      disablePagination={false}
      singularLabel={props.singularLabel}
      pluralLabel={props.pluralLabel}
      sortOrder={sortOrder}
      sortBy={sortBy}
      onSortChanged={(sortBy: keyof T | null, sortOrder: SortOrder) => {
        setSortOrder(sortOrder);
        setSortBy(sortBy);
        const sortedData: T[] = [...props.data].sort((a: T, b: T) => {
          if (sortOrder === SortOrder.Ascending) {
            return a[sortBy as keyof T] > b[sortBy as keyof T] ? 1 : -1;
          }
          return a[sortBy as keyof T] < b[sortBy as keyof T] ? 1 : -1;
        });
        setDataSlice(sortedData.slice(0, itemsPerPage));
        setCurrentPage(1);
      }}
    />
  );
};

export default LocalTable;
