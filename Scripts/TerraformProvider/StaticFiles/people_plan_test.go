package provider

/*
 * People named by email address, through the provider's real protocol
 * server, the way terraform plan, apply, refresh and import drive it,
 * against a fake OneUptime API that keeps a project's people the way
 * OneUptime does: accounts with an address, and team memberships, some of
 * them invitations still waiting.
 *
 * After every step the tests check what Terraform checks: an apply's
 * result matches its plan for every attribute the plan knew ("Provider
 * produced inconsistent result after apply"), and the next plan changes
 * nothing - the bug of the team member before these, which planned
 * has_accepted_invitation = false over an accepted member on every plan.
 *
 * The resources are four that name people the four ways a resource can:
 *   - oneuptime_team_member: a person the API cannot change, named by an
 *     address that invites them when nobody in the project has it;
 *   - oneuptime_on_call_schedule_layer_user: a person the API can change;
 *   - oneuptime_monitor_user_owner: a person the API cannot change, whose
 *     row OneUptime marks once it has told them (is_owner_notified);
 *   - oneuptime_monitor_owner_rule: a set of people (owner_users).
 */

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"sync"
	"testing"

	"github.com/hashicorp/terraform-plugin-framework/providerserver"
	"github.com/hashicorp/terraform-plugin-go/tfprotov6"
	"github.com/hashicorp/terraform-plugin-go/tftypes"
)

const (
	peopleAPIKey     = "people-test-key"
	peopleProjectID  = "5a0e0000-0000-4000-8000-000000000001"
	peopleTeamID     = "5a0e0000-0000-4000-8000-0000000000a1"
	peopleOtherTeam  = "5a0e0000-0000-4000-8000-0000000000a2"
	peopleScheduleID = "5a0e0000-0000-4000-8000-0000000000b1"
	peopleLayerID    = "5a0e0000-0000-4000-8000-0000000000b2"
	peopleMonitorID  = "5a0e0000-0000-4000-8000-0000000000c1"
	peopleTimestamp  = "2026-11-02T08:00:00.000Z"

	// People of the fake project.
	aliceID = "5a0e0000-0000-4000-8000-0000000000d1"
	bobID   = "5a0e0000-0000-4000-8000-0000000000d2"
	// Has an account, in another project only.
	strangerID = "5a0e0000-0000-4000-8000-0000000000d3"
)

// fakePerson is an account.
type fakePerson struct {
	id    string
	email string
	name  string
}

// peopleAPI is the fake OneUptime API of these tests.
type peopleAPI struct {
	t      *testing.T
	server *httptest.Server

	mu     sync.Mutex
	people map[string]*fakePerson
	tables map[string]map[string]map[string]interface{}
	order  map[string][]string
	nextID int
	// The requests the provider made, as "METHOD /path".
	requests []string
	// The create bodies, by table.
	creates map[string][]map[string]interface{}
	// The update bodies, by table.
	updates map[string][]map[string]interface{}
	// Team-member lists that filtered by person.
	personLookups int
}

// The tables the fake keeps, by API path.
var peopleTables = []string{
	"/team-member",
	"/on-call-duty-schedule-layer-user",
	"/monitor-owner-user",
	"/monitor-owner-rule",
}

func newPeopleAPI(t *testing.T) *peopleAPI {
	t.Helper()
	api := &peopleAPI{
		t:       t,
		people:  map[string]*fakePerson{},
		tables:  map[string]map[string]map[string]interface{}{},
		order:   map[string][]string{},
		creates: map[string][]map[string]interface{}{},
		updates: map[string][]map[string]interface{}{},
	}
	for _, table := range peopleTables {
		api.tables[table] = map[string]map[string]interface{}{}
	}

	// Alice and Bob are in the project: Alice has joined, Bob is invited.
	api.people[aliceID] = &fakePerson{id: aliceID, email: "alice@example.com", name: "Alice Smith"}
	api.people[bobID] = &fakePerson{id: bobID, email: "bob@example.com", name: "Bob Jones"}
	api.people[strangerID] = &fakePerson{id: strangerID, email: "stranger@example.com", name: "Stranger"}
	api.insert("/team-member", map[string]interface{}{"teamId": peopleOtherTeam, "userId": aliceID, "hasAcceptedInvitation": true})
	api.insert("/team-member", map[string]interface{}{"teamId": peopleOtherTeam, "userId": bobID, "hasAcceptedInvitation": false})

	api.server = httptest.NewServer(http.HandlerFunc(api.handle))
	t.Cleanup(api.server.Close)
	return api
}

func (a *peopleAPI) insert(table string, data map[string]interface{}) string {
	a.nextID++
	id := fmt.Sprintf("5a0e1000-0000-4000-8000-%012d", a.nextID)
	row := map[string]interface{}{}
	for key, value := range data {
		row[key] = value
	}
	row["_id"] = id
	a.tables[table][id] = row
	a.order[table] = append(a.order[table], id)
	return id
}

// personByEmail is the account with an address, in any case.
func (a *peopleAPI) personByEmail(email string) *fakePerson {
	for _, person := range a.people {
		if strings.EqualFold(person.email, strings.TrimSpace(email)) {
			return person
		}
	}
	return nil
}

// isInProject: a membership of any of the project's teams, invitations too.
func (a *peopleAPI) isInProject(userID string) bool {
	for _, row := range a.tables["/team-member"] {
		if row["userId"] == userID {
			return true
		}
	}
	return false
}

func (a *peopleAPI) hasJoined(userID string) bool {
	for _, row := range a.tables["/team-member"] {
		if row["userId"] == userID && row["hasAcceptedInvitation"] == true {
			return true
		}
	}
	return false
}

// answer is a row as the API answers it: ids and dates wrapped, and the
// person's account where the select asks for it.
func (a *peopleAPI) answer(table string, row map[string]interface{}, selectParam map[string]interface{}) map[string]interface{} {
	answer := map[string]interface{}{
		"_id":       row["_id"],
		"projectId": map[string]interface{}{"_type": "ObjectID", "value": peopleProjectID},
		"createdAt": map[string]interface{}{"_type": "DateTime", "value": peopleTimestamp},
		"updatedAt": map[string]interface{}{"_type": "DateTime", "value": peopleTimestamp},
	}
	for key, value := range row {
		if key == "_id" {
			continue
		}
		switch v := value.(type) {
		case string:
			if strings.HasSuffix(key, "Id") {
				answer[key] = map[string]interface{}{"_type": "ObjectID", "value": v}
			} else {
				answer[key] = v
			}
		default:
			answer[key] = v
		}
	}
	if table == "/monitor-owner-user" {
		if _, ok := answer["isOwnerNotified"]; !ok {
			answer["isOwnerNotified"] = false
		}
	}
	if table == "/team-member" {
		if _, ok := answer["hasAcceptedInvitation"]; !ok {
			answer["hasAcceptedInvitation"] = false
		}
	}
	if userSelect, ok := selectParam["user"].(map[string]interface{}); ok && len(userSelect) > 0 {
		if person := a.people[fmt.Sprint(row["userId"])]; person != nil {
			user := map[string]interface{}{"_id": person.id, "email": map[string]interface{}{"_type": "Email", "value": person.email}}
			if person.name != "" {
				user["name"] = map[string]interface{}{"_type": "Name", "value": person.name}
			} else {
				user["name"] = nil
			}
			answer["user"] = user
		}
	}
	return answer
}

func (a *peopleAPI) handle(w http.ResponseWriter, r *http.Request) {
	a.mu.Lock()
	defer a.mu.Unlock()

	path := strings.TrimPrefix(r.URL.Path, "/api")
	a.requests = append(a.requests, r.Method+" "+path)

	if r.Header.Get("APIKey") != peopleAPIKey {
		a.reply(w, http.StatusUnauthorized, map[string]interface{}{"message": "Invalid API Key"})
		return
	}

	var body map[string]interface{}
	raw, _ := io.ReadAll(r.Body)
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &body); err != nil {
			a.t.Errorf("%s %s sent a body that is not JSON: %s", r.Method, path, err)
		}
	}

	for _, table := range peopleTables {
		if path != table && !strings.HasPrefix(path, table+"/") {
			continue
		}
		rest := strings.TrimPrefix(path, table)
		selectParam, _ := body["select"].(map[string]interface{})

		switch {
		case r.Method == http.MethodPost && rest == "":
			a.create(w, table, body)
		case r.Method == http.MethodPost && rest == "/get-list":
			a.list(w, table, body)
		case r.Method == http.MethodPost && strings.HasSuffix(rest, "/get-item"):
			row, ok := a.tables[table][strings.TrimSuffix(strings.TrimPrefix(rest, "/"), "/get-item")]
			if !ok {
				a.reply(w, http.StatusNotFound, map[string]interface{}{"message": "Not found"})
				return
			}
			a.reply(w, http.StatusOK, map[string]interface{}{"data": a.answer(table, row, selectParam)})
		case r.Method == http.MethodPut && rest != "":
			row, ok := a.tables[table][strings.TrimPrefix(rest, "/")]
			if !ok {
				a.reply(w, http.StatusNotFound, map[string]interface{}{"message": "Not found"})
				return
			}
			data, _ := body["data"].(map[string]interface{})
			a.updates[table] = append(a.updates[table], data)
			for key, value := range data {
				if key == "userId" && !a.isInProject(fmt.Sprint(value)) {
					a.reply(w, http.StatusBadRequest, map[string]interface{}{"message": "The user is not a member of this project."})
					return
				}
				row[key] = value
			}
			a.reply(w, http.StatusOK, map[string]interface{}{})
		case r.Method == http.MethodDelete && rest != "":
			id := strings.TrimPrefix(rest, "/")
			delete(a.tables[table], id)
			a.reply(w, http.StatusOK, map[string]interface{}{})
		default:
			a.t.Errorf("unexpected request: %s %s", r.Method, path)
			a.reply(w, http.StatusNotFound, map[string]interface{}{"message": "Not found"})
		}
		return
	}

	a.t.Errorf("unexpected request: %s %s", r.Method, path)
	a.reply(w, http.StatusNotFound, map[string]interface{}{"message": "Not found"})
}

func (a *peopleAPI) create(w http.ResponseWriter, table string, body map[string]interface{}) {
	data, _ := body["data"].(map[string]interface{})
	a.creates[table] = append(a.creates[table], data)
	row := map[string]interface{}{}
	for key, value := range data {
		row[key] = value
	}

	if table == "/team-member" {
		misc, _ := body["miscDataProps"].(map[string]interface{})
		if email, ok := misc["email"].(string); ok && email != "" {
			// TeamMemberService: the account with the address, or a new one.
			person := a.personByEmail(email)
			if person == nil {
				a.nextID++
				person = &fakePerson{id: fmt.Sprintf("5a0e2000-0000-4000-8000-%012d", a.nextID), email: strings.ToLower(strings.TrimSpace(email))}
				a.people[person.id] = person
			}
			row["userId"] = person.id
		}
		userID := fmt.Sprint(row["userId"])
		for _, existing := range a.tables[table] {
			if existing["userId"] == userID && existing["teamId"] == row["teamId"] {
				a.reply(w, http.StatusBadRequest, map[string]interface{}{"message": "This user has already been invited to this team"})
				return
			}
		}
		// Someone who has joined the project joins another team at once.
		row["hasAcceptedInvitation"] = a.hasJoined(userID)
	} else if userID, ok := row["userId"].(string); ok && !a.isInProject(userID) {
		a.reply(w, http.StatusBadRequest, map[string]interface{}{"message": "The user is not a member of this project."})
		return
	}

	id := a.insert(table, row)
	a.reply(w, http.StatusOK, map[string]interface{}{"data": a.answer(table, a.tables[table][id], nil)})
}

// list answers get-list: the rows every filter of the query matches.
func (a *peopleAPI) list(w http.ResponseWriter, table string, body map[string]interface{}) {
	query, _ := body["query"].(map[string]interface{})
	selectParam, _ := body["select"].(map[string]interface{})
	found := []interface{}{}

	if _, byPerson := query["user"]; byPerson {
		a.personLookups++
	} else if _, byPerson := query["userId"]; byPerson {
		a.personLookups++
	}

	for _, id := range a.order[table] {
		row, ok := a.tables[table][id]
		if !ok {
			continue
		}
		matches := true
		for key, want := range query {
			switch key {
			case "user":
				filter, _ := want.(map[string]interface{})
				person := a.people[fmt.Sprint(row["userId"])]
				for field, value := range filter {
					switch field {
					case "email":
						matches = matches && person != nil && strings.EqualFold(person.email, fmt.Sprint(value))
					case "name":
						matches = matches && person != nil && person.name == fmt.Sprint(value)
					default:
						a.t.Errorf("the lookup filtered people on %s", field)
					}
				}
			case "_id", "userId", "teamId", "monitorId", "onCallDutyPolicyScheduleLayerId":
				matches = matches && strings.EqualFold(fmt.Sprint(row[key]), fmt.Sprint(want))
			default:
				a.t.Errorf("the lookup filtered %s on %s, which this test does not expect", table, key)
				matches = false
			}
		}
		if matches {
			found = append(found, a.answer(table, row, selectParam))
		}
	}

	a.reply(w, http.StatusOK, map[string]interface{}{"data": found, "count": len(found)})
}

func (a *peopleAPI) reply(w http.ResponseWriter, status int, body interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(body); err != nil {
		a.t.Errorf("writing the response: %s", err)
	}
}

// rows of a table, for the assertions.
func (a *peopleAPI) rows(table string) []map[string]interface{} {
	a.mu.Lock()
	defer a.mu.Unlock()
	rows := []map[string]interface{}{}
	for _, id := range a.order[table] {
		if row, ok := a.tables[table][id]; ok {
			rows = append(rows, row)
		}
	}
	return rows
}

// ---------------------------------------------------------------------------
// Terraform, as these tests drive it.

type peopleTerraform struct {
	t       *testing.T
	ctx     context.Context
	api     *peopleAPI
	server  tfprotov6.ProviderServer
	schemas map[string]*tfprotov6.Schema
	sources map[string]*tfprotov6.Schema
}

func newPeopleTerraform(t *testing.T) *peopleTerraform {
	t.Helper()
	tf := &peopleTerraform{t: t, ctx: context.Background(), api: newPeopleAPI(t)}
	tf.restart()
	return tf
}

// restart starts the provider again, as the next terraform command does: a
// new process, which remembers nobody the last one found.
func (tf *peopleTerraform) restart() {
	tf.t.Helper()
	server := providerserver.NewProtocol6(New("test")())()

	schemas, err := server.GetProviderSchema(tf.ctx, &tfprotov6.GetProviderSchemaRequest{})
	if err != nil {
		tf.t.Fatalf("GetProviderSchema: %s", err)
	}

	providerType := schemas.Provider.ValueType().(tftypes.Object)
	providerConfig, err := tfprotov6.NewDynamicValue(providerType, objectWith(providerType, map[string]tftypes.Value{
		"oneuptime_url": tftypes.NewValue(tftypes.String, tf.api.server.URL),
		"api_key":       tftypes.NewValue(tftypes.String, peopleAPIKey),
	}))
	if err != nil {
		tf.t.Fatalf("encoding the provider configuration: %s", err)
	}
	configured, err := server.ConfigureProvider(tf.ctx, &tfprotov6.ConfigureProviderRequest{TerraformVersion: "1.9.8", Config: &providerConfig})
	if err != nil {
		tf.t.Fatalf("ConfigureProvider: %s", err)
	}
	failOnErrors(tf.t, "configuring the provider", configured.Diagnostics)

	tf.server = server
	tf.schemas = schemas.ResourceSchemas
	tf.sources = schemas.DataSourceSchemas
}

func (tf *peopleTerraform) objectType(typeName string) tftypes.Object {
	tf.t.Helper()
	schema := tf.schemas[typeName]
	if schema == nil {
		tf.t.Fatalf("the provider has no resource %s", typeName)
	}
	return schema.ValueType().(tftypes.Object)
}

func (tf *peopleTerraform) encode(objectType tftypes.Object, value tftypes.Value) *tfprotov6.DynamicValue {
	tf.t.Helper()
	encoded, err := tfprotov6.NewDynamicValue(objectType, value)
	if err != nil {
		tf.t.Fatalf("encoding %s: %s", value, err)
	}
	return &encoded
}

func (tf *peopleTerraform) decode(objectType tftypes.Object, value *tfprotov6.DynamicValue) tftypes.Value {
	tf.t.Helper()
	if value == nil {
		tf.t.Fatalf("the provider returned no value")
	}
	decoded, err := value.Unmarshal(objectType)
	if err != nil {
		tf.t.Fatalf("decoding: %s", err)
	}
	return decoded
}

func (tf *peopleTerraform) config(typeName string, values map[string]tftypes.Value) tftypes.Value {
	return objectWith(tf.objectType(typeName), values)
}

func (tf *peopleTerraform) isComputed(typeName string, name string) bool {
	for _, attribute := range tf.schemas[typeName].Block.Attributes {
		if attribute.Name == name {
			return attribute.Computed
		}
	}
	tf.t.Fatalf("%s has no attribute %s", typeName, name)
	return false
}

// proposedNew is what Terraform proposes: the configuration, with the prior
// state's value for every computed attribute it leaves out.
func (tf *peopleTerraform) proposedNew(typeName string, prior, config tftypes.Value) tftypes.Value {
	if prior.IsNull() {
		return config
	}
	priorValues := attributesOf(tf.t, prior)
	proposed := map[string]tftypes.Value{}
	for name, configured := range attributesOf(tf.t, config) {
		proposed[name] = configured
		if configured.IsNull() && tf.isComputed(typeName, name) {
			proposed[name] = priorValues[name]
		}
	}
	return tftypes.NewValue(tf.objectType(typeName), proposed)
}

func (tf *peopleTerraform) validate(typeName string, config tftypes.Value) []*tfprotov6.Diagnostic {
	tf.t.Helper()
	validated, err := tf.server.ValidateResourceConfig(tf.ctx, &tfprotov6.ValidateResourceConfigRequest{
		TypeName: typeName,
		Config:   tf.encode(tf.objectType(typeName), config),
	})
	if err != nil {
		tf.t.Fatalf("ValidateResourceConfig: %s", err)
	}
	return validated.Diagnostics
}

func (tf *peopleTerraform) planResponse(typeName string, prior, config tftypes.Value) *tfprotov6.PlanResourceChangeResponse {
	tf.t.Helper()
	objectType := tf.objectType(typeName)
	planned, err := tf.server.PlanResourceChange(tf.ctx, &tfprotov6.PlanResourceChangeRequest{
		TypeName:         typeName,
		PriorState:       tf.encode(objectType, prior),
		ProposedNewState: tf.encode(objectType, tf.proposedNew(typeName, prior, config)),
		Config:           tf.encode(objectType, config),
	})
	if err != nil {
		tf.t.Fatalf("PlanResourceChange: %s", err)
	}
	return planned
}

func (tf *peopleTerraform) plan(typeName string, prior, config tftypes.Value) (tftypes.Value, *tfprotov6.PlanResourceChangeResponse) {
	tf.t.Helper()
	response := tf.planResponse(typeName, prior, config)
	failOnErrors(tf.t, "planning "+typeName, response.Diagnostics)
	return tf.decode(tf.objectType(typeName), response.PlannedState), response
}

// applyResponse applies a plan as Terraform does, without failing on its
// errors.
func (tf *peopleTerraform) applyResponse(typeName string, prior, config tftypes.Value) (*tfprotov6.PlanResourceChangeResponse, *tfprotov6.ApplyResourceChangeResponse) {
	tf.t.Helper()
	objectType := tf.objectType(typeName)
	planResponse := tf.planResponse(typeName, prior, config)
	failOnErrors(tf.t, "planning "+typeName, planResponse.Diagnostics)

	applied, err := tf.server.ApplyResourceChange(tf.ctx, &tfprotov6.ApplyResourceChangeRequest{
		TypeName:       typeName,
		PriorState:     tf.encode(objectType, prior),
		PlannedState:   planResponse.PlannedState,
		Config:         tf.encode(objectType, config),
		PlannedPrivate: planResponse.PlannedPrivate,
	})
	if err != nil {
		tf.t.Fatalf("ApplyResourceChange: %s", err)
	}
	return planResponse, applied
}

// apply plans and applies, and checks the result the way Terraform does:
// every attribute the plan knew is what it said, and nothing is unknown.
func (tf *peopleTerraform) apply(typeName string, prior, config tftypes.Value) tftypes.Value {
	tf.t.Helper()
	planResponse, applied := tf.applyResponse(typeName, prior, config)
	failOnErrors(tf.t, "applying "+typeName, applied.Diagnostics)

	objectType := tf.objectType(typeName)
	planned := tf.decode(objectType, planResponse.PlannedState)
	state := tf.decode(objectType, applied.NewState)
	got := attributesOf(tf.t, state)
	for name, want := range attributesOf(tf.t, planned) {
		if !got[name].IsFullyKnown() {
			tf.t.Fatalf("Provider returned invalid result object after apply: .%s is unknown", name)
		}
		if want.IsKnown() && !sameToTerraform(tf.t, want, got[name]) {
			tf.t.Fatalf("Provider produced inconsistent result after apply: .%s: was %s, but now %s", name, want, got[name])
		}
	}
	return state
}

func (tf *peopleTerraform) refresh(typeName string, state tftypes.Value) tftypes.Value {
	tf.t.Helper()
	objectType := tf.objectType(typeName)
	read, err := tf.server.ReadResource(tf.ctx, &tfprotov6.ReadResourceRequest{
		TypeName:     typeName,
		CurrentState: tf.encode(objectType, state),
	})
	if err != nil {
		tf.t.Fatalf("ReadResource: %s", err)
	}
	failOnErrors(tf.t, "refreshing "+typeName, read.Diagnostics)
	return tf.decode(objectType, read.NewState)
}

// changes is what a plan of the configuration over the state changes, as
// Terraform decides it, and what it replaces the resource for.
func (tf *peopleTerraform) changes(typeName string, state, config tftypes.Value) ([]string, []string) {
	tf.t.Helper()
	planned, response := tf.plan(typeName, state, config)
	before := attributesOf(tf.t, state)
	changed := []string{}
	for name, value := range attributesOf(tf.t, planned) {
		if !value.IsKnown() || !sameToTerraform(tf.t, before[name], value) {
			changed = append(changed, name)
		}
	}
	sort.Strings(changed)
	replaced := []string{}
	for _, path := range response.RequiresReplace {
		if name, ok := path.Steps()[0].(tftypes.AttributeName); ok {
			replaced = append(replaced, string(name))
		}
	}
	sort.Strings(replaced)
	return changed, replaced
}

func (tf *peopleTerraform) requireNoChanges(typeName string, state, config tftypes.Value) {
	tf.t.Helper()
	changed, replaced := tf.changes(typeName, state, config)
	if len(changed) > 0 || len(replaced) > 0 {
		tf.t.Fatalf("the plan is not empty: it changes %v and replaces for %v", changed, replaced)
	}
}

func (tf *peopleTerraform) importState(typeName string, id string) (tftypes.Value, []*tfprotov6.Diagnostic) {
	tf.t.Helper()
	imported, err := tf.server.ImportResourceState(tf.ctx, &tfprotov6.ImportResourceStateRequest{TypeName: typeName, ID: id})
	if err != nil {
		tf.t.Fatalf("ImportResourceState: %s", err)
	}
	if len(imported.ImportedResources) == 0 {
		return tftypes.Value{}, imported.Diagnostics
	}
	return tf.decode(tf.objectType(typeName), imported.ImportedResources[0].State), imported.Diagnostics
}

func (tf *peopleTerraform) destroy(typeName string, state tftypes.Value) {
	tf.t.Helper()
	objectType := tf.objectType(typeName)
	nothing := tftypes.NewValue(objectType, nil)
	destroyed, err := tf.server.ApplyResourceChange(tf.ctx, &tfprotov6.ApplyResourceChangeRequest{
		TypeName:     typeName,
		PriorState:   tf.encode(objectType, state),
		PlannedState: tf.encode(objectType, nothing),
		Config:       tf.encode(objectType, nothing),
	})
	if err != nil {
		tf.t.Fatalf("destroying: %s", err)
	}
	failOnErrors(tf.t, "destroying "+typeName, destroyed.Diagnostics)
}

func str(value string) tftypes.Value {
	return tftypes.NewValue(tftypes.String, value)
}

func stringSet(values ...string) tftypes.Value {
	elements := []tftypes.Value{}
	for _, value := range values {
		elements = append(elements, str(value))
	}
	return tftypes.NewValue(tftypes.Set{ElementType: tftypes.String}, elements)
}

func stringOf(t *testing.T, object tftypes.Value, name string) string {
	t.Helper()
	value := attributesOf(t, object)[name]
	if value.IsNull() {
		return ""
	}
	var s string
	if err := value.As(&s); err != nil {
		t.Fatalf("reading %s: %s", name, err)
	}
	return s
}

func boolOf(t *testing.T, object tftypes.Value, name string) bool {
	t.Helper()
	var b bool
	if err := attributesOf(t, object)[name].As(&b); err != nil {
		t.Fatalf("reading %s: %s", name, err)
	}
	return b
}

func stringsOf(t *testing.T, object tftypes.Value, name string) []string {
	t.Helper()
	var elements []tftypes.Value
	if err := attributesOf(t, object)[name].As(&elements); err != nil {
		t.Fatalf("reading %s: %s", name, err)
	}
	values := []string{}
	for _, element := range elements {
		var s string
		if err := element.As(&s); err != nil {
			t.Fatalf("reading %s: %s", name, err)
		}
		values = append(values, s)
	}
	sort.Strings(values)
	return values
}

func requireDiagnostic(t *testing.T, diagnostics []*tfprotov6.Diagnostic, severity tfprotov6.DiagnosticSeverity, summaryPart string) *tfprotov6.Diagnostic {
	t.Helper()
	for _, diagnostic := range diagnostics {
		if diagnostic.Severity == severity && strings.Contains(diagnostic.Summary+" "+diagnostic.Detail, summaryPart) {
			return diagnostic
		}
	}
	t.Fatalf("no diagnostic saying %q among %d: %v", summaryPart, len(diagnostics), describeDiagnostics(diagnostics))
	return nil
}

func describeDiagnostics(diagnostics []*tfprotov6.Diagnostic) []string {
	described := []string{}
	for _, diagnostic := range diagnostics {
		described = append(described, fmt.Sprintf("[%v] %s: %s", diagnostic.Severity, diagnostic.Summary, diagnostic.Detail))
	}
	return described
}

const teamMemberType = "oneuptime_team_member"
const layerUserType = "oneuptime_on_call_schedule_layer_user"
const monitorOwnerType = "oneuptime_monitor_user_owner"
const ownerRuleType = "oneuptime_monitor_owner_rule"

// ---------------------------------------------------------------------------
// Team members.

// Someone nobody in the project has the address of is invited by it, the
// way the dashboard's Invite does: the create sends the address as
// miscDataProps.email and no user ID, and plans nothing about them it
// cannot know. When they accept, nothing changes for Terraform.
func TestPeopleTeamMemberInvitedByEmailSettles(t *testing.T) {
	tf := newPeopleTerraform(t)
	config := tf.config(teamMemberType, map[string]tftypes.Value{
		"team_id":    str(peopleTeamID),
		"user_email": str("New.Person@Example.com"),
	})

	planned, response := tf.plan(teamMemberType, tftypes.NewValue(tf.objectType(teamMemberType), nil), config)
	if attributesOf(t, planned)["user_id"].IsKnown() {
		t.Fatalf("someone not in the project yet planned a user ID: %s", attributesOf(t, planned)["user_id"])
	}
	for _, diagnostic := range response.Diagnostics {
		if diagnostic.Severity == tfprotov6.DiagnosticSeverityWarning {
			t.Fatalf("an invitation warned that the person is not in the project: %s", diagnostic.Summary)
		}
	}

	state := tf.apply(teamMemberType, tftypes.NewValue(tf.objectType(teamMemberType), nil), config)

	sent := tf.api.creates["/team-member"]
	if len(sent) != 1 {
		t.Fatalf("expected one create, got %d", len(sent))
	}
	if _, sentID := sent[0]["userId"]; sentID {
		t.Fatalf("the invitation sent a user ID: %v", sent[0])
	}
	invited := tf.api.personByEmail("new.person@example.com")
	if invited == nil {
		t.Fatalf("nobody was invited")
	}
	if got := stringOf(t, state, "user_id"); got != invited.id {
		t.Fatalf("user_id = %q, want the invited person's %q", got, invited.id)
	}
	if got := stringOf(t, state, "user_email"); got != "New.Person@Example.com" {
		t.Fatalf("user_email = %q, want it as written", got)
	}
	if boolOf(t, state, "has_accepted_invitation") {
		t.Fatalf("a new invitation reads as accepted")
	}

	state = tf.refresh(teamMemberType, state)
	tf.requireNoChanges(teamMemberType, state, config)

	// They accept: OneUptime marks the membership, and Terraform has nothing to do.
	for _, row := range tf.api.rows("/team-member") {
		if row["userId"] == invited.id {
			row["hasAcceptedInvitation"] = true
		}
	}
	state = tf.refresh(teamMemberType, state)
	if !boolOf(t, state, "has_accepted_invitation") {
		t.Fatalf("the refresh did not read the acceptance")
	}
	tf.requireNoChanges(teamMemberType, state, config)

	tf.destroy(teamMemberType, state)
	if len(tf.api.rows("/team-member")) != 2 {
		t.Fatalf("the membership was not removed")
	}
}

// Someone already in the project is found at plan, so the plan names them,
// and they join the team at once.
func TestPeopleTeamMemberOfSomeoneInTheProject(t *testing.T) {
	tf := newPeopleTerraform(t)
	config := tf.config(teamMemberType, map[string]tftypes.Value{
		"team_id":    str(peopleTeamID),
		"user_email": str("ALICE@example.com"),
	})

	planned, _ := tf.plan(teamMemberType, tftypes.NewValue(tf.objectType(teamMemberType), nil), config)
	if got := stringOf(t, planned, "user_id"); got != aliceID {
		t.Fatalf("planned user_id = %q, want Alice's %q", got, aliceID)
	}

	state := tf.apply(teamMemberType, tftypes.NewValue(tf.objectType(teamMemberType), nil), config)
	if !boolOf(t, state, "has_accepted_invitation") {
		t.Fatalf("someone who has joined the project did not join the team at once")
	}
	tf.requireNoChanges(teamMemberType, tf.refresh(teamMemberType, state), config)
}

// The bug this replaces: a member who has accepted planned
// has_accepted_invitation = false on every plan. It is read-only now, and a
// configuration that still sets it is refused at validate.
func TestPeopleTeamMemberAcceptanceIsReadOnly(t *testing.T) {
	tf := newPeopleTerraform(t)
	for _, attribute := range tf.schemas[teamMemberType].Block.Attributes {
		switch attribute.Name {
		case "has_accepted_invitation", "invitation_accepted_at":
			if attribute.Optional || attribute.Required || !attribute.Computed {
				t.Errorf("%s is not read-only: optional=%t required=%t", attribute.Name, attribute.Optional, attribute.Required)
			}
		case "team_id":
			if !attribute.Required {
				t.Errorf("team_id is not required: the API refuses a membership without a team")
			}
		}
	}
}

func TestPeopleTeamMemberTwoWaysAtOnceOrNone(t *testing.T) {
	tf := newPeopleTerraform(t)

	both := tf.validate(teamMemberType, tf.config(teamMemberType, map[string]tftypes.Value{
		"team_id":    str(peopleTeamID),
		"user_id":    str(aliceID),
		"user_email": str("alice@example.com"),
	}))
	requireDiagnostic(t, both, tfprotov6.DiagnosticSeverityError, "user_email")

	none := tf.validate(teamMemberType, tf.config(teamMemberType, map[string]tftypes.Value{
		"team_id": str(peopleTeamID),
	}))
	requireDiagnostic(t, none, tfprotov6.DiagnosticSeverityError, "user_email")

	notAnAddress := tf.validate(teamMemberType, tf.config(teamMemberType, map[string]tftypes.Value{
		"team_id":    str(peopleTeamID),
		"user_email": str("alice at example.com"),
	}))
	requireDiagnostic(t, notAnAddress, tfprotov6.DiagnosticSeverityError, "not an email address")

	byID := tf.validate(teamMemberType, tf.config(teamMemberType, map[string]tftypes.Value{
		"team_id": str(peopleTeamID),
		"user_id": str(aliceID),
	}))
	for _, diagnostic := range byID {
		if diagnostic.Severity == tfprotov6.DiagnosticSeverityError {
			t.Fatalf("a member named by ID was refused: %s", diagnostic.Summary)
		}
	}
}

// A membership is imported by team and address, or team and user ID, as
// well as by its own ID - and imported by an address, the address stays as
// it was written, so the plan after it is empty.
func TestPeopleTeamMemberImports(t *testing.T) {
	tf := newPeopleTerraform(t)
	config := tf.config(teamMemberType, map[string]tftypes.Value{
		"team_id":    str(peopleOtherTeam),
		"user_email": str("Alice@Example.com"),
	})
	membershipID := tf.api.rows("/team-member")[0]["_id"].(string)

	for _, importID := range []string{
		peopleOtherTeam + "/Alice@Example.com",
		peopleOtherTeam + "/" + aliceID,
		membershipID,
	} {
		imported, diagnostics := tf.importState(teamMemberType, importID)
		failOnErrors(t, "importing "+importID, diagnostics)
		if got := stringOf(t, imported, "id"); got != membershipID {
			t.Fatalf("import %q found %q, want %q", importID, got, membershipID)
		}
		state := tf.refresh(teamMemberType, imported)
		if got := stringOf(t, state, "user_id"); got != aliceID {
			t.Fatalf("import %q: user_id = %q", importID, got)
		}

		changed, replaced := tf.changes(teamMemberType, state, config)
		if len(replaced) > 0 {
			t.Fatalf("import %q: the plan replaces the membership for %v", importID, replaced)
		}
		if strings.Contains(importID, "@") {
			if len(changed) > 0 {
				t.Fatalf("import %q: the plan changes %v", importID, changed)
			}
		} else if got := stringOf(t, state, "user_email"); got != "alice@example.com" {
			t.Fatalf("import %q: user_email = %q, want the address OneUptime keeps", importID, got)
		}
	}

	_, diagnostics := tf.importState(teamMemberType, peopleOtherTeam+"/nobody@example.com")
	requireDiagnostic(t, diagnostics, tfprotov6.DiagnosticSeverityError, "nobody@example.com")

	_, diagnostics = tf.importState(teamMemberType, peopleTeamID+"/alice@example.com")
	requireDiagnostic(t, diagnostics, tfprotov6.DiagnosticSeverityError, "is not a member")

	_, diagnostics = tf.importState(teamMemberType, "/alice@example.com")
	requireDiagnostic(t, diagnostics, tfprotov6.DiagnosticSeverityError, "Invalid Import ID")
}

// Adding someone to a team they are in already says how to import that
// membership instead.
func TestPeopleTeamMemberAlreadyInTheTeam(t *testing.T) {
	tf := newPeopleTerraform(t)
	config := tf.config(teamMemberType, map[string]tftypes.Value{
		"team_id":    str(peopleOtherTeam),
		"user_email": str("alice@example.com"),
	})

	_, applied := tf.applyResponse(teamMemberType, tftypes.NewValue(tf.objectType(teamMemberType), nil), config)
	requireDiagnostic(t, applied.Diagnostics, tfprotov6.DiagnosticSeverityError, "terraform import oneuptime_team_member.<name> <team_id>/<email address>")
}

// ---------------------------------------------------------------------------
// A person the API can change: an on-call schedule layer's member.

func layerUserConfig(tf *peopleTerraform, person map[string]tftypes.Value) tftypes.Value {
	values := map[string]tftypes.Value{
		"on_call_duty_policy_schedule_id":       str(peopleScheduleID),
		"on_call_duty_policy_schedule_layer_id": str(peopleLayerID),
	}
	for key, value := range person {
		values[key] = value
	}
	return tf.config(layerUserType, values)
}

func TestPeopleLayerUserByEmailChangesPersonInPlace(t *testing.T) {
	tf := newPeopleTerraform(t)
	nothing := tftypes.NewValue(tf.objectType(layerUserType), nil)

	alice := layerUserConfig(tf, map[string]tftypes.Value{"user_email": str("alice@example.com")})
	state := tf.apply(layerUserType, nothing, alice)
	if got := tf.api.creates["/on-call-duty-schedule-layer-user"][0]["userId"]; got != aliceID {
		t.Fatalf("the create sent userId %v, want Alice's", got)
	}
	state = tf.refresh(layerUserType, state)
	tf.requireNoChanges(layerUserType, state, alice)

	// The same person, written in another case: the address is written
	// again, and nothing else - not the person, nothing to the API, nobody
	// looked up, even by a provider that has found nobody yet.
	tf.restart()
	lookups := tf.api.personLookups
	otherCase := layerUserConfig(tf, map[string]tftypes.Value{"user_email": str("Alice@EXAMPLE.com")})
	changed, replaced := tf.changes(layerUserType, state, otherCase)
	if len(replaced) > 0 || strings.Join(withoutServerTimes(changed), ",") != "user_email" {
		t.Fatalf("the same person in another case changes %v and replaces for %v", changed, replaced)
	}
	if tf.api.personLookups != lookups {
		t.Fatalf("an unchanged person was looked up again")
	}
	state = tf.apply(layerUserType, state, otherCase)
	if len(tf.api.updates["/on-call-duty-schedule-layer-user"]) != 0 {
		t.Fatalf("the same person in another case was written to the API")
	}
	tf.requireNoChanges(layerUserType, tf.refresh(layerUserType, state), otherCase)

	// Another person (only invited, which an on-call layer takes): an
	// update in place, with their ID.
	bob := layerUserConfig(tf, map[string]tftypes.Value{"user_email": str("bob@example.com")})
	changed, replaced = tf.changes(layerUserType, state, bob)
	if len(replaced) > 0 {
		t.Fatalf("changing the person replaces the layer member for %v", replaced)
	}
	if !contains(changed, "user_id") || !contains(changed, "user_email") {
		t.Fatalf("changing the person changes %v", changed)
	}
	planned, _ := tf.plan(layerUserType, state, bob)
	if got := stringOf(t, planned, "user_id"); got != bobID {
		t.Fatalf("planned user_id = %q, want Bob's", got)
	}
	state = tf.apply(layerUserType, state, bob)
	updates := tf.api.updates["/on-call-duty-schedule-layer-user"]
	if len(updates) != 1 || updates[0]["userId"] != bobID {
		t.Fatalf("the update sent %v, want Bob's userId", updates)
	}
	tf.requireNoChanges(layerUserType, tf.refresh(layerUserType, state), bob)

	// Named by ID instead: the address is read for them, and nothing changes.
	byID := layerUserConfig(tf, map[string]tftypes.Value{"user_id": str(bobID)})
	tf.requireNoChanges(layerUserType, state, byID)
}

// A person who changes their address in OneUptime is no change: the state
// keeps the address it was given, and Terraform the same person. Writing
// the new address later changes the address only.
func TestPeopleAddressChangedInOneUptimeIsNoChange(t *testing.T) {
	tf := newPeopleTerraform(t)
	nothing := tftypes.NewValue(tf.objectType(layerUserType), nil)
	old := layerUserConfig(tf, map[string]tftypes.Value{"user_email": str("alice@example.com")})
	state := tf.apply(layerUserType, nothing, old)

	tf.api.mu.Lock()
	tf.api.people[aliceID].email = "alice.smith@example.com"
	tf.api.mu.Unlock()

	// The next terraform command: nobody found yet.
	tf.restart()
	state = tf.refresh(layerUserType, state)
	if got := stringOf(t, state, "user_email"); got != "alice@example.com" {
		t.Fatalf("the refresh moved the address to %q", got)
	}
	tf.requireNoChanges(layerUserType, state, old)

	renamed := layerUserConfig(tf, map[string]tftypes.Value{"user_email": str("alice.smith@example.com")})
	changed, replaced := tf.changes(layerUserType, state, renamed)
	if len(replaced) > 0 || strings.Join(withoutServerTimes(changed), ",") != "user_email" {
		t.Fatalf("writing the new address changes %v and replaces for %v, want user_email only", changed, replaced)
	}
	before := len(tf.api.updates["/on-call-duty-schedule-layer-user"])
	state = tf.apply(layerUserType, state, renamed)
	if len(tf.api.updates["/on-call-duty-schedule-layer-user"]) != before {
		t.Fatalf("a new address of the same person was written to the API")
	}
	tf.requireNoChanges(layerUserType, tf.refresh(layerUserType, state), renamed)
}

// Named by ID, the address is filled in after the apply, and read again
// only when the person changes.
func TestPeopleNamedByIDGetTheirAddress(t *testing.T) {
	tf := newPeopleTerraform(t)
	nothing := tftypes.NewValue(tf.objectType(layerUserType), nil)
	alice := layerUserConfig(tf, map[string]tftypes.Value{"user_id": str(aliceID)})

	state := tf.apply(layerUserType, nothing, alice)
	if got := stringOf(t, state, "user_email"); got != "alice@example.com" {
		t.Fatalf("user_email = %q after an apply by ID", got)
	}
	tf.requireNoChanges(layerUserType, tf.refresh(layerUserType, state), alice)

	bob := layerUserConfig(tf, map[string]tftypes.Value{"user_id": str(bobID)})
	planned, _ := tf.plan(layerUserType, state, bob)
	if attributesOf(t, planned)["user_email"].IsKnown() {
		t.Fatalf("another person planned the old address")
	}
	state = tf.apply(layerUserType, state, bob)
	if got := stringOf(t, state, "user_email"); got != "bob@example.com" {
		t.Fatalf("user_email = %q after switching to Bob", got)
	}
}

// Someone outside the project - an account of another project included -
// is never found: the plan warns, and the apply fails, saying what to do.
func TestPeopleOutsideTheProjectAreNotFound(t *testing.T) {
	tf := newPeopleTerraform(t)
	nothing := tftypes.NewValue(tf.objectType(layerUserType), nil)

	for _, address := range []string{"stranger@example.com", "nobody@example.com"} {
		config := layerUserConfig(tf, map[string]tftypes.Value{"user_email": str(address)})

		_, response := tf.plan(layerUserType, nothing, config)
		requireDiagnostic(t, response.Diagnostics, tfprotov6.DiagnosticSeverityWarning, address+" is not in this project yet")

		_, applied := tf.applyResponse(layerUserType, nothing, config)
		diagnostic := requireDiagnostic(t, applied.Diagnostics, tfprotov6.DiagnosticSeverityError, address+" is not in this project")
		if !strings.Contains(diagnostic.Detail, "user_id = oneuptime_team_member.<name>.user_id") {
			t.Fatalf("the error does not say how to invite them first: %s", diagnostic.Detail)
		}
	}
	if len(tf.api.creates["/on-call-duty-schedule-layer-user"]) != 0 {
		t.Fatalf("a layer member was created for someone outside the project")
	}
}

// Someone invited by another resource of the same apply is found at apply.
func TestPeopleInvitedInTheSameApplyAreFoundAtApply(t *testing.T) {
	tf := newPeopleTerraform(t)
	nothing := tftypes.NewValue(tf.objectType(layerUserType), nil)
	config := layerUserConfig(tf, map[string]tftypes.Value{"user_email": str("carol@example.com")})

	// Planned before Carol is invited...
	planResponse := tf.planResponse(layerUserType, nothing, config)
	failOnErrors(t, "planning", planResponse.Diagnostics)

	// ...her membership is created first...
	member := tf.apply(teamMemberType, tftypes.NewValue(tf.objectType(teamMemberType), nil), tf.config(teamMemberType, map[string]tftypes.Value{
		"team_id":    str(peopleTeamID),
		"user_email": str("carol@example.com"),
	}))

	// ...and the layer member applies with her ID.
	objectType := tf.objectType(layerUserType)
	applied, err := tf.server.ApplyResourceChange(tf.ctx, &tfprotov6.ApplyResourceChangeRequest{
		TypeName:     layerUserType,
		PriorState:   tf.encode(objectType, nothing),
		PlannedState: planResponse.PlannedState,
		Config:       tf.encode(objectType, config),
	})
	if err != nil {
		t.Fatalf("ApplyResourceChange: %s", err)
	}
	failOnErrors(t, "applying", applied.Diagnostics)
	state := tf.decode(objectType, applied.NewState)
	if got, want := stringOf(t, state, "user_id"), stringOf(t, member, "user_id"); got != want {
		t.Fatalf("user_id = %q, want Carol's %q", got, want)
	}
}

// ---------------------------------------------------------------------------
// A person the API cannot change: a monitor's owner.

func TestPeopleOwnerReplacedOnlyForAnotherPerson(t *testing.T) {
	tf := newPeopleTerraform(t)
	nothing := tftypes.NewValue(tf.objectType(monitorOwnerType), nil)
	alice := tf.config(monitorOwnerType, map[string]tftypes.Value{
		"monitor_id": str(peopleMonitorID),
		"user_email": str("alice@example.com"),
	})

	state := tf.apply(monitorOwnerType, nothing, alice)

	// OneUptime tells Alice, and marks her row: no change for Terraform -
	// before, every plan after that replaced the owner, and told her again.
	for _, row := range tf.api.rows("/monitor-owner-user") {
		row["isOwnerNotified"] = true
	}
	state = tf.refresh(monitorOwnerType, state)
	tf.requireNoChanges(monitorOwnerType, state, alice)

	sameOtherCase := tf.config(monitorOwnerType, map[string]tftypes.Value{
		"monitor_id": str(peopleMonitorID),
		"user_email": str("ALICE@example.com"),
	})
	_, replaced := tf.changes(monitorOwnerType, state, sameOtherCase)
	if len(replaced) > 0 {
		t.Fatalf("the same person in another case replaces the owner for %v", replaced)
	}

	bob := tf.config(monitorOwnerType, map[string]tftypes.Value{
		"monitor_id": str(peopleMonitorID),
		"user_email": str("bob@example.com"),
	})
	_, replaced = tf.changes(monitorOwnerType, state, bob)
	if len(replaced) != 1 || replaced[0] != "user_id" {
		t.Fatalf("another owner replaces the row for %v, want user_id", replaced)
	}
}

// A monitor's owner, and a person on an on-call layer, are imported by what
// they own or are on and the person's address (or user ID), as a membership
// is: no screen shows their own IDs. Imported by an address, the address
// stays as written, so the plan after it is empty.
func TestPeopleOwnerAndLayerRowsImportByParentAndAddress(t *testing.T) {
	tf := newPeopleTerraform(t)
	nothing := tftypes.NewValue(tf.objectType(monitorOwnerType), nil)
	owner := tf.config(monitorOwnerType, map[string]tftypes.Value{
		"monitor_id": str(peopleMonitorID),
		"user_email": str("Alice@Example.com"),
	})
	tf.apply(monitorOwnerType, nothing, owner)
	ownerID := tf.api.rows("/monitor-owner-user")[0]["_id"].(string)

	for _, importID := range []string{
		peopleMonitorID + "/Alice@Example.com",
		peopleMonitorID + "/" + aliceID,
		ownerID,
	} {
		imported, diagnostics := tf.importState(monitorOwnerType, importID)
		failOnErrors(t, "importing "+importID, diagnostics)
		if got := stringOf(t, imported, "id"); got != ownerID {
			t.Fatalf("import %q found %q, want %q", importID, got, ownerID)
		}
		state := tf.refresh(monitorOwnerType, imported)
		if got := stringOf(t, state, "user_id"); got != aliceID {
			t.Fatalf("import %q: user_id = %q", importID, got)
		}
		if strings.Contains(importID, "@") {
			tf.requireNoChanges(monitorOwnerType, state, owner)
		}
	}

	// Someone who owns nothing there is named as such.
	_, diagnostics := tf.importState(monitorOwnerType, peopleMonitorID+"/bob@example.com")
	requireDiagnostic(t, diagnostics, tfprotov6.DiagnosticSeverityError, "Not Found")
	if detail := diagnostics[0].Detail; !strings.Contains(detail, "bob@example.com is not an owner of the monitor") {
		t.Fatalf("an owner not found says %q", detail)
	}

	// The person on a layer, by the layer and their address.
	layerNothing := tftypes.NewValue(tf.objectType(layerUserType), nil)
	tf.apply(layerUserType, layerNothing, layerUserConfig(tf, map[string]tftypes.Value{
		"user_email": str("bob@example.com"),
	}))
	layerRowID := tf.api.rows("/on-call-duty-schedule-layer-user")[0]["_id"].(string)

	imported, diagnostics := tf.importState(layerUserType, peopleLayerID+"/bob@example.com")
	failOnErrors(t, "importing the layer's member", diagnostics)
	if got := stringOf(t, imported, "id"); got != layerRowID {
		t.Fatalf("the layer import found %q, want %q", got, layerRowID)
	}
	if got := stringOf(t, imported, "user_email"); got != "bob@example.com" {
		t.Fatalf("the layer import keeps user_email %q", got)
	}

	_, diagnostics = tf.importState(layerUserType, peopleLayerID+"/alice@example.com")
	requireDiagnostic(t, diagnostics, tfprotov6.DiagnosticSeverityError, "Not Found")
	if detail := diagnostics[0].Detail; !strings.Contains(detail, "alice@example.com is not on the on call schedule layer") {
		t.Fatalf("a person not on the layer says %q", detail)
	}

	// The form an import ID takes is said when it is not followed.
	_, diagnostics = tf.importState(monitorOwnerType, "/alice@example.com")
	requireDiagnostic(t, diagnostics, tfprotov6.DiagnosticSeverityError, "Invalid Import ID")
	if detail := diagnostics[0].Detail; !strings.Contains(detail, "<monitor_id>/<email address or user id>") {
		t.Fatalf("an import ID with no monitor says %q", detail)
	}
}

func TestPeopleOwnerNotifiedIsReadOnly(t *testing.T) {
	tf := newPeopleTerraform(t)
	for name, schema := range tf.schemas {
		for _, attribute := range schema.Block.Attributes {
			if attribute.Name == "is_owner_notified" && (attribute.Optional || attribute.Required) {
				t.Errorf("%s.is_owner_notified is writable: OneUptime sets it once it has told the owner", name)
			}
		}
	}
}

// ---------------------------------------------------------------------------
// A set of people: an owner rule's owners.

func TestPeopleOwnerRuleNamesASetByEmail(t *testing.T) {
	tf := newPeopleTerraform(t)
	nothing := tftypes.NewValue(tf.objectType(ownerRuleType), nil)
	config := tf.config(ownerRuleType, map[string]tftypes.Value{
		"name":              str("Platform owners"),
		"owner_user_emails": stringSet("alice@example.com", "Bob@Example.com"),
	})

	planned, _ := tf.plan(ownerRuleType, nothing, config)
	if got := stringsOf(t, planned, "owner_users"); strings.Join(got, ",") != strings.Join([]string{aliceID, bobID}, ",") {
		t.Fatalf("planned owner_users = %v", got)
	}

	state := tf.apply(ownerRuleType, nothing, config)
	sent, _ := tf.api.creates["/monitor-owner-rule"][0]["ownerUsers"].([]interface{})
	if len(sent) != 2 {
		t.Fatalf("the create sent ownerUsers %v", tf.api.creates["/monitor-owner-rule"][0]["ownerUsers"])
	}
	state = tf.refresh(ownerRuleType, state)
	tf.requireNoChanges(ownerRuleType, state, config)

	// Bob leaves the rule.
	aliceOnly := tf.config(ownerRuleType, map[string]tftypes.Value{
		"name":              str("Platform owners"),
		"owner_user_emails": stringSet("alice@example.com"),
	})
	state = tf.apply(ownerRuleType, state, aliceOnly)
	if got := stringsOf(t, state, "owner_users"); len(got) != 1 || got[0] != aliceID {
		t.Fatalf("owner_users = %v after Bob left", got)
	}
	tf.requireNoChanges(ownerRuleType, tf.refresh(ownerRuleType, state), aliceOnly)

	conflict := tf.validate(ownerRuleType, tf.config(ownerRuleType, map[string]tftypes.Value{
		"name":              str("Platform owners"),
		"owner_users":       stringSet(aliceID),
		"owner_user_emails": stringSet("alice@example.com"),
	}))
	requireDiagnostic(t, conflict, tfprotov6.DiagnosticSeverityError, "owner_user_emails")
}

// ---------------------------------------------------------------------------
// The user data source.

const userDataSource = "oneuptime_user"

func (tf *peopleTerraform) lookUpUser(arguments map[string]tftypes.Value) (tftypes.Value, []*tfprotov6.Diagnostic) {
	tf.t.Helper()
	objectType := tf.sources[userDataSource].ValueType().(tftypes.Object)
	read, err := tf.server.ReadDataSource(tf.ctx, &tfprotov6.ReadDataSourceRequest{
		TypeName: userDataSource,
		Config:   tf.encode(objectType, objectWith(objectType, arguments)),
	})
	if err != nil {
		tf.t.Fatalf("ReadDataSource: %s", err)
	}
	if read.State == nil {
		return tftypes.Value{}, read.Diagnostics
	}
	return tf.decode(objectType, read.State), read.Diagnostics
}

func TestPeopleUserDataSource(t *testing.T) {
	tf := newPeopleTerraform(t)

	alice, diagnostics := tf.lookUpUser(map[string]tftypes.Value{"email": str("Alice@Example.com")})
	failOnErrors(t, "looking Alice up by email", diagnostics)
	if stringOf(t, alice, "id") != aliceID || stringOf(t, alice, "name") != "Alice Smith" || !boolOf(t, alice, "has_accepted_invitation") {
		t.Fatalf("Alice by email: %s", alice)
	}
	if got := stringOf(t, alice, "email"); got != "Alice@Example.com" {
		t.Fatalf("email = %q, want it as configured", got)
	}
	if got := stringsOf(t, alice, "team_ids"); len(got) != 1 || got[0] != peopleOtherTeam {
		t.Fatalf("team_ids = %v", got)
	}

	bob, diagnostics := tf.lookUpUser(map[string]tftypes.Value{"id": str(bobID)})
	failOnErrors(t, "looking Bob up by id", diagnostics)
	if stringOf(t, bob, "email") != "bob@example.com" || boolOf(t, bob, "has_accepted_invitation") {
		t.Fatalf("Bob by id: %s", bob)
	}

	byName, diagnostics := tf.lookUpUser(map[string]tftypes.Value{"name": str("Bob Jones")})
	failOnErrors(t, "looking Bob up by name", diagnostics)
	if stringOf(t, byName, "id") != bobID {
		t.Fatalf("Bob by name: %s", byName)
	}

	// Two people of one name.
	tf.api.mu.Lock()
	tf.api.people[bobID].name = "Alice Smith"
	tf.api.mu.Unlock()
	_, diagnostics = tf.lookUpUser(map[string]tftypes.Value{"name": str("Alice Smith")})
	requireDiagnostic(t, diagnostics, tfprotov6.DiagnosticSeverityError, "Look the one you mean up by `email`")

	_, diagnostics = tf.lookUpUser(map[string]tftypes.Value{"email": str("stranger@example.com")})
	requireDiagnostic(t, diagnostics, tfprotov6.DiagnosticSeverityError, "No one in this project, or invited to it")

	_, diagnostics = tf.lookUpUser(map[string]tftypes.Value{"email": str("alice@example.com"), "name": str("Alice Smith")})
	requireDiagnostic(t, diagnostics, tfprotov6.DiagnosticSeverityError, "set exactly one of them")

	_, diagnostics = tf.lookUpUser(map[string]tftypes.Value{})
	requireDiagnostic(t, diagnostics, tfprotov6.DiagnosticSeverityError, "set exactly one of them")
}

// lookUp reads a data source, as terraform plan does.
func (tf *peopleTerraform) lookUp(typeName string, arguments map[string]tftypes.Value) (tftypes.Value, []*tfprotov6.Diagnostic) {
	tf.t.Helper()
	source := tf.sources[typeName]
	if source == nil {
		tf.t.Fatalf("the provider has no data source %s", typeName)
	}
	objectType := source.ValueType().(tftypes.Object)
	config := tf.encode(objectType, objectWith(objectType, arguments))

	validated, err := tf.server.ValidateDataResourceConfig(tf.ctx, &tfprotov6.ValidateDataResourceConfigRequest{
		TypeName: typeName,
		Config:   config,
	})
	if err != nil {
		tf.t.Fatalf("ValidateDataResourceConfig: %s", err)
	}
	for _, diagnostic := range validated.Diagnostics {
		if diagnostic.Severity == tfprotov6.DiagnosticSeverityError {
			return tftypes.Value{}, validated.Diagnostics
		}
	}

	read, err := tf.server.ReadDataSource(tf.ctx, &tfprotov6.ReadDataSourceRequest{
		TypeName: typeName,
		Config:   config,
	})
	if err != nil {
		tf.t.Fatalf("ReadDataSource: %s", err)
	}
	if read.State == nil {
		return tftypes.Value{}, read.Diagnostics
	}
	return tf.decode(objectType, read.State), read.Diagnostics
}

// A data source finds a record by the address of the person it names, as
// the resource names them: user_email beside user_id.
func TestPeopleDataSourceFindsARecordByThePersonsAddress(t *testing.T) {
	tf := newPeopleTerraform(t)
	const memberSource = "oneuptime_team_member"

	alice, diagnostics := tf.lookUp(memberSource, map[string]tftypes.Value{
		"team_id":    str(peopleOtherTeam),
		"user_email": str("Alice@Example.com"),
	})
	failOnErrors(t, "looking Alice's membership up by her address", diagnostics)
	if got := stringOf(t, alice, "user_id"); got != aliceID {
		t.Fatalf("user_id = %q, want Alice's", got)
	}
	if got := stringOf(t, alice, "user_email"); got != "Alice@Example.com" {
		t.Fatalf("user_email = %q, want it as configured", got)
	}

	// Found by ID, the address is the person's own.
	bob, diagnostics := tf.lookUp(memberSource, map[string]tftypes.Value{
		"team_id": str(peopleOtherTeam),
		"user_id": str(bobID),
	})
	failOnErrors(t, "looking Bob's membership up by his ID", diagnostics)
	if got := stringOf(t, bob, "user_email"); got != "bob@example.com" {
		t.Fatalf("user_email = %q, want Bob's address", got)
	}

	// Nobody in the project has the address: an error that says so, and no
	// list of memberships asked for.
	tf.api.mu.Lock()
	before := len(tf.api.requests)
	tf.api.mu.Unlock()
	_, diagnostics = tf.lookUp(memberSource, map[string]tftypes.Value{
		"team_id":    str(peopleOtherTeam),
		"user_email": str("stranger@example.com"),
	})
	requireDiagnostic(t, diagnostics, tfprotov6.DiagnosticSeverityError, "stranger@example.com is not in this project")
	tf.api.mu.Lock()
	lists := 0
	for _, request := range tf.api.requests[before:] {
		if request == "POST /team-member/get-list" {
			lists++
		}
	}
	tf.api.mu.Unlock()
	if lists != 1 {
		t.Fatalf("looking a stranger up listed team members %d times, want once: the person lookup only", lists)
	}

	// One of the two: an ID and an address at once is refused before any
	// request, and so is something that is no address.
	_, diagnostics = tf.lookUp(memberSource, map[string]tftypes.Value{
		"user_id":    str(aliceID),
		"user_email": str("alice@example.com"),
	})
	requireDiagnostic(t, diagnostics, tfprotov6.DiagnosticSeverityError, "user_email")
	_, diagnostics = tf.lookUp(memberSource, map[string]tftypes.Value{
		"user_email": str("alice at example.com"),
	})
	requireDiagnostic(t, diagnostics, tfprotov6.DiagnosticSeverityError, "not an email address")

	// An owner row finds its owner the same way.
	tf.api.mu.Lock()
	tf.api.insert("/monitor-owner-user", map[string]interface{}{"monitorId": peopleMonitorID, "userId": aliceID})
	tf.api.mu.Unlock()
	owner, diagnostics := tf.lookUp("oneuptime_monitor_user_owner", map[string]tftypes.Value{
		"monitor_id": str(peopleMonitorID),
		"user_email": str("alice@example.com"),
	})
	failOnErrors(t, "looking a monitor's owner up by address", diagnostics)
	if got := stringOf(t, owner, "user_id"); got != aliceID {
		t.Fatalf("owner user_id = %q, want Alice's", got)
	}
}

// withoutServerTimes: a change leaves when the server last wrote the row
// unknown until the apply, which is no change anybody made.
func withoutServerTimes(changed []string) []string {
	kept := []string{}
	for _, name := range changed {
		if name != "updated_at" {
			kept = append(kept, name)
		}
	}
	return kept
}

func contains(values []string, value string) bool {
	for _, candidate := range values {
		if candidate == value {
			return true
		}
	}
	return false
}
