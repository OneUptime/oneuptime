package provider

/*
 * A permission - a team's, an API key's, a custom role's - is a permission's
 * key, such as IncidentMember: a string. The API spec documented it as an
 * object, so the provider made it a JSON attribute and its reference said
 * "write it with jsonencode()" (OneUptime#10300). A configuration that did,
 * permission = jsonencode("IncidentMember"), sent the key, but read it back
 * as the key, not as the JSON it planned, and the apply failed with
 * "Provider produced inconsistent result after apply".
 *
 * The spec now says what a permission is, and the provider takes the plain
 * key. It still takes the jsonencode() form, from a configuration and from
 * state, as the same permission: these drive each of the three resources
 * through the real protocol server, against a fake API that keeps a
 * permission as the key it was sent and refuses anything else, as OneUptime
 * does.
 */

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/hashicorp/terraform-plugin-framework/providerserver"
	"github.com/hashicorp/terraform-plugin-go/tfprotov6"
	"github.com/hashicorp/terraform-plugin-go/tftypes"
)

const permissionAPIKey = "permission-roundtrip-key"

// A permission's key as a configuration writes it, and as jsonencode() does.
const (
	incidentMember            = "IncidentMember"
	incidentMemberJSONEncoded = `"IncidentMember"`
	readIncident              = "ReadProjectIncident"
	readIncidentJSONEncoded   = `"ReadProjectIncident"`
)

// The keys the fake takes: OneUptime refuses any other value of a permission.
var knownPermissionKeys = map[string]bool{
	incidentMember: true,
	readIncident:   true,
	"ProjectAdmin": true,
}

// A table whose rows each hold one permission, and the record a row belongs to.
type permissionTable struct {
	resourceType string
	apiPath      string
	parent       string
	parentField  string
	// What OneUptime fills in when a create leaves it out.
	defaults map[string]interface{}
}

var permissionTables = []permissionTable{
	{
		resourceType: "oneuptime_team_permission",
		apiPath:      "/api/team-permission",
		parent:       "team_id",
		parentField:  "teamId",
		defaults: map[string]interface{}{
			"isBlockPermission": false,
			"scope":             "All",
			"labels":            []interface{}{},
		},
	},
	{
		resourceType: "oneuptime_api_key_permission",
		apiPath:      "/api/api-key-permission",
		parent:       "api_key_id",
		parentField:  "apiKeyId",
		defaults: map[string]interface{}{
			"isBlockPermission": false,
			"labels":            []interface{}{},
		},
	},
	{
		resourceType: "oneuptime_custom_role_permission",
		apiPath:      "/api/custom-role-permission",
		parent:       "custom_role_id",
		parentField:  "customRoleId",
		defaults: map[string]interface{}{
			"scope":  "All",
			"labels": []interface{}{},
		},
	},
}

const permissionParentID = "11111111-1111-4111-8111-111111111111"

// permissionAPI is the fake OneUptime API: one table's endpoints. It keeps a
// permission as the key it was sent, answers it back as that key, and
// refuses a value that is no permission's key, as OneUptime does.
type permissionAPI struct {
	t       *testing.T
	table   permissionTable
	mu      sync.Mutex
	server  *httptest.Server
	rows    map[string]map[string]interface{}
	created int
	// Every value a create or an update sent as the permission.
	sent []interface{}
}

func newPermissionAPI(t *testing.T, table permissionTable) *permissionAPI {
	t.Helper()
	api := &permissionAPI{t: t, table: table, rows: map[string]map[string]interface{}{}}
	api.server = httptest.NewServer(http.HandlerFunc(api.handle))
	t.Cleanup(api.server.Close)
	return api
}

func (a *permissionAPI) handle(w http.ResponseWriter, r *http.Request) {
	a.mu.Lock()
	defer a.mu.Unlock()

	if r.Header.Get("APIKey") != permissionAPIKey {
		a.reply(w, http.StatusUnauthorized, map[string]interface{}{"message": "Invalid API Key"})
		return
	}

	var body map[string]interface{}
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		a.t.Errorf("reading %s %s: %s", r.Method, r.URL.Path, err)
	}
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &body); err != nil {
			a.t.Errorf("%s %s sent a body that is not JSON: %s", r.Method, r.URL.Path, err)
		}
	}

	rest := strings.TrimPrefix(r.URL.Path, a.table.apiPath)
	switch {
	case r.Method == http.MethodPost && rest == "":
		data, _ := body["data"].(map[string]interface{})
		if problem := a.refusal(data); problem != "" {
			a.reply(w, http.StatusBadRequest, map[string]interface{}{"message": problem})
			return
		}
		a.created++
		id := fmt.Sprintf("00000000-0000-4000-8000-%012d", a.created)
		row := map[string]interface{}{"_id": id, "projectId": "22222222-2222-4222-8222-222222222222"}
		for key, value := range a.table.defaults {
			row[key] = value
		}
		for key, value := range data {
			row[key] = value
		}
		a.rows[id] = row
		a.reply(w, http.StatusOK, row)
	case r.Method == http.MethodPost && rest == "/get-list":
		query, _ := body["query"].(map[string]interface{})
		matches := []interface{}{}
		for _, row := range a.rows {
			if rowMatches(row, query) {
				matches = append(matches, row)
			}
		}
		a.reply(w, http.StatusOK, map[string]interface{}{"data": matches, "count": len(matches)})
	case r.Method == http.MethodPost && strings.HasSuffix(rest, "/get-item"):
		row, ok := a.rows[strings.TrimSuffix(strings.TrimPrefix(rest, "/"), "/get-item")]
		if !ok {
			a.reply(w, http.StatusNotFound, map[string]interface{}{"message": "Not found."})
			return
		}
		a.reply(w, http.StatusOK, row)
	case r.Method == http.MethodPut && rest != "":
		row, ok := a.rows[strings.TrimPrefix(rest, "/")]
		if !ok {
			a.reply(w, http.StatusNotFound, map[string]interface{}{"message": "Not found."})
			return
		}
		data, _ := body["data"].(map[string]interface{})
		if problem := a.refusal(data); problem != "" {
			a.reply(w, http.StatusBadRequest, map[string]interface{}{"message": problem})
			return
		}
		for key, value := range data {
			row[key] = value
		}
		a.reply(w, http.StatusOK, map[string]interface{}{})
	case r.Method == http.MethodDelete && rest != "":
		delete(a.rows, strings.TrimPrefix(rest, "/"))
		a.reply(w, http.StatusOK, map[string]interface{}{})
	default:
		a.t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
		a.reply(w, http.StatusNotFound, map[string]interface{}{"message": "Not found"})
	}
}

// refusal is why OneUptime would refuse the permission a write sends, as its
// own words say it ("OneUptime has no permission called ..."), or "".
func (a *permissionAPI) refusal(data map[string]interface{}) string {
	value, sent := data["permission"]
	if !sent {
		return ""
	}
	a.sent = append(a.sent, value)
	key, isString := value.(string)
	if !isString || !knownPermissionKeys[key] {
		return fmt.Sprintf("OneUptime has no permission called %v.", value)
	}
	return ""
}

func rowMatches(row map[string]interface{}, query map[string]interface{}) bool {
	for key, want := range query {
		if fmt.Sprint(row[key]) != fmt.Sprint(want) {
			return false
		}
	}
	return true
}

// permissionOf is the permission OneUptime keeps for the row.
func (a *permissionAPI) permissionOf(id string) interface{} {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.rows[id]["permission"]
}

// lastSent is the value the last create or update sent as the permission.
func (a *permissionAPI) lastSent() interface{} {
	a.mu.Lock()
	defer a.mu.Unlock()
	if len(a.sent) == 0 {
		return nil
	}
	return a.sent[len(a.sent)-1]
}

func (a *permissionAPI) reply(w http.ResponseWriter, status int, body interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(body); err != nil {
		a.t.Errorf("writing the response: %s", err)
	}
}

// permissionTerraform drives one permission resource the way Terraform does.
type permissionTerraform struct {
	t              *testing.T
	ctx            context.Context
	table          permissionTable
	server         tfprotov6.ProviderServer
	resourceSchema *tfprotov6.Schema
	resourceType   tftypes.Object
	dataSourceType tftypes.Object
}

func newPermissionTerraform(t *testing.T, api *permissionAPI) *permissionTerraform {
	t.Helper()
	ctx := context.Background()
	server := providerserver.NewProtocol6(New("test")())()

	schemas, err := server.GetProviderSchema(ctx, &tfprotov6.GetProviderSchemaRequest{})
	if err != nil {
		t.Fatalf("GetProviderSchema: %s", err)
	}
	resourceSchema := schemas.ResourceSchemas[api.table.resourceType]
	dataSourceSchema := schemas.DataSourceSchemas[api.table.resourceType]
	if resourceSchema == nil || dataSourceSchema == nil {
		t.Fatalf("the provider has no %s resource and data source", api.table.resourceType)
	}

	providerType := schemas.Provider.ValueType().(tftypes.Object)
	providerConfig, err := tfprotov6.NewDynamicValue(providerType, objectWith(providerType, map[string]tftypes.Value{
		"oneuptime_url": tftypes.NewValue(tftypes.String, api.server.URL),
		"api_key":       tftypes.NewValue(tftypes.String, permissionAPIKey),
	}))
	if err != nil {
		t.Fatalf("encoding the provider configuration: %s", err)
	}
	configured, err := server.ConfigureProvider(ctx, &tfprotov6.ConfigureProviderRequest{
		TerraformVersion: "1.9.8",
		Config:           &providerConfig,
	})
	if err != nil {
		t.Fatalf("ConfigureProvider: %s", err)
	}
	failOnErrors(t, "configuring the provider", configured.Diagnostics)

	return &permissionTerraform{
		t:              t,
		ctx:            ctx,
		table:          api.table,
		server:         server,
		resourceSchema: resourceSchema,
		resourceType:   resourceSchema.ValueType().(tftypes.Object),
		dataSourceType: dataSourceSchema.ValueType().(tftypes.Object),
	}
}

// config is a resource block giving the row's record and its permission, as written.
func (tf *permissionTerraform) config(permission string) tftypes.Value {
	return objectWith(tf.resourceType, map[string]tftypes.Value{
		tf.table.parent: tftypes.NewValue(tftypes.String, permissionParentID),
		"permission":    tftypes.NewValue(tftypes.String, permission),
	})
}

func (tf *permissionTerraform) encode(objectType tftypes.Object, value tftypes.Value) *tfprotov6.DynamicValue {
	tf.t.Helper()
	encoded, err := tfprotov6.NewDynamicValue(objectType, value)
	if err != nil {
		tf.t.Fatalf("encoding %s: %s", value, err)
	}
	return &encoded
}

func (tf *permissionTerraform) decode(objectType tftypes.Object, value *tfprotov6.DynamicValue) tftypes.Value {
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

// proposedNew is what Terraform proposes for a plan: the configuration, and
// the prior state's value for every computed attribute it leaves out.
func (tf *permissionTerraform) proposedNew(prior, config tftypes.Value) tftypes.Value {
	if prior.IsNull() {
		return config
	}
	priorValues := attributesOf(tf.t, prior)
	proposed := map[string]tftypes.Value{}
	for name, configured := range attributesOf(tf.t, config) {
		proposed[name] = configured
		if configured.IsNull() && tf.isComputed(name) {
			proposed[name] = priorValues[name]
		}
	}
	return tftypes.NewValue(tf.resourceType, proposed)
}

func (tf *permissionTerraform) isComputed(name string) bool {
	for _, attribute := range tf.resourceSchema.Block.Attributes {
		if attribute.Name == name {
			return attribute.Computed
		}
	}
	tf.t.Fatalf("%s has no attribute %s", tf.table.resourceType, name)
	return false
}

func (tf *permissionTerraform) validate(config tftypes.Value) []*tfprotov6.Diagnostic {
	tf.t.Helper()
	validated, err := tf.server.ValidateResourceConfig(tf.ctx, &tfprotov6.ValidateResourceConfigRequest{
		TypeName: tf.table.resourceType,
		Config:   tf.encode(tf.resourceType, config),
	})
	if err != nil {
		tf.t.Fatalf("ValidateResourceConfig: %s", err)
	}
	return validated.Diagnostics
}

func (tf *permissionTerraform) plan(prior, config tftypes.Value) *tfprotov6.PlanResourceChangeResponse {
	tf.t.Helper()
	failOnErrors(tf.t, "validating", tf.validate(config))
	planned, err := tf.server.PlanResourceChange(tf.ctx, &tfprotov6.PlanResourceChangeRequest{
		TypeName:         tf.table.resourceType,
		PriorState:       tf.encode(tf.resourceType, prior),
		ProposedNewState: tf.encode(tf.resourceType, tf.proposedNew(prior, config)),
		Config:           tf.encode(tf.resourceType, config),
	})
	if err != nil {
		tf.t.Fatalf("PlanResourceChange: %s", err)
	}
	failOnErrors(tf.t, "planning", planned.Diagnostics)
	tf.requireValidPlan(prior, config, tf.decode(tf.resourceType, planned.PlannedState))
	return planned
}

// requireValidPlan fails where Terraform refuses a plan: a planned value of
// an attribute the configuration sets that is neither the configuration's
// nor the prior state's ("Provider produced invalid plan").
func (tf *permissionTerraform) requireValidPlan(prior, config, planned tftypes.Value) {
	tf.t.Helper()
	configured := attributesOf(tf.t, config)
	var priorValues map[string]tftypes.Value
	if !prior.IsNull() {
		priorValues = attributesOf(tf.t, prior)
	}
	for name, value := range attributesOf(tf.t, planned) {
		want := configured[name]
		if want.IsNull() || !want.IsKnown() {
			continue
		}
		if value.Equal(want) || (priorValues != nil && value.Equal(priorValues[name])) {
			continue
		}
		tf.t.Fatalf("Provider produced invalid plan: .%s: planned %s does not match the configuration's %s nor the prior state's", name, value, want)
	}
}

// apply plans the configuration over the prior state, applies the plan and
// fails where Terraform fails an apply with "Provider produced inconsistent
// result after apply": an attribute the plan knew that the result lost.
func (tf *permissionTerraform) apply(prior, config tftypes.Value) tftypes.Value {
	tf.t.Helper()
	planResponse := tf.plan(prior, config)
	planned := tf.decode(tf.resourceType, planResponse.PlannedState)

	applied, err := tf.server.ApplyResourceChange(tf.ctx, &tfprotov6.ApplyResourceChangeRequest{
		TypeName:       tf.table.resourceType,
		PriorState:     tf.encode(tf.resourceType, prior),
		PlannedState:   planResponse.PlannedState,
		Config:         tf.encode(tf.resourceType, config),
		PlannedPrivate: planResponse.PlannedPrivate,
	})
	if err != nil {
		tf.t.Fatalf("ApplyResourceChange: %s", err)
	}
	failOnErrors(tf.t, "applying", applied.Diagnostics)

	state := tf.decode(tf.resourceType, applied.NewState)
	got := attributesOf(tf.t, state)
	for name, want := range attributesOf(tf.t, planned) {
		if want.IsKnown() && !sameToTerraform(tf.t, want, got[name]) {
			tf.t.Fatalf("Provider produced inconsistent result after apply: .%s: was %s, but now %s", name, want, got[name])
		}
	}
	return state
}

func (tf *permissionTerraform) refresh(state tftypes.Value) tftypes.Value {
	tf.t.Helper()
	read, err := tf.server.ReadResource(tf.ctx, &tfprotov6.ReadResourceRequest{
		TypeName:     tf.table.resourceType,
		CurrentState: tf.encode(tf.resourceType, state),
	})
	if err != nil {
		tf.t.Fatalf("ReadResource: %s", err)
	}
	failOnErrors(tf.t, "refreshing", read.Diagnostics)
	return tf.decode(tf.resourceType, read.NewState)
}

// requireNoChanges fails unless planning the configuration over the state
// is empty, as Terraform decides it: every attribute known and the same as
// in the state, so "No changes", and nothing to replace.
func (tf *permissionTerraform) requireNoChanges(state, config tftypes.Value) {
	tf.t.Helper()
	planResponse := tf.plan(state, config)
	planned := tf.decode(tf.resourceType, planResponse.PlannedState)

	before := attributesOf(tf.t, state)
	for name, value := range attributesOf(tf.t, planned) {
		if !value.IsKnown() || !sameToTerraform(tf.t, before[name], value) {
			tf.t.Errorf("the plan changes %s: %s -> %s", name, before[name], value)
		}
	}
	if len(planResponse.RequiresReplace) > 0 {
		tf.t.Errorf("the plan replaces the %s because of %v", tf.table.resourceType, planResponse.RequiresReplace)
	}
}

func (tf *permissionTerraform) importRow(id string) tftypes.Value {
	tf.t.Helper()
	imported, err := tf.server.ImportResourceState(tf.ctx, &tfprotov6.ImportResourceStateRequest{
		TypeName: tf.table.resourceType,
		ID:       id,
	})
	if err != nil {
		tf.t.Fatalf("ImportResourceState: %s", err)
	}
	failOnErrors(tf.t, "importing", imported.Diagnostics)
	if len(imported.ImportedResources) != 1 {
		tf.t.Fatalf("importing %s gave %d resources", id, len(imported.ImportedResources))
	}
	return tf.refresh(tf.decode(tf.resourceType, imported.ImportedResources[0].State))
}

func (tf *permissionTerraform) lookUp(arguments map[string]tftypes.Value) tftypes.Value {
	tf.t.Helper()
	read, err := tf.server.ReadDataSource(tf.ctx, &tfprotov6.ReadDataSourceRequest{
		TypeName: tf.table.resourceType,
		Config:   tf.encode(tf.dataSourceType, objectWith(tf.dataSourceType, arguments)),
	})
	if err != nil {
		tf.t.Fatalf("ReadDataSource: %s", err)
	}
	failOnErrors(tf.t, "looking the permission up", read.Diagnostics)
	return tf.decode(tf.dataSourceType, read.State)
}

// withPermission is the state with its permission written another way: what
// a provider before this one kept for a configuration that used jsonencode().
func (tf *permissionTerraform) withPermission(state tftypes.Value, permission string) tftypes.Value {
	return withAttribute(tf.t, tf.resourceType, state, "permission", tftypes.NewValue(tftypes.String, permission))
}

// eachPermissionTable runs the test for each of the three resources.
func eachPermissionTable(t *testing.T, test func(t *testing.T, api *permissionAPI, tf *permissionTerraform)) {
	for _, table := range permissionTables {
		table := table
		t.Run(table.resourceType, func(t *testing.T) {
			api := newPermissionAPI(t, table)
			test(t, api, newPermissionTerraform(t, api))
		})
	}
}

func requirePermissionSent(t *testing.T, api *permissionAPI, want string) {
	t.Helper()
	if got := api.lastSent(); got != want {
		t.Fatalf("the API was sent the permission %#v, not the key %q", got, want)
	}
}

func requireStatePermission(t *testing.T, state tftypes.Value, want string) {
	t.Helper()
	if got := stringAttribute(t, state, "permission"); got != want {
		t.Fatalf("the state holds the permission %q, not %q", got, want)
	}
}

func TestPermission_PlainKeyIsSentAndKept(t *testing.T) {
	eachPermissionTable(t, func(t *testing.T, api *permissionAPI, tf *permissionTerraform) {
		created := tf.apply(tftypes.NewValue(tf.resourceType, nil), tf.config(incidentMember))
		requirePermissionSent(t, api, incidentMember)
		requireStatePermission(t, created, incidentMember)

		refreshed := tf.refresh(created)
		requireStatePermission(t, refreshed, incidentMember)
		tf.requireNoChanges(refreshed, tf.config(incidentMember))
	})
}

// The jsonencode() form the reference asked for: sent as the key, kept as
// the configuration writes it, and no change on the next plan.
func TestPermission_JSONEncodedKeyIsSentAsTheKey(t *testing.T) {
	eachPermissionTable(t, func(t *testing.T, api *permissionAPI, tf *permissionTerraform) {
		created := tf.apply(tftypes.NewValue(tf.resourceType, nil), tf.config(incidentMemberJSONEncoded))
		requirePermissionSent(t, api, incidentMember)
		if got := api.permissionOf(stringAttribute(t, created, "id")); got != incidentMember {
			t.Fatalf("OneUptime keeps the permission %#v, not %q", got, incidentMember)
		}
		requireStatePermission(t, created, incidentMemberJSONEncoded)

		refreshed := tf.refresh(created)
		requireStatePermission(t, refreshed, incidentMemberJSONEncoded)
		tf.requireNoChanges(refreshed, tf.config(incidentMemberJSONEncoded))
	})
}

// State written by an earlier provider, in either form, under a
// configuration in either form: a refresh keeps it, and the plan is empty.
func TestPermission_ExistingStateInEitherFormPlansNoChanges(t *testing.T) {
	forms := map[string]string{"plain": incidentMember, "jsonencode": incidentMemberJSONEncoded}
	for stateForm, inState := range forms {
		for configForm, configured := range forms {
			inState, configured := inState, configured
			t.Run(fmt.Sprintf("state %s, configuration %s", stateForm, configForm), func(t *testing.T) {
				eachPermissionTable(t, func(t *testing.T, api *permissionAPI, tf *permissionTerraform) {
					created := tf.apply(tftypes.NewValue(tf.resourceType, nil), tf.config(incidentMember))
					existing := tf.withPermission(created, inState)

					refreshed := tf.refresh(existing)
					requireStatePermission(t, refreshed, inState)
					tf.requireNoChanges(refreshed, tf.config(configured))

					// And nothing is sent: an apply of the plan changes nothing.
					sentBefore := len(api.sent)
					kept := tf.apply(refreshed, tf.config(configured))
					requireStatePermission(t, kept, inState)
					if len(api.sent) != sentBefore {
						t.Fatalf("applying a plan with no changes sent the permission %#v", api.lastSent())
					}
				})
			})
		}
	}
}

// Another permission is a change, in either form, and is sent as its key.
func TestPermission_AnotherPermissionIsAnUpdate(t *testing.T) {
	changes := map[string]string{"plain": readIncident, "jsonencode": readIncidentJSONEncoded}
	for form, configured := range changes {
		configured := configured
		t.Run(form, func(t *testing.T) {
			eachPermissionTable(t, func(t *testing.T, api *permissionAPI, tf *permissionTerraform) {
				created := tf.apply(tftypes.NewValue(tf.resourceType, nil), tf.config(incidentMemberJSONEncoded))
				id := stringAttribute(t, created, "id")

				planned := tf.decode(tf.resourceType, tf.plan(created, tf.config(configured)).PlannedState)
				requireStatePermission(t, planned, configured)

				updated := tf.apply(created, tf.config(configured))
				requirePermissionSent(t, api, readIncident)
				if got := api.permissionOf(id); got != readIncident {
					t.Fatalf("OneUptime keeps the permission %#v, not %q", got, readIncident)
				}
				if got := stringAttribute(t, updated, "id"); got != id {
					t.Fatalf("changing the permission replaced the row: %s, then %s", id, got)
				}
				tf.requireNoChanges(tf.refresh(updated), tf.config(configured))
			})
		})
	}
}

// An import reads the key; a configuration in either form is no change.
func TestPermission_ImportedRowUnderEitherFormPlansNoChanges(t *testing.T) {
	for _, configured := range []string{incidentMember, incidentMemberJSONEncoded} {
		configured := configured
		t.Run(configured, func(t *testing.T) {
			eachPermissionTable(t, func(t *testing.T, api *permissionAPI, tf *permissionTerraform) {
				created := tf.apply(tftypes.NewValue(tf.resourceType, nil), tf.config(incidentMember))

				imported := tf.importRow(stringAttribute(t, created, "id"))
				requireStatePermission(t, imported, incidentMember)
				tf.requireNoChanges(imported, tf.config(configured))
			})
		})
	}
}

// What is no permission's key is refused before anything is sent: an object,
// as the reference's old example wrote one, a list, or nothing at all.
func TestPermission_RefusesWhatIsNoPermissionKey(t *testing.T) {
	refused := map[string]string{
		"an object":                  `{"delete":false,"read":true,"write":false}`,
		"a list":                     `["IncidentMember"]`,
		"a number":                   `42`,
		"an empty key":               ``,
		"an empty jsonencode() key":  `""`,
		"a key with spaces round it": ` IncidentMember `,
		"malformed JSON":             `"IncidentMember`,
	}
	for what, configured := range refused {
		configured := configured
		t.Run(what, func(t *testing.T) {
			eachPermissionTable(t, func(t *testing.T, api *permissionAPI, tf *permissionTerraform) {
				diagnostics := tf.validate(tf.config(configured))
				refusedHere := false
				for _, diagnostic := range diagnostics {
					if diagnostic.Severity == tfprotov6.DiagnosticSeverityError {
						refusedHere = true
					}
				}
				if !refusedHere {
					t.Fatalf("the permission %q was not refused at plan time", configured)
				}
				if len(api.sent) > 0 {
					t.Fatalf("a refused permission was sent: %#v", api.sent)
				}
			})
		})
	}
}

// The data source reads a permission as its key, and looks one up by it.
func TestPermission_DataSourceReadsAndLooksUpTheKey(t *testing.T) {
	eachPermissionTable(t, func(t *testing.T, api *permissionAPI, tf *permissionTerraform) {
		created := tf.apply(tftypes.NewValue(tf.resourceType, nil), tf.config(incidentMemberJSONEncoded))
		id := stringAttribute(t, created, "id")

		byID := tf.lookUp(map[string]tftypes.Value{"id": tftypes.NewValue(tftypes.String, id)})
		if got := stringAttribute(t, byID, "permission"); got != incidentMember {
			t.Fatalf("the data source reads the permission as %q, not %q", got, incidentMember)
		}

		byKey := tf.lookUp(map[string]tftypes.Value{
			tf.table.parent: tftypes.NewValue(tftypes.String, permissionParentID),
			"permission":    tftypes.NewValue(tftypes.String, incidentMember),
		})
		if got := stringAttribute(t, byKey, "id"); got != id {
			t.Fatalf("looking the permission up by its key found %q, not %q", got, id)
		}
	})
}
