package provider

// oneuptime_user: someone in the API key's project, or invited to it, found
// by email address (or by name, or user ID).
//
// Written by hand, in place of the data source the API would give: the User
// endpoints answer a person about themselves only, so a project API key was
// refused every lookup ("A user session is required to read User"). People
// are found among the project's team members instead (people.go) - exactly
// the people the dashboard's pickers offer - and nobody outside the key's
// project is ever found.

import (
	"context"
	"fmt"
	"strings"

	"github.com/hashicorp/terraform-plugin-framework/attr"
	"github.com/hashicorp/terraform-plugin-framework/datasource"
	"github.com/hashicorp/terraform-plugin-framework/datasource/schema"
	"github.com/hashicorp/terraform-plugin-framework/types"
)

var _ datasource.DataSource = &UserDataSource{}

func NewUserDataSource() datasource.DataSource {
	return &UserDataSource{}
}

// UserDataSource defines the data source implementation.
type UserDataSource struct {
	client *Client
}

// UserDataSourceModel describes the data source data model.
type UserDataSourceModel struct {
	Id                    types.String `tfsdk:"id"`
	Email                 types.String `tfsdk:"email"`
	Name                  types.String `tfsdk:"name"`
	HasAcceptedInvitation types.Bool   `tfsdk:"has_accepted_invitation"`
	TeamIds               types.Set    `tfsdk:"team_ids"`
}

func (d *UserDataSource) Metadata(ctx context.Context, req datasource.MetadataRequest, resp *datasource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_user"
}

func (d *UserDataSource) Schema(ctx context.Context, req datasource.SchemaRequest, resp *datasource.SchemaResponse) {
	resp.Schema = schema.Schema{
		MarkdownDescription: "Someone in this project, or invited to it: look them up by email address, and use their `id` wherever a resource takes a user ID. " +
			"Every resource that names a person also takes their address directly (`user_email` beside `user_id`, `owner_user_emails` beside `owner_users`), so this is needed only to read who someone is, or which teams they are in. " +
			"Only the API key's own project is searched.",

		Attributes: map[string]schema.Attribute{
			"id": schema.StringAttribute{
				MarkdownDescription: "The person's user ID. Set it to look them up by ID instead of by email address or name.",
				Optional:            true,
				Computed:            true,
			},
			"email": schema.StringAttribute{
				MarkdownDescription: "The person's email address, in any case. Set it to look them up by it: the usual way.",
				Optional:            true,
				Computed:            true,
				Validators:          personEmailValidators(),
			},
			"name": schema.StringAttribute{
				MarkdownDescription: "The person's name, exactly as it is shown in OneUptime. Set it to look them up by it; two people of the same name are an error, so prefer `email`.",
				Optional:            true,
				Computed:            true,
			},
			"has_accepted_invitation": schema.BoolAttribute{
				MarkdownDescription: "Whether they have joined the project: false while every invitation they have is still waiting for them.",
				Computed:            true,
			},
			"team_ids": schema.SetAttribute{
				MarkdownDescription: "IDs of the `oneuptime_team` resources of this project they are in, or invited to.",
				Computed:            true,
				ElementType:         types.StringType,
			},
		},
	}
}

func (d *UserDataSource) Configure(ctx context.Context, req datasource.ConfigureRequest, resp *datasource.ConfigureResponse) {
	if req.ProviderData == nil {
		return
	}

	client, ok := req.ProviderData.(*Client)
	if !ok {
		resp.Diagnostics.AddError(
			"Unexpected Data Source Configure Type",
			fmt.Sprintf("Expected *Client, got: %T. Please report this issue to the provider developers.", req.ProviderData),
		)
		return
	}

	d.client = client
}

func (d *UserDataSource) Read(ctx context.Context, req datasource.ReadRequest, resp *datasource.ReadResponse) {
	var data UserDataSourceModel

	resp.Diagnostics.Append(req.Config.Get(ctx, &data)...)
	if resp.Diagnostics.HasError() {
		return
	}

	given := []string{}
	if isSetString(data.Id) {
		given = append(given, "id")
	}
	if isSetString(data.Email) {
		given = append(given, "email")
	}
	if isSetString(data.Name) {
		given = append(given, "name")
	}

	if len(given) != 1 {
		resp.Diagnostics.AddError(
			"Invalid Lookup",
			"Look the person up by one of `email`, `name` or `id`: set exactly one of them. "+
				fmt.Sprintf("This lookup sets %d (%s).", len(given), strings.Join(given, ", ")),
		)
		return
	}

	var person *projectPerson
	var err error
	lookup := ""

	switch given[0] {
	case "email":
		lookup = fmt.Sprintf("email = %q", data.Email.ValueString())
		person, err = d.client.readPersonByEmail(ctx, data.Email.ValueString())
	case "id":
		lookup = fmt.Sprintf("id = %q", data.Id.ValueString())
		person, err = d.client.readPersonByID(ctx, data.Id.ValueString())
	case "name":
		lookup = fmt.Sprintf("name = %q", data.Name.ValueString())
		var people []*projectPerson
		people, err = d.client.findPeopleByName(ctx, data.Name.ValueString())
		if err == nil && len(people) > 1 {
			addresses := make([]string, 0, len(people))
			for _, candidate := range people {
				addresses = append(addresses, candidate.Email)
			}
			resp.Diagnostics.AddError(
				"Ambiguous Match",
				fmt.Sprintf("%d people in this project are called %q (%s). Look the one you mean up by `email` instead.", len(people), data.Name.ValueString(), strings.Join(addresses, ", ")),
			)
			return
		}
		if len(people) == 1 {
			person = people[0]
		}
	}

	if err != nil {
		resp.Diagnostics.AddError(
			"Could not look up "+lookup,
			personLookupFailedDetail(strings.TrimPrefix(lookup, given[0]+" = "), err),
		)
		return
	}

	if person == nil {
		detail := fmt.Sprintf("No one in this project, or invited to it, matches %s.", lookup)
		if given[0] == "email" {
			detail = personNotFoundDetail(data.Email.ValueString())
		}
		resp.Diagnostics.AddError("Not Found", detail)
		return
	}

	// What the configuration gave stays as written (an address in its own
	// case); the rest is the person's.
	if given[0] != "id" {
		data.Id = types.StringValue(person.ID)
	}
	if given[0] != "email" {
		if person.Email != "" {
			data.Email = types.StringValue(person.Email)
		} else {
			data.Email = types.StringNull()
		}
	}
	if given[0] != "name" {
		if person.Name != "" {
			data.Name = types.StringValue(person.Name)
		} else {
			data.Name = types.StringNull()
		}
	}
	data.HasAcceptedInvitation = types.BoolValue(person.HasAcceptedInvitation)

	teamIDs := make([]attr.Value, 0, len(person.TeamIDs))
	for _, teamID := range person.TeamIDs {
		teamIDs = append(teamIDs, types.StringValue(teamID))
	}
	teams, diags := types.SetValue(types.StringType, teamIDs)
	resp.Diagnostics.Append(diags...)
	if resp.Diagnostics.HasError() {
		return
	}
	data.TeamIds = teams

	resp.Diagnostics.Append(resp.State.Set(ctx, &data)...)
}

func isSetString(value types.String) bool {
	return !value.IsNull() && !value.IsUnknown() && value.ValueString() != ""
}
