package config

// spec.initProvider through a monitor's reconciles (#9985): what it gives
// is what the record is created with, and the dashboard's after - late
// initialization never copies it into spec.forProvider, and once the record
// exists the provider plans OneUptime's value for it, a field with a
// default included. What spec.forProvider gives is kept as it says, and a
// management policy without LateInitialize copies nothing and still records
// the record's ID as the external name.

import (
	"testing"

	"github.com/crossplane/crossplane-runtime/v2/pkg/meta"
	xpv2 "github.com/crossplane/crossplane/apis/v2/core/v2"
)

func TestADescriptionGivenInInitProviderIsTheDashboardsAfterTheCreate(t *testing.T) {
	api := newFakeAPI(t)
	api.serve("monitor", "oneuptime_monitor", monitorAsOneUptimeCreatesIt)
	r := newReconciler(t, api)

	mg := newMonitor("status-api", "Website")
	mg.Spec.InitProvider.Description = ptrTo("Written in spec.initProvider")
	r.create("oneuptime_monitor", mg)
	id := meta.GetExternalName(mg)
	if got := api.creates("monitor")[0].Data["description"]; got != "Written in spec.initProvider" {
		t.Fatalf("the monitor was created with the description %v", got)
	}

	if _, err := r.reconcile("oneuptime_monitor", mg); err != nil {
		t.Fatalf("the reconcile after the create: %v", err)
	}
	assertNotLateInitialized(t, mg.Spec.ForProvider, []string{"description"})

	api.set("monitor", id, map[string]any{"description": "Changed in the dashboard"})
	obs, err := r.reconcile("oneuptime_monitor", mg)
	if err != nil {
		t.Fatalf("the reconcile after the dashboard's change: %v", err)
	}
	if !obs.ResourceUpToDate {
		t.Error("the monitor is not up to date after the dashboard changed what spec.initProvider gave")
	}
	if updates := api.updates("monitor", id); len(updates) != 0 {
		t.Errorf("the provider put the description back: %+v", updates)
	}
}

// disableActiveMonitoring has a default, false, which the Terraform provider
// plans for a configuration that leaves it out: under Crossplane a field the
// manifest leaves out of a record that exists keeps the record's value.
func TestMonitoringTurnedOffInInitProviderStaysTheDashboardsToTurnBackOn(t *testing.T) {
	api := newFakeAPI(t)
	api.serve("monitor", "oneuptime_monitor", monitorAsOneUptimeCreatesIt)
	r := newReconciler(t, api)

	mg := newMonitor("staging-api", "Website")
	mg.Spec.InitProvider.DisableActiveMonitoring = ptrTo(true)
	r.create("oneuptime_monitor", mg)
	id := meta.GetExternalName(mg)
	if got := api.creates("monitor")[0].Data["disableActiveMonitoring"]; got != true {
		t.Fatalf("the monitor was created with disableActiveMonitoring %v, want true", got)
	}

	for _, monitoringOff := range []bool{true, false, true} {
		api.set("monitor", id, map[string]any{"disableActiveMonitoring": monitoringOff})
		obs, err := r.reconcile("oneuptime_monitor", mg)
		if err != nil {
			t.Fatalf("the reconcile with monitoring off %v: %v", monitoringOff, err)
		}
		if !obs.ResourceUpToDate {
			t.Errorf("with monitoring off %v in the dashboard, the monitor is not up to date", monitoringOff)
		}
	}
	assertNotLateInitialized(t, mg.Spec.ForProvider, []string{"disableActiveMonitoring"})
	if updates := api.updates("monitor", id); len(updates) != 0 {
		t.Errorf("the provider put the switch back: %+v", updates)
	}
}

func TestWhatSpecForProviderGivesIsPutBack(t *testing.T) {
	api := newFakeAPI(t)
	api.serve("monitor", "oneuptime_monitor", monitorAsOneUptimeCreatesIt)
	r := newReconciler(t, api)

	mg := newMonitor("billing-api", "Website")
	mg.Spec.ForProvider.Description = ptrTo("Kept by the manifest")
	// spec.forProvider wins over spec.initProvider.
	mg.Spec.InitProvider.Description = ptrTo("Never used")
	r.create("oneuptime_monitor", mg)
	id := meta.GetExternalName(mg)
	if got := api.creates("monitor")[0].Data["description"]; got != "Kept by the manifest" {
		t.Fatalf("the monitor was created with the description %v", got)
	}
	if _, err := r.reconcile("oneuptime_monitor", mg); err != nil {
		t.Fatalf("the reconcile after the create: %v", err)
	}

	api.set("monitor", id, map[string]any{"description": "Changed in the dashboard"})
	obs, err := r.reconcile("oneuptime_monitor", mg)
	if err != nil {
		t.Fatalf("the reconcile after the dashboard's change: %v", err)
	}
	if obs.ResourceUpToDate {
		t.Fatal("a change to what spec.forProvider gives reads as up to date")
	}
	updates := api.updates("monitor", id)
	if len(updates) != 1 || updates[0].Data["description"] != "Kept by the manifest" {
		t.Errorf("the provider did not put the description back: %+v", updates)
	}
}

// Without LateInitialize nothing is copied into spec.forProvider, and the
// create still gives the resource its external name, which Crossplane
// records itself: a record is created in the reconcile that asks for it.
func TestAPolicyWithoutLateInitializeCopiesNothingAndStillNamesTheRecord(t *testing.T) {
	api := newFakeAPI(t)
	api.serve("monitor", "oneuptime_monitor", monitorAsOneUptimeCreatesIt)
	r := newReconciler(t, api)

	mg := newMonitor("no-late-init", "Metrics")
	mg.SetManagementPolicies(xpv2.ManagementPolicies{
		xpv2.ManagementActionObserve,
		xpv2.ManagementActionCreate,
		xpv2.ManagementActionUpdate,
		xpv2.ManagementActionDelete,
	})
	r.create("oneuptime_monitor", mg)
	id := meta.GetExternalName(mg)
	if id == "" {
		t.Fatal("the create gave the resource no external name")
	}
	if provider.Resources["oneuptime_monitor"].UseAsync {
		t.Fatal("a monitor is created in the background: only late initialization would record its ID")
	}

	before := jsonFields(t, mg.Spec.ForProvider)
	obs, err := r.reconcile("oneuptime_monitor", mg)
	if err != nil {
		t.Fatalf("the reconcile after the create: %v", err)
	}
	if !obs.ResourceUpToDate {
		t.Error("the monitor is not up to date after the create")
	}
	if after := jsonFields(t, mg.Spec.ForProvider); len(after) != len(before) {
		t.Errorf("spec.forProvider went from %v to %v without LateInitialize", sortedFieldNames(before), sortedFieldNames(after))
	}
	if meta.GetExternalName(mg) != id {
		t.Errorf("the external name moved from %s to %s", id, meta.GetExternalName(mg))
	}
}
