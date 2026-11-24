package provider

// The generated resources and data sources are in packages of their own,
// internal/provider/shard00 and on, a few dozen files each. Compiled in this
// package, some 1,000 files and 64 MB of Go, they took the Go compiler more
// than 11 GiB, near the 16 GB of a CI runner, and more with every resource
// the provider gained (#7591). Split, no compile holds more than a few
// percent of them.
//
// A shard's init hands what it holds to this package (its resources.go and
// data_sources.go), and internal/provider/all imports every shard: whatever
// runs the provider - main.go, xpprovider and the tests - links them all by
// importing it. GetResources and GetDataSources list them in the generator's
// order, with the ones written by hand (handwrittenResources and
// handwrittenDataSources, in this package's resources.go and
// data_sources.go) in their places, and refuse to answer while a shard is
// missing: a program that did not import internal/provider/all would
// otherwise serve a provider without most of its resources.

import (
	"fmt"
	"sort"

	"github.com/hashicorp/terraform-plugin-framework/datasource"
	"github.com/hashicorp/terraform-plugin-framework/resource"
)

// OrderedResource is a resource's constructor and its place in GetResources.
type OrderedResource struct {
	Order int
	New   func() resource.Resource
}

// OrderedDataSource is a data source's constructor and its place in
// GetDataSources.
type OrderedDataSource struct {
	Order int
	New   func() datasource.DataSource
}

var (
	// What each shard handed over, by its package name.
	resourceShards   = map[string][]OrderedResource{}
	dataSourceShards = map[string][]OrderedDataSource{}

	// The renamed resources and data sources, with the deprecated aliases
	// that keep their old names working (legacynames.go), in order.
	legacyResourceAliases   []LegacyResourceAlias
	legacyDataSourceAliases []LegacyDataSourceAlias
)

// RegisterResources is how a shard hands over its resources, and the
// deprecated aliases among them. Its init calls it, once.
func RegisterResources(shard string, resources []OrderedResource, aliases []LegacyResourceAlias) {
	if _, ok := resourceShards[shard]; ok {
		panic(fmt.Sprintf("internal/provider: %s handed over its resources twice", shard))
	}
	resourceShards[shard] = resources
	legacyResourceAliases = append(legacyResourceAliases, aliases...)
	sort.SliceStable(legacyResourceAliases, func(i, j int) bool {
		return legacyResourceAliases[i].Order < legacyResourceAliases[j].Order
	})
}

// RegisterDataSources is RegisterResources for data sources.
func RegisterDataSources(shard string, dataSources []OrderedDataSource, aliases []LegacyDataSourceAlias) {
	if _, ok := dataSourceShards[shard]; ok {
		panic(fmt.Sprintf("internal/provider: %s handed over its data sources twice", shard))
	}
	dataSourceShards[shard] = dataSources
	legacyDataSourceAliases = append(legacyDataSourceAliases, aliases...)
	sort.SliceStable(legacyDataSourceAliases, func(i, j int) bool {
		return legacyDataSourceAliases[i].Order < legacyDataSourceAliases[j].Order
	})
}

// GetResources returns every resource, in the generator's order.
func GetResources() []func() resource.Resource {
	requireEveryShard("resources", len(resourceShards), generatedShards)
	return resourcesInOrder(handwrittenResources, resourceShards)
}

// GetDataSources returns every data source, in the generator's order.
func GetDataSources() []func() datasource.DataSource {
	requireEveryShard("data sources", len(dataSourceShards), generatedShards)
	return dataSourcesInOrder(handwrittenDataSources, dataSourceShards)
}

// resourcesInOrder is the constructors of `handwritten` and of every shard,
// by Order.
func resourcesInOrder(handwritten []OrderedResource, shards map[string][]OrderedResource) []func() resource.Resource {
	ordered := append([]OrderedResource{}, handwritten...)
	for _, entries := range shards {
		ordered = append(ordered, entries...)
	}
	sort.SliceStable(ordered, func(i, j int) bool {
		return ordered[i].Order < ordered[j].Order
	})

	constructors := make([]func() resource.Resource, len(ordered))
	for i, entry := range ordered {
		constructors[i] = entry.New
	}
	return constructors
}

// dataSourcesInOrder is resourcesInOrder for data sources.
func dataSourcesInOrder(handwritten []OrderedDataSource, shards map[string][]OrderedDataSource) []func() datasource.DataSource {
	ordered := append([]OrderedDataSource{}, handwritten...)
	for _, entries := range shards {
		ordered = append(ordered, entries...)
	}
	sort.SliceStable(ordered, func(i, j int) bool {
		return ordered[i].Order < ordered[j].Order
	})

	constructors := make([]func() datasource.DataSource, len(ordered))
	for i, entry := range ordered {
		constructors[i] = entry.New
	}
	return constructors
}

// requireEveryShard panics unless all `expected` shards handed over their
// resources or data sources.
func requireEveryShard(what string, registered int, expected int) {
	if registered != expected {
		panic(fmt.Sprintf(
			"internal/provider: %d of the %d packages that hold the generated %s are linked into this program: import github.com/oneuptime/terraform-provider-oneuptime/internal/provider/all",
			registered, expected, what,
		))
	}
}
