package provider_test

// The tests of this package run the provider with every resource and data
// source it has: this links the packages that hold the generated ones, which
// hand them to the package from their init functions (shards.go). Linked
// from this external test, they are built against the package with its
// tests, so the tests in package provider see them too.
import (
	"testing"

	"github.com/oneuptime/terraform-provider-oneuptime/internal/provider"
	_ "github.com/oneuptime/terraform-provider-oneuptime/internal/provider/all"
)

// Every shard hands over its resources and data sources, so neither list
// refuses to answer (shards_order_test.go checks what they hold).
func TestEveryShardIsLinked(t *testing.T) {
	resources := provider.GetResources()
	dataSources := provider.GetDataSources()
	if len(resources) == 0 || len(dataSources) == 0 {
		t.Fatalf("%d resources and %d data sources: want both", len(resources), len(dataSources))
	}
}
