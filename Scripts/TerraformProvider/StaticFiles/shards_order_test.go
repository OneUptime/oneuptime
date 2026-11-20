package provider

import (
	"context"
	"reflect"
	"strings"
	"testing"

	"github.com/hashicorp/terraform-plugin-framework/datasource"
	"github.com/hashicorp/terraform-plugin-framework/resource"
)

// The shards hand over their resources in no order of their own (a map, by
// package name), and the provider lists them in the generator's order, the
// hand-written ones in their places: shards.go.

type namedResource struct {
	resource.Resource
	name string
}

func (r namedResource) Metadata(_ context.Context, _ resource.MetadataRequest, resp *resource.MetadataResponse) {
	resp.TypeName = r.name
}

func newNamed(name string) func() resource.Resource {
	return func() resource.Resource {
		return namedResource{name: name}
	}
}

func typeNames(constructors []func() resource.Resource) []string {
	names := make([]string, len(constructors))
	for i, newResource := range constructors {
		var meta resource.MetadataResponse
		newResource().Metadata(context.Background(), resource.MetadataRequest{}, &meta)
		names[i] = meta.TypeName
	}
	return names
}

func TestResourcesAreListedInTheGeneratorsOrderWithTheHandwrittenInTheirPlaces(t *testing.T) {
	handwritten := []OrderedResource{{Order: 2, New: newNamed("handwritten")}}
	shards := map[string][]OrderedResource{
		"shard01": {{Order: 3, New: newNamed("d")}, {Order: 0, New: newNamed("a")}},
		"shard00": {{Order: 4, New: newNamed("e")}},
		"shard02": {{Order: 1, New: newNamed("b")}},
	}
	want := []string{"a", "b", "handwritten", "d", "e"}

	// Go visits a map in a different order each time.
	for attempt := 0; attempt < 50; attempt++ {
		if got := typeNames(resourcesInOrder(handwritten, shards)); !reflect.DeepEqual(got, want) {
			t.Fatalf("got %v, want %v", got, want)
		}
	}
}

func TestDataSourcesAreListedInTheGeneratorsOrder(t *testing.T) {
	var made []int
	newMade := func(order int) func() datasource.DataSource {
		return func() datasource.DataSource {
			made = append(made, order)
			return nil
		}
	}
	shards := map[string][]OrderedDataSource{
		"shard00": {{Order: 2, New: newMade(2)}},
		"shard01": {{Order: 0, New: newMade(0)}},
	}

	for _, newDataSource := range dataSourcesInOrder([]OrderedDataSource{{Order: 1, New: newMade(1)}}, shards) {
		newDataSource()
	}
	if !reflect.DeepEqual(made, []int{0, 1, 2}) {
		t.Fatalf("made in the order %v, want [0 1 2]", made)
	}
}

func TestAProgramMissingAShardIsRefused(t *testing.T) {
	defer func() {
		message, _ := recover().(string)
		if !strings.Contains(message, "31 of the 32 packages that hold the generated resources") ||
			!strings.Contains(message, "import github.com/oneuptime/terraform-provider-oneuptime/internal/provider/all") {
			t.Fatalf("panic = %q, want one that names the package to import", message)
		}
	}()

	requireEveryShard("resources", 31, 32)
}

func TestEveryShardLinkedIsEnough(t *testing.T) {
	requireEveryShard("data sources", 32, 32)
}

// The real lists, with every shard linked (shards_test.go): each place in
// the order is taken once, and every deprecated alias pairs two resources
// the provider lists.
func TestTheShardsHandOverAWholeOrder(t *testing.T) {
	seen := map[int]string{}
	for shard, entries := range resourceShards {
		for _, entry := range entries {
			if other, taken := seen[entry.Order]; taken {
				t.Fatalf("place %d is taken by %s and %s", entry.Order, other, shard)
			}
			seen[entry.Order] = shard
		}
	}
	for _, entry := range handwrittenResources {
		if other, taken := seen[entry.Order]; taken {
			t.Fatalf("place %d of a hand-written resource is taken by %s", entry.Order, other)
		}
		seen[entry.Order] = "handwritten"
	}
	if len(seen) != len(GetResources()) {
		t.Fatalf("%d places for %d resources", len(seen), len(GetResources()))
	}
	for order := range seen {
		if order < 0 || order >= len(seen) {
			t.Fatalf("place %d is outside 0 to %d: the order has a gap", order, len(seen)-1)
		}
	}

	listed := map[uintptr]bool{}
	for _, newResource := range GetResources() {
		listed[reflect.ValueOf(newResource).Pointer()] = true
	}
	for i, alias := range legacyResourceAliases {
		if !listed[reflect.ValueOf(alias.New).Pointer()] || !listed[reflect.ValueOf(alias.NewLegacy).Pointer()] {
			t.Fatalf("the alias %s -> %s pairs a resource the provider does not list", alias.LegacyName, alias.Name)
		}
		if i > 0 && legacyResourceAliases[i-1].Order > alias.Order {
			t.Fatalf("the aliases are out of order at %s", alias.Name)
		}
	}
}
