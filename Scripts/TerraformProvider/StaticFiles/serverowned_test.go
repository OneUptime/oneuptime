package provider

/*
 * The plan modifiers that keep the state's value of an attribute a create
 * gives and OneUptime keeps from then on (serverowned.go), called the way
 * the framework calls them: a create plans the configuration's value, a
 * record that exists plans the state's whatever the configuration says, and
 * a destroy is left alone. How a whole plan and apply of a monitor go is
 * serverowned_plan_test.go's.
 */

import (
	"context"
	"math/big"
	"strings"
	"testing"

	"github.com/hashicorp/terraform-plugin-framework/attr"
	"github.com/hashicorp/terraform-plugin-framework/path"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/planmodifier"
	"github.com/hashicorp/terraform-plugin-framework/tfsdk"
	"github.com/hashicorp/terraform-plugin-framework/types"
	"github.com/hashicorp/terraform-plugin-go/tftypes"
)

// The record a plan is for: none yet (a create), one that exists, or none
// any more (a destroy).
type keepAfterCreateCase struct {
	name       string
	stateNull  bool
	planNull   bool
	wantsState bool
}

var keepAfterCreateCases = []keepAfterCreateCase{
	{name: "a create plans the configuration's value", stateNull: true},
	{name: "a record that exists plans the state's", wantsState: true},
	{name: "a destroy is left alone", planNull: true},
}

var recordType = tftypes.Object{AttributeTypes: map[string]tftypes.Type{"id": tftypes.String}}

func recordValue(isNull bool) tftypes.Value {
	if isNull {
		return tftypes.NewValue(recordType, nil)
	}
	return tftypes.NewValue(recordType, map[string]tftypes.Value{
		"id": tftypes.NewValue(tftypes.String, "5ec7e700-0000-4000-8000-000000000001"),
	})
}

func (c keepAfterCreateCase) state() tfsdk.State {
	return tfsdk.State{Raw: recordValue(c.stateNull)}
}

func (c keepAfterCreateCase) plan() tfsdk.Plan {
	return tfsdk.Plan{Raw: recordValue(c.planNull)}
}

func TestStringKeepAfterCreate(t *testing.T) {
	const (
		created = "11111111-0000-4000-8000-000000000001"
		moved   = "11111111-0000-4000-8000-000000000002"
	)
	for _, c := range keepAfterCreateCases {
		for _, config := range []types.String{types.StringValue(created), types.StringNull(), types.StringUnknown()} {
			state := types.StringValue(moved)
			if c.stateNull {
				state = types.StringNull()
			}
			req := planmodifier.StringRequest{
				Path:        path.Root("current_monitor_status_id"),
				State:       c.state(),
				Plan:        c.plan(),
				StateValue:  state,
				ConfigValue: config,
				PlanValue:   config,
			}
			resp := &planmodifier.StringResponse{PlanValue: req.PlanValue}
			StringKeepAfterCreate().PlanModifyString(context.Background(), req, resp)

			want := config
			if c.wantsState {
				want = state
			}
			if !resp.PlanValue.Equal(want) {
				t.Errorf("%s: with %s configured over %s in state, the plan is %s, want %s", c.name, config, state, resp.PlanValue, want)
			}
		}
	}
}

func TestBoolKeepAfterCreate(t *testing.T) {
	for _, c := range keepAfterCreateCases {
		state := types.BoolValue(true)
		if c.stateNull {
			state = types.BoolNull()
		}
		config := types.BoolValue(false)
		req := planmodifier.BoolRequest{State: c.state(), Plan: c.plan(), StateValue: state, ConfigValue: config, PlanValue: config}
		resp := &planmodifier.BoolResponse{PlanValue: req.PlanValue}
		BoolKeepAfterCreate().PlanModifyBool(context.Background(), req, resp)
		if want := map[bool]types.Bool{true: state, false: config}[c.wantsState]; !resp.PlanValue.Equal(want) {
			t.Errorf("%s: the plan is %s, want %s", c.name, resp.PlanValue, want)
		}
	}
}

func TestNumberKeepAfterCreate(t *testing.T) {
	for _, c := range keepAfterCreateCases {
		state := types.NumberValue(big.NewFloat(7))
		if c.stateNull {
			state = types.NumberNull()
		}
		config := types.NumberValue(big.NewFloat(1))
		req := planmodifier.NumberRequest{State: c.state(), Plan: c.plan(), StateValue: state, ConfigValue: config, PlanValue: config}
		resp := &planmodifier.NumberResponse{PlanValue: req.PlanValue}
		NumberKeepAfterCreate().PlanModifyNumber(context.Background(), req, resp)
		if want := map[bool]types.Number{true: state, false: config}[c.wantsState]; !resp.PlanValue.Equal(want) {
			t.Errorf("%s: the plan is %s, want %s", c.name, resp.PlanValue, want)
		}
	}
}

func TestListAndSetKeepAfterCreate(t *testing.T) {
	for _, c := range keepAfterCreateCases {
		stateList := types.ListValueMust(types.StringType, []attr.Value{types.StringValue("b")})
		stateSet := types.SetValueMust(types.StringType, []attr.Value{types.StringValue("b")})
		if c.stateNull {
			stateList = types.ListNull(types.StringType)
			stateSet = types.SetNull(types.StringType)
		}
		configList := types.ListValueMust(types.StringType, []attr.Value{types.StringValue("a")})
		configSet := types.SetValueMust(types.StringType, []attr.Value{types.StringValue("a")})

		listReq := planmodifier.ListRequest{State: c.state(), Plan: c.plan(), StateValue: stateList, ConfigValue: configList, PlanValue: configList}
		listResp := &planmodifier.ListResponse{PlanValue: listReq.PlanValue}
		ListKeepAfterCreate().PlanModifyList(context.Background(), listReq, listResp)
		if want := map[bool]types.List{true: stateList, false: configList}[c.wantsState]; !listResp.PlanValue.Equal(want) {
			t.Errorf("%s: the list plans %s, want %s", c.name, listResp.PlanValue, want)
		}

		setReq := planmodifier.SetRequest{State: c.state(), Plan: c.plan(), StateValue: stateSet, ConfigValue: configSet, PlanValue: configSet}
		setResp := &planmodifier.SetResponse{PlanValue: setReq.PlanValue}
		SetKeepAfterCreate().PlanModifySet(context.Background(), setReq, setResp)
		if want := map[bool]types.Set{true: stateSet, false: configSet}[c.wantsState]; !setResp.PlanValue.Equal(want) {
			t.Errorf("%s: the set plans %s, want %s", c.name, setResp.PlanValue, want)
		}
	}
}

// While OneUptime has no value yet - a state timeline row that has not
// ended - a value configured after the create is one Terraform takes no
// plan to drop: it plans as written, with a warning that no update sends
// it. The Crossplane provider keeps the state's then too.
func TestAValueConfiguredBeforeOneUptimeHasOne(t *testing.T) {
	existing := keepAfterCreateCases[1]
	configured := types.StringValue("2026-11-19T10:00:00.000Z")
	req := planmodifier.StringRequest{
		Path:        path.Root("ends_at"),
		State:       existing.state(),
		Plan:        existing.plan(),
		StateValue:  types.StringNull(),
		ConfigValue: configured,
		PlanValue:   configured,
	}

	runUnderTerraform(t)
	resp := &planmodifier.StringResponse{PlanValue: req.PlanValue}
	StringKeepAfterCreate().PlanModifyString(context.Background(), req, resp)
	if !resp.PlanValue.Equal(configured) {
		t.Errorf("under Terraform the plan is %s, want the configuration's %s", resp.PlanValue, configured)
	}
	if resp.Diagnostics.HasError() || resp.Diagnostics.WarningsCount() != 1 {
		t.Fatalf("diagnostics %v, want one warning", resp.Diagnostics)
	}
	if detail := resp.Diagnostics.Warnings()[0].Detail(); !strings.Contains(detail, "is never sent") {
		t.Errorf("the warning says %q", detail)
	}

	runUnderCrossplane(t)
	resp = &planmodifier.StringResponse{PlanValue: req.PlanValue}
	StringKeepAfterCreate().PlanModifyString(context.Background(), req, resp)
	if !resp.PlanValue.IsNull() || resp.Diagnostics.WarningsCount() != 0 {
		t.Errorf("under Crossplane the plan is %s with %v, want the state's null and no warning", resp.PlanValue, resp.Diagnostics)
	}

	// With a value in state, the state's wins under Terraform too, silently.
	runUnderTerraform(t)
	req.StateValue = types.StringValue("2026-11-19T09:00:00.000Z")
	resp = &planmodifier.StringResponse{PlanValue: req.PlanValue}
	StringKeepAfterCreate().PlanModifyString(context.Background(), req, resp)
	if !resp.PlanValue.Equal(req.StateValue) || resp.Diagnostics.WarningsCount() != 0 {
		t.Errorf("the plan is %s with %v, want the state's and no warning", resp.PlanValue, resp.Diagnostics)
	}
}

func TestKeepAfterCreateSaysWhatItDoes(t *testing.T) {
	ctx := context.Background()
	for _, description := range []string{
		StringKeepAfterCreate().Description(ctx),
		StringKeepAfterCreate().MarkdownDescription(ctx),
		BoolKeepAfterCreate().Description(ctx),
		NumberKeepAfterCreate().Description(ctx),
		ListKeepAfterCreate().Description(ctx),
		SetKeepAfterCreate().Description(ctx),
	} {
		if description != keepAfterCreateDescription {
			t.Errorf("description %q, want %q", description, keepAfterCreateDescription)
		}
	}
}
