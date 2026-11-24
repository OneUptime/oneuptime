package config

// THE EXTERNAL NAME, UNDER ANY MANAGEMENT POLICY.
//
// A resource's crossplane.io/external-name annotation is the ID of its
// record, and what every reference to the resource resolves to (a status
// page resource's monitorIdRef, a monitor group resource's). A record is
// created in the reconcile that asks for it (ResourceDefaults: UseAsync
// false), so Crossplane writes the annotation itself right after the
// create, whatever the resource's management policy.
//
// Before, records were created in the background, and the ID reached the
// annotation only through late initialization: a resource whose policy left
// LateInitialize out never had one, and every reference to it stayed at
// "referenced field was empty" (#9985). Its status still holds the ID, so
// externalNameFromStatus writes the annotation from there before such a
// resource is next reconciled: one an older provider made recovers on the
// upgrade, with no edit.

import (
	"context"

	"github.com/crossplane/crossplane-runtime/v2/pkg/meta"
	"github.com/crossplane/crossplane-runtime/v2/pkg/reconciler/managed"
	xpresource "github.com/crossplane/crossplane-runtime/v2/pkg/resource"
	ujconfig "github.com/crossplane/upjet/v2/pkg/config"
	"github.com/crossplane/upjet/v2/pkg/resource"
	"github.com/pkg/errors"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

// NewExternalNameFromStatus is the initializer of every resource: it writes
// the external name of a resource that has none from the ID its status
// observed.
var NewExternalNameFromStatus ujconfig.NewInitializerFn = func(kube client.Client) managed.Initializer {
	return &externalNameFromStatus{kube: kube}
}

type externalNameFromStatus struct {
	kube client.Client
}

// Initialize writes the external name from status.atProvider's id when the
// resource has none: the record exists, and its ID is known.
func (e *externalNameFromStatus) Initialize(ctx context.Context, mg xpresource.Managed) error {
	if meta.GetExternalName(mg) != "" {
		return nil
	}
	tr, ok := mg.(resource.Terraformed)
	if !ok {
		return nil
	}
	observation, err := tr.GetObservation()
	if err != nil {
		return errors.Wrap(err, "cannot read the observed record")
	}
	id, _ := observation["id"].(string)
	if id == "" {
		return nil
	}
	meta.SetExternalName(mg, id)
	return errors.Wrap(e.kube.Update(ctx, mg), "cannot record the external name of the observed record")
}
