package provider

/*
 * An attribute OneUptime changes only together with a new value of
 * another, in the same write (the OpenAPI spec's
 * x-oneuptime-changes-only-with, from the model's changesOnlyWith).
 *
 * A monitor secret's secret_type is one: it changes only together with a new
 * secret_value, which OneUptime reads for the new type, because the value a
 * secret holds means something else in the other type (OneUptime issue
 * #9760). The dashboard asks for the value again whenever the type changes,
 * and the API refuses a type sent without one.
 *
 * The provider's Update sends only what changed between state and plan, so
 * a plan that changed secret_type and kept secret_value sent the type alone,
 * and OneUptime refused it half-way through the apply (#9814). The
 * resource's ModifyPlan now refuses that plan instead, before anything is
 * written, and says what to change. A plan that changes both updates the
 * secret in place, with one request that carries both: the secret keeps its
 * ID and the monitors and labels it is shared with.
 *
 * Not a replacement: OneUptime changes the type in place, and a new secret
 * would lose its ID and its history - and a one-time code secret replaced by
 * a Text secret holding the same setup key would send that key where the
 * code went, which OneUptime refuses in place for that reason.
 */

import (
	"context"
	"fmt"
	"strings"

	"github.com/hashicorp/terraform-plugin-framework/path"
	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-go/tftypes"
)

// RequireChangedTogether refuses a plan that changes attribute and does not
// give companion a new value. A new value is one the plan knows, that is set
// and not empty, and that is not the value in state. A value known only at
// apply - one another resource makes - may well be new, so it is left to
// OneUptime to judge then; so is an attribute known only at apply. Creating
// a resource and destroying one change nothing in place.
func RequireChangedTogether(ctx context.Context, req resource.ModifyPlanRequest, resp *resource.ModifyPlanResponse, attribute string, companion string) {
	_ = ctx

	if req.State.Raw.IsNull() || resp.Plan.Raw.IsNull() {
		return
	}

	planned := map[string]tftypes.Value{}
	prior := map[string]tftypes.Value{}
	if resp.Plan.Raw.As(&planned) != nil || req.State.Raw.As(&prior) != nil {
		return
	}

	plannedValue, ok := planned[attribute]
	if !ok || !plannedValue.IsFullyKnown() || plannedValue.Equal(prior[attribute]) {
		return
	}

	companionValue, ok := planned[companion]
	if !ok || !companionValue.IsFullyKnown() {
		return
	}

	empty := isEmptyValue(companionValue)
	if !empty && !companionValue.Equal(prior[companion]) {
		return
	}

	resp.Diagnostics.AddAttributeError(
		path.Root(attribute),
		fmt.Sprintf("%s changes only with a new %s", attribute, companion),
		changedAloneDetail(req, attribute, companion, prior[attribute], plannedValue, empty),
	)
}

// isEmptyValue: no value, or text that is empty.
func isEmptyValue(value tftypes.Value) bool {
	if value.IsNull() {
		return true
	}

	if value.Type().Is(tftypes.String) {
		var text string
		if value.As(&text) == nil {
			return strings.TrimSpace(text) == ""
		}
	}

	return false
}

// changedAloneDetail says what the plan does, why it cannot be applied and
// what to change. It names the attribute's values only when they are plain
// text that is not sensitive.
func changedAloneDetail(req resource.ModifyPlanRequest, attribute string, companion string, from tftypes.Value, to tftypes.Value, empty bool) string {
	change := fmt.Sprintf("This plan changes %s", attribute)

	fromText, fromShown := shownText(req, attribute, from)
	toText, toShown := shownText(req, attribute, to)
	if fromShown && toShown {
		change = fmt.Sprintf("This plan changes %s from %q to %q", attribute, fromText, toText)
	}

	companionChange := fmt.Sprintf("keeps %s as it is", companion)
	if empty {
		companionChange = fmt.Sprintf("leaves %s empty", companion)
	}

	return fmt.Sprintf(
		"%s and %s. OneUptime changes %s only in the same write as a new %s, so the apply would fail. Give %s its new value in this change, or keep %s as it is.",
		change, companionChange, attribute, companion, companion, attribute,
	)
}

// shownText is a value as a sentence may show it: plain text of an
// attribute that is not sensitive.
func shownText(req resource.ModifyPlanRequest, attribute string, value tftypes.Value) (string, bool) {
	if value.IsNull() || !value.IsKnown() || !value.Type().Is(tftypes.String) {
		return "", false
	}

	if definition, ok := req.Plan.Schema.GetAttributes()[attribute]; !ok || definition.IsSensitive() {
		return "", false
	}

	var text string
	if value.As(&text) != nil {
		return "", false
	}

	return text, true
}
