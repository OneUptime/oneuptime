// Package kinds names the managed resource kind of each Terraform resource.
// It embeds nothing, so cmd/schema can use it before config/schema.json
// exists.
package kinds

import (
	"strings"

	"github.com/crossplane/upjet/v2/pkg/types/name"
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
