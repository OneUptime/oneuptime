import React from "react";
import { View } from "react-native";
import { spacing } from "../../theme/tokens";
import SearchField from "../SearchField";
import FilterButton from "./FilterButton";

interface SearchFilterRowProps {
  search: string;
  onSearch: (value: string) => void;
  placeholder: string;
  searchAccessibilityLabel: string;
  // What the list holds, plural: "incidents", for the Filter button's name.
  noun: string;
  filterCount: number;
  onOpenFilters: () => void;
}

/**
 * A list's search with its Filter button beside it: the two ways to narrow
 * the list, side by side, where people look for them.
 */
export default function SearchFilterRow({
  search,
  onSearch,
  placeholder,
  searchAccessibilityLabel,
  noun,
  filterCount,
  onOpenFilters,
}: SearchFilterRowProps): React.JSX.Element {
  return (
    <View
      testID="search-filter-row"
      style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <SearchField
          value={search}
          onChangeText={onSearch}
          placeholder={placeholder}
          accessibilityLabel={searchAccessibilityLabel}
        />
      </View>
      <FilterButton
        activeCount={filterCount}
        noun={noun}
        onPress={onOpenFilters}
      />
    </View>
  );
}
