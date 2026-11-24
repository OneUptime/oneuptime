package provider

// WHAT ONEUPTIME KEEPS.
//
// Some of a record's values are OneUptime's to keep once the record exists
// (TableColumnMetadata.serverOwned in OneUptime's models, the spec's
// x-oneuptime-server-owned):
//
//   - only OneUptime writes some of them - when a telemetry monitor was last
//     evaluated, how many nodes a cluster's agent counted, whether an owner
//     was told. Those are read-only attributes: no configuration gives them,
//     and no create or update sends them;
//   - a create may give the first value of others, and OneUptime moves them
//     on from there - the status a new monitor starts in, which its checks
//     then change; the end of a state timeline row, which the next change of
//     state sets.
//
// The second kind is optional: the configuration's value is the one the
// record is created with. Once the record exists the plan keeps the state's
// value, whatever the configuration says - the modifiers here - so a value
// OneUptime moved is never a change to undo, and a value only a create sends
// is never a reason to replace the record. Before this, Terraform set a
// monitor's status back to the one its configuration named, and the
// Crossplane provider, which runs this provider in process, copied each of
// these values into its manifests and then fought OneUptime over them
// (#9985). No update sends the attribute, and after a write it keeps its
// planned value (keepPlannedValues), so OneUptime moving it while the write
// runs is no inconsistent result either.
//
// Terraform accepts a planned value that differs from the configuration's
// when it is the prior state's - the provider keeps what it has - but not a
// planned null for a configured value: while OneUptime has no value yet (a
// state timeline row that has not ended), a value configured after the
// create plans as written, with a warning that no update sends it. The
// Crossplane provider takes the state's value then too.

import (
	"context"
	"fmt"

	"github.com/hashicorp/terraform-plugin-framework/attr"
	"github.com/hashicorp/terraform-plugin-framework/diag"
	"github.com/hashicorp/terraform-plugin-framework/path"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/planmodifier"
)

type keepAfterCreateModifier struct{}

const keepAfterCreateDescription = "Once the record exists, OneUptime keeps the value: the plan keeps the state's, whatever the configuration says."

func (m keepAfterCreateModifier) Description(ctx context.Context) string {
	return m.MarkdownDescription(ctx)
}

func (m keepAfterCreateModifier) MarkdownDescription(_ context.Context) string {
	return keepAfterCreateDescription
}

// keepsStateAfterCreate says whether a plan keeps the state's value of an
// attribute OneUptime keeps once the record exists: a record that exists and
// stays (not a create, not a destroy), unless OneUptime has no value yet and
// the configuration gives one, which Terraform plans as written - it takes no
// plan that drops a configured value while the state has none. It warns then
// that the value is never sent.
func keepsStateAfterCreate(attribute path.Path, stateIsNull, planIsNull bool, state, config attr.Value, diagnostics *diag.Diagnostics) bool {
	if stateIsNull || planIsNull {
		return false
	}
	if !state.IsNull() || config.IsNull() || config.IsUnknown() || underCrossplane.Load() {
		return true
	}
	diagnostics.AddAttributeWarning(
		attribute,
		fmt.Sprintf("%s is OneUptime's once the record exists", attribute),
		fmt.Sprintf("OneUptime keeps %s up to date once the record exists, so a value configured after the create is never sent. Take it out of the configuration: it is given only to create the record.", attribute),
	)
	return false
}

// StringKeepAfterCreate keeps the state's value once the record exists.
func StringKeepAfterCreate() planmodifier.String {
	return keepAfterCreateModifier{}
}

func (m keepAfterCreateModifier) PlanModifyString(_ context.Context, req planmodifier.StringRequest, resp *planmodifier.StringResponse) {
	if keepsStateAfterCreate(req.Path, req.State.Raw.IsNull(), req.Plan.Raw.IsNull(), req.StateValue, req.ConfigValue, &resp.Diagnostics) {
		resp.PlanValue = req.StateValue
	}
}

// BoolKeepAfterCreate keeps the state's value once the record exists.
func BoolKeepAfterCreate() planmodifier.Bool {
	return keepAfterCreateModifier{}
}

func (m keepAfterCreateModifier) PlanModifyBool(_ context.Context, req planmodifier.BoolRequest, resp *planmodifier.BoolResponse) {
	if keepsStateAfterCreate(req.Path, req.State.Raw.IsNull(), req.Plan.Raw.IsNull(), req.StateValue, req.ConfigValue, &resp.Diagnostics) {
		resp.PlanValue = req.StateValue
	}
}

// NumberKeepAfterCreate keeps the state's value once the record exists.
func NumberKeepAfterCreate() planmodifier.Number {
	return keepAfterCreateModifier{}
}

func (m keepAfterCreateModifier) PlanModifyNumber(_ context.Context, req planmodifier.NumberRequest, resp *planmodifier.NumberResponse) {
	if keepsStateAfterCreate(req.Path, req.State.Raw.IsNull(), req.Plan.Raw.IsNull(), req.StateValue, req.ConfigValue, &resp.Diagnostics) {
		resp.PlanValue = req.StateValue
	}
}

// ListKeepAfterCreate keeps the state's value once the record exists.
func ListKeepAfterCreate() planmodifier.List {
	return keepAfterCreateModifier{}
}

func (m keepAfterCreateModifier) PlanModifyList(_ context.Context, req planmodifier.ListRequest, resp *planmodifier.ListResponse) {
	if keepsStateAfterCreate(req.Path, req.State.Raw.IsNull(), req.Plan.Raw.IsNull(), req.StateValue, req.ConfigValue, &resp.Diagnostics) {
		resp.PlanValue = req.StateValue
	}
}

// SetKeepAfterCreate keeps the state's value once the record exists.
func SetKeepAfterCreate() planmodifier.Set {
	return keepAfterCreateModifier{}
}

func (m keepAfterCreateModifier) PlanModifySet(_ context.Context, req planmodifier.SetRequest, resp *planmodifier.SetResponse) {
	if keepsStateAfterCreate(req.Path, req.State.Raw.IsNull(), req.Plan.Raw.IsNull(), req.StateValue, req.ConfigValue, &resp.Diagnostics) {
		resp.PlanValue = req.StateValue
	}
}
