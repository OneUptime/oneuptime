package provider

// PEOPLE NAMED BY THEIR EMAIL ADDRESS.
//
// The API names a person by their user ID. Beside every attribute that does
// (user_id, assigned_to_user_id, owner_users...), the provider takes their
// email address too (user_email, assigned_to_user_email,
// owner_user_emails), finds the person and sends their ID. The rules, and
// the names, are Common/Utils/DeveloperDocs/PeopleByEmail.ts in the
// OneUptime repository; the generator applies them (Core/OpenAPIParser.ts).
//
// A person is found among the project's members and invitees - the
// project's team members, the only place a project API key can read who is
// in the project - by exact address, in any case. Nobody outside the key's
// project is ever found: the lookup is scoped to the key's project like
// every other request, so it cannot tell whether an address has an account
// anywhere else.
//
// The address is how a configuration names someone; the user ID is who they
// are. Once a resource holds a person, the address it was given stays in
// state as written, so a person who changes their address in OneUptime is
// not a change: Terraform keeps managing the same person. Edit the address
// in the configuration whenever it suits - the plan then changes the
// address and nothing else.

import (
	"context"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"sync"

	"github.com/hashicorp/terraform-plugin-framework-validators/setvalidator"
	"github.com/hashicorp/terraform-plugin-framework-validators/stringvalidator"
	"github.com/hashicorp/terraform-plugin-framework/attr"
	"github.com/hashicorp/terraform-plugin-framework/diag"
	"github.com/hashicorp/terraform-plugin-framework/path"
	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/planmodifier"
	"github.com/hashicorp/terraform-plugin-framework/schema/validator"
	"github.com/hashicorp/terraform-plugin-framework/types"
	"github.com/hashicorp/terraform-plugin-log/tflog"
)

// Where the project's people are read from.
const teamMemberListPath = "/team-member/get-list"

// One page of a lookup, and how far a lookup reads: a person's memberships,
// or the people of one name, are never this many.
const (
	peopleLookupPageSize = 100
	peopleLookupMaxRows  = 1000
)

// projectPerson is someone in the API key's project, or invited to it.
type projectPerson struct {
	ID    string
	Email string
	Name  string
	// Whether they have joined: acceptance is per project, so any accepted
	// membership.
	HasAcceptedInvitation bool
	// The project's teams they are in, or invited to.
	TeamIDs []string
}

// peopleDirectory remembers, for one provider process, the people it has
// found, so one person named by many resources is looked up once. Only
// people found are remembered: someone not in the project yet may be invited
// by another resource of the same apply.
type peopleDirectory struct {
	mu      sync.Mutex
	byEmail map[string]*projectPerson
	byID    map[string]*projectPerson
	// The API key may not read the project's team members. Filling in an
	// address from an ID (on refresh) stops asking; naming someone by
	// address still says why it cannot.
	idLookupRefused bool
}

func (d *peopleDirectory) remember(person *projectPerson) {
	d.mu.Lock()
	defer d.mu.Unlock()

	if d.byEmail == nil {
		d.byEmail = map[string]*projectPerson{}
		d.byID = map[string]*projectPerson{}
	}

	if person.Email != "" {
		d.byEmail[normalizePersonEmail(person.Email)] = person
	}
	d.byID[strings.ToLower(person.ID)] = person
}

func (d *peopleDirectory) lookupEmail(email string) *projectPerson {
	d.mu.Lock()
	defer d.mu.Unlock()

	return d.byEmail[normalizePersonEmail(email)]
}

func (d *peopleDirectory) lookupID(id string) *projectPerson {
	d.mu.Lock()
	defer d.mu.Unlock()

	return d.byID[strings.ToLower(id)]
}

// normalizePersonEmail is how two addresses compare: OneUptime stores every
// address trimmed and in lower case.
func normalizePersonEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

func sameEmail(a string, b string) bool {
	return normalizePersonEmail(a) == normalizePersonEmail(b)
}

// apiStringValue reads a string the API may wrap: "x", {"_type": ..., "value": "x"} or {"_id": "x"}.
func apiStringValue(value interface{}) string {
	switch v := value.(type) {
	case string:
		return v
	case map[string]interface{}:
		if s, ok := v["value"].(string); ok {
			return s
		}
		if s, ok := v["_id"].(string); ok {
			return s
		}
	}
	return ""
}

// listPeople reads the people of the project's memberships that match query,
// one person for all their memberships, in the order they were first seen.
func (c *Client) listPeople(ctx context.Context, query map[string]interface{}) ([]*projectPerson, error) {
	byID := map[string]*projectPerson{}
	order := []string{}

	for skip := 0; skip < peopleLookupMaxRows; skip += peopleLookupPageSize {
		body := map[string]interface{}{
			"query": query,
			"select": map[string]interface{}{
				"_id":                   true,
				"userId":                true,
				"teamId":                true,
				"hasAcceptedInvitation": true,
				"user": map[string]interface{}{
					"_id":   true,
					"email": true,
					"name":  true,
				},
			},
			"sort":  map[string]interface{}{"createdAt": "ASC"},
			"skip":  skip,
			"limit": peopleLookupPageSize,
		}

		httpResp, err := c.Post(ctx, teamMemberListPath, body)
		if err != nil {
			return nil, err
		}

		var parsed map[string]interface{}
		if err := c.ParseResponse(httpResp, &parsed); err != nil {
			return nil, err
		}

		items, _ := parsed["data"].([]interface{})

		for _, raw := range items {
			item, ok := raw.(map[string]interface{})
			if !ok {
				continue
			}

			user, _ := item["user"].(map[string]interface{})
			id := apiStringValue(item["userId"])
			if id == "" && user != nil {
				id = apiStringValue(user["_id"])
			}
			if id == "" {
				continue
			}

			key := strings.ToLower(id)
			person := byID[key]
			if person == nil {
				person = &projectPerson{ID: id}
				byID[key] = person
				order = append(order, key)
			}

			if user != nil {
				if email := apiStringValue(user["email"]); email != "" {
					person.Email = email
				}
				if name := apiStringValue(user["name"]); name != "" {
					person.Name = name
				}
			}
			if accepted, ok := item["hasAcceptedInvitation"].(bool); ok && accepted {
				person.HasAcceptedInvitation = true
			}
			if teamID := apiStringValue(item["teamId"]); teamID != "" {
				person.TeamIDs = append(person.TeamIDs, teamID)
			}
		}

		if len(items) < peopleLookupPageSize {
			break
		}
	}

	people := make([]*projectPerson, 0, len(order))
	for _, key := range order {
		person := byID[key]
		sort.Strings(person.TeamIDs)
		people = append(people, person)
	}

	return people, nil
}

// findPersonByEmail finds the member or invitee of the project with this
// address, in any case. nil, nil: nobody in the project has it.
func (c *Client) findPersonByEmail(ctx context.Context, email string) (*projectPerson, error) {
	if person := c.people.lookupEmail(email); person != nil {
		return person, nil
	}

	return c.readPersonByEmail(ctx, email)
}

// readPersonByEmail is findPersonByEmail asking the API whatever is
// remembered: for the user data source, whose teams and acceptance are what
// a reader asks it for, and may have changed earlier in the same run.
func (c *Client) readPersonByEmail(ctx context.Context, email string) (*projectPerson, error) {
	people, err := c.listPeople(ctx, map[string]interface{}{
		"user": map[string]interface{}{"email": normalizePersonEmail(email)},
	})
	if err != nil {
		return nil, err
	}

	for _, person := range people {
		if sameEmail(person.Email, email) {
			c.people.remember(person)
			return person, nil
		}
	}

	return nil, nil
}

// findPersonByID finds the member or invitee of the project with this user
// ID. nil, nil: nobody in the project has it.
func (c *Client) findPersonByID(ctx context.Context, id string) (*projectPerson, error) {
	if person := c.people.lookupID(id); person != nil {
		return person, nil
	}

	return c.readPersonByID(ctx, id)
}

// readPersonByID is findPersonByID asking the API whatever is remembered.
func (c *Client) readPersonByID(ctx context.Context, id string) (*projectPerson, error) {
	people, err := c.listPeople(ctx, map[string]interface{}{"userId": id})
	if err != nil {
		return nil, err
	}

	for _, person := range people {
		if strings.EqualFold(person.ID, id) {
			c.people.remember(person)
			return person, nil
		}
	}

	return nil, nil
}

// findPeopleByName finds the members and invitees of the project with this
// name, exactly as OneUptime shows it.
func (c *Client) findPeopleByName(ctx context.Context, name string) ([]*projectPerson, error) {
	people, err := c.listPeople(ctx, map[string]interface{}{
		"user": map[string]interface{}{"name": name},
	})
	if err != nil {
		return nil, err
	}

	matching := []*projectPerson{}
	for _, person := range people {
		if person.Name == name {
			c.people.remember(person)
			matching = append(matching, person)
		}
	}

	return matching, nil
}

// emailOfPerson is the address of the person with this ID, for an address
// the configuration left out, or "" when it cannot be read: they are not in
// the project, or the API key may not read its team members. Never an
// error - a refresh must not fail for want of an address nobody configured.
func (c *Client) emailOfPerson(ctx context.Context, id string) string {
	if c == nil || id == "" {
		return ""
	}

	c.people.mu.Lock()
	refused := c.people.idLookupRefused
	c.people.mu.Unlock()
	if refused {
		return ""
	}

	person, err := c.findPersonByID(ctx, id)
	if err != nil {
		tflog.Warn(ctx, "Could not read the email address of a person the resource names", map[string]any{
			"user_id": id,
			"error":   err.Error(),
		})
		if isRefusal(err) {
			c.people.mu.Lock()
			c.people.idLookupRefused = true
			c.people.mu.Unlock()
		}
		return ""
	}
	if person == nil {
		return ""
	}

	return person.Email
}

// isRefusal says whether a lookup failed because the API key may not read
// the project's team members.
func isRefusal(err error) bool {
	message := err.Error()
	for _, status := range []int{http.StatusBadRequest, http.StatusUnauthorized, http.StatusForbidden, http.StatusUnprocessableEntity} {
		if strings.Contains(message, fmt.Sprintf("returned status %d", status)) {
			return true
		}
	}
	return false
}

// personLookupFailedDetail explains a lookup the API refused or could not answer.
func personLookupFailedDetail(email string, err error) string {
	return fmt.Sprintf(
		"The provider finds %q among this project's members and invitees, and could not: %s\n\n"+
			"It reads them as the project's team members, so the API key needs a permission that may read those, such as Project Member, Project Admin or Read Teams. Or name the person by user ID instead.",
		email, err,
	)
}

// personNotFoundDetail says what to do about an address nobody in the project has.
func personNotFoundDetail(email string) string {
	return fmt.Sprintf(
		"No one in this project, or invited to it, has the email address %q.\n\n"+
			"Invite them with an oneuptime_team_member that has user_email = %q. "+
			"If that member is in this configuration, refer to it here instead - user_id = oneuptime_team_member.<name>.user_id - so they are invited first. "+
			"If they changed their address in OneUptime, use the new one.",
		email, email,
	)
}

// ---------------------------------------------------------------------------
// Plan: the ID of a person named by address.
//
// Found in the resource's ModifyPlan, not in a plan modifier: the framework
// builds a schema once, from a resource it never configures, so a plan
// modifier has no client to ask with. ModifyPlan runs on the configured one.

// personAttribute is one person a resource names: its ID attribute, the
// attribute that names them by address instead, and what the resource does
// with them.
type personAttribute struct {
	id    string
	email string
	// Someone nobody in the project has the address of is invited by it (a
	// team member), so not finding them is no warning.
	invites bool
	// The API cannot change the person: a different one replaces the resource.
	replaces bool
}

// planPersonID plans a person's user ID. Named by ID, that is it. Named by
// address: the ID the resource had for the same address, else the ID the
// project has for it - unknown, to find at apply, when nobody has it yet
// (another resource of this apply may invite them) or when the address is
// itself known only then. Named by neither: what the server has stays, as
// with any optional value.
func planPersonID(ctx context.Context, client *Client, req resource.ModifyPlanRequest, resp *resource.ModifyPlanResponse, a personAttribute) {
	var configID, planID, stateID, email, stateEmail types.String

	resp.Diagnostics.Append(req.Config.GetAttribute(ctx, path.Root(a.id), &configID)...)
	resp.Diagnostics.Append(req.Plan.GetAttribute(ctx, path.Root(a.id), &planID)...)
	resp.Diagnostics.Append(req.Config.GetAttribute(ctx, path.Root(a.email), &email)...)
	hasState := !req.State.Raw.IsNull()
	if hasState {
		resp.Diagnostics.Append(req.State.GetAttribute(ctx, path.Root(a.id), &stateID)...)
		resp.Diagnostics.Append(req.State.GetAttribute(ctx, path.Root(a.email), &stateEmail)...)
	}
	if resp.Diagnostics.HasError() {
		return
	}

	planned := planID

	switch {
	case !configID.IsNull():
		planned = configID
	case email.IsNull():
		if planned.IsUnknown() && hasState && !stateID.IsNull() {
			planned = stateID
		}
	case email.IsUnknown():
		planned = types.StringUnknown()
	case hasState && !stateID.IsNull() && !stateID.IsUnknown() && !stateEmail.IsNull() && !stateEmail.IsUnknown() && sameEmail(stateEmail.ValueString(), email.ValueString()):
		planned = stateID
	default:
		planned = types.StringUnknown()

		if client != nil {
			person, err := client.findPersonByEmail(ctx, email.ValueString())
			if err != nil {
				resp.Diagnostics.AddAttributeError(
					path.Root(a.email),
					"Could not look up "+email.ValueString(),
					personLookupFailedDetail(email.ValueString(), err),
				)
				return
			}

			if person != nil {
				planned = types.StringValue(person.ID)
			} else if !a.invites {
				resp.Diagnostics.AddAttributeWarning(
					path.Root(a.email),
					email.ValueString()+" is not in this project yet",
					"The apply fails unless they are by then. "+personNotFoundDetail(email.ValueString()),
				)
			}
		}
	}

	if !planned.Equal(planID) {
		resp.Diagnostics.Append(resp.Plan.SetAttribute(ctx, path.Root(a.id), planned)...)
	}

	if a.replaces && hasState && !stateID.IsNull() && !planned.Equal(stateID) {
		resp.RequiresReplace = append(resp.RequiresReplace, path.Root(a.id))
	}
}

// planPeopleIDs is planPersonID for a set of people (owner_users beside
// owner_user_emails).
func planPeopleIDs(ctx context.Context, client *Client, req resource.ModifyPlanRequest, resp *resource.ModifyPlanResponse, a personAttribute) {
	var configIDs, planIDs, stateIDs, emails, stateEmails types.Set

	resp.Diagnostics.Append(req.Config.GetAttribute(ctx, path.Root(a.id), &configIDs)...)
	resp.Diagnostics.Append(req.Plan.GetAttribute(ctx, path.Root(a.id), &planIDs)...)
	resp.Diagnostics.Append(req.Config.GetAttribute(ctx, path.Root(a.email), &emails)...)
	hasState := !req.State.Raw.IsNull()
	if hasState {
		resp.Diagnostics.Append(req.State.GetAttribute(ctx, path.Root(a.id), &stateIDs)...)
		resp.Diagnostics.Append(req.State.GetAttribute(ctx, path.Root(a.email), &stateEmails)...)
	}
	if resp.Diagnostics.HasError() {
		return
	}

	planned := planIDs
	addresses, known := setStrings(ctx, emails)

	switch {
	case !configIDs.IsNull():
		planned = configIDs
	case emails.IsNull():
		if planned.IsUnknown() && hasState && !stateIDs.IsNull() {
			planned = stateIDs
		}
	case !known:
		planned = types.SetUnknown(types.StringType)
	default:
		before, beforeKnown := setStrings(ctx, stateEmails)
		if hasState && !stateIDs.IsNull() && !stateIDs.IsUnknown() && !stateEmails.IsNull() && beforeKnown && sameEmailSets(before, addresses) {
			planned = stateIDs
			break
		}

		planned = types.SetUnknown(types.StringType)
		if client == nil {
			break
		}

		ids := make([]attr.Value, 0, len(addresses))
		for _, address := range addresses {
			person, err := client.findPersonByEmail(ctx, address)
			if err != nil {
				resp.Diagnostics.AddAttributeError(
					path.Root(a.email),
					"Could not look up "+address,
					personLookupFailedDetail(address, err),
				)
				return
			}
			if person == nil {
				resp.Diagnostics.AddAttributeWarning(
					path.Root(a.email),
					address+" is not in this project yet",
					"The apply fails unless they are by then. "+personNotFoundDetail(address),
				)
				ids = nil
				break
			}
			ids = append(ids, types.StringValue(person.ID))
		}

		if ids != nil {
			set, diags := types.SetValue(types.StringType, ids)
			resp.Diagnostics.Append(diags...)
			if diags.HasError() {
				return
			}
			planned = set
		}
	}

	if !planned.Equal(planIDs) {
		resp.Diagnostics.Append(resp.Plan.SetAttribute(ctx, path.Root(a.id), planned)...)
	}

	if a.replaces && hasState && !stateIDs.IsNull() && !planned.Equal(stateIDs) {
		resp.RequiresReplace = append(resp.RequiresReplace, path.Root(a.id))
	}
}

// ---------------------------------------------------------------------------
// Plan: the address of a person named by ID.

// personEmailFromID plans the address attribute when the configuration names
// the person by ID instead: the address read before for the same person, or
// unknown - read after the apply - for another one.
type personEmailFromID struct {
	idAttribute string
}

func (m personEmailFromID) Description(ctx context.Context) string {
	return m.MarkdownDescription(ctx)
}

func (m personEmailFromID) MarkdownDescription(_ context.Context) string {
	return fmt.Sprintf("The email address of the person %s names, when it names them.", m.idAttribute)
}

func (m personEmailFromID) PlanModifyString(ctx context.Context, req planmodifier.StringRequest, resp *planmodifier.StringResponse) {
	if req.Plan.Raw.IsNull() || !req.ConfigValue.IsNull() || req.State.Raw.IsNull() {
		return
	}

	var configID, stateID types.String
	resp.Diagnostics.Append(req.Config.GetAttribute(ctx, path.Root(m.idAttribute), &configID)...)
	resp.Diagnostics.Append(req.State.GetAttribute(ctx, path.Root(m.idAttribute), &stateID)...)
	if resp.Diagnostics.HasError() {
		return
	}

	if configID.IsNull() || (!configID.IsUnknown() && strings.EqualFold(configID.ValueString(), stateID.ValueString())) {
		if req.PlanValue.IsUnknown() {
			resp.PlanValue = req.StateValue
		}
		return
	}

	resp.PlanValue = types.StringUnknown()
}

// personEmailsFromIDs is personEmailFromID for a set of people.
type personEmailsFromIDs struct {
	idsAttribute string
}

func (m personEmailsFromIDs) Description(ctx context.Context) string {
	return m.MarkdownDescription(ctx)
}

func (m personEmailsFromIDs) MarkdownDescription(_ context.Context) string {
	return fmt.Sprintf("The email addresses of the people %s names, when it names them.", m.idsAttribute)
}

func (m personEmailsFromIDs) PlanModifySet(ctx context.Context, req planmodifier.SetRequest, resp *planmodifier.SetResponse) {
	if req.Plan.Raw.IsNull() || !req.ConfigValue.IsNull() || req.State.Raw.IsNull() {
		return
	}

	var configIDs, stateIDs types.Set
	resp.Diagnostics.Append(req.Config.GetAttribute(ctx, path.Root(m.idsAttribute), &configIDs)...)
	resp.Diagnostics.Append(req.State.GetAttribute(ctx, path.Root(m.idsAttribute), &stateIDs)...)
	if resp.Diagnostics.HasError() {
		return
	}

	if configIDs.IsNull() || (!configIDs.IsUnknown() && sameIDSets(ctx, configIDs, stateIDs)) {
		if req.PlanValue.IsUnknown() {
			resp.PlanValue = req.StateValue
		}
		return
	}

	resp.PlanValue = types.SetUnknown(types.StringType)
}

// ---------------------------------------------------------------------------
// Schema helpers the generated resources call.

func personEmailPlanModifiers(idAttribute string) []planmodifier.String {
	return []planmodifier.String{personEmailFromID{idAttribute: idAttribute}}
}

func personEmailsPlanModifiers(idsAttribute string) []planmodifier.Set {
	return []planmodifier.Set{personEmailsFromIDs{idsAttribute: idsAttribute}}
}

// personIDValidators: a configuration names the person by ID or by address,
// not both - and exactly one of the two when the resource needs a person.
// An ID is a user ID (ids.go): an address or a name there is refused at
// plan time, pointing at the address attribute.
func personIDValidators(emailAttribute string, required bool) []validator.String {
	userID := recordIDValidator{resourceType: personResourceType, emailAttribute: emailAttribute}
	if required {
		return []validator.String{userID, stringvalidator.ExactlyOneOf(path.MatchRoot(emailAttribute))}
	}
	return []validator.String{userID, stringvalidator.ConflictsWith(path.MatchRoot(emailAttribute))}
}

func personIDsValidators(emailsAttribute string, required bool) []validator.Set {
	userIDs := setvalidator.ValueStringsAre(recordIDValidator{resourceType: personResourceType, emailAttribute: emailsAttribute})
	if required {
		return []validator.Set{userIDs, setvalidator.ExactlyOneOf(path.MatchRoot(emailsAttribute))}
	}
	return []validator.Set{userIDs, setvalidator.ConflictsWith(path.MatchRoot(emailsAttribute))}
}

func personEmailValidators() []validator.String {
	return []validator.String{emailAddressValidator{}}
}

func personEmailsValidators() []validator.Set {
	return []validator.Set{setvalidator.ValueStringsAre(emailAddressValidator{})}
}

// emailAddressValidator refuses at plan time a value that cannot be an
// address. The server checks the rest.
type emailAddressValidator struct{}

func (v emailAddressValidator) Description(ctx context.Context) string {
	return v.MarkdownDescription(ctx)
}

func (v emailAddressValidator) MarkdownDescription(_ context.Context) string {
	return "must be an email address, such as alice@example.com"
}

func (v emailAddressValidator) ValidateString(_ context.Context, req validator.StringRequest, resp *validator.StringResponse) {
	if req.ConfigValue.IsNull() || req.ConfigValue.IsUnknown() {
		return
	}

	if !looksLikeEmailAddress(req.ConfigValue.ValueString()) {
		resp.Diagnostics.AddAttributeError(
			req.Path,
			"Not an email address",
			fmt.Sprintf("%q is not an email address. Write the person's address, such as alice@example.com.", req.ConfigValue.ValueString()),
		)
	}
}

// looksLikeEmailAddress: one "@" between a local part and a dotted domain,
// and no spaces.
func looksLikeEmailAddress(value string) bool {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" || len(trimmed) > 254 || strings.ContainsAny(trimmed, " \t\r\n") {
		return false
	}

	at := strings.LastIndex(trimmed, "@")
	if at <= 0 || at != strings.Index(trimmed, "@") {
		return false
	}

	domain := trimmed[at+1:]
	dot := strings.Index(domain, ".")
	return dot > 0 && dot < len(domain)-1
}

// ---------------------------------------------------------------------------
// Apply: what the generated Create, Read and Update do.

// personIDForWrite fills in, at apply, the ID of a person named by an
// address the plan could not find: someone another resource of this apply
// has just invited. False: the person cannot be found, and the write stops.
func personIDForWrite(ctx context.Context, client *Client, id *types.String, email types.String, emailAttribute string, diags *diag.Diagnostics) bool {
	if !id.IsUnknown() || email.IsNull() || email.IsUnknown() {
		return true
	}

	person, err := client.findPersonByEmail(ctx, email.ValueString())
	if err != nil {
		diags.AddAttributeError(path.Root(emailAttribute), "Could not look up "+email.ValueString(), personLookupFailedDetail(email.ValueString(), err))
		return false
	}
	if person == nil {
		diags.AddAttributeError(path.Root(emailAttribute), email.ValueString()+" is not in this project", personNotFoundDetail(email.ValueString()))
		return false
	}

	*id = types.StringValue(person.ID)
	return true
}

// personIDsForWrite is personIDForWrite for a set of people.
func personIDsForWrite(ctx context.Context, client *Client, ids *types.Set, emails types.Set, emailsAttribute string, diags *diag.Diagnostics) bool {
	if !ids.IsUnknown() || emails.IsNull() || emails.IsUnknown() {
		return true
	}

	addresses, known := setStrings(ctx, emails)
	if !known {
		return true
	}

	values := make([]attr.Value, 0, len(addresses))
	for _, address := range addresses {
		person, err := client.findPersonByEmail(ctx, address)
		if err != nil {
			diags.AddAttributeError(path.Root(emailsAttribute), "Could not look up "+address, personLookupFailedDetail(address, err))
			return false
		}
		if person == nil {
			diags.AddAttributeError(path.Root(emailsAttribute), address+" is not in this project", personNotFoundDetail(address))
			return false
		}
		values = append(values, types.StringValue(person.ID))
	}

	planned, d := types.SetValue(types.StringType, values)
	diags.Append(d...)
	if d.HasError() {
		return false
	}

	*ids = planned
	return true
}

// ---------------------------------------------------------------------------
// Lookup: what the generated data sources do with an address.

// personIDForLookup is the ID of the person a data source is asked to find
// a record by (user_email), which the list endpoint then matches. False:
// nobody in the project has the address, or the project's people cannot be
// read, and the lookup stops with an error that says which.
func personIDForLookup(ctx context.Context, client *Client, email string, emailAttribute string, diags *diag.Diagnostics) (string, bool) {
	person, err := client.findPersonByEmail(ctx, email)
	if err != nil {
		diags.AddAttributeError(path.Root(emailAttribute), "Could not look up "+email, personLookupFailedDetail(email, err))
		return "", false
	}
	if person == nil {
		diags.AddAttributeError(
			path.Root(emailAttribute),
			email+" is not in this project",
			fmt.Sprintf("No one in this project, or invited to it, has the email address %q, so nothing names them. Check the address: if they changed it in OneUptime, use the new one.", email),
		)
		return "", false
	}

	return person.ID, true
}

// personEmailAfterLookup is the address a data source's read leaves: the
// one it was looked up by, or - found another way - the person's own, as far
// as the project can say.
func personEmailAfterLookup(ctx context.Context, client *Client, id types.String, email types.String) types.String {
	if !email.IsNull() && !email.IsUnknown() {
		return email
	}
	if id.IsNull() || id.IsUnknown() || id.ValueString() == "" {
		return types.StringNull()
	}
	if address := client.emailOfPerson(ctx, id.ValueString()); address != "" {
		return types.StringValue(address)
	}
	return types.StringNull()
}

// personEmailAfterWrite is the address a create or update leaves in state:
// the one configured, or - for a person named by ID - theirs, read now.
func personEmailAfterWrite(ctx context.Context, client *Client, id types.String, email types.String) types.String {
	if !email.IsUnknown() {
		return email
	}
	if id.IsNull() || id.IsUnknown() {
		return types.StringNull()
	}
	if address := client.emailOfPerson(ctx, id.ValueString()); address != "" {
		return types.StringValue(address)
	}
	return types.StringNull()
}

func personEmailsAfterWrite(ctx context.Context, client *Client, ids types.Set, emails types.Set) types.Set {
	if !emails.IsUnknown() {
		return emails
	}
	return emailsOfPeople(ctx, client, ids)
}

// personEmailAfterRead is the address a refresh leaves in state. The one in
// state stays while the resource names the same person - a person who
// changes their address in OneUptime is no change to the resource - and an
// address is read only when there is none yet (an import) or the person is
// someone else now (changed outside Terraform).
func personEmailAfterRead(ctx context.Context, client *Client, priorID types.String, id types.String, priorEmail types.String) types.String {
	if id.IsNull() || id.IsUnknown() {
		return types.StringNull()
	}

	hasPriorEmail := !priorEmail.IsNull() && !priorEmail.IsUnknown() && priorEmail.ValueString() != ""

	if hasPriorEmail && strings.EqualFold(priorID.ValueString(), id.ValueString()) {
		return priorEmail
	}

	if address := client.emailOfPerson(ctx, id.ValueString()); address != "" {
		// The address an import was given, in its own case, when it is theirs.
		if hasPriorEmail && sameEmail(priorEmail.ValueString(), address) {
			return priorEmail
		}
		return types.StringValue(address)
	}

	// Imported by an address the project cannot read back: as it was given.
	if hasPriorEmail && (priorID.IsNull() || priorID.ValueString() == "") {
		return priorEmail
	}
	return types.StringNull()
}

func personEmailsAfterRead(ctx context.Context, client *Client, priorIDs types.Set, ids types.Set, priorEmails types.Set) types.Set {
	if ids.IsNull() || ids.IsUnknown() {
		return types.SetNull(types.StringType)
	}

	if !priorEmails.IsNull() && !priorEmails.IsUnknown() && sameIDSets(ctx, priorIDs, ids) {
		return priorEmails
	}

	return emailsOfPeople(ctx, client, ids)
}

// emailsOfPeople: the addresses of the people with these IDs, as far as the
// project can say.
func emailsOfPeople(ctx context.Context, client *Client, ids types.Set) types.Set {
	if ids.IsNull() || ids.IsUnknown() {
		return types.SetNull(types.StringType)
	}

	idList, known := setStrings(ctx, ids)
	if !known {
		return types.SetNull(types.StringType)
	}

	values := make([]attr.Value, 0, len(idList))
	for _, id := range idList {
		if address := client.emailOfPerson(ctx, id); address != "" {
			values = append(values, types.StringValue(address))
		}
	}

	set, diags := types.SetValue(types.StringType, values)
	if diags.HasError() {
		return types.SetNull(types.StringType)
	}
	return set
}

// setStrings: a set of strings' elements, and whether every one is known.
func setStrings(ctx context.Context, set types.Set) ([]string, bool) {
	if set.IsUnknown() {
		return nil, false
	}
	if set.IsNull() {
		return []string{}, true
	}

	values := []string{}
	for _, element := range set.Elements() {
		str, ok := element.(types.String)
		if !ok || str.IsUnknown() {
			return nil, false
		}
		if !str.IsNull() {
			values = append(values, str.ValueString())
		}
	}
	_ = ctx
	return values, true
}

// sameEmailSets: the same addresses, in any case and order.
func sameEmailSets(a []string, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	seen := map[string]int{}
	for _, value := range a {
		seen[normalizePersonEmail(value)]++
	}
	for _, value := range b {
		key := normalizePersonEmail(value)
		if seen[key] == 0 {
			return false
		}
		seen[key]--
	}
	return true
}

// sameIDSets: the same user IDs, in any order.
func sameIDSets(ctx context.Context, a types.Set, b types.Set) bool {
	left, leftKnown := setStrings(ctx, a)
	right, rightKnown := setStrings(ctx, b)
	if !leftKnown || !rightKnown || len(left) != len(right) {
		return false
	}
	seen := map[string]int{}
	for _, value := range left {
		seen[strings.ToLower(value)]++
	}
	for _, value := range right {
		key := strings.ToLower(value)
		if seen[key] == 0 {
			return false
		}
		seen[key]--
	}
	return true
}

// ---------------------------------------------------------------------------
// Import: a row by what it joins and who or what joins it.

// The kinds of row imported so (Common/Utils/DeveloperDocs/PeopleByEmail.ts
// MembershipKind).
const (
	membershipKindMember = "member"
	membershipKindOwner  = "owner"
	membershipKindOnCall = "on-call"
)

// membershipImport names the list a row is found in, and the API fields of
// its parent (a team, a monitor, an escalation rule) and of who or what
// joins it (a person, a team, a schedule).
type membershipImport struct {
	listPath        string
	parentField     string
	parentAttribute string
	// What the parent is, in words: "team", "monitor".
	parentNoun      string
	personField     string
	personAttribute string
	// The member is a person, so an email address names them too.
	byEmail bool
	kind    string
}

// importForm is how the import ID of a row of spec is written.
func (spec membershipImport) importForm() string {
	if spec.byEmail {
		return fmt.Sprintf("<%s>/<email address or user id>", spec.parentAttribute)
	}
	return fmt.Sprintf("<%s>/<%s>", spec.parentAttribute, spec.personAttribute)
}

// notFound says that nothing joins what the import ID names, the way the
// kind of row would say it.
func (spec membershipImport) notFound(member string, parentID string) string {
	parent := spec.parentNoun
	if parent == "" {
		parent = strings.ReplaceAll(strings.TrimSuffix(spec.parentAttribute, "_id"), "_", " ")
	}
	switch spec.kind {
	case membershipKindOwner:
		return fmt.Sprintf("%s is not an owner of the %s %q.", member, parent, parentID)
	case membershipKindOnCall:
		return fmt.Sprintf("%s is not on the %s %q.", member, parent, parentID)
	default:
		return fmt.Sprintf("%s is not a member of the %s %q, nor invited to it.", member, parent, parentID)
	}
}

// importIDOfMembership turns "<team id>/<email address or user id>" - or
// "<monitor id>/<team id>" for a row whose member is no person - into the
// row's own ID, and the address it was given (to keep in state, in its own
// case). An ID without a "/" is the row's own, as it always was.
func importIDOfMembership(ctx context.Context, client *Client, importID string, spec membershipImport, diags *diag.Diagnostics) (string, string, bool) {
	if !strings.Contains(importID, "/") {
		return importID, "", true
	}

	parts := strings.SplitN(importID, "/", 2)
	parentID := strings.TrimSpace(parts[0])
	person := strings.TrimSpace(parts[1])

	if parentID == "" || person == "" {
		diags.AddError("Invalid Import ID", fmt.Sprintf("Import it by its ID, or as %s; got %q.", spec.importForm(), importID))
		return "", "", false
	}

	if client == nil {
		diags.AddError("Provider Not Configured", "The provider must be configured to import by what a row joins.")
		return "", "", false
	}

	userID := person
	email := ""
	if strings.Contains(person, "@") {
		if !spec.byEmail {
			diags.AddError("Invalid Import ID", fmt.Sprintf("%q is an email address, and %s takes no person: import it as %s.", person, spec.personAttribute, spec.importForm()))
			return "", "", false
		}
		found, err := client.findPersonByEmail(ctx, person)
		if err != nil {
			diags.AddError("Could not look up "+person, personLookupFailedDetail(person, err))
			return "", "", false
		}
		if found == nil {
			diags.AddError(person+" is not in this project", personNotFoundDetail(person))
			return "", "", false
		}
		userID = found.ID
		email = person
	}

	httpResp, err := client.Post(ctx, spec.listPath, map[string]interface{}{
		"query": map[string]interface{}{
			spec.parentField: parentID,
			spec.personField: userID,
		},
		"select": map[string]interface{}{"_id": true},
		"limit":  2,
	})
	if err != nil {
		diags.AddError("Client Error", fmt.Sprintf("Unable to find the membership to import: %s", err))
		return "", "", false
	}

	var parsed map[string]interface{}
	if err := client.ParseResponse(httpResp, &parsed); err != nil {
		diags.AddError("OneUptime API Error", fmt.Sprintf("Unable to find the membership to import: %s", err))
		return "", "", false
	}

	items, _ := parsed["data"].([]interface{})
	if len(items) == 0 {
		diags.AddError("Not Found", spec.notFound(person, parentID))
		return "", "", false
	}

	first, _ := items[0].(map[string]interface{})
	id := apiStringValue(first["_id"])
	if id == "" {
		diags.AddError("OneUptime API Error", "The membership found has no id.")
		return "", "", false
	}

	return id, email, true
}

// alreadyInvitedHint is what a create that finds the person already in the
// team adds: how to take that membership over instead. A paragraph of its
// own, whatever the server's message ends with (it ends with no full stop),
// and the command on a line of its own, to copy.
func alreadyInvitedHint(err error, resourceType string, parentAttribute string) string {
	if err == nil || !strings.Contains(strings.ToLower(err.Error()), "already been invited") {
		return ""
	}
	return fmt.Sprintf("\n\nThey are in this team already. To manage that membership with Terraform, import it:\n\n  terraform import %s.<name> <%s>/<email address>", resourceType, parentAttribute)
}
