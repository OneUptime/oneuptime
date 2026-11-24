package config

// What people and OneUptime both change (#10052), through whole reconciles
// as the managed reconciler runs them (reconciler.cycle): a monitor's
// labels, which a label rule adds to; the site discovery moves a network
// device to; a telemetry ingestion key OneUptime switches off; a cluster's
// AI setting, which its agent reports and only an update writes. And the
// upgrade, from manifests an earlier version filled by late
// initialization. An update of a monitor's labels adds and takes off single
// labels (#10135), never the whole list, so one a rule adds while a
// reconcile runs stays.

import (
	"context"
	"errors"
	"sort"
	"strings"
	"testing"

	"github.com/crossplane/crossplane-runtime/v2/pkg/meta"
	xpv2 "github.com/crossplane/crossplane/apis/v2/core/v2"

	"github.com/oneuptime/crossplane-provider-oneuptime/apis/crossplane/v1alpha1"
)

var errFake = errors.New("the API refused the update")

// A label a rule adds while a reconcile runs.
const laterRuleLabel = "1abe1000-0000-4000-8000-0000000000a9"

const (
	frankfurtSite = "517e0000-0000-4000-8000-000000000001"
	berlinSite    = "517e0000-0000-4000-8000-000000000002"
	parisSite     = "517e0000-0000-4000-8000-000000000003"
)

// labelsOf is a record's labels, as the API keeps them, in order.
func labelsOf(record map[string]any) string {
	items, _ := record["labels"].([]any)
	ids := []string{}
	for _, item := range items {
		switch typed := item.(type) {
		case map[string]any:
			if id, ok := typed["_id"].(string); ok {
				ids = append(ids, id)
			}
		case string:
			ids = append(ids, typed)
		}
	}
	sort.Strings(ids)
	return strings.Join(ids, ",")
}

func ids(values ...string) string {
	sorted := append([]string{}, values...)
	sort.Strings(sorted)
	return strings.Join(sorted, ",")
}

// addedByRule adds a label to a record, as a label rule does.
func addedByRule(api *fakeAPI, path, id, label string) {
	items, _ := api.record(path, id)["labels"].([]any)
	api.set(path, id, map[string]any{"labels": append(append([]any{}, items...), map[string]any{"_id": label})})
}

func cycles(t *testing.T, r *reconciler, terraformName string, mg *v1alpha1.Monitor, times int) {
	t.Helper()
	for i := 0; i < times; i++ {
		if _, err := r.cycle(terraformName, mg); err != nil {
			t.Fatalf("reconcile %d: %v", i, err)
		}
	}
}

// A labelled monitor, created through a reconcile, with the rule's label added after.
func labelledMonitor(t *testing.T, labels ...string) (*fakeAPI, *reconciler, *v1alpha1.Monitor, string) {
	t.Helper()
	api := newFakeAPI(t)
	api.serve("monitor", "oneuptime_monitor", monitorAsOneUptimeCreatesIt)
	r := newReconciler(t, api)
	mg := newMonitor("homepage", "Manual")
	mg.SetGeneration(1)
	for _, label := range labels {
		mg.Spec.ForProvider.Labels = append(mg.Spec.ForProvider.Labels, ptrTo(label))
	}
	if _, err := r.cycle("oneuptime_monitor", mg); err != nil {
		t.Fatalf("the create: %v", err)
	}
	id := meta.GetExternalName(mg)
	if id == "" {
		t.Fatal("the create gave the monitor no external name")
	}
	addedByRule(api, "monitor", id, ruleLabel)
	return api, r, mg, id
}

func TestARulesLabelStaysBesideTheManifests(t *testing.T) {
	api, r, mg, id := labelledMonitor(t, productionLabel)

	cycles(t, r, "oneuptime_monitor", mg, 3)

	if updates := api.updates("monitor", id); len(updates) != 0 {
		t.Fatalf("the provider wrote to the monitor: %+v", updates)
	}
	if got := labelsOf(api.record("monitor", id)); got != ids(productionLabel, ruleLabel) {
		t.Fatalf("the monitor has labels %s, want the manifest's and the rule's", got)
	}
	if got := sortedStrings(mg.Spec.ForProvider.Labels); strings.Join(got, ",") != productionLabel {
		t.Fatalf("spec.forProvider.labels is %v: the rule's label was copied in", got)
	}
	record, ok := recordOf(t, mg)
	if !ok || labelsOfRecord(record) != productionLabel {
		t.Fatalf("recorded %+v", record)
	}
}

func labelsOfRecord(record lastApplied) string {
	items, _ := record.Fields["labels"].([]any)
	values := []string{}
	for _, item := range items {
		if id, ok := item.(string); ok {
			values = append(values, id)
		}
	}
	sort.Strings(values)
	return strings.Join(values, ",")
}

func TestALabelTheManifestAddsJoinsTheRules(t *testing.T) {
	api, r, mg, id := labelledMonitor(t, productionLabel)
	cycles(t, r, "oneuptime_monitor", mg, 1)

	edit(mg, func() {
		mg.Spec.ForProvider.Labels = append(mg.Spec.ForProvider.Labels, ptrTo(teamALabel))
	})
	cycles(t, r, "oneuptime_monitor", mg, 3)

	updates := api.updates("monitor", id)
	if len(updates) != 1 {
		t.Fatalf("%d updates, want the one that adds the label: %+v", len(updates), updates)
	}
	// The label the manifest adds, alone: never the whole list (#10135).
	if _, sent := updates[0].Data["labels"]; sent {
		t.Fatalf("the update sent the labels whole: %+v", updates[0].Data)
	}
	if got := entriesOf(updates[0].AddToList, "labels"); got != teamALabel {
		t.Fatalf("the update added labels %s, want %s alone", got, teamALabel)
	}
	if got := entriesOf(updates[0].RemoveFromList, "labels"); got != "" {
		t.Fatalf("the update took off labels %s", got)
	}
	if got := labelsOf(api.record("monitor", id)); got != ids(productionLabel, teamALabel, ruleLabel) {
		t.Fatalf("the monitor has labels %s, want the manifest's beside the rule's", got)
	}
	if record, _ := recordOf(t, mg); labelsOfRecord(record) != ids(productionLabel, teamALabel) {
		t.Fatalf("recorded %+v", record)
	}
}

// entriesOf is what an update added to a list or took off it, sorted and joined.
func entriesOf(lists map[string]any, list string) string {
	entries, _ := lists[list].([]any)
	values := []string{}
	for _, entry := range entries {
		if id, ok := entry.(string); ok {
			values = append(values, id)
		}
	}
	sort.Strings(values)
	return strings.Join(values, ",")
}

// A label a rule adds after a reconcile observed the monitor, before it
// updates it, stays: the update names only the label the manifest adds.
func TestALabelARuleAddsWhileAReconcileRunsStays(t *testing.T) {
	api, r, mg, id := labelledMonitor(t, productionLabel)
	cycles(t, r, "oneuptime_monitor", mg, 1)

	edit(mg, func() {
		mg.Spec.ForProvider.Labels = append(mg.Spec.ForProvider.Labels, ptrTo(teamALabel))
	})
	r.initialize("oneuptime_monitor", mg)
	ext := r.connect("oneuptime_monitor", mg)
	obs, err := ext.Observe(context.Background(), mg)
	if err != nil {
		t.Fatalf("observe: %v", err)
	}
	if obs.ResourceUpToDate {
		t.Fatal("the edit left the monitor up to date")
	}
	addedByRule(api, "monitor", id, laterRuleLabel)
	if _, err := ext.Update(context.Background(), mg); err != nil {
		t.Fatalf("update: %v", err)
	}

	if got := labelsOf(api.record("monitor", id)); got != ids(productionLabel, teamALabel, ruleLabel, laterRuleLabel) {
		t.Fatalf("the monitor has labels %s, want the label the rule added meanwhile kept", got)
	}
}

func TestALabelTakenOutOfTheManifestGoesAndTheRulesStays(t *testing.T) {
	api, r, mg, id := labelledMonitor(t, productionLabel, teamALabel)
	cycles(t, r, "oneuptime_monitor", mg, 1)

	edit(mg, func() { mg.Spec.ForProvider.Labels = []*string{ptrTo(teamALabel)} })
	cycles(t, r, "oneuptime_monitor", mg, 3)

	if got := labelsOf(api.record("monitor", id)); got != ids(teamALabel, ruleLabel) {
		t.Fatalf("the monitor has labels %s, want the manifest's and the rule's", got)
	}
	if updates := api.updates("monitor", id); len(updates) != 1 {
		t.Fatalf("%d updates, want the one that takes the label off: %+v", len(updates), updates)
	}
}

func TestADeclaredLabelSomeoneTookOffIsPutBack(t *testing.T) {
	api, r, mg, id := labelledMonitor(t, productionLabel, teamALabel)
	cycles(t, r, "oneuptime_monitor", mg, 1)

	api.set("monitor", id, map[string]any{"labels": []any{map[string]any{"_id": productionLabel}, map[string]any{"_id": ruleLabel}}})
	cycles(t, r, "oneuptime_monitor", mg, 2)

	if got := labelsOf(api.record("monitor", id)); got != ids(productionLabel, teamALabel, ruleLabel) {
		t.Fatalf("the monitor has labels %s, want every declared label back, and the rule's", got)
	}
}

func TestAMonitorThatLeavesItsLabelsOutNeverHasThemCopiedOrTakenOff(t *testing.T) {
	api, r, mg, id := labelledMonitor(t)
	cycles(t, r, "oneuptime_monitor", mg, 3)

	assertNotLateInitialized(t, mg.Spec.ForProvider, []string{"labels"})
	if updates := api.updates("monitor", id); len(updates) != 0 {
		t.Fatalf("the provider wrote to the monitor: %+v", updates)
	}
	if got := labelsOf(api.record("monitor", id)); got != ruleLabel {
		t.Fatalf("the monitor has labels %s, want the rule's", got)
	}
}

// A monitor's manifest as an earlier version left it: late initialization
// copied the labels the record had then into spec.forProvider, the rule's
// with them, and it was synced.
func monitorLeftWithLabels(t *testing.T, api *fakeAPI, labels ...string) (*v1alpha1.Monitor, string) {
	t.Helper()
	items := []any{}
	for _, label := range labels {
		items = append(items, map[string]any{"_id": label})
	}
	id := api.seed("monitor", map[string]any{
		"name":                    "homepage",
		"monitorType":             "Manual",
		"currentMonitorStatusId":  operationalStatusID,
		"keepResponseContent":     true,
		"disableActiveMonitoring": false,
		"isArchived":              false,
		"description":             "",
		"labels":                  items,
	})
	mg := newMonitor("homepage", "Manual")
	mg.SetGeneration(3)
	meta.SetExternalName(mg, id)
	for _, label := range labels {
		mg.Spec.ForProvider.Labels = append(mg.Spec.ForProvider.Labels, ptrTo(label))
	}
	mg.Status.AtProvider.ID = ptrTo(id)
	appliedAt(mg, 3)
	return mg, id
}

func TestAfterTheUpgradeAManifestsLateInitializedLabelsAreNeverTakenOff(t *testing.T) {
	api := newFakeAPI(t)
	api.serve("monitor", "oneuptime_monitor", monitorAsOneUptimeCreatesIt)
	r := newReconciler(t, api)
	mg, id := monitorLeftWithLabels(t, api, productionLabel, ruleLabel)

	cycles(t, r, "oneuptime_monitor", mg, 2)
	if updates := api.updates("monitor", id); len(updates) != 0 {
		t.Fatalf("the upgrade wrote to the monitor: %+v", updates)
	}

	// Taking the copied labels out of the manifest takes nothing off.
	edit(mg, func() { mg.Spec.ForProvider.Labels = nil })
	cycles(t, r, "oneuptime_monitor", mg, 2)
	if got := labelsOf(api.record("monitor", id)); got != ids(productionLabel, ruleLabel) {
		t.Fatalf("the monitor has labels %s, want every label it had", got)
	}

	// From an edit on, the manifest's labels are its own: added, then taken off.
	edit(mg, func() { mg.Spec.ForProvider.Labels = []*string{ptrTo(teamALabel)} })
	cycles(t, r, "oneuptime_monitor", mg, 2)
	if got := labelsOf(api.record("monitor", id)); got != ids(productionLabel, teamALabel, ruleLabel) {
		t.Fatalf("the monitor has labels %s", got)
	}
	edit(mg, func() { mg.Spec.ForProvider.Labels = []*string{} })
	cycles(t, r, "oneuptime_monitor", mg, 2)
	if got := labelsOf(api.record("monitor", id)); got != ids(productionLabel, ruleLabel) {
		t.Fatalf("the monitor has labels %s, want the label the manifest added taken off", got)
	}
}

// A manifest cannot hold an empty list, so the last label goes with the list.
func TestTheLastLabelTakenOutOfTheManifestGoesAndTheRulesStays(t *testing.T) {
	api, r, mg, id := labelledMonitor(t, teamALabel)
	cycles(t, r, "oneuptime_monitor", mg, 1)

	edit(mg, func() { mg.Spec.ForProvider.Labels = nil })
	cycles(t, r, "oneuptime_monitor", mg, 3)

	if got := labelsOf(api.record("monitor", id)); got != ruleLabel {
		t.Fatalf("the monitor has labels %s, want the rule's alone", got)
	}
	if updates := api.updates("monitor", id); len(updates) != 1 {
		t.Fatalf("%d updates, want the one that takes the label off: %+v", len(updates), updates)
	}
}

// A list moved to spec.initProvider is the dashboard's from then on.
func TestAListMovedToInitProviderKeepsItsEntries(t *testing.T) {
	api, r, mg, id := labelledMonitor(t, teamALabel)
	cycles(t, r, "oneuptime_monitor", mg, 1)

	edit(mg, func() {
		mg.Spec.InitProvider.Labels = mg.Spec.ForProvider.Labels
		mg.Spec.ForProvider.Labels = nil
	})
	cycles(t, r, "oneuptime_monitor", mg, 3)

	if got := labelsOf(api.record("monitor", id)); got != ids(teamALabel, ruleLabel) {
		t.Fatalf("the monitor has labels %s, want every one it had", got)
	}
	if updates := api.updates("monitor", id); len(updates) != 0 {
		t.Fatalf("the provider wrote to the monitor: %+v", updates)
	}
}

func TestANetworkDeviceStaysAtTheSiteDiscoveryMovedItTo(t *testing.T) {
	api := newFakeAPI(t)
	api.serve("network-device", "oneuptime_network_device", nil)
	r := newReconciler(t, api)
	mg := &v1alpha1.NetworkDevice{ObjectMeta: objectMeta("core-switch")}
	mg.SetGeneration(1)
	mg.SetManagementPolicies(defaultPolicy)
	mg.Spec.ForProvider.Name = ptrTo("core-switch")
	mg.Spec.ForProvider.Hostname = ptrTo("10.0.0.1")
	mg.Spec.ForProvider.SiteID = ptrTo(frankfurtSite)

	if _, err := r.cycle("oneuptime_network_device", mg); err != nil {
		t.Fatalf("the create: %v", err)
	}
	id := meta.GetExternalName(mg)
	if got := api.creates("network-device")[0].Data["siteId"]; got != frankfurtSite {
		t.Fatalf("the create sent the site %v", got)
	}

	// Discovery finds it in Berlin.
	api.set("network-device", id, map[string]any{"siteId": berlinSite})
	for i := 0; i < 3; i++ {
		if _, err := r.cycle("oneuptime_network_device", mg); err != nil {
			t.Fatalf("reconcile %d: %v", i, err)
		}
	}
	if updates := api.updates("network-device", id); len(updates) != 0 {
		t.Fatalf("the provider moved the device back: %+v", updates)
	}

	// The manifest moves it to Paris: sent, once.
	edit(mg, func() { mg.Spec.ForProvider.SiteID = ptrTo(parisSite) })
	for i := 0; i < 3; i++ {
		if _, err := r.cycle("oneuptime_network_device", mg); err != nil {
			t.Fatalf("reconcile %d after the edit: %v", i, err)
		}
	}
	updates := api.updates("network-device", id)
	if len(updates) != 1 || updates[0].Data["siteId"] != parisSite {
		t.Fatalf("updates %+v, want one that moves the device to Paris", updates)
	}

	// And discovery moves it again: it stays.
	api.set("network-device", id, map[string]any{"siteId": berlinSite})
	if _, err := r.cycle("oneuptime_network_device", mg); err != nil {
		t.Fatal(err)
	}
	if got := api.record("network-device", id)["siteId"]; got != berlinSite {
		t.Fatalf("the device is at %v, want where discovery found it", got)
	}
}

func telemetryKey(enabled *bool) *v1alpha1.TelemetryIngestionKey {
	mg := &v1alpha1.TelemetryIngestionKey{ObjectMeta: objectMeta("collector")}
	mg.SetGeneration(1)
	mg.SetManagementPolicies(defaultPolicy)
	mg.Spec.ForProvider.Name = ptrTo("Collector")
	mg.Spec.ForProvider.IsEnabled = enabled
	return mg
}

func TestAKeyOneUptimeSwitchedOffStaysOff(t *testing.T) {
	for _, c := range []struct {
		name    string
		enabled *bool
	}{
		{"its manifest leaves the switch out", nil},
		{"its manifest switches it on", ptrTo(true)},
	} {
		t.Run(c.name, func(t *testing.T) {
			api := newFakeAPI(t)
			api.serve("telemetry-ingestion-key", "oneuptime_telemetry_ingestion_key", func(record map[string]any) {
				if record["isEnabled"] == false && c.enabled == nil {
					record["isEnabled"] = true
				}
			})
			r := newReconciler(t, api)
			mg := telemetryKey(c.enabled)
			if _, err := r.cycle("oneuptime_telemetry_ingestion_key", mg); err != nil {
				t.Fatalf("the create: %v", err)
			}
			id := meta.GetExternalName(mg)

			// A Vercel uninstall switches the key OneUptime provisioned off.
			api.set("telemetry-ingestion-key", id, map[string]any{"isEnabled": false})
			for i := 0; i < 3; i++ {
				if _, err := r.cycle("oneuptime_telemetry_ingestion_key", mg); err != nil {
					t.Fatalf("reconcile %d: %v", i, err)
				}
			}
			if updates := api.updates("telemetry-ingestion-key", id); len(updates) != 0 {
				t.Fatalf("the provider switched the key back on: %+v", updates)
			}
			if c.enabled == nil {
				assertNotLateInitialized(t, mg.Spec.ForProvider, []string{"isEnabled"})
			}
		})
	}
}

func TestAClustersAISettingOnlyAnUpdateWritesIsSentOnceThenLeftToItsAgent(t *testing.T) {
	api := newFakeAPI(t)
	api.serve("kubernetes-cluster", "oneuptime_kubernetes_cluster", func(record map[string]any) {
		// OneUptime's default: no create sends the setting.
		record["isAiInvestigationEnabled"] = true
	})
	r := newReconciler(t, api)
	mg := &v1alpha1.KubernetesCluster{ObjectMeta: objectMeta("production")}
	mg.SetGeneration(1)
	mg.SetManagementPolicies(defaultPolicy)
	mg.Spec.ForProvider.Name = ptrTo("Production")
	mg.Spec.ForProvider.ClusterIdentifier = ptrTo("production-eu-1")
	mg.Spec.ForProvider.IsAIInvestigationEnabled = ptrTo(false)

	if _, err := r.cycle("oneuptime_kubernetes_cluster", mg); err != nil {
		t.Fatalf("the create: %v", err)
	}
	id := meta.GetExternalName(mg)
	if _, sent := api.creates("kubernetes-cluster")[0].Data["isAiInvestigationEnabled"]; sent {
		t.Fatal("the create sent a setting only an update writes")
	}

	// The reconcile after the create sends it.
	for i := 0; i < 2; i++ {
		if _, err := r.cycle("oneuptime_kubernetes_cluster", mg); err != nil {
			t.Fatalf("reconcile %d: %v", i, err)
		}
	}
	updates := api.updates("kubernetes-cluster", id)
	if len(updates) != 1 || updates[0].Data["isAiInvestigationEnabled"] != false {
		t.Fatalf("updates %+v, want the one that sends the manifest's setting", updates)
	}

	// Its agent reports the value its Helm chart has: left to it.
	api.set("kubernetes-cluster", id, map[string]any{"isAiInvestigationEnabled": true})
	for i := 0; i < 3; i++ {
		if _, err := r.cycle("oneuptime_kubernetes_cluster", mg); err != nil {
			t.Fatalf("reconcile %d after the report: %v", i, err)
		}
	}
	if updates := api.updates("kubernetes-cluster", id); len(updates) != 1 {
		t.Fatalf("the provider set the agent's setting back: %+v", updates)
	}
}

func TestAfterTheUpgradeALateInitializedSwitchOneUptimeTurnedOffStaysOff(t *testing.T) {
	api := newFakeAPI(t)
	api.serve("telemetry-ingestion-key", "oneuptime_telemetry_ingestion_key", nil)
	r := newReconciler(t, api)
	id := api.seed("telemetry-ingestion-key", map[string]any{"name": "Collector", "isEnabled": false})

	// As an earlier version left it: the switch copied in while it was on.
	mg := telemetryKey(ptrTo(true))
	mg.SetGeneration(2)
	meta.SetExternalName(mg, id)
	mg.Status.AtProvider.ID = ptrTo(id)
	mg.SetConditions(xpv2.Available(), xpv2.ReconcileSuccess().WithObservedGeneration(2))

	for i := 0; i < 3; i++ {
		if _, err := r.cycle("oneuptime_telemetry_ingestion_key", mg); err != nil {
			t.Fatalf("reconcile %d: %v", i, err)
		}
	}
	if updates := api.updates("telemetry-ingestion-key", id); len(updates) != 0 {
		t.Fatalf("the upgrade switched the key back on: %+v", updates)
	}
}
