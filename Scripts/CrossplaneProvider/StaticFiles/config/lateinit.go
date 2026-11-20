package config

// LATE INITIALIZATION, spec.initProvider, AND WHAT ONEUPTIME KEEPS.
//
// After a record is created, each reconcile copies into spec.forProvider
// every field the manifest left out and OneUptime has a value for (late
// initialization), and from then on puts the record back the way
// spec.forProvider says. Three kinds of field must not be treated so
// (#9985):
//
//   - A field OneUptime alone writes - when a telemetry monitor was last
//     evaluated, how many nodes a cluster's agent counted - is read only in
//     the Terraform provider (TableColumnMetadata.serverOwned "always"), so
//     its kind has it in status.atProvider alone: nothing to copy, nothing
//     to put back.
//   - A field a manifest may give to create the record, which OneUptime
//     moves on from there - a monitor's current status - is never copied
//     ("after-create": lateInitialization below), and the Terraform
//     provider never compares it after the create. Copied, the provider set
//     a monitor's status back after every check that moved it.
//   - A field spec.initProvider gives is the record's to start with and the
//     dashboard's after: it is never copied either (lateInitialization),
//     and once the record exists it is left out of the configuration the
//     provider plans with (initProviderAtCreateOnly), so the provider never
//     puts it back.
//
// And a fourth (#10052): a field people set and OneUptime changes too - the
// labels a label rule adds, an exception OneUptime resolves ("shared") - is
// never copied either. Copied, an exception's isResolved went into
// spec.forProvider as false, and the provider reopened the exception each
// time OneUptime resolved it. Written in the manifest, such a field is sent
// when the manifest's value changes, not each time OneUptime moves the
// record's (lastapplied.go, and the Terraform provider's shared.go).

import (
	"sort"

	ujconfig "github.com/crossplane/upjet/v2/pkg/config"
	"github.com/crossplane/upjet/v2/pkg/types/name"
	"github.com/hashicorp/terraform-plugin-sdk/v2/helper/schema"
)

const (
	// ServerOwnedAlways is a field only OneUptime writes.
	ServerOwnedAlways = "always"
	// ServerOwnedAfterCreate is a field a manifest may give to create the
	// record, which OneUptime keeps from then on.
	ServerOwnedAfterCreate = "after-create"
	// ServerOwnedShared is a field people set and OneUptime changes too.
	ServerOwnedShared = "shared"
)

// ServerOwned returns the fields of a resource OneUptime keeps, or changes
// too, once its record exists, and how: ServerOwnedAlways,
// ServerOwnedAfterCreate or ServerOwnedShared.
func ServerOwned(terraformName string) map[string]string {
	fields := map[string]string{}
	for field, kind := range generatedServerOwned[terraformName] {
		fields[field] = kind
	}
	return fields
}

// settableFields are the top-level fields a manifest can give: the
// resource's arguments, in order.
func settableFields(r *ujconfig.Resource) []string {
	if r.TerraformResource == nil {
		return nil
	}
	var fields []string
	for field, s := range r.TerraformResource.Schema {
		if field != "id" && (s.Optional || s.Required) {
			fields = append(fields, field)
		}
	}
	sort.Strings(fields)
	return fields
}

// lateInitialization configures what late initialization leaves alone: a
// field OneUptime keeps after the create or changes too, always, and every
// other field while spec.initProvider gives it.
func lateInitialization(r *ujconfig.Resource) {
	neverCopied := map[string]bool{}
	for field, kind := range ServerOwned(r.Name) {
		if kind == ServerOwnedAfterCreate || kind == ServerOwnedShared {
			neverCopied[field] = true
		}
	}
	for _, field := range settableFields(r) {
		if neverCopied[field] {
			r.LateInitializer.IgnoredFields = append(r.LateInitializer.IgnoredFields, field)
			continue
		}
		r.LateInitializer.ConditionalIgnoredFields = append(r.LateInitializer.ConditionalIgnoredFields, field)
	}
}

// keepsOneUptimesValueWhenLeftOut says whether the Terraform provider plans
// OneUptime's value for a field the configuration leaves out of a record
// that exists - an optional field it reads back - rather than taking it to
// mean "unset" (a write-only field) or refusing it (a required one).
func keepsOneUptimesValueWhenLeftOut(s *schema.Schema) bool {
	return s != nil && s.Optional && s.Computed
}

// identifyByExternalName sets the configuration's id from the external name,
// once there is one: the record exists. It runs before the configuration
// injector (initProviderAtCreateOnly), which reads it.
func identifyByExternalName(params map[string]any, externalName string) {
	if externalName != "" {
		params["id"] = externalName
	}
}

// initProviderAtCreateOnly leaves out of the configuration the provider
// plans with, once the record exists, each top-level field spec.initProvider
// gives and spec.forProvider does not: the Terraform provider then plans
// OneUptime's value for it, so a change made in the dashboard is never put
// back. Upjet merges spec.initProvider into every reconcile's configuration
// and, for a Terraform Plugin Framework resource such as every OneUptime
// one, never leaves its fields out of the plan afterwards; this does. A
// required field stays in: the Terraform provider takes no record without
// it.
func initProviderAtCreateOnly(r *ujconfig.Resource) ujconfig.ConfigurationInjector {
	return func(forProvider map[string]any, params map[string]any) error {
		if id, _ := params["id"].(string); id == "" {
			// No record yet: spec.initProvider is what creates it.
			return nil
		}
		for field := range params {
			if field == "id" || inForProvider(forProvider, field) {
				continue
			}
			if r.TerraformResource == nil || !keepsOneUptimesValueWhenLeftOut(r.TerraformResource.Schema[field]) {
				continue
			}
			delete(params, field)
		}
		return nil
	}
}

// inForProvider says whether spec.forProvider gives a field, by its name in
// the manifest: as a value, or as the Secret that holds it.
func inForProvider(forProvider map[string]any, field string) bool {
	jsonName := name.NewFromSnake(field).LowerCamelComputed
	for _, key := range []string{jsonName, jsonName + "SecretRef"} {
		if value, ok := forProvider[key]; ok && value != nil {
			return true
		}
	}
	return false
}
