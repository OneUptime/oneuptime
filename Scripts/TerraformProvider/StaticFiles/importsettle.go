package provider

// IMPORTS THAT SETTLE.
//
// Someone imports what they made in the dashboard into a configuration they
// wrote by hand. The import reads the record as OneUptime keeps it, which is
// not always how a configuration writes the same thing:
//
//   - a timestamp comes back in UTC with milliseconds -
//     "2030-01-01T00:00:00.000Z" for a configuration's "2030-01-01T00:00:00Z";
//   - a number comes back as the 64-bit float OneUptime keeps it as - 99.93055555555556
//     for a configuration's 100 * (1 - 1 / 1440);
//   - a JSON value comes back whole, with the keys OneUptime fills in itself -
//     a schedule layer's restriction times carry "weeklyRestrictionTimes": []
//     the configuration never wrote;
//   - a monitor's steps come back with every criteria's defaults written out,
//     and a bare origin with its trailing slash (monitorsteps.go).
//
// Each of those planned an update right after the import, of things nobody
// changed. The plan modifiers here keep what the state holds when the
// configuration says the same thing: the plan shows no change, the state
// keeps OneUptime's spelling, and Terraform accepts a planned value that
// equals the prior one where the configuration's is equivalent.
//
// The framework marks every attribute OneUptime sets "(known after apply)"
// as soon as the configuration differs from the state at all, before any
// plan modifier runs. So the last step of every resource's ModifyPlan,
// keepStateWhenNothingChanges, gives those back their state values when the
// plan modifiers have kept everything a configuration sets: no update runs,
// so nothing OneUptime sets changes either, and the plan says "No changes".
//
// Timestamps and numbers have one meaning however they are written, so they
// are compared that way always. A JSON value - and a monitor's steps - is
// compared as a subset only while it holds what an import read
// (isImportedFromServer): only then can the state hold keys the
// configuration never wrote. The import names those attributes in the
// private state, and an update that writes one from the configuration takes
// it off (keepImportedFromServer): its state is then what the configuration
// says, and taking a key out of the configuration is a change again.

import (
	"context"
	"encoding/json"
	"reflect"
	"sort"

	"github.com/hashicorp/terraform-plugin-framework/diag"
	"github.com/hashicorp/terraform-plugin-framework/path"
	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/planmodifier"
	"github.com/hashicorp/terraform-plugin-go/tftypes"
)

// The private state key an import leaves: the attributes whose state is
// still the record as OneUptime keeps it, every key it fills in itself
// included - a JSON array of their names.
const importedFromServerKey = "imported_from_server"

// privateState is what a resource's private state offers: the framework's
// privatestate.ProviderData, which is internal to it.
type privateState interface {
	GetKey(ctx context.Context, key string) ([]byte, diag.Diagnostics)
	SetKey(ctx context.Context, key string, value []byte) diag.Diagnostics
}

// noPrivateState: no private state to read or write - none given, or a nil
// *privatestate.ProviderData inside the interface.
func noPrivateState(private privateState) bool {
	if private == nil {
		return true
	}
	value := reflect.ValueOf(private)
	return value.Kind() == reflect.Ptr && value.IsNil()
}

// importedFromServer is the attributes the private state says still hold
// what an import read.
func importedFromServer(ctx context.Context, private privateState) []string {
	if noPrivateState(private) {
		return nil
	}
	value, diags := private.GetKey(ctx, importedFromServerKey)
	if diags.HasError() || len(value) == 0 {
		return nil
	}
	var attributes []string
	if json.Unmarshal(value, &attributes) != nil {
		return nil
	}
	return attributes
}

func setImportedFromServer(ctx context.Context, private privateState, attributes []string) diag.Diagnostics {
	if noPrivateState(private) {
		return nil
	}
	if len(attributes) == 0 {
		return private.SetKey(ctx, importedFromServerKey, nil)
	}
	sorted := append([]string(nil), attributes...)
	sort.Strings(sorted)
	value, err := json.Marshal(sorted)
	if err != nil {
		return nil
	}
	return private.SetKey(ctx, importedFromServerKey, value)
}

// markImportedFromServer is what an import leaves in the private state: the
// resource's attributes that may hold keys a configuration never writes.
func markImportedFromServer(ctx context.Context, private privateState, attributes []string) diag.Diagnostics {
	return setImportedFromServer(ctx, private, attributes)
}

// keepImportedFromServer is what an update leaves: the attributes it wrote
// from the configuration - written[name] true - no longer hold what the
// import read.
func keepImportedFromServer(ctx context.Context, private privateState, written map[string]bool) diag.Diagnostics {
	kept := []string{}
	for _, attribute := range importedFromServer(ctx, private) {
		if !written[attribute] {
			kept = append(kept, attribute)
		}
	}
	return setImportedFromServer(ctx, private, kept)
}

// forgetImportedFromServer is what a create leaves: nothing it holds was
// imported.
func forgetImportedFromServer(ctx context.Context, private privateState) diag.Diagnostics {
	return setImportedFromServer(ctx, private, nil)
}

// isImportedFromServer says whether an attribute still holds what an import
// read, with nothing written over it since.
func isImportedFromServer(ctx context.Context, private privateState, attribute path.Path) bool {
	name := attribute.String()
	for _, imported := range importedFromServer(ctx, private) {
		if imported == name {
			return true
		}
	}
	return false
}

// ---------------------------------------------------------------------------
// Timestamps: the same instant, however it is written.

type rfc3339SameInstantModifier struct{}

// RFC3339KeepSameInstant keeps the prior timestamp in the plan when the
// configuration's is the same instant written another way.
func RFC3339KeepSameInstant() planmodifier.String {
	return rfc3339SameInstantModifier{}
}

func (m rfc3339SameInstantModifier) Description(ctx context.Context) string {
	return m.MarkdownDescription(ctx)
}

func (m rfc3339SameInstantModifier) MarkdownDescription(_ context.Context) string {
	return "A timestamp that is the same instant as the one in state is no change, however it is written."
}

func (m rfc3339SameInstantModifier) PlanModifyString(_ context.Context, req planmodifier.StringRequest, resp *planmodifier.StringResponse) {
	if req.StateValue.IsNull() || req.StateValue.IsUnknown() ||
		req.ConfigValue.IsNull() || req.ConfigValue.IsUnknown() ||
		req.PlanValue.IsNull() || req.PlanValue.IsUnknown() {
		return
	}

	if req.PlanValue.ValueString() == req.StateValue.ValueString() {
		return
	}

	if sameInstant(req.PlanValue.ValueString(), req.StateValue.ValueString()) {
		resp.PlanValue = req.StateValue
	}
}

// ---------------------------------------------------------------------------
// Numbers: the same number to OneUptime, which keeps a 64-bit float.

type numberSameAPINumberModifier struct{}

// NumberKeepSameAPINumber keeps the prior number in the plan when the
// configuration's is the same number to OneUptime: equal, or the same once
// rounded to the 64-bit float OneUptime keeps (sameAPINumber).
func NumberKeepSameAPINumber() planmodifier.Number {
	return numberSameAPINumberModifier{}
}

func (m numberSameAPINumberModifier) Description(ctx context.Context) string {
	return m.MarkdownDescription(ctx)
}

func (m numberSameAPINumberModifier) MarkdownDescription(_ context.Context) string {
	return "A number OneUptime keeps as the number in state is no change, however many digits it is written with."
}

func (m numberSameAPINumberModifier) PlanModifyNumber(_ context.Context, req planmodifier.NumberRequest, resp *planmodifier.NumberResponse) {
	if req.StateValue.IsNull() || req.StateValue.IsUnknown() ||
		req.ConfigValue.IsNull() || req.ConfigValue.IsUnknown() ||
		req.PlanValue.IsNull() || req.PlanValue.IsUnknown() {
		return
	}

	planned := req.PlanValue.ValueBigFloat()
	prior := req.StateValue.ValueBigFloat()
	if planned == nil || prior == nil || planned.Cmp(prior) == 0 {
		return
	}

	if sameAPINumber(planned, prior) {
		resp.PlanValue = req.StateValue
	}
}

// ---------------------------------------------------------------------------
// JSON values: right after an import, what the configuration writes of the
// record is what it says.

type jsonSubsetAfterImportModifier struct{}

// JSONSubsetKeepImported keeps the imported JSON value in the plan when the
// configuration's is a subset of it: the keys it writes, with the values it
// writes, and the rest OneUptime's own - only right after an import.
func JSONSubsetKeepImported() planmodifier.String {
	return jsonSubsetAfterImportModifier{}
}

func (m jsonSubsetAfterImportModifier) Description(ctx context.Context) string {
	return m.MarkdownDescription(ctx)
}

func (m jsonSubsetAfterImportModifier) MarkdownDescription(_ context.Context) string {
	return "Right after an import, a JSON value whose keys and values are all in the imported one is no change."
}

func (m jsonSubsetAfterImportModifier) PlanModifyString(ctx context.Context, req planmodifier.StringRequest, resp *planmodifier.StringResponse) {
	if req.StateValue.IsNull() || req.StateValue.IsUnknown() ||
		req.ConfigValue.IsNull() || req.ConfigValue.IsUnknown() ||
		req.PlanValue.IsNull() || req.PlanValue.IsUnknown() {
		return
	}

	if req.PlanValue.ValueString() == req.StateValue.ValueString() {
		return
	}

	if isImportedFromServer(ctx, req.Private, req.Path) && jsonSameAfterImport(req.PlanValue.ValueString(), req.StateValue.ValueString()) {
		resp.PlanValue = req.StateValue
	}
}

// jsonSameAfterImport: the JSON a configuration writes says the same as the
// JSON an import read - every key it writes is there, with the value it
// writes, bare origins compared without their trailing slash and timestamps
// by instant (jsonIsSubset). Text that is not JSON is never the same: it was
// compared as it is before.
func jsonSameAfterImport(planned string, imported string) bool {
	var configured, read interface{}
	if json.Unmarshal([]byte(planned), &configured) != nil {
		return false
	}
	if json.Unmarshal([]byte(imported), &read) != nil {
		return false
	}

	return jsonIsSubset(normalizeURLWrapperLeaves(configured), normalizeURLWrapperLeaves(read))
}

// ---------------------------------------------------------------------------
// The whole resource: no update, no change.

// keepStateWhenNothingChanges ends every resource's ModifyPlan. When each
// attribute a configuration sets plans as its value in state - the same
// thing written another way included, which the plan modifiers above have
// kept - nothing will be sent, so nothing OneUptime sets will change either:
// the attributes only OneUptime sets, which the framework made "(known after
// apply)" because the configuration's text differed, keep their state
// values, and the plan is the state. Any real change - another value, a
// value known only at apply, a replacement - leaves the plan as it is.
func keepStateWhenNothingChanges(ctx context.Context, req resource.ModifyPlanRequest, resp *resource.ModifyPlanResponse) {
	if req.State.Raw.IsNull() || resp.Plan.Raw.IsNull() || len(resp.RequiresReplace) > 0 {
		return
	}
	if resp.Plan.Raw.Equal(req.State.Raw) {
		return
	}

	planned := map[string]tftypes.Value{}
	prior := map[string]tftypes.Value{}
	if resp.Plan.Raw.As(&planned) != nil || req.State.Raw.As(&prior) != nil {
		return
	}

	attributes := req.Plan.Schema.GetAttributes()
	for name, value := range planned {
		attribute, ok := attributes[name]
		if !ok {
			return
		}
		setOnlyByOneUptime := attribute.IsComputed() && !attribute.IsOptional() && !attribute.IsRequired()
		if setOnlyByOneUptime && !value.IsKnown() {
			continue
		}
		if !value.Equal(prior[name]) {
			return
		}
	}

	_ = ctx
	resp.Plan.Raw = req.State.Raw.Copy()
}
