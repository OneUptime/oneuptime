package provider

// UNDER CROSSPLANE.
//
// The OneUptime Crossplane provider runs this provider in process
// (xpprovider), and plans each managed resource with it. Terraform and
// Crossplane read a field a configuration leaves out of a record that
// exists differently:
//
//   - to Terraform, an attribute with a default that the configuration
//     leaves out means its default: taking `disable_active_monitoring` out
//     of a configuration turns monitoring back on;
//   - to Crossplane, a field the manifest leaves out is OneUptime's: its
//     spec.initProvider fields are the record's to start with and the
//     dashboard's after (the Crossplane provider leaves them out of the
//     configuration once the record exists), and under a management policy
//     without LateInitialize, every field the manifest does not give.
//
// So under Crossplane an optional attribute the configuration leaves out of
// a record that exists keeps the state's value, the record's, even when it
// has a default. Under Terraform nothing changes. Before, a monitor created
// with `disableActiveMonitoring: true` in spec.initProvider had its
// monitoring turned back on - its default - at the next reconcile, and the
// dashboard's change of such a field was put back (#9985).

import (
	"context"
	"sync/atomic"

	"github.com/hashicorp/terraform-plugin-framework/path"
	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-go/tftypes"
)

// underCrossplane says the Crossplane provider runs this provider: set by
// xpprovider, which only it calls.
var underCrossplane atomic.Bool

// RunUnderCrossplane has every plan this process makes from now on plan as
// Crossplane reads a manifest. xpprovider calls it.
func RunUnderCrossplane() {
	underCrossplane.Store(true)
}

// KeepLeftOutUnderCrossplane starts every resource's ModifyPlan, before the
// steps that work a value out of another (a person's ID from their email
// address): under Crossplane, each optional attribute the configuration
// leaves out of a record that exists plans the state's value, not its
// default.
func KeepLeftOutUnderCrossplane(_ context.Context, req resource.ModifyPlanRequest, resp *resource.ModifyPlanResponse) {
	if !underCrossplane.Load() || req.State.Raw.IsNull() || resp.Plan.Raw.IsNull() {
		return
	}

	configured := map[string]tftypes.Value{}
	prior := map[string]tftypes.Value{}
	planned := map[string]tftypes.Value{}
	if req.Config.Raw.As(&configured) != nil || req.State.Raw.As(&prior) != nil || resp.Plan.Raw.As(&planned) != nil {
		return
	}

	attributes := req.Plan.Schema.GetAttributes()
	kept := map[string]bool{}
	for name, attribute := range attributes {
		if !attribute.IsOptional() || !attribute.IsComputed() {
			continue
		}
		value, ok := configured[name]
		if !ok || !value.IsNull() {
			continue
		}
		before, ok := prior[name]
		if !ok || planned[name].Equal(before) {
			continue
		}
		kept[name] = true
	}
	if len(kept) == 0 {
		return
	}

	// A new object: the map As gives is the plan's own.
	next := make(map[string]tftypes.Value, len(planned))
	for name, value := range planned {
		next[name] = value
		if kept[name] {
			next[name] = prior[name]
		}
	}
	resp.Plan.Raw = tftypes.NewValue(resp.Plan.Raw.Type(), next)

	// A value kept as it is replaces nothing: its default may have planned so.
	replaces := path.Paths{}
	for _, replaced := range resp.RequiresReplace {
		if steps := replaced.Steps(); len(steps) > 0 {
			if attribute, ok := steps[0].(path.PathStepAttributeName); ok && kept[string(attribute)] {
				continue
			}
		}
		replaces = append(replaces, replaced)
	}
	resp.RequiresReplace = replaces
}
