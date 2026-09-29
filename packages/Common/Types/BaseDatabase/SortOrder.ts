enum SortOrder {
  Ascending = "ASC",
  Descending = "DESC",
}

// Maps SortOrder to ARIA sort values for accessibility
export const SortOrderToAriaSortMap: Record<
  SortOrder,
  "ascending" | "descending"
> = {
  [SortOrder.Ascending]: "ascending",
  [SortOrder.Descending]: "descending",
};

export default SortOrder;
