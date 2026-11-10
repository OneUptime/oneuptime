// Package config says how Upjet makes the managed resources of the OneUptime
// Terraform provider's resources: their group, kinds, external names and
// the references between them.
package config

import (
	// The schema and the metadata are written by generation, then embedded.
	_ "embed"
	"sort"
	"strings"

	ujconfig "github.com/crossplane/upjet/v2/pkg/config"
	"github.com/hashicorp/terraform-plugin-sdk/v2/helper/schema"

	"github.com/oneuptime/terraform-provider-oneuptime/xpprovider"

	"github.com/oneuptime/crossplane-provider-oneuptime/internal/kinds"
)

const (
	// Group is the API group of every managed resource, and of the
	// ProviderConfigs: ShortGroup under RootGroup. Upjet writes a group's
	// kinds to apis/<short group>/<version>, and finds a reference's type
	// there, so every kind has the short group, the same one.
	Group = ShortGroup + "." + RootGroup
	// ShortGroup is the first label of Group.
	ShortGroup = "crossplane"
	// RootGroup is the rest of Group.
	RootGroup = "oneuptime.com"
	// ModulePath is the Go module of this provider.
	ModulePath = "github.com/oneuptime/crossplane-provider-oneuptime"
	// Version of every managed resource kind.
	Version = "v1alpha1"
)

//go:embed schema.json
var providerSchema []byte

//go:embed provider-metadata.yaml
var providerMetadata []byte

// GetProvider returns the configuration of every managed resource.
func GetProvider() *ujconfig.Provider {
	pc := ujconfig.NewProvider(providerSchema, kinds.ResourcePrefix, ModulePath, providerMetadata,
		ujconfig.WithShortName(kinds.ResourcePrefix),
		ujconfig.WithRootGroup(RootGroup),
		// Every resource is a Terraform Plugin Framework resource, run in
		// process: no Terraform CLI, no plugin process.
		ujconfig.WithIncludeList([]string{}),
		ujconfig.WithTerraformPluginFrameworkIncludeList([]string{".+"}),
		ujconfig.WithTerraformPluginFrameworkProvider(xpprovider.FrameworkProvider("crossplane")),
		ujconfig.WithFeaturesPackage("internal/features"),
		ujconfig.WithDefaultResourceOptions(ResourceDefaults()),
	)
	references := References()
	for _, terraformName := range sortedKeys(references) {
		fields := references[terraformName]
		pc.AddResourceConfigurator(terraformName, func(r *ujconfig.Resource) {
			for field, target := range fields {
				// A field OneUptime alone writes (project_id, which the
				// API key decides) takes no reference.
				if _, settable := FieldOf(r.TerraformResource, field); settable && pc.Resources[target] != nil {
					r.References[field] = ujconfig.Reference{TerraformName: target}
				}
			}
		})
	}
	pc.ConfigureResources()
	return pc
}

// FieldOf finds a field of a resource by its dotted Terraform path, through
// nested objects (monitor_steps.criteria.monitor_status_id), and says
// whether a manifest can set it.
func FieldOf(r *schema.Resource, path string) (*schema.Schema, bool) {
	if r == nil {
		return nil, false
	}
	fields := r.Schema
	parts := strings.Split(path, ".")
	for i, part := range parts {
		s := fields[part]
		if s == nil {
			return nil, false
		}
		if i == len(parts)-1 {
			return s, s.Optional || s.Required
		}
		nested, ok := s.Elem.(*schema.Resource)
		if !ok {
			return nil, false
		}
		fields = nested.Schema
	}
	return nil, false
}

// ResourceDefaults puts every resource in one API group, names its kind
// after its Terraform name and identifies it by the ID OneUptime gives it.
func ResourceDefaults() ujconfig.ResourceOption {
	return func(r *ujconfig.Resource) {
		r.ShortGroup = ShortGroup
		r.Kind = kinds.Of(r.Name)
		r.Version = Version
		r.ExternalName = ujconfig.IdentifierFromProvider
		// A field's description is the schema's, written for Kubernetes by
		// cmd/schema. The docs the metadata is scraped from repeat each one
		// with a Terraform type in front, which Upjet would add to it.
		if r.MetaResource != nil {
			r.MetaResource.ArgumentDocs = nil
		}
	}
}

// References returns, for each resource, the fields that hold the IDs of
// other resources and the Terraform resource the IDs are of: a field with a
// reference also takes its target by name (fieldRef, fieldRefs) or by labels
// (fieldSelector), as Crossplane resolves it.
func References() map[string]map[string]string {
	all := map[string]map[string]string{}
	for terraformName, fields := range generatedReferences {
		all[terraformName] = map[string]string{}
		for field, target := range fields {
			all[terraformName][field] = target
		}
	}
	for _, terraformName := range []string{"oneuptime_monitor", "oneuptime_monitor_template"} {
		if all[terraformName] == nil {
			all[terraformName] = map[string]string{}
		}
		for field, target := range monitorStepReferences {
			all[terraformName][field] = target
		}
	}
	return all
}

// A monitor's (and a monitor template's) steps are written by hand in the
// Terraform provider, so the spec's relations do not reach them: the
// statuses, severities, labels, policies and teams their criteria name.
var monitorStepReferences = map[string]string{
	"monitor_steps.criteria.monitor_status_id":              "oneuptime_monitor_status",
	"monitor_steps.criteria.incidents.incident_severity_id": "oneuptime_incident_severity",
	"monitor_steps.criteria.incidents.label_ids":            "oneuptime_label",
	"monitor_steps.criteria.incidents.on_call_policy_ids":   "oneuptime_on_call_policy",
	"monitor_steps.criteria.incidents.owner_team_ids":       "oneuptime_team",
	"monitor_steps.criteria.alerts.alert_severity_id":       "oneuptime_alert_severity",
	"monitor_steps.criteria.alerts.label_ids":               "oneuptime_label",
	"monitor_steps.criteria.alerts.on_call_policy_ids":      "oneuptime_on_call_policy",
	"monitor_steps.criteria.alerts.owner_team_ids":          "oneuptime_team",
}

func sortedKeys(m map[string]map[string]string) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}
