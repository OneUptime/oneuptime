package config

// The external-name annotation of a resource version 15 created under a
// management policy without LateInitialize (#9985): the record exists, its
// ID is in status.atProvider, and the annotation, which every reference to
// the resource resolves to, was never written. This version writes it from
// the status before the resource is next reconciled.

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/crossplane/crossplane-runtime/v2/pkg/meta"
	"sigs.k8s.io/controller-runtime/pkg/client"

	"github.com/oneuptime/crossplane-provider-oneuptime/apis/crossplane/v1alpha1"
)

// recordingKube is the Kubernetes API, as far as an initializer uses it: it
// keeps every object it is asked to update.
type recordingKube struct {
	client.Client
	updated []client.Object
}

func (k *recordingKube) Update(_ context.Context, obj client.Object, _ ...client.UpdateOption) error {
	k.updated = append(k.updated, obj.DeepCopyObject().(client.Object))
	return nil
}

// A monitor as version 15 left it under a policy without LateInitialize: its
// record created, given a description from spec.initProvider, observed, and
// no external name.
func monitorWithoutExternalName(t *testing.T, id string) *v1alpha1.Monitor {
	t.Helper()
	manifest := `{
		"apiVersion": "crossplane.oneuptime.com/v1alpha1",
		"kind": "Monitor",
		"metadata": {
			"name": "api",
			"namespace": "team-a",
			"uid": "uid-api",
			"annotations": {
				"crossplane.io/external-create-pending": "2026-11-01T10:00:00Z",
				"crossplane.io/external-create-succeeded": "2026-11-01T10:00:00Z"
			}
		},
		"spec": {
			"managementPolicies": ["Observe", "Create", "Update", "Delete"],
			"forProvider": {"name": "api", "monitorType": "Manual"},
			"initProvider": {"description": "Created by Crossplane"}
		},
		"status": {
			"atProvider": {
				"id": "` + id + `",
				"name": "api",
				"monitorType": "Manual",
				"description": "Created by Crossplane",
				"currentMonitorStatusId": "` + operationalStatusID + `"
			}
		}
	}`
	mg := &v1alpha1.Monitor{}
	if err := json.Unmarshal([]byte(manifest), mg); err != nil {
		t.Fatal(err)
	}
	return mg
}

func TestEveryResourceGetsItsExternalNameFromItsStatus(t *testing.T) {
	for name, r := range provider.Resources {
		if len(r.InitializerFns) != 1 {
			t.Errorf("%s has %d initializers, want the external name's", name, len(r.InitializerFns))
		}
	}
}

func TestAResourceWithoutAnExternalNameGetsItsRecordsID(t *testing.T) {
	const id = "00000000-0000-4000-8000-000000000042"
	mg := monitorWithoutExternalName(t, id)
	kube := &recordingKube{}

	if err := NewExternalNameFromStatus(kube).Initialize(context.Background(), mg); err != nil {
		t.Fatal(err)
	}
	if got := meta.GetExternalName(mg); got != id {
		t.Errorf("the external name is %q, want the record's ID %q", got, id)
	}
	if len(kube.updated) != 1 {
		t.Fatalf("the resource was updated %d times, want once", len(kube.updated))
	}
	if got := meta.GetExternalName(kube.updated[0]); got != id {
		t.Errorf("the update wrote the external name %q, want %q", got, id)
	}
}

func TestAResourceWithAnExternalNameKeepsIt(t *testing.T) {
	mg := monitorWithoutExternalName(t, "00000000-0000-4000-8000-000000000042")
	// One imported by its ID, or created by this version.
	meta.SetExternalName(mg, "00000000-0000-4000-8000-000000000007")
	kube := &recordingKube{}

	if err := NewExternalNameFromStatus(kube).Initialize(context.Background(), mg); err != nil {
		t.Fatal(err)
	}
	if got := meta.GetExternalName(mg); got != "00000000-0000-4000-8000-000000000007" {
		t.Errorf("the external name became %q", got)
	}
	if len(kube.updated) != 0 {
		t.Errorf("the resource was updated %d times, want never", len(kube.updated))
	}
}

func TestAResourceNotYetCreatedHasNoExternalName(t *testing.T) {
	mg := &v1alpha1.Monitor{}
	mg.SetName("api")
	kube := &recordingKube{}

	if err := NewExternalNameFromStatus(kube).Initialize(context.Background(), mg); err != nil {
		t.Fatal(err)
	}
	if got := meta.GetExternalName(mg); got != "" {
		t.Errorf("a resource with no record got the external name %q", got)
	}
	if len(kube.updated) != 0 {
		t.Errorf("the resource was updated %d times, want never", len(kube.updated))
	}
}

// After the upgrade, the monitor is the record version 15 created, and what
// spec.initProvider gave it is the dashboard's: a description changed there
// stays, and no second record is made.
func TestAMonitorVersion15CreatedWithoutLateInitializeRecoversItsExternalName(t *testing.T) {
	api := newFakeAPI(t)
	api.serve("monitor", "oneuptime_monitor", monitorAsOneUptimeCreatesIt)
	id := api.seed("monitor", map[string]any{
		"name":                    "api",
		"monitorType":             "Manual",
		"description":             "Changed in the dashboard",
		"currentMonitorStatusId":  operationalStatusID,
		"keepResponseContent":     true,
		"disableActiveMonitoring": false,
		"isArchived":              false,
	})
	r := newReconciler(t, api)

	// Without the annotation, the provider takes the record for one it has
	// yet to create: spec.initProvider stays in what it plans with, and the
	// dashboard's description would be put back.
	before := monitorWithoutExternalName(t, id)
	if obs, err := r.observe("oneuptime_monitor", before); err == nil && obs.ResourceUpToDate {
		t.Fatalf("without its external name, the monitor is up to date: the test shows nothing")
	}

	mg := monitorWithoutExternalName(t, id)
	if err := NewExternalNameFromStatus(&recordingKube{}).Initialize(context.Background(), mg); err != nil {
		t.Fatal(err)
	}
	r = newReconciler(t, api)
	for i := 0; i < 2; i++ {
		obs, err := r.reconcile("oneuptime_monitor", mg)
		if err != nil {
			t.Fatalf("reconcile %d: %v", i, err)
		}
		if !obs.ResourceUpToDate {
			t.Errorf("reconcile %d: the monitor is not up to date", i)
		}
	}
	if got := meta.GetExternalName(mg); got != id {
		t.Errorf("the external name is %q, want the record's ID %q", got, id)
	}
	if updates := api.updates("monitor", id); len(updates) != 0 {
		t.Errorf("the provider wrote to the monitor: %+v", updates)
	}
	if creates := api.creates("monitor"); len(creates) != 0 {
		t.Errorf("the provider created another monitor: %+v", creates)
	}
	if got := api.record("monitor", id)["description"]; got != "Changed in the dashboard" {
		t.Errorf("the description is %v, want the dashboard's", got)
	}
}
