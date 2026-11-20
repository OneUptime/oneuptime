package config

// WHAT A MANIFEST LAST APPLIED OF THE FIELDS PEOPLE AND ONEUPTIME BOTH CHANGE.
//
// Some fields are a person's to set and OneUptime's to change too, on its
// own ("shared", #10052): the labels a label rule adds to a monitor, an
// exception OneUptime resolves, the site discovery finds a device at.
// Crossplane puts a record back the way spec.forProvider says at every
// reconcile, so a manifest that names such a field would undo OneUptime's
// change each time: reopen the exception, take the rule's label off. The
// provider does not:
//
//   - a value is sent to create the record, and again when the manifest's
//     value changes; OneUptime's change in between stays;
//   - a list of IDs, such as labels, is held to the entries the manifest
//     declares: an entry OneUptime added stays, an entry the manifest
//     declares is put back if it goes, and an entry taken out of the
//     manifest is taken off the record.
//
// For both it has to know what the manifest said when it was last applied,
// and keeps that in the resource's crossplane.oneuptime.com/last-applied
// annotation: {"generation": 4, "fields": {"labels": [...], "isResolved":
// false}}, each field by its name in the manifest. The Terraform provider
// plans each reconcile with it (clients.TerraformSetupBuilder hands it over:
// LastAppliedOf), and this file keeps it up to date at the start of each
// reconcile (lastAppliedRecorder):
//
//   - before the record exists: what the create will send - every field the
//     manifest gives but one only an update writes (generatedSharedUpdateOnly);
//   - once a reconcile has observed the record and finished at the
//     resource's generation (Synced at it, and Ready): what spec.forProvider
//     says has been applied, and is recorded - all of it when the
//     generation is new (a person's edit, applied), and otherwise the
//     fields not recorded yet (one only an update writes, sent by the
//     reconcile after the create);
//   - a resource with nothing recorded whose record OneUptime has - one an
//     earlier version of the provider made, which copied such fields into
//     spec.forProvider by late initialization, or one adopted by its ID once
//     it is first observed: its values are taken as applied, so OneUptime's
//     changes stay, and its lists as declaring nothing known (null), so no
//     entry is taken off a record because an earlier version copied it into
//     the manifest. A list stays so until the manifest changes that list -
//     not when late initialization of other fields moves the generation on
//     (Copied keeps the list as it was). From then on, an entry taken out
//     goes.
//
// A resource adopted by its ID is not recorded until it is observed: its
// first reconcile sends what its manifest says, as any adoption does.

import (
	"context"
	"encoding/json"
	"reflect"
	"sort"

	"github.com/crossplane/crossplane-runtime/v2/pkg/meta"
	"github.com/crossplane/crossplane-runtime/v2/pkg/reconciler/managed"
	xpresource "github.com/crossplane/crossplane-runtime/v2/pkg/resource"
	xpv2 "github.com/crossplane/crossplane/apis/v2/core/v2"
	ujconfig "github.com/crossplane/upjet/v2/pkg/config"
	"github.com/crossplane/upjet/v2/pkg/resource"
	"github.com/crossplane/upjet/v2/pkg/types/name"
	"github.com/hashicorp/terraform-plugin-sdk/v2/helper/schema"
	"github.com/pkg/errors"
	corev1 "k8s.io/api/core/v1"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

// LastAppliedAnnotation holds what a resource's manifest said, when it was
// last applied, of the fields people and OneUptime both change.
const LastAppliedAnnotation = "crossplane.oneuptime.com/last-applied"

// lastApplied is the annotation's value.
type lastApplied struct {
	// The resource's metadata.generation the fields are of.
	Generation int64 `json:"generation"`
	// Each field the manifest gave, by its name in the manifest: a list's
	// IDs, or a value. A list recorded as null declares nothing known: one
	// an earlier version of the provider may have filled in.
	Fields map[string]any `json:"fields"`
	// Each list recorded as null, as the manifest held it then: it stays
	// null until the manifest's list itself changes, whatever else moves
	// the resource's generation on (late initialization of other fields).
	Copied map[string]any `json:"copied,omitempty"`
}

// SharedFields returns the fields of a resource that people set and
// OneUptime changes too, by Terraform name, in order.
func SharedFields(terraformName string) []string {
	var fields []string
	for field, kind := range ServerOwned(terraformName) {
		if kind == ServerOwnedShared {
			fields = append(fields, field)
		}
	}
	sort.Strings(fields)
	return fields
}

// SharedFieldsOnlyAnUpdateSends returns the fields of a resource that people
// and OneUptime both change and no create sends: an update writes them.
func SharedFieldsOnlyAnUpdateSends(terraformName string) map[string]bool {
	fields := map[string]bool{}
	for _, field := range generatedSharedUpdateOnly[terraformName] {
		fields[field] = true
	}
	return fields
}

// manifestName is a field's name in a manifest: is_resolved is isResolved.
func manifestName(terraformName string) string {
	return name.NewFromSnake(terraformName).LowerCamelComputed
}

// terraformName is a field's Terraform name, from its name in a manifest.
func terraformName(manifestName string) string {
	return name.NewFromCamel(manifestName).Snake
}

// readLastApplied reads a resource's annotation: what is recorded, and
// whether anything is.
func readLastApplied(mg xpresource.Managed) (lastApplied, bool) {
	text, ok := mg.GetAnnotations()[LastAppliedAnnotation]
	if !ok || text == "" {
		return lastApplied{}, false
	}
	var record lastApplied
	if err := json.Unmarshal([]byte(text), &record); err != nil || record.Fields == nil {
		// Unreadable, as if nothing were recorded: no entry is taken off.
		return lastApplied{}, false
	}
	return record, true
}

// LastAppliedOf returns what a resource's manifest last applied of the fields
// people and OneUptime both change, by Terraform name, and whether anything
// is recorded: what the Terraform provider plans the resource's reconcile
// with (xpprovider.FrameworkProviderFor). A field spec.initProvider gives,
// and spec.forProvider no longer does, is left out: it was moved there to be
// the dashboard's from now on, so the entries of a list moved there stay.
func LastAppliedOf(mg xpresource.Managed) (bool, map[string]any) {
	record, recorded := readLastApplied(mg)
	fields := map[string]any{}
	if !recorded {
		return false, fields
	}
	var forProvider, initProvider map[string]any
	if tr, ok := mg.(resource.Terraformed); ok {
		forProvider, _ = tr.GetParameters()
		initProvider, _ = tr.GetInitParameters()
	}
	for field, value := range record.Fields {
		name := terraformName(field)
		if initProvider[name] != nil && forProvider[name] == nil {
			continue
		}
		fields[name] = value
	}
	return true, fields
}

// NewLastAppliedRecorder returns the initializer that keeps a resource's
// last-applied annotation up to date: nil for one with no fields people and
// OneUptime both change.
func NewLastAppliedRecorder(r *ujconfig.Resource) ujconfig.NewInitializerFn {
	fields := SharedFields(r.Name)
	if len(fields) == 0 {
		return nil
	}
	entries := map[string]bool{}
	for _, field := range fields {
		if s, _ := FieldOf(r.TerraformResource, field); s != nil && (s.Type == schema.TypeList || s.Type == schema.TypeSet) {
			entries[field] = true
		}
	}
	shared := sharedFieldsOf{
		fields:     fields,
		entries:    entries,
		updateOnly: SharedFieldsOnlyAnUpdateSends(r.Name),
	}
	return func(kube client.Client) managed.Initializer {
		return &lastAppliedRecorder{kube: kube, shared: shared}
	}
}

// sharedFieldsOf is what the recorder knows of a resource's shared fields.
type sharedFieldsOf struct {
	// By Terraform name.
	fields []string
	// The fields that are lists or sets of IDs.
	entries map[string]bool
	// The fields no create sends.
	updateOnly map[string]bool
}

type lastAppliedRecorder struct {
	kube   client.Client
	shared sharedFieldsOf
}

// Initialize records what the resource's manifest has applied, when that
// changed since it last did.
func (r *lastAppliedRecorder) Initialize(ctx context.Context, mg xpresource.Managed) error {
	record, changed, err := nextLastApplied(mg, r.shared)
	if err != nil || !changed {
		return err
	}
	text, err := json.Marshal(record)
	if err != nil {
		return errors.Wrap(err, "cannot record what the manifest last applied")
	}
	meta.AddAnnotations(mg, map[string]string{LastAppliedAnnotation: string(text)})
	return errors.Wrap(r.kube.Update(ctx, mg), "cannot record what the manifest last applied")
}

// nextLastApplied is what the annotation should hold now, and whether that
// differs from what it holds.
func nextLastApplied(mg xpresource.Managed, shared sharedFieldsOf) (lastApplied, bool, error) {
	tr, ok := mg.(resource.Terraformed)
	if !ok {
		return lastApplied{}, false, nil
	}
	parameters, err := tr.GetParameters()
	if err != nil {
		return lastApplied{}, false, errors.Wrap(err, "cannot read spec.forProvider")
	}
	declared := map[string]any{}
	for _, field := range shared.fields {
		if value, ok := parameters[field]; ok && value != nil {
			declared[manifestName(field)] = value
		}
	}

	generation := mg.GetGeneration()
	current, recorded := readLastApplied(mg)

	// Not created yet: what the create will send.
	if meta.GetExternalName(mg) == "" {
		next := lastApplied{Generation: generation, Fields: map[string]any{}}
		for field, value := range declared {
			if !shared.updateOnly[terraformName(field)] {
				next.Fields[field] = value
			}
		}
		return next, !recorded || !sameRecord(current, next), nil
	}

	if !recorded {
		if !observed(tr) {
			// Adopted by its ID: its first reconcile sends what the manifest says.
			return lastApplied{}, false, nil
		}
		// Made by an earlier version, or adopted and observed: its values as
		// applied, its lists as declaring nothing known.
		next := lastApplied{Generation: generation, Fields: map[string]any{}, Copied: map[string]any{}}
		for field, value := range declared {
			if shared.entries[terraformName(field)] {
				next.Fields[field] = nil
				next.Copied[field] = value
				continue
			}
			next.Fields[field] = value
		}
		return next, true, nil
	}

	if !appliedAtGeneration(mg, generation) {
		return current, false, nil
	}

	// A new generation, applied: what the manifest says now - but a list
	// that declares nothing known stays so until the manifest changes it.
	if current.Generation != generation {
		next := lastApplied{Generation: generation, Fields: declared, Copied: map[string]any{}}
		for field, copied := range current.Copied {
			if value, ok := current.Fields[field]; ok && value == nil && sameJSON(declared[field], copied) {
				next.Fields[field] = nil
				next.Copied[field] = copied
			}
		}
		return next, !sameRecord(current, next), nil
	}

	// The same generation: the fields applied since it was recorded.
	next := lastApplied{Generation: generation, Fields: map[string]any{}, Copied: current.Copied}
	for field, value := range current.Fields {
		next.Fields[field] = value
	}
	for field, value := range declared {
		if _, ok := next.Fields[field]; !ok {
			next.Fields[field] = value
		}
	}
	return next, !sameRecord(current, next), nil
}

func sameRecord(a, b lastApplied) bool {
	return a.Generation == b.Generation &&
		sameJSON(a.Fields, b.Fields) &&
		sameJSON(emptyAsNil(a.Copied), emptyAsNil(b.Copied))
}

// sameJSON says whether two values read the same as JSON.
func sameJSON(a, b any) bool {
	left, errLeft := json.Marshal(a)
	right, errRight := json.Marshal(b)
	return errLeft == nil && errRight == nil && reflect.DeepEqual(left, right)
}

func emptyAsNil(m map[string]any) map[string]any {
	if len(m) == 0 {
		return nil
	}
	return m
}

// appliedAtGeneration says whether a resource's last reconcile observed its
// record and finished at the generation it has: what spec.forProvider says
// now has been applied - an update sent what differed, or nothing needed
// to. The reconcile that creates the record leaves it Creating, not Ready:
// the next one sends what only an update writes.
func appliedAtGeneration(mg xpresource.Managed, generation int64) bool {
	synced := mg.GetCondition(xpv2.TypeSynced)
	ready := mg.GetCondition(xpv2.TypeReady)
	return synced.Status == corev1.ConditionTrue &&
		synced.Reason == xpv2.ReasonReconcileSuccess &&
		synced.ObservedGeneration == generation &&
		ready.Status == corev1.ConditionTrue
}

// observed says whether a resource's status holds its record: it has been
// observed in OneUptime.
func observed(tr resource.Terraformed) bool {
	observation, err := tr.GetObservation()
	if err != nil {
		return false
	}
	id, _ := observation["id"].(string)
	return id != ""
}
