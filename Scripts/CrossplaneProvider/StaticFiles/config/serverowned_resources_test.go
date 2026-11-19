package config

// What OneUptime keeps on resources other than monitors (#9985), through
// their reconciles as serverowned_test.go drives a monitor's: an incident's
// current state, which its state timeline moves; what a Kubernetes cluster's
// agent reports and counts; and the end of a monitor status timeline row,
// which only a create may give and the next status sets - the replacement
// kind of fight.

import (
	"reflect"
	"testing"

	"github.com/crossplane/crossplane-runtime/v2/pkg/meta"
	xpv2 "github.com/crossplane/crossplane/apis/v2/core/v2"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"

	"github.com/oneuptime/crossplane-provider-oneuptime/apis/crossplane/v1alpha1"
)

const (
	severityID        = "22222222-0000-4000-8000-000000000001"
	identifiedState   = "33333333-0000-4000-8000-000000000001"
	acknowledgedState = "33333333-0000-4000-8000-000000000002"
	resolvedState     = "33333333-0000-4000-8000-000000000003"
)

func objectMeta(name string) metav1.ObjectMeta {
	return metav1.ObjectMeta{Name: name, Namespace: "team-a", UID: types.UID("uid-" + name)}
}

var defaultPolicy = xpv2.ManagementPolicies{xpv2.ManagementActionAll}

func TestAnIncidentKeepsTheStateItsTimelineMoves(t *testing.T) {
	api := newFakeAPI(t)
	api.serve("incident", "oneuptime_incident", func(record map[string]any) {
		if record["currentIncidentStateId"] == nil {
			record["currentIncidentStateId"] = identifiedState
		}
		record["declaredAt"] = "2026-11-19T10:00:00.000Z"
	})
	r := newReconciler(t, api)

	mg := &v1alpha1.Incident{ObjectMeta: objectMeta("checkout-down")}
	mg.Spec.ForProvider.Title = ptrTo("Checkout is down")
	mg.Spec.ForProvider.IncidentSeverityID = ptrTo(severityID)
	mg.SetManagementPolicies(defaultPolicy)
	r.create("oneuptime_incident", mg)
	id := meta.GetExternalName(mg)

	if _, err := r.reconcile("oneuptime_incident", mg); err != nil {
		t.Fatalf("the reconcile after the create: %v", err)
	}
	assertNotLateInitialized(t, mg.Spec.ForProvider, []string{"currentIncidentStateId"})

	// Acknowledged, then resolved, through its state timeline.
	for _, state := range []string{acknowledgedState, resolvedState} {
		api.set("incident", id, map[string]any{"currentIncidentStateId": state})
		obs, err := r.reconcile("oneuptime_incident", mg)
		if err != nil {
			t.Fatalf("the reconcile after the incident moved to %s: %v", state, err)
		}
		if !obs.ResourceUpToDate {
			t.Errorf("the incident is not up to date after it moved to %s", state)
		}
		if got := mg.Status.AtProvider.CurrentIncidentStateID; got == nil || *got != state {
			t.Errorf("status.atProvider shows the state %v, want %s", got, state)
		}
	}
	if updates := api.updates("incident", id); len(updates) != 0 {
		t.Errorf("the provider wrote to the incident: %+v", updates)
	}
}

func TestAKubernetesClustersAgentReportsAreOneUptimesAlone(t *testing.T) {
	api := newFakeAPI(t)
	api.serve("kubernetes-cluster", "oneuptime_kubernetes_cluster", func(record map[string]any) {
		record["otelCollectorStatus"] = "connected"
		record["agentVersion"] = "17.1.0"
		record["lastSeenAt"] = "2026-11-19T10:00:00.000Z"
		record["nodeCount"] = 3
	})
	r := newReconciler(t, api)

	mg := &v1alpha1.KubernetesCluster{ObjectMeta: objectMeta("production")}
	mg.Spec.ForProvider.Name = ptrTo("Production")
	mg.Spec.ForProvider.ClusterIdentifier = ptrTo("production-eu-1")
	mg.SetManagementPolicies(defaultPolicy)
	r.create("oneuptime_kubernetes_cluster", mg)
	id := meta.GetExternalName(mg)

	// The kind has them in status.atProvider alone: nothing to copy.
	for _, field := range []string{"NodeCount", "AgentVersion", "LastSeenAt", "OtelCollectorStatus"} {
		if _, ok := reflect.TypeOf(v1alpha1.KubernetesClusterParameters{}).FieldByName(field); ok {
			t.Errorf("spec.forProvider has %s, which only OneUptime writes", field)
		}
		if _, ok := reflect.TypeOf(v1alpha1.KubernetesClusterObservation{}).FieldByName(field); !ok {
			t.Errorf("status.atProvider has no %s", field)
		}
	}

	if _, err := r.reconcile("oneuptime_kubernetes_cluster", mg); err != nil {
		t.Fatalf("the reconcile after the create: %v", err)
	}

	// The agent reports again: a node more, a new version.
	api.set("kubernetes-cluster", id, map[string]any{
		"nodeCount":    4,
		"agentVersion": "17.2.0",
		"lastSeenAt":   "2026-11-19T10:05:00.000Z",
	})
	obs, err := r.reconcile("oneuptime_kubernetes_cluster", mg)
	if err != nil {
		t.Fatalf("the reconcile after the agent reported: %v", err)
	}
	if !obs.ResourceUpToDate {
		t.Error("the cluster is not up to date after its agent reported")
	}
	if updates := api.updates("kubernetes-cluster", id); len(updates) != 0 {
		t.Errorf("the provider wrote to the cluster: %+v", updates)
	}
	if got := mg.Status.AtProvider.NodeCount; got == nil || *got != 4 {
		t.Errorf("status.atProvider shows %v nodes, want 4", got)
	}
	if got := mg.Status.AtProvider.AgentVersion; got == nil || *got != "17.2.0" {
		t.Errorf("status.atProvider shows the agent version %v, want 17.2.0", got)
	}
}

// A monitor status timeline row's end: only a create may give it, so the
// Terraform provider replaced the row whenever it differed - and Crossplane,
// which cannot replace, failed every reconcile after the next status ended
// the row.
func TestAStatusTimelineRowsEndIsNeverAReplacement(t *testing.T) {
	const monitorID = "44444444-0000-4000-8000-000000000001"
	api := newFakeAPI(t)
	api.serve("monitor-status-timeline", "oneuptime_monitor_status_event", nil)
	r := newReconciler(t, api)

	mg := &v1alpha1.MonitorStatusEvent{ObjectMeta: objectMeta("offline-since-ten")}
	mg.Spec.ForProvider.MonitorID = ptrTo(monitorID)
	mg.Spec.ForProvider.MonitorStatusID = ptrTo(offlineStatusID)
	mg.Spec.ForProvider.StartsAt = ptrTo("2026-11-19T10:00:00.000Z")
	mg.SetManagementPolicies(defaultPolicy)
	r.create("oneuptime_monitor_status_event", mg)
	id := meta.GetExternalName(mg)

	if _, err := r.reconcile("oneuptime_monitor_status_event", mg); err != nil {
		t.Fatalf("the reconcile after the create: %v", err)
	}

	// The monitor comes back up: OneUptime ends this row.
	api.set("monitor-status-timeline", id, map[string]any{"endsAt": "2026-11-19T10:30:00.000Z"})
	for i := 0; i < 2; i++ {
		obs, err := r.reconcile("oneuptime_monitor_status_event", mg)
		if isReplacementError(err) {
			t.Fatalf("reconcile %d fails, as the row cannot be replaced: %v", i, err)
		}
		if err != nil {
			t.Fatalf("reconcile %d: %v", i, err)
		}
		if !obs.ResourceUpToDate {
			t.Errorf("reconcile %d: the row is not up to date after OneUptime ended it", i)
		}
	}
	assertNotLateInitialized(t, mg.Spec.ForProvider, []string{"endsAt"})
	if got := mg.Status.AtProvider.EndsAt; got == nil || *got != "2026-11-19T10:30:00.000Z" {
		t.Errorf("status.atProvider shows the row ending %v", got)
	}
}
