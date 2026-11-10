package config

import (
	"encoding/json"
	"testing"

	"github.com/oneuptime/crossplane-provider-oneuptime/internal/kinds"
)

var provider = GetProvider()

func TestEveryResourceInTheSchemaIsAManagedResource(t *testing.T) {
	var dump struct {
		ProviderSchemas map[string]struct {
			ResourceSchemas map[string]json.RawMessage `json:"resource_schemas"`
		} `json:"provider_schemas"`
	}
	if err := json.Unmarshal(providerSchema, &dump); err != nil {
		t.Fatal(err)
	}
	inSchema := 0
	for _, p := range dump.ProviderSchemas {
		inSchema += len(p.ResourceSchemas)
		for name := range p.ResourceSchemas {
			if provider.Resources[name] == nil {
				t.Errorf("%s is in the schema and has no managed resource", name)
			}
		}
	}
	if inSchema < 400 || len(provider.Resources) != inSchema {
		t.Fatalf("%d managed resources for %d resources in the schema", len(provider.Resources), inSchema)
	}
}

func TestEveryResourceIsNamedAndIdentifiedTheSameWay(t *testing.T) {
	owner := map[string]string{}
	for name, r := range provider.Resources {
		if r.Kind != kinds.Of(name) {
			t.Errorf("%s: kind %q, want %q", name, r.Kind, kinds.Of(name))
		}
		if other, taken := owner[r.Kind]; taken {
			t.Errorf("%s and %s are both kind %s", name, other, r.Kind)
		}
		owner[r.Kind] = name
		if r.ShortGroup != ShortGroup || r.Version != Version {
			t.Errorf("%s: group %q version %q, want %s at %s", name, r.ShortGroup, r.Version, Group, Version)
		}
		if r.ExternalName.GetExternalNameFn == nil || r.ExternalName.SetIdentifierArgumentFn == nil {
			t.Errorf("%s: no external name configuration", name)
		}
		if !r.ExternalName.DisableNameInitializer {
			t.Errorf("%s: its external name is not the ID OneUptime gives it", name)
		}
		if r.MetaResource != nil && len(r.MetaResource.ArgumentDocs) != 0 {
			t.Errorf("%s: field docs from the scraped Terraform docs would repeat the schema's", name)
		}
	}
	for _, kind := range []string{"Monitor", "StatusPage", "Team", "OnCallPolicy", "MonitorStatusDefinition", "TelemetryIngestionKey"} {
		if owner[kind] == "" {
			t.Errorf("there is no %s kind", kind)
		}
	}
}

// Every reference Upjet generates is on a field a manifest can set, and to
// a managed resource there is.
func TestConfiguredReferencesAreValid(t *testing.T) {
	configured := 0
	for name, r := range provider.Resources {
		for path, ref := range r.References {
			configured++
			if provider.Resources[ref.TerraformName] == nil {
				t.Errorf("%s.%s refers to %s, which is not a managed resource", name, path, ref.TerraformName)
			}
			if s, settable := FieldOf(r.TerraformResource, path); s == nil || !settable {
				t.Errorf("%s.%s takes a reference and is not a field a manifest sets", name, path)
			}
		}
	}
	// The spec's relations name well over a thousand fields.
	if configured < 500 {
		t.Fatalf("%d references; the spec's relations name far more", configured)
	}
}

// Every reference asked for names a field the resource has, so a renamed
// field cannot quietly lose its reference; one OneUptime alone writes, such
// as project_id, is left without.
func TestEveryReferenceAskedForIsAFieldOfTheResource(t *testing.T) {
	for terraformName, fields := range References() {
		r := provider.Resources[terraformName]
		if r == nil {
			t.Errorf("references for %s, which is not a managed resource", terraformName)
			continue
		}
		for path, target := range fields {
			s, settable := FieldOf(r.TerraformResource, path)
			if s == nil {
				t.Errorf("%s has no field %s", terraformName, path)
				continue
			}
			got := r.References[path].TerraformName
			if settable && got != target {
				t.Errorf("%s.%s: configured reference to %q, want %q", terraformName, path, got, target)
			}
			if !settable && got != "" {
				t.Errorf("%s.%s is read only and takes a reference", terraformName, path)
			}
		}
	}
}

func TestReadOnlyProjectIDsTakeNoReference(t *testing.T) {
	for name, r := range provider.Resources {
		if _, ok := r.References["project_id"]; ok {
			t.Errorf("%s.project_id takes a reference; the API key decides the project", name)
		}
	}
}

func TestAMonitorRefersToWhatItsCriteriaName(t *testing.T) {
	for _, terraformName := range []string{"oneuptime_monitor", "oneuptime_monitor_template"} {
		r := provider.Resources[terraformName]
		for path, target := range map[string]string{
			"labels": "oneuptime_label",
			"monitor_steps.criteria.monitor_status_id":              "oneuptime_monitor_status",
			"monitor_steps.criteria.incidents.incident_severity_id": "oneuptime_incident_severity",
			"monitor_steps.criteria.incidents.owner_team_ids":       "oneuptime_team",
			"monitor_steps.criteria.alerts.alert_severity_id":       "oneuptime_alert_severity",
			"monitor_steps.criteria.alerts.on_call_policy_ids":      "oneuptime_on_call_policy",
		} {
			if got := r.References[path].TerraformName; got != target {
				t.Errorf("%s %s refers to %q, want %q", terraformName, path, got, target)
			}
		}
	}
}

// A person is named by ID or email, never by a managed resource: OneUptime
// has no user resource to refer to.
func TestNothingRefersToUsers(t *testing.T) {
	for name, r := range provider.Resources {
		for path, ref := range r.References {
			if ref.TerraformName == "oneuptime_user" {
				t.Errorf("%s.%s refers to users", name, path)
			}
		}
	}
}

func TestFieldOf(t *testing.T) {
	monitor := provider.Resources["oneuptime_monitor"].TerraformResource
	cases := []struct {
		path     string
		exists   bool
		settable bool
	}{
		{"name", true, true},
		{"labels", true, true},
		{"project_id", true, false},
		{"monitor_steps.criteria.monitor_status_id", true, true},
		{"monitor_steps.criteria.missing", false, false},
		{"name.nested", false, false},
		{"missing", false, false},
	}
	for _, c := range cases {
		s, settable := FieldOf(monitor, c.path)
		if (s != nil) != c.exists || settable != c.settable {
			t.Errorf("FieldOf(monitor, %q) = %v, %v; want exists %v, settable %v", c.path, s != nil, settable, c.exists, c.settable)
		}
	}
	if s, _ := FieldOf(nil, "name"); s != nil {
		t.Error("FieldOf(nil, ...) found a field")
	}
}
