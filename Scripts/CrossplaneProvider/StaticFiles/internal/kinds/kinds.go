// Package kinds names the managed resource kind of each Terraform resource,
// and the CRD of each kind. It embeds nothing, so cmd/schema can use it
// before config/schema.json exists.
package kinds

import (
	"fmt"
	"slices"
	"strings"

	"github.com/crossplane/upjet/v2/pkg/types/name"
	"github.com/gobuffalo/flect"
)

// ResourcePrefix is the start of every Terraform resource name.
const ResourcePrefix = "oneuptime"

// Every kind's generated Go types are <Kind>Spec, <Kind>Status and
// <Kind>List, so a kind whose own name ends in one of these words would take
// another kind's: oneuptime_monitor_status would be MonitorStatus, the type
// of Monitor's status. Such a kind gets Definition added.
var reservedEndings = []string{"Spec", "Status", "List"}

// Of returns the kind of a Terraform resource: its name without the
// provider's prefix, in CamelCase, with Upjet's acronyms (AI, API, SLO, ID
// and the rest) in capitals. oneuptime_status_page is StatusPage.
func Of(terraformName string) string {
	kind := name.NewFromSnake(strings.TrimPrefix(terraformName, ResourcePrefix+"_")).Camel
	for _, ending := range reservedEndings {
		if strings.HasSuffix(kind, ending) {
			return kind + "Definition"
		}
	}
	return kind
}

// FieldName returns the name a Terraform attribute has in a managed
// resource's spec or status: monitor_status_id is monitorStatusId.
func FieldName(attribute string) string {
	return name.NewFromSnake(attribute).LowerCamelComputed
}

// controller-gen names a kind's CRD, and the file it writes it to, by the
// kind's plural: of two kinds with one plural, the second's CRD was written
// over the first's, and the first was a kind no cluster could install
// (#10144). paths gives such a kind a plural of its own, which Upjet writes
// into the kind's +kubebuilder:resource marker as path=. The kind whose CRD
// the packages have installed keeps its plural: a CRD's name is its plural,
// and a new name would be a new CRD, without the resources of the old one.
var paths = map[string]string{
	// oneuptime_on_call_schedule_layer: a layer of an on-call schedule, and
	// its settings. oneuptime_on_call_schedule_layers, who takes turns in
	// the layers and their order, is OnCallScheduleLayers, a plural already,
	// so both kinds were oncallschedulelayers, and every package had
	// OnCallScheduleLayers' CRD alone.
	"OnCallScheduleLayer": "oncallschedulelayerdefinitions",
}

// Path returns the plural a kind's CRD has in place of the one
// controller-gen would give it, for Upjet's config.Resource.Path: "" for a
// kind that keeps controller-gen's.
func Path(kind string) string {
	return paths[kind]
}

// CRD is what a kind's CRD is named by in its API group: the kinds of its
// objects and of their lists, and the plural and singular the API server
// serves them by. The CRD itself is <plural>.<group>, and controller-gen
// writes it to <group>_<plural>.yaml.
type CRD struct {
	Kind     string
	ListKind string
	Plural   string
	Singular string
}

// CRDOf returns the names controller-gen gives the CRD of a kind, with the
// path of its +kubebuilder:resource marker ("" for none): the path as its
// plural, or else the kind's plural as flect makes it, in lower case, and
// the kind in lower case as its singular. flect is what controller-gen
// pluralizes with, at the one version go.mod has for both, and
// config/crds_test.go holds these names to the CRDs it writes.
func CRDOf(kind, path string) CRD {
	plural := path
	if plural == "" {
		plural = strings.ToLower(flect.Pluralize(kind))
	}
	return CRD{
		Kind:     kind,
		ListKind: kind + "List",
		Plural:   plural,
		Singular: strings.ToLower(kind),
	}
}

// Clashes returns a line, sorted, for each name that two or more of an API
// group's CRDs have, the CRDs given by what each stands for: a Terraform
// resource, or one of the provider's own kinds. The API server serves a CRD
// only under a plural and a singular, and a kind and a list kind, that no
// other CRD of its group has, and controller-gen writes CRDs of one plural to
// one file, each over the one before.
func Clashes(crds map[string]CRD) []string {
	resourceNames := map[string][]string{}
	kindNames := map[string][]string{}
	for of, crd := range crds {
		owner := fmt.Sprintf("%s (%s)", crd.Kind, of)
		for _, n := range distinct(crd.Plural, crd.Singular) {
			resourceNames[n] = append(resourceNames[n], owner)
		}
		for _, n := range distinct(crd.Kind, crd.ListKind) {
			kindNames[n] = append(kindNames[n], owner)
		}
	}
	clashes := append(clashesOf(resourceNames, "plural or singular"), clashesOf(kindNames, "kind or list kind")...)
	slices.Sort(clashes)
	return clashes
}

func clashesOf(owners map[string][]string, what string) []string {
	var clashes []string
	for n, of := range owners {
		if len(of) > 1 {
			slices.Sort(of)
			clashes = append(clashes, fmt.Sprintf("%s: the %s of %s", n, what, strings.Join(of, " and ")))
		}
	}
	return clashes
}

// The names given, each once: a CRD may have one name twice, as
// OnCallScheduleLayers is its plural and its singular.
func distinct(names ...string) []string {
	var out []string
	for _, n := range names {
		if n != "" && !slices.Contains(out, n) {
			out = append(out, n)
		}
	}
	return out
}
