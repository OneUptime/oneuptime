package schemadump

import (
	"context"
	"strings"
	"testing"

	tfjson "github.com/hashicorp/terraform-json"

	"github.com/oneuptime/terraform-provider-oneuptime/xpprovider"
)

func dump(t *testing.T) (*Result, map[string]*tfjson.Schema) {
	t.Helper()
	result, err := Dump(context.Background(), xpprovider.FrameworkProvider("test"))
	if err != nil {
		t.Fatal(err)
	}
	return result, result.Schemas.Schemas[ProviderAddress].ResourceSchemas
}

func TestDumpHasTheResources(t *testing.T) {
	_, resources := dump(t)
	if len(resources) < 400 {
		t.Fatalf("%d resources, want the 400 and more the provider has", len(resources))
	}
	for _, name := range []string{"oneuptime_monitor", "oneuptime_status_page", "oneuptime_team", "oneuptime_on_call_policy", "oneuptime_monitor_status"} {
		if resources[name] == nil {
			t.Errorf("the dump has no %s", name)
		}
	}
	monitor := resources["oneuptime_monitor"].Block
	if !monitor.Attributes["name"].Required {
		t.Error("a monitor's name is not required in the dump")
	}
	if monitor.Attributes["monitor_steps"].AttributeNestedType == nil {
		t.Error("a monitor's steps lost their nested attributes")
	}
	if !monitor.Attributes["id"].Computed {
		t.Error("a monitor's id is not computed")
	}
}

// Old names stay in Terraform for configurations written with them; a
// managed resource has its current name only.
func TestDumpLeavesOutDeprecatedNames(t *testing.T) {
	result, resources := dump(t)
	if len(result.Deprecated) == 0 {
		t.Fatal("no deprecated names were left out; the provider has some (io_t_fleet, for one)")
	}
	for _, name := range result.Deprecated {
		if resources[name] != nil {
			t.Errorf("%s is deprecated and still in the dump", name)
		}
	}
	if resources["oneuptime_iot_fleet"] == nil {
		t.Error("oneuptime_iot_fleet, the current name, is missing")
	}
}

// No description, at any depth, reads as Terraform's.
func TestDumpDescriptionsReadAsKubernetes(t *testing.T) {
	_, resources := dump(t)
	var check func(where, text string)
	check = func(where, text string) {
		for _, word := range []string{"jsonencode", "jsondecode", "(see the data source)", "`oneuptime_"} {
			if strings.Contains(text, word) {
				t.Errorf("%s: %q still says %s", where, text, word)
			}
		}
	}
	var walk func(where string, attributes map[string]*tfjson.SchemaAttribute)
	walk = func(where string, attributes map[string]*tfjson.SchemaAttribute) {
		for name, a := range attributes {
			check(where+"."+name, a.Description)
			if a.AttributeNestedType != nil {
				walk(where+"."+name, a.AttributeNestedType.Attributes)
			}
		}
	}
	for name, s := range resources {
		check(name, s.Block.Description)
		walk(name, s.Block.Attributes)
	}
	labels := resources["oneuptime_monitor"].Block.Attributes["labels"].Description
	if !strings.Contains(labels, "`Label`") {
		t.Errorf("a monitor's labels say %q, want them to name the Label kind", labels)
	}
}
