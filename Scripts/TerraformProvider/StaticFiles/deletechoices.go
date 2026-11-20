package provider

// WHAT A DELETE SAYS BESIDES THE RECORD (#9832).
//
// Most deletes name the record and nothing else. OneUptime deletes a custom
// role that workflows run as only when the delete says what they run as
// instead, in the DELETE's body (miscDataProps, the server's
// DeleteOneBy.miscDataProps), and refuses one that does not, naming the
// workflows (Common/Utils/DeveloperDocs/DeleteChoices.ts). The provider
// deleted every resource with no body, so `terraform destroy` of such a role
// failed, and the only way through was to change each workflow first.
//
// Each such choice is an attribute of the resource named for the delete
// (workflows_run_as_on_delete). No create or update sends it and no read
// sets it: it keeps what the configuration says, and the delete sends what
// state holds - so it is set, and applied, before the destroy. Left unset,
// the delete is the one it always was.

import (
	"context"
	"fmt"
	"strings"

	"github.com/hashicorp/terraform-plugin-framework/path"
	"github.com/hashicorp/terraform-plugin-framework/schema/validator"
	"github.com/hashicorp/terraform-plugin-framework/types"
)

// DeleteChoice is one choice a delete takes: its key in miscDataProps, the
// attribute that holds it, and what state holds.
type DeleteChoice struct {
	Key       string
	Attribute string
	Value     types.String
}

// isSet says whether state holds a value for the choice.
func (c DeleteChoice) isSet() bool {
	return !c.Value.IsNull() && !c.Value.IsUnknown() && strings.TrimSpace(c.Value.ValueString()) != ""
}

// DeleteChoicesBody is the DELETE's body for the choices state holds:
// {"miscDataProps": {...}}, or nil when none is set, so the delete is the
// one it always was.
func DeleteChoicesBody(choices []DeleteChoice) map[string]interface{} {
	misc := map[string]interface{}{}

	for _, choice := range choices {
		if choice.isSet() {
			misc[choice.Key] = strings.TrimSpace(choice.Value.ValueString())
		}
	}

	if len(misc) == 0 {
		return nil
	}

	return map[string]interface{}{"miscDataProps": misc}
}

// DeleteChoicesHint is what to add to a refused delete: `hint`, which says
// how to give the choice in Terraform, when OneUptime refused the delete for
// a choice it needs - its words name miscDataProps.<key> - and the
// configuration gave none. Empty otherwise: a delete that gave a choice was
// refused for something the API's own words say.
func DeleteChoicesHint(err error, choices []DeleteChoice, hint string) string {
	if err == nil || hint == "" {
		return ""
	}

	for _, choice := range choices {
		if choice.isSet() {
			return ""
		}
	}

	message := err.Error()

	for _, choice := range choices {
		if strings.Contains(message, "miscDataProps."+choice.Key) {
			return "\n\n" + hint
		}
	}

	return ""
}

// deleteChoiceWithValidator holds a choice to the one it goes with: given
// only while `attribute` is `value`, and needed then
// (workflows_run_as_custom_role_id_on_delete, with
// workflows_run_as_on_delete = "CustomRole").
type deleteChoiceWithValidator struct {
	attribute string
	value     string
}

// DeleteChoiceRequiredWith is that validator.
func DeleteChoiceRequiredWith(attribute string, value string) validator.String {
	return deleteChoiceWithValidator{attribute: attribute, value: value}
}

func (v deleteChoiceWithValidator) Description(ctx context.Context) string {
	return v.MarkdownDescription(ctx)
}

func (v deleteChoiceWithValidator) MarkdownDescription(_ context.Context) string {
	return fmt.Sprintf("given only, and needed, while %s is %q", v.attribute, v.value)
}

func (v deleteChoiceWithValidator) ValidateString(ctx context.Context, req validator.StringRequest, resp *validator.StringResponse) {
	if req.ConfigValue.IsUnknown() {
		return
	}

	var other types.String
	diags := req.Config.GetAttribute(ctx, path.Root(v.attribute), &other)
	if diags.HasError() {
		resp.Diagnostics.Append(diags...)
		return
	}

	// Known only at apply: the apply's own refusal says what is wrong.
	if other.IsUnknown() {
		return
	}

	isGiven := !req.ConfigValue.IsNull()
	otherIsValue := !other.IsNull() && other.ValueString() == v.value

	switch {
	case isGiven && !otherIsValue:
		resp.Diagnostics.AddAttributeError(
			req.Path,
			"Invalid Attribute Combination",
			fmt.Sprintf(
				"%s goes with %s = %q, and that is not what %s says. Set %s = %q, or leave %s out.",
				req.Path, v.attribute, v.value, v.attribute, v.attribute, v.value, req.Path,
			),
		)
	case !isGiven && otherIsValue:
		resp.Diagnostics.AddAttributeError(
			req.Path,
			"Missing Attribute Configuration",
			fmt.Sprintf("%s is %q, which needs %s too.", v.attribute, v.value, req.Path),
		)
	}
}
