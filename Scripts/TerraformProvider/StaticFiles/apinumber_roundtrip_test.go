package provider

/*
 * The resource issue #4719 was about - oneuptime_status_page_history_chart_bar_color -
 * created, refreshed, planned, changed, imported, looked up and destroyed
 * through the provider's real protocol server, the way terraform apply and
 * terraform plan drive it, against a fake OneUptime API.
 *
 * The fake keeps the uptime percent the way OneUptime does - the server
 * reads the request's JSON number as a JavaScript number, and Postgres keeps
 * the digits it was given as numeric - and answers it in one of two ways:
 *
 *   - as text, "uptimePercentGreaterThanOrEqualTo": "99.65", the way every
 *     server before the fix for #4719 answered it (the reporter ran 14.0.44);
 *   - as a JSON number, the way servers with the fix answer it.
 *
 * A provider is often upgraded before the server it talks to, so it has to
 * work with both.
 *
 * After every step the test checks what Terraform checks: an apply's result
 * matches its plan for every attribute the plan knew ("Provider produced
 * inconsistent result after apply"), a refresh reads back what the apply
 * stored, and the next plan changes nothing.
 */

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"

	"github.com/hashicorp/terraform-plugin-framework/providerserver"
	"github.com/hashicorp/terraform-plugin-go/tfprotov6"
	"github.com/hashicorp/terraform-plugin-go/tftypes"
)

const (
	barColorRuleType         = "oneuptime_status_page_history_chart_bar_color"
	barColorRuleAPIPath      = "/api/status-page-history-chart-bar-color-rule"
	barColorRuleAPIKey       = "test-api-key"
	barColorRuleProjectID    = "4719a000-0000-4000-8000-000000000001"
	barColorRuleStatusPageID = "4719a000-0000-4000-8000-000000000002"
	barColorRuleTimestamp    = "2026-10-12T14:17:28.000Z"
)

// The two servers a provider meets.
var barColorRuleServers = []struct {
	name        string
	answersText bool
}{
	{"a server that answers decimals as text, as before the fix", true},
	{"a server that answers decimals as numbers", false},
}

// barColorRuleAPI is the fake OneUptime API: the bar color rule endpoints.
type barColorRuleAPI struct {
	t           *testing.T
	answersText bool
	server      *httptest.Server

	mu    sync.Mutex
	rules map[string]map[string]interface{}
	ids   []string
	// Every uptime percent the provider sent, as the server's JSON reader
	// read it.
	sentUptimes []interface{}
	deleted     []string
}

func newBarColorRuleAPI(t *testing.T, answersText bool) *barColorRuleAPI {
	t.Helper()
	api := &barColorRuleAPI{t: t, answersText: answersText, rules: map[string]map[string]interface{}{}}
	api.server = httptest.NewServer(http.HandlerFunc(api.handle))
	t.Cleanup(api.server.Close)
	return api
}

// storeUptime is the text Postgres keeps for the uptime percent a request
// carried. The server reads a JSON number as a JavaScript number and hands
// it to Postgres as its shortest decimal; text the dashboard sent ("100.00")
// keeps its digits.
func (a *barColorRuleAPI) storeUptime(value interface{}) string {
	switch v := value.(type) {
	case float64:
		return strconv.FormatFloat(v, 'f', -1, 64)
	case string:
		return strings.TrimSpace(v)
	default:
		a.t.Errorf("the provider sent the uptime percent as %#v (%T), not a number", value, value)
		return ""
	}
}

// seed stores a rule as the dashboard made it.
func (a *barColorRuleAPI) seed(uptimeText string) string {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.insert(map[string]interface{}{
		"statusPageId":                      barColorRuleStatusPageID,
		"uptimePercentGreaterThanOrEqualTo": uptimeText,
		"barColor":                          "#22C55E",
	})
}

func (a *barColorRuleAPI) insert(data map[string]interface{}) string {
	id := fmt.Sprintf("4719b000-0000-4000-8000-%012d", len(a.ids)+1)
	rule := map[string]interface{}{
		"_id":                               id,
		"statusPageId":                      data["statusPageId"],
		"uptimePercentGreaterThanOrEqualTo": a.storeUptime(data["uptimePercentGreaterThanOrEqualTo"]),
		"barColor":                          data["barColor"],
		"order":                             float64(len(a.ids) + 1),
	}
	if order, ok := data["order"].(float64); ok {
		rule["order"] = order
	}
	a.rules[id] = rule
	a.ids = append(a.ids, id)
	return id
}

// answer is a rule as the API answers it.
func (a *barColorRuleAPI) answer(rule map[string]interface{}) map[string]interface{} {
	stored := rule["uptimePercentGreaterThanOrEqualTo"].(string)

	var uptime interface{} = stored
	if !a.answersText {
		number, err := strconv.ParseFloat(stored, 64)
		if err != nil {
			a.t.Fatalf("stored uptime %q is not a number: %s", stored, err)
		}
		uptime = number
	}

	return map[string]interface{}{
		"_id":                               rule["_id"],
		"projectId":                         map[string]interface{}{"_type": "ObjectID", "value": barColorRuleProjectID},
		"statusPageId":                      map[string]interface{}{"_type": "ObjectID", "value": rule["statusPageId"]},
		"uptimePercentGreaterThanOrEqualTo": uptime,
		"barColor":                          map[string]interface{}{"_type": "Color", "value": rule["barColor"]},
		"order":                             rule["order"],
		"createdAt":                         map[string]interface{}{"_type": "DateTime", "value": barColorRuleTimestamp},
		"updatedAt":                         map[string]interface{}{"_type": "DateTime", "value": barColorRuleTimestamp},
		"createdByUserId":                   nil,
	}
}

func (a *barColorRuleAPI) handle(w http.ResponseWriter, r *http.Request) {
	a.mu.Lock()
	defer a.mu.Unlock()

	if r.Header.Get("APIKey") != barColorRuleAPIKey {
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

	rest := strings.TrimPrefix(r.URL.Path, barColorRuleAPIPath)
	switch {
	case r.Method == http.MethodPost && rest == "":
		data, _ := body["data"].(map[string]interface{})
		a.sentUptimes = append(a.sentUptimes, data["uptimePercentGreaterThanOrEqualTo"])
		id := a.insert(data)
		a.reply(w, http.StatusOK, a.answer(a.rules[id]))
	case r.Method == http.MethodPost && rest == "/get-list":
		a.list(w, body)
	case r.Method == http.MethodPost && strings.HasSuffix(rest, "/get-item"):
		rule, ok := a.rules[strings.TrimSuffix(strings.TrimPrefix(rest, "/"), "/get-item")]
		if !ok {
			a.reply(w, http.StatusNotFound, map[string]interface{}{"message": "Not found"})
			return
		}
		a.reply(w, http.StatusOK, a.answer(rule))
	case r.Method == http.MethodPut && rest != "":
		rule, ok := a.rules[strings.TrimPrefix(rest, "/")]
		if !ok {
			a.reply(w, http.StatusNotFound, map[string]interface{}{"message": "Not found"})
			return
		}
		data, _ := body["data"].(map[string]interface{})
		for key, value := range data {
			switch key {
			case "uptimePercentGreaterThanOrEqualTo":
				a.sentUptimes = append(a.sentUptimes, value)
				rule[key] = a.storeUptime(value)
			case "barColor", "statusPageId", "order":
				rule[key] = value
			default:
				a.t.Errorf("the update sent %s, which the rule has no column for", key)
			}
		}
		a.reply(w, http.StatusOK, map[string]interface{}{})
	case r.Method == http.MethodDelete && rest != "":
		id := strings.TrimPrefix(rest, "/")
		delete(a.rules, id)
		a.deleted = append(a.deleted, id)
		a.reply(w, http.StatusOK, map[string]interface{}{})
	default:
		a.t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
		a.reply(w, http.StatusNotFound, map[string]interface{}{"message": "Not found"})
	}
}

// list answers get-list: the rules every filter of the query matches, the
// uptime percent compared as Postgres compares numerics - by value.
func (a *barColorRuleAPI) list(w http.ResponseWriter, body map[string]interface{}) {
	query, _ := body["query"].(map[string]interface{})
	found := []interface{}{}

	for _, id := range a.ids {
		rule, ok := a.rules[id]
		if !ok {
			continue
		}
		matches := true
		for key, want := range query {
			switch key {
			case "_id", "statusPageId":
				matches = matches && rule[key] == want
			case "uptimePercentGreaterThanOrEqualTo":
				stored, _ := strconv.ParseFloat(rule[key].(string), 64)
				wanted, isNumber := want.(float64)
				if !isNumber {
					a.t.Errorf("the lookup sent the uptime percent as %#v (%T), not a number", want, want)
				}
				matches = matches && isNumber && stored == wanted
			case "order":
				matches = matches && rule[key] == want
			default:
				a.t.Errorf("the lookup filtered on %s, which this test does not expect", key)
				matches = false
			}
		}
		if matches {
			found = append(found, a.answer(rule))
		}
	}

	a.reply(w, http.StatusOK, map[string]interface{}{"data": found, "count": len(found), "skip": 0, "limit": 2})
}

func (a *barColorRuleAPI) reply(w http.ResponseWriter, status int, body interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(body); err != nil {
		a.t.Errorf("writing the response: %s", err)
	}
}

// barColorRuleTerraform drives the provider the way Terraform does.
type barColorRuleTerraform struct {
	t              *testing.T
	ctx            context.Context
	api            *barColorRuleAPI
	server         tfprotov6.ProviderServer
	resourceSchema *tfprotov6.Schema
	resourceType   tftypes.Object
	dataSourceType tftypes.Object
}

func newBarColorRuleTerraform(t *testing.T, answersText bool) *barColorRuleTerraform {
	t.Helper()
	ctx := context.Background()
	api := newBarColorRuleAPI(t, answersText)
	server := providerserver.NewProtocol6(New("test")())()

	schemas, err := server.GetProviderSchema(ctx, &tfprotov6.GetProviderSchemaRequest{})
	if err != nil {
		t.Fatalf("GetProviderSchema: %s", err)
	}
	resourceSchema := schemas.ResourceSchemas[barColorRuleType]
	dataSourceSchema := schemas.DataSourceSchemas[barColorRuleType]
	if resourceSchema == nil || dataSourceSchema == nil {
		t.Fatalf("the provider has no %s resource and data source", barColorRuleType)
	}

	providerType := schemas.Provider.ValueType().(tftypes.Object)
	providerConfig, err := tfprotov6.NewDynamicValue(providerType, objectWith(providerType, map[string]tftypes.Value{
		"oneuptime_url": tftypes.NewValue(tftypes.String, api.server.URL),
		"api_key":       tftypes.NewValue(tftypes.String, barColorRuleAPIKey),
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

	return &barColorRuleTerraform{
		t:              t,
		ctx:            ctx,
		api:            api,
		server:         server,
		resourceSchema: resourceSchema,
		resourceType:   resourceSchema.ValueType().(tftypes.Object),
		dataSourceType: dataSourceSchema.ValueType().(tftypes.Object),
	}
}

func failOnErrors(t *testing.T, doing string, diagnostics []*tfprotov6.Diagnostic) {
	t.Helper()
	for _, diagnostic := range diagnostics {
		if diagnostic.Severity == tfprotov6.DiagnosticSeverityError {
			t.Fatalf("%s: %s - %s", doing, diagnostic.Summary, diagnostic.Detail)
		}
	}
}

// ruleConfig is a resource block like the one in issue #4719.
func (tf *barColorRuleTerraform) ruleConfig(uptime *big.Float) tftypes.Value {
	return objectWith(tf.resourceType, map[string]tftypes.Value{
		"status_page_id": tftypes.NewValue(tftypes.String, barColorRuleStatusPageID),
		"uptime_percent_greater_than_or_equal_to": tftypes.NewValue(tftypes.Number, uptime),
		"bar_color": tftypes.NewValue(tftypes.String, "#86EFAC"),
	})
}

func (tf *barColorRuleTerraform) encode(objectType tftypes.Object, value tftypes.Value) *tfprotov6.DynamicValue {
	tf.t.Helper()
	encoded, err := tfprotov6.NewDynamicValue(objectType, value)
	if err != nil {
		tf.t.Fatalf("encoding %s: %s", value, err)
	}
	return &encoded
}

func (tf *barColorRuleTerraform) decode(objectType tftypes.Object, value *tfprotov6.DynamicValue) tftypes.Value {
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
func (tf *barColorRuleTerraform) proposedNew(prior, config tftypes.Value) tftypes.Value {
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

func (tf *barColorRuleTerraform) isComputed(name string) bool {
	for _, attribute := range tf.resourceSchema.Block.Attributes {
		if attribute.Name == name {
			return attribute.Computed
		}
	}
	tf.t.Fatalf("%s has no attribute %s", barColorRuleType, name)
	return false
}

func (tf *barColorRuleTerraform) plan(prior, config tftypes.Value) *tfprotov6.PlanResourceChangeResponse {
	tf.t.Helper()
	planned, err := tf.server.PlanResourceChange(tf.ctx, &tfprotov6.PlanResourceChangeRequest{
		TypeName:         barColorRuleType,
		PriorState:       tf.encode(tf.resourceType, prior),
		ProposedNewState: tf.encode(tf.resourceType, tf.proposedNew(prior, config)),
		Config:           tf.encode(tf.resourceType, config),
	})
	if err != nil {
		tf.t.Fatalf("PlanResourceChange: %s", err)
	}
	failOnErrors(tf.t, "planning", planned.Diagnostics)
	return planned
}

// apply plans the configuration over the prior state, applies the plan and
// checks the result the way Terraform does.
func (tf *barColorRuleTerraform) apply(prior, config tftypes.Value) tftypes.Value {
	tf.t.Helper()
	planResponse := tf.plan(prior, config)
	planned := tf.decode(tf.resourceType, planResponse.PlannedState)

	applied, err := tf.server.ApplyResourceChange(tf.ctx, &tfprotov6.ApplyResourceChangeRequest{
		TypeName:       barColorRuleType,
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
	tf.requireAsPlanned(planned, state)
	return state
}

// requireAsPlanned fails where Terraform fails an apply with "Provider
// produced inconsistent result after apply": an attribute the plan knew that
// the result does not have, compared the way Terraform compares it.
func (tf *barColorRuleTerraform) requireAsPlanned(planned, state tftypes.Value) {
	tf.t.Helper()
	got := attributesOf(tf.t, state)
	for name, want := range attributesOf(tf.t, planned) {
		if !want.IsKnown() {
			continue
		}
		if !sameToTerraform(tf.t, want, got[name]) {
			tf.t.Fatalf("Provider produced inconsistent result after apply: .%s: was %s, but now %s", name, want, got[name])
		}
	}
}

// sameToTerraform compares two attribute values the way Terraform does:
// numbers by how they print (terraformNumbersEqual), the rest as they are.
func sameToTerraform(t *testing.T, a, b tftypes.Value) bool {
	t.Helper()
	if !a.Type().Is(tftypes.Number) || !b.Type().Is(tftypes.Number) ||
		a.IsNull() || b.IsNull() || !a.IsKnown() || !b.IsKnown() {
		return a.Equal(b)
	}
	var aNumber, bNumber big.Float
	if err := a.As(&aNumber); err != nil {
		t.Fatalf("reading %s: %s", a, err)
	}
	if err := b.As(&bNumber); err != nil {
		t.Fatalf("reading %s: %s", b, err)
	}
	return terraformNumbersEqual(&aNumber, &bNumber)
}

func (tf *barColorRuleTerraform) refresh(state tftypes.Value) tftypes.Value {
	tf.t.Helper()
	read, err := tf.server.ReadResource(tf.ctx, &tfprotov6.ReadResourceRequest{
		TypeName:     barColorRuleType,
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
func (tf *barColorRuleTerraform) requireNoChanges(state, config tftypes.Value) {
	tf.t.Helper()
	planResponse := tf.plan(state, config)
	planned := tf.decode(tf.resourceType, planResponse.PlannedState)

	before := attributesOf(tf.t, state)
	after := attributesOf(tf.t, planned)
	for name, value := range after {
		if !value.IsKnown() || !sameToTerraform(tf.t, before[name], value) {
			tf.t.Errorf("the plan changes %s: %s -> %s", name, before[name], value)
		}
	}
	// Terraform replaces only for a path whose value the plan changes.
	for _, path := range planResponse.RequiresReplace {
		name, isAttribute := path.Steps()[0].(tftypes.AttributeName)
		if !isAttribute || !sameToTerraform(tf.t, before[string(name)], after[string(name)]) {
			tf.t.Errorf("the plan replaces the rule because of %s", path)
		}
	}
}

func (tf *barColorRuleTerraform) destroy(state tftypes.Value) {
	tf.t.Helper()
	nothing := tftypes.NewValue(tf.resourceType, nil)
	destroyed, err := tf.server.ApplyResourceChange(tf.ctx, &tfprotov6.ApplyResourceChangeRequest{
		TypeName:     barColorRuleType,
		PriorState:   tf.encode(tf.resourceType, state),
		PlannedState: tf.encode(tf.resourceType, nothing),
		Config:       tf.encode(tf.resourceType, nothing),
	})
	if err != nil {
		tf.t.Fatalf("destroying: %s", err)
	}
	failOnErrors(tf.t, "destroying", destroyed.Diagnostics)
}

func (tf *barColorRuleTerraform) importRule(id string) tftypes.Value {
	tf.t.Helper()
	imported, err := tf.server.ImportResourceState(tf.ctx, &tfprotov6.ImportResourceStateRequest{
		TypeName: barColorRuleType,
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

// lookUp reads the data source with the arguments given.
func (tf *barColorRuleTerraform) lookUp(arguments map[string]tftypes.Value) tftypes.Value {
	tf.t.Helper()
	read, err := tf.server.ReadDataSource(tf.ctx, &tfprotov6.ReadDataSourceRequest{
		TypeName: barColorRuleType,
		Config:   tf.encode(tf.dataSourceType, objectWith(tf.dataSourceType, arguments)),
	})
	if err != nil {
		tf.t.Fatalf("ReadDataSource: %s", err)
	}
	failOnErrors(tf.t, "looking the rule up", read.Diagnostics)
	return tf.decode(tf.dataSourceType, read.State)
}

func attributesOf(t *testing.T, object tftypes.Value) map[string]tftypes.Value {
	t.Helper()
	attributes := map[string]tftypes.Value{}
	if err := object.As(&attributes); err != nil {
		t.Fatalf("reading %s: %s", object, err)
	}
	return attributes
}

func stringAttribute(t *testing.T, object tftypes.Value, name string) string {
	t.Helper()
	var value string
	if err := attributesOf(t, object)[name].As(&value); err != nil {
		t.Fatalf("reading %s: %s", name, err)
	}
	return value
}

// uptimeOf is the uptime percent an object holds, failing if it holds none.
func uptimeOf(t *testing.T, object tftypes.Value) *big.Float {
	t.Helper()
	value := attributesOf(t, object)["uptime_percent_greater_than_or_equal_to"]
	if value.IsNull() || !value.IsKnown() {
		t.Fatalf("uptime_percent_greater_than_or_equal_to is %s", value)
	}
	var uptime big.Float
	if err := value.As(&uptime); err != nil {
		t.Fatalf("reading uptime_percent_greater_than_or_equal_to: %s", err)
	}
	return &uptime
}

// requireUptime fails unless the object holds exactly the number wanted.
//
// Exactly, not merely a number that prints the same: the framework compares
// a plan with the prior state number for number, and finding them unequal
// it plans every computed attribute the configuration leaves out as unknown.
// A rule whose 99.65 was read as the nearest float64 - what the provider did
// with a JSON number before #4719's fix - showed "~ updated_at -> (known
// after apply)" in every plan after its apply.
func requireUptime(t *testing.T, object tftypes.Value, want *big.Float, where string) {
	t.Helper()
	got := uptimeOf(t, object)
	if got.Cmp(want) == 0 {
		return
	}
	if terraformNumbersEqual(got, want) {
		t.Fatalf("%s: uptime_percent_greater_than_or_equal_to is %s, which prints as %s but is not exactly it", where, got.Text('g', 40), want.Text('f', -1))
	}
	t.Fatalf("%s: uptime_percent_greater_than_or_equal_to is %s, want %s", where, got.Text('f', -1), want.Text('f', -1))
}

// The configurations a test applies: the reporter's 100 and 99.65, the
// recommended rules' others, and a number with more digits than the API
// keeps - a day with one minute of downtime, 100 * (1 - 1 / 1440).
func barColorRuleUptimes(t *testing.T) map[string]*big.Float {
	return map[string]*big.Float{
		"100":                configNumber(t, "100"),
		"99.65":              configNumber(t, "99.65"),
		"99":                 configNumber(t, "99"),
		"0":                  configNumber(t, "0"),
		"99.999":             configNumber(t, "99.999"),
		"100 * (1 - 1/1440)": new(big.Float).SetPrec(512).Quo(new(big.Float).SetPrec(512).SetInt64(143900), new(big.Float).SetPrec(512).SetInt64(1440)),
	}
}

// Issue #4719, step by step: apply, refresh, plan again, destroy.
func TestBarColorRuleUptimeAppliesAndPlansClean(t *testing.T) {
	for _, server := range barColorRuleServers {
		for written, uptime := range barColorRuleUptimes(t) {
			t.Run(server.name+", uptime "+written, func(t *testing.T) {
				tf := newBarColorRuleTerraform(t, server.answersText)
				config := tf.ruleConfig(uptime)

				// The apply that failed with "inconsistent result after apply".
				state := tf.apply(tftypes.NewValue(tf.resourceType, nil), config)
				requireUptime(t, state, uptime, "after the apply")

				// The server was sent a JSON number - the nearest the API keeps.
				nearest, _ := uptime.Float64()
				if len(tf.api.sentUptimes) != 1 || tf.api.sentUptimes[0] != nearest {
					t.Fatalf("the server was sent %#v, want [%v]", tf.api.sentUptimes, nearest)
				}

				refreshed := tf.refresh(state)
				requireUptime(t, refreshed, uptime, "after a refresh")
				tf.requireNoChanges(refreshed, config)

				// The tainted rule the failed applies left behind is destroyed
				// cleanly too.
				tf.destroy(refreshed)
				id := stringAttribute(t, state, "id")
				if len(tf.api.deleted) != 1 || tf.api.deleted[0] != id {
					t.Fatalf("deleted %v, want [%s]", tf.api.deleted, id)
				}
			})
		}
	}
}

// A change to the uptime percent is an update in place, and reads back as
// written.
func TestBarColorRuleUptimeUpdatesInPlace(t *testing.T) {
	for _, server := range barColorRuleServers {
		t.Run(server.name, func(t *testing.T) {
			tf := newBarColorRuleTerraform(t, server.answersText)
			uptimes := barColorRuleUptimes(t)

			state := tf.apply(tftypes.NewValue(tf.resourceType, nil), tf.ruleConfig(uptimes["99.65"]))
			id := stringAttribute(t, state, "id")

			for _, written := range []string{"99.999", "100", "100 * (1 - 1/1440)", "0", "99.65"} {
				config := tf.ruleConfig(uptimes[written])

				planResponse := tf.plan(state, config)
				for _, path := range planResponse.RequiresReplace {
					t.Fatalf("changing the uptime to %s replaces the rule because of %s", written, path)
				}

				state = tf.apply(state, config)
				requireUptime(t, state, uptimes[written], "after updating to "+written)
				if got := stringAttribute(t, state, "id"); got != id {
					t.Fatalf("updating to %s made rule %s, want %s kept", written, got, id)
				}

				state = tf.refresh(state)
				requireUptime(t, state, uptimes[written], "after a refresh at "+written)
				tf.requireNoChanges(state, config)
			}
		})
	}
}

// A rule made in the dashboard keeps the digits its form sent ("100.00");
// imported, it reads back as the number a configuration writes.
func TestBarColorRuleMadeInTheDashboardImportsWithoutChanges(t *testing.T) {
	for _, server := range barColorRuleServers {
		for stored, written := range map[string]string{
			"100.00": "100",
			"99.00":  "99",
			"95":     "95",
			"0.00":   "0",
			"99.650": "99.65",
		} {
			t.Run(server.name+", stored as "+stored, func(t *testing.T) {
				tf := newBarColorRuleTerraform(t, server.answersText)
				id := tf.api.seed(stored)

				state := tf.importRule(id)
				requireUptime(t, state, configNumber(t, written), "after the import")

				config := objectWith(tf.resourceType, map[string]tftypes.Value{
					"status_page_id": tftypes.NewValue(tftypes.String, barColorRuleStatusPageID),
					"uptime_percent_greater_than_or_equal_to": tftypes.NewValue(tftypes.Number, configNumber(t, written)),
					"bar_color": tftypes.NewValue(tftypes.String, "#22C55E"),
				})
				tf.requireNoChanges(state, config)
			})
		}
	}
}

// The data source reads the uptime percent as a number, looked up by id or
// by the uptime percent itself.
func TestBarColorRuleDataSourceReadsTheUptime(t *testing.T) {
	for _, server := range barColorRuleServers {
		t.Run(server.name, func(t *testing.T) {
			tf := newBarColorRuleTerraform(t, server.answersText)
			uptimes := barColorRuleUptimes(t)

			made := tf.apply(tftypes.NewValue(tf.resourceType, nil), tf.ruleConfig(uptimes["99.65"]))
			madeID := stringAttribute(t, made, "id")
			dashboardID := tf.api.seed("100.00")

			byID := tf.lookUp(map[string]tftypes.Value{
				"id": tftypes.NewValue(tftypes.String, madeID),
			})
			requireUptime(t, byID, uptimes["99.65"], "looked up by id")

			byDashboardID := tf.lookUp(map[string]tftypes.Value{
				"id": tftypes.NewValue(tftypes.String, dashboardID),
			})
			requireUptime(t, byDashboardID, uptimes["100"], "the dashboard's rule looked up by id")

			for written, wantID := range map[string]string{"99.65": madeID, "100": dashboardID} {
				byUptime := tf.lookUp(map[string]tftypes.Value{
					"status_page_id": tftypes.NewValue(tftypes.String, barColorRuleStatusPageID),
					"uptime_percent_greater_than_or_equal_to": tftypes.NewValue(tftypes.Number, uptimes[written]),
				})
				if got := stringAttribute(t, byUptime, "id"); got != wantID {
					t.Fatalf("looked up by uptime %s: found %s, want %s", written, got, wantID)
				}
				// The argument reads back as it was written.
				requireUptime(t, byUptime, uptimes[written], "looked up by uptime "+written)
			}
		})
	}
}
