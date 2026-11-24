package config

import (
	"reflect"
	"sort"
	"testing"

	ujconfig "github.com/crossplane/upjet/v2/pkg/config"

	"github.com/oneuptime/crossplane-provider-oneuptime/apis/crossplane/v1alpha1"
)

// A record is created in the reconcile that asks for it, so Crossplane
// writes its ID to the external-name annotation itself, under any
// management policy: one without LateInitialize too (#9985).
func TestEveryResourceIsCreatedInTheReconcileThatAsksForIt(t *testing.T) {
	for name, r := range provider.Resources {
		if r.UseAsync {
			t.Errorf("%s is created in the background, so only late initialization would record its ID", name)
		}
	}
}

func TestTheConfigurationIsIdentifiedByTheExternalName(t *testing.T) {
	for name, r := range provider.Resources {
		params := map[string]any{}
		r.ExternalName.SetIdentifierArgumentFn(params, "")
		if _, ok := params["id"]; ok {
			t.Fatalf("%s: a resource with no record yet has an id: %v", name, params)
		}
		r.ExternalName.SetIdentifierArgumentFn(params, "5ec7e700-0000-4000-8000-000000000001")
		if params["id"] != "5ec7e700-0000-4000-8000-000000000001" {
			t.Fatalf("%s: the external name is not the id: %v", name, params)
		}
		if r.TerraformConfigurationInjector == nil {
			t.Fatalf("%s: nothing leaves spec.initProvider out of the configuration after the create", name)
		}
	}
}

// Every field the generator says OneUptime keeps is one of the resource's,
// declared as its kind needs: a field OneUptime alone writes is read only,
// in status.atProvider alone; one a manifest may start is settable, and late
// initialization never copies it.
func TestWhatOneUptimeKeepsIsDeclaredOnTheResourcesFields(t *testing.T) {
	declared := 0
	for terraformName, fields := range generatedServerOwned {
		r := provider.Resources[terraformName]
		if r == nil {
			t.Errorf("%s keeps fields OneUptime owns and is no managed resource", terraformName)
			continue
		}
		ignored := asSet(r.LateInitializer.IgnoredFields)
		conditional := asSet(r.LateInitializer.ConditionalIgnoredFields)
		for field, kind := range fields {
			declared++
			s, settable := FieldOf(r.TerraformResource, field)
			if s == nil {
				t.Errorf("%s has no field %s", terraformName, field)
				continue
			}
			switch kind {
			case ServerOwnedAlways:
				if settable {
					t.Errorf("%s.%s: only OneUptime writes it, and a manifest can set it", terraformName, field)
				}
				if ignored[field] || conditional[field] {
					t.Errorf("%s.%s: read only, and configured for late initialization", terraformName, field)
				}
			case ServerOwnedAfterCreate, ServerOwnedShared:
				if !settable {
					t.Errorf("%s.%s: a manifest may give it, and cannot set it", terraformName, field)
				}
				if !ignored[field] {
					t.Errorf("%s.%s: late initialization copies it into spec.forProvider", terraformName, field)
				}
				if conditional[field] {
					t.Errorf("%s.%s: late initialization copies it while spec.initProvider leaves it out", terraformName, field)
				}
			default:
				t.Errorf("%s.%s: OneUptime keeps it as %q, which is no kind", terraformName, field, kind)
			}
		}
	}
	// Monitors, incidents, alerts, maintenance, agents and their counts.
	if declared < 20 {
		t.Fatalf("%d fields OneUptime keeps; the models declare far more", declared)
	}
}

// The fields #9985 names.
func TestAMonitorsStatusAndEvaluationTimesAreOneUptimes(t *testing.T) {
	want := map[string]string{
		"current_monitor_status_id":         ServerOwnedAfterCreate,
		"telemetry_monitor_last_monitor_at": ServerOwnedAlways,
		"telemetry_monitor_next_monitor_at": ServerOwnedAlways,
	}
	got := ServerOwned("oneuptime_monitor")
	for field, kind := range want {
		if got[field] != kind {
			t.Errorf("oneuptime_monitor.%s: %q, want %q", field, got[field], kind)
		}
	}

	// The kind: the times are in status.atProvider alone, and the status
	// is a field a manifest may start the monitor in.
	parameters := reflect.TypeOf(v1alpha1.MonitorParameters{})
	initParameters := reflect.TypeOf(v1alpha1.MonitorInitParameters{})
	observation := reflect.TypeOf(v1alpha1.MonitorObservation{})
	for _, field := range []string{"TelemetryMonitorLastMonitorAt", "TelemetryMonitorNextMonitorAt"} {
		if _, ok := parameters.FieldByName(field); ok {
			t.Errorf("spec.forProvider has %s", field)
		}
		if _, ok := initParameters.FieldByName(field); ok {
			t.Errorf("spec.initProvider has %s", field)
		}
		if _, ok := observation.FieldByName(field); !ok {
			t.Errorf("status.atProvider has no %s", field)
		}
	}
	for _, typ := range []reflect.Type{parameters, initParameters, observation} {
		if _, ok := typ.FieldByName("CurrentMonitorStatusID"); !ok {
			t.Errorf("%s has no CurrentMonitorStatusID", typ.Name())
		}
	}
}

// Late initialization leaves a field alone while spec.initProvider gives it:
// every field a manifest can set, but the ones it never copies at all.
func TestLateInitializationLeavesSpecInitProviderFieldsAlone(t *testing.T) {
	for name, r := range provider.Resources {
		ignored := asSet(r.LateInitializer.IgnoredFields)
		conditional := asSet(r.LateInitializer.ConditionalIgnoredFields)
		for _, field := range settableFields(r) {
			if !ignored[field] && !conditional[field] {
				t.Errorf("%s.%s: late initialization copies it from spec.initProvider", name, field)
			}
		}
		for field := range conditional {
			if _, settable := FieldOf(r.TerraformResource, field); !settable {
				t.Errorf("%s.%s: no manifest sets it, and late initialization checks spec.initProvider for it", name, field)
			}
		}
	}
}

func TestInitProviderIsLeftOutOfTheConfigurationOnceTheRecordExists(t *testing.T) {
	r := provider.Resources["oneuptime_monitor"]
	inject := r.TerraformConfigurationInjector

	// spec.forProvider gives the name, type and labels (by reference); the
	// rest comes from spec.initProvider.
	forProvider := map[string]any{
		"name":        "Homepage",
		"monitorType": "Website",
		"labels":      []any{"5ec7e700-0000-4000-8000-0000000000aa"},
		"labelsRefs":  []any{map[string]any{"name": "production"}},
	}
	merged := func() map[string]any {
		return map[string]any{
			"name":                      "Homepage",
			"monitor_type":              "Website",
			"labels":                    []any{"5ec7e700-0000-4000-8000-0000000000aa"},
			"description":               "Written in spec.initProvider",
			"disable_active_monitoring": true,
			"current_monitor_status_id": "11111111-0000-4000-8000-000000000002",
		}
	}

	// No record yet: spec.initProvider is what creates it.
	params := merged()
	if err := inject(forProvider, params); err != nil {
		t.Fatal(err)
	}
	if len(params) != len(merged()) {
		t.Fatalf("the create's configuration lost fields: %v", sortedFieldNames(params))
	}

	// The record exists: what spec.initProvider alone gives is left out.
	params = merged()
	identifyByExternalName(params, "5ec7e700-0000-4000-8000-000000000001")
	if err := inject(forProvider, params); err != nil {
		t.Fatal(err)
	}
	if got, want := sortedFieldNames(params), []string{"id", "labels", "monitor_type", "name"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("after the create the configuration holds %v, want %v", got, want)
	}
}

func TestInitProviderKeepsWhatTheTerraformProviderCannotDoWithout(t *testing.T) {
	// A required field stays in, though spec.initProvider alone gives it.
	monitor := provider.Resources["oneuptime_monitor"]
	params := map[string]any{"id": "5ec7e700-0000-4000-8000-000000000001", "name": "Homepage", "monitor_type": "Website"}
	if err := monitor.TerraformConfigurationInjector(map[string]any{}, params); err != nil {
		t.Fatal(err)
	}
	if params["name"] != "Homepage" || params["monitor_type"] != "Website" {
		t.Errorf("the required fields were left out: %v", params)
	}

	// A field spec.forProvider gives through a Secret stays in.
	if !inForProvider(map[string]any{"apiKeySecretRef": map[string]any{"name": "a", "key": "b"}}, "api_key") {
		t.Error("a field given through a Secret does not count as given")
	}
	if inForProvider(map[string]any{"apiKey": nil}, "api_key") {
		t.Error("a field set to null counts as given")
	}
}

func asSet(values []string) map[string]bool {
	set := map[string]bool{}
	for _, v := range values {
		set[v] = true
	}
	return set
}

func TestSettableFieldsAreTheArguments(t *testing.T) {
	fields := settableFields(provider.Resources["oneuptime_monitor"])
	if !sort.StringsAreSorted(fields) {
		t.Errorf("not in order: %v", fields)
	}
	set := asSet(fields)
	for _, field := range []string{"name", "monitor_type", "description", "current_monitor_status_id"} {
		if !set[field] {
			t.Errorf("%s is not a settable field", field)
		}
	}
	for _, field := range []string{"id", "project_id", "telemetry_monitor_last_monitor_at"} {
		if set[field] {
			t.Errorf("%s is a settable field", field)
		}
	}
	if settableFields(&ujconfig.Resource{}) != nil {
		t.Error("a resource with no schema has settable fields")
	}
}
