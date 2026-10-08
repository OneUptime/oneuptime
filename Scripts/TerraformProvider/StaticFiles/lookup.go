package provider

// Helpers for the data sources' lookups: every argument set in a data
// source's configuration is a filter on the list it looks the item up in.

import (
	"sort"
	"strings"

	"github.com/hashicorp/terraform-plugin-framework/types"
)

// lookupNumber turns a number argument into the value a list query matches.
func lookupNumber(value types.Number) interface{} {
	if value.IsNull() || value.IsUnknown() || value.ValueBigFloat() == nil {
		return nil
	}

	f, _ := value.ValueBigFloat().Float64()
	return f
}

// describeLookup renders the arguments a lookup used, for its error
// messages: {name = "Offline", priority = 3}.
func describeLookup(parts []string) string {
	sorted := append([]string(nil), parts...)
	sort.Strings(sorted)

	return "{" + strings.Join(sorted, ", ") + "}"
}
