package provider

/*
 * Finding people by email address (people.go): the requests the lookups
 * make, how they read the API's answers, what they remember, and the small
 * rules - addresses, sets, error text - the plans and applies are built on.
 * The plans themselves are people_plan_test.go.
 */

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/hashicorp/terraform-plugin-framework/attr"
	"github.com/hashicorp/terraform-plugin-framework/diag"
	"github.com/hashicorp/terraform-plugin-framework/schema/validator"
	"github.com/hashicorp/terraform-plugin-framework/types"
)

// directoryAPI answers /team-member/get-list from canned pages and records
// every body it was sent.
type directoryAPI struct {
	t      *testing.T
	server *httptest.Server

	mu     sync.Mutex
	bodies []map[string]interface{}
	// answer gives the rows for one request.
	answer func(body map[string]interface{}) (int, interface{})
}

func newDirectoryAPI(t *testing.T, answer func(body map[string]interface{}) (int, interface{})) (*directoryAPI, *Client) {
	t.Helper()
	api := &directoryAPI{t: t, answer: answer}
	api.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		api.mu.Lock()
		defer api.mu.Unlock()

		if r.URL.Path != "/api/team-member/get-list" || r.Method != http.MethodPost {
			t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		var body map[string]interface{}
		raw, _ := io.ReadAll(r.Body)
		if err := json.Unmarshal(raw, &body); err != nil {
			t.Errorf("the lookup sent a body that is not JSON: %s", err)
		}
		api.bodies = append(api.bodies, body)

		status, reply := api.answer(body)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(reply)
	}))
	t.Cleanup(api.server.Close)

	client, err := NewClient(api.server.URL, "key", "test")
	if err != nil {
		t.Fatalf("NewClient: %s", err)
	}
	return api, client
}

func (a *directoryAPI) requestCount() int {
	a.mu.Lock()
	defer a.mu.Unlock()
	return len(a.bodies)
}

func membership(userID string, teamID string, accepted bool, email string, name interface{}) map[string]interface{} {
	return map[string]interface{}{
		"_id":                   "m-" + userID + "-" + teamID,
		"userId":                map[string]interface{}{"_type": "ObjectID", "value": userID},
		"teamId":                map[string]interface{}{"_type": "ObjectID", "value": teamID},
		"hasAcceptedInvitation": accepted,
		"user": map[string]interface{}{
			"_id":   userID,
			"email": map[string]interface{}{"_type": "Email", "value": email},
			"name":  name,
		},
	}
}

func page(rows ...interface{}) (int, interface{}) {
	return http.StatusOK, map[string]interface{}{"data": rows, "count": len(rows)}
}

func TestPeopleLookupByEmailAsksTheProjectsMembers(t *testing.T) {
	api, client := newDirectoryAPI(t, func(body map[string]interface{}) (int, interface{}) {
		return page(
			membership("u1", "team-b", false, "alice@example.com", map[string]interface{}{"_type": "Name", "value": "Alice Smith"}),
			membership("u1", "team-a", true, "alice@example.com", map[string]interface{}{"_type": "Name", "value": "Alice Smith"}),
		)
	})

	person, err := client.findPersonByEmail(context.Background(), "  Alice@Example.COM ")
	if err != nil {
		t.Fatalf("findPersonByEmail: %s", err)
	}
	if person == nil || person.ID != "u1" || person.Email != "alice@example.com" || person.Name != "Alice Smith" {
		t.Fatalf("found %+v", person)
	}
	if !person.HasAcceptedInvitation {
		t.Fatalf("an accepted membership in one team is not joined")
	}
	if strings.Join(person.TeamIDs, ",") != "team-a,team-b" {
		t.Fatalf("team ids %v, want both, sorted", person.TeamIDs)
	}

	body := api.bodies[0]
	query, _ := body["query"].(map[string]interface{})
	user, _ := query["user"].(map[string]interface{})
	if user["email"] != "alice@example.com" || len(query) != 1 {
		t.Fatalf("the lookup sent query %v, want the address alone, trimmed and in lower case", query)
	}
	selectParam, _ := body["select"].(map[string]interface{})
	userSelect, _ := selectParam["user"].(map[string]interface{})
	for _, column := range []string{"_id", "email", "name"} {
		if userSelect[column] != true {
			t.Fatalf("the lookup does not select user.%s: %v", column, selectParam)
		}
	}

	// Remembered: a second resource naming Alice asks nothing.
	again, err := client.findPersonByEmail(context.Background(), "alice@example.com")
	if err != nil || again != person {
		t.Fatalf("the second lookup did not use what the first found: %v %v", again, err)
	}
	byID, err := client.findPersonByID(context.Background(), "U1")
	if err != nil || byID != person {
		t.Fatalf("a lookup by ID did not use what the lookup by address found: %v %v", byID, err)
	}
	if api.requestCount() != 1 {
		t.Fatalf("%d requests, want 1", api.requestCount())
	}
}

// Only the exact address counts: a server that matched more widely (a
// search) must not hand back someone else.
func TestPeopleLookupByEmailIsExact(t *testing.T) {
	api, client := newDirectoryAPI(t, func(body map[string]interface{}) (int, interface{}) {
		return page(membership("u2", "team-a", true, "jim.bob@example.com", nil))
	})

	person, err := client.findPersonByEmail(context.Background(), "bob@example.com")
	if err != nil {
		t.Fatalf("findPersonByEmail: %s", err)
	}
	if person != nil {
		t.Fatalf("bob@example.com found %+v", person)
	}

	// Nobody found is never remembered: an invitation may add them.
	_, _ = client.findPersonByEmail(context.Background(), "bob@example.com")
	if api.requestCount() != 2 {
		t.Fatalf("%d requests, want a miss asked again", api.requestCount())
	}
}

func TestPeopleLookupReadsEveryPage(t *testing.T) {
	_, client := newDirectoryAPI(t, func(body map[string]interface{}) (int, interface{}) {
		skip := int(body["skip"].(float64))
		limit := int(body["limit"].(float64))
		if limit != peopleLookupPageSize {
			t.Errorf("limit %d, want %d", limit, peopleLookupPageSize)
		}
		rows := []interface{}{}
		if skip == 0 {
			for i := 0; i < peopleLookupPageSize; i++ {
				rows = append(rows, membership("u3", "team-"+string(rune('a'+i%26))+strings.Repeat("x", i/26), false, "carol@example.com", nil))
			}
		} else if skip == peopleLookupPageSize {
			rows = append(rows, membership("u3", "team-last", true, "carol@example.com", nil))
		}
		return page(rows...)
	})

	person, err := client.findPersonByEmail(context.Background(), "carol@example.com")
	if err != nil {
		t.Fatalf("findPersonByEmail: %s", err)
	}
	if person == nil || len(person.TeamIDs) != peopleLookupPageSize+1 || !person.HasAcceptedInvitation {
		t.Fatalf("found %+v, want every membership of both pages", person)
	}
}

func TestPeopleLookupByName(t *testing.T) {
	_, client := newDirectoryAPI(t, func(body map[string]interface{}) (int, interface{}) {
		return page(
			membership("u4", "team-a", true, "dan@example.com", map[string]interface{}{"_type": "Name", "value": "Dan"}),
			membership("u5", "team-a", true, "dan.other@example.com", map[string]interface{}{"_type": "Name", "value": "Dan"}),
			membership("u6", "team-a", true, "daniel@example.com", map[string]interface{}{"_type": "Name", "value": "Daniel"}),
		)
	})

	people, err := client.findPeopleByName(context.Background(), "Dan")
	if err != nil {
		t.Fatalf("findPeopleByName: %s", err)
	}
	if len(people) != 2 {
		t.Fatalf("found %d people called Dan, want 2 (not Daniel)", len(people))
	}
}

func TestPeopleLookupErrorsSayWhatToDo(t *testing.T) {
	_, client := newDirectoryAPI(t, func(body map[string]interface{}) (int, interface{}) {
		return http.StatusForbidden, map[string]interface{}{"message": "You do not have permissions to read Team Member."}
	})

	_, err := client.findPersonByEmail(context.Background(), "alice@example.com")
	if err == nil {
		t.Fatalf("a refused lookup is no error")
	}
	detail := personLookupFailedDetail("alice@example.com", err)
	for _, part := range []string{"You do not have permissions to read Team Member.", "Read Teams", "user ID"} {
		if !strings.Contains(detail, part) {
			t.Fatalf("the error detail does not say %q: %s", part, detail)
		}
	}

	// Filling in an address on refresh stops asking once the key is refused.
	if address := client.emailOfPerson(context.Background(), "u1"); address != "" {
		t.Fatalf("a refused lookup found %q", address)
	}
	if !client.people.idLookupRefused {
		t.Fatalf("a refusal was not remembered")
	}
}

func TestPeopleRefusalStopsFillingAddresses(t *testing.T) {
	api, client := newDirectoryAPI(t, func(body map[string]interface{}) (int, interface{}) {
		return http.StatusForbidden, map[string]interface{}{"message": "You do not have permissions to read Team Member."}
	})

	for i := 0; i < 3; i++ {
		_ = client.emailOfPerson(context.Background(), "u1")
	}
	if api.requestCount() != 1 {
		t.Fatalf("%d requests, want the refusal asked once", api.requestCount())
	}
}

// The user data source reads who someone is now - their teams may have
// changed earlier in the same run - and what it finds serves the
// resources' lookups after it.
func TestPeopleReadBypassesWhatIsRemembered(t *testing.T) {
	teams := []string{"team-a"}
	api, client := newDirectoryAPI(t, func(body map[string]interface{}) (int, interface{}) {
		rows := []interface{}{}
		for _, team := range teams {
			rows = append(rows, membership("u8", team, true, "frank@example.com", nil))
		}
		return page(rows...)
	})
	ctx := context.Background()

	if _, err := client.findPersonByEmail(ctx, "frank@example.com"); err != nil {
		t.Fatalf("findPersonByEmail: %s", err)
	}
	teams = append(teams, "team-b")

	person, err := client.readPersonByEmail(ctx, "frank@example.com")
	if err != nil || person == nil || len(person.TeamIDs) != 2 {
		t.Fatalf("readPersonByEmail found %+v, %v: want both teams", person, err)
	}
	byID, err := client.readPersonByID(ctx, "u8")
	if err != nil || byID == nil || len(byID.TeamIDs) != 2 {
		t.Fatalf("readPersonByID found %+v, %v: want both teams", byID, err)
	}
	if api.requestCount() != 3 {
		t.Fatalf("%d requests, want each read to ask", api.requestCount())
	}

	// The resources' lookups use what the reads found.
	again, err := client.findPersonByEmail(ctx, "frank@example.com")
	if err != nil || len(again.TeamIDs) != 2 || api.requestCount() != 3 {
		t.Fatalf("a lookup after a read asked again or found the old teams: %+v", again)
	}
}

func TestPeopleEmailAddressValidator(t *testing.T) {
	for value, valid := range map[string]bool{
		"alice@example.com":              true,
		"Alice.Smith+oncall@Example.Com": true,
		" alice@example.com ":            true,
		"alice":                          false,
		"alice@":                         false,
		"@example.com":                   false,
		"alice@example":                  false,
		"alice@@example.com":             false,
		"alice@exa mple.com":             false,
		"alice at example.com":           false,
		"alice@example.":                 false,
		"":                               false,
	} {
		response := &validator.StringResponse{}
		emailAddressValidator{}.ValidateString(context.Background(), validator.StringRequest{ConfigValue: types.StringValue(value)}, response)
		if got := !response.Diagnostics.HasError(); got != valid {
			t.Errorf("%q: valid = %t, want %t", value, got, valid)
		}
	}

	// Unknown and null values are not refused before they are known.
	for _, value := range []types.String{types.StringUnknown(), types.StringNull()} {
		response := &validator.StringResponse{}
		emailAddressValidator{}.ValidateString(context.Background(), validator.StringRequest{ConfigValue: value}, response)
		if response.Diagnostics.HasError() {
			t.Errorf("%s was refused", value)
		}
	}
}

func TestPeopleSetComparisons(t *testing.T) {
	if !sameEmailSets([]string{"A@x.com", "b@x.com"}, []string{"B@X.COM", "a@x.com"}) {
		t.Errorf("the same addresses in another case and order are different")
	}
	if sameEmailSets([]string{"a@x.com", "a@x.com"}, []string{"a@x.com", "b@x.com"}) {
		t.Errorf("different addresses are the same")
	}

	set := func(values ...string) types.Set {
		elements := []attr.Value{}
		for _, value := range values {
			elements = append(elements, types.StringValue(value))
		}
		return types.SetValueMust(types.StringType, elements)
	}
	if !sameIDSets(context.Background(), set("U1", "u2"), set("u2", "u1")) {
		t.Errorf("the same IDs in another case and order are different")
	}
	if sameIDSets(context.Background(), set("u1"), types.SetUnknown(types.StringType)) {
		t.Errorf("an unknown set is the same as a known one")
	}
}

func TestPeopleAddressAfterRead(t *testing.T) {
	_, client := newDirectoryAPI(t, func(body map[string]interface{}) (int, interface{}) {
		query, _ := body["query"].(map[string]interface{})
		if query["userId"] == "u9" {
			return page(membership("u9", "team-a", true, "frank.new@example.com", nil))
		}
		return page()
	})
	ctx := context.Background()

	// The same person: the address in state stays, whatever OneUptime has now.
	kept := personEmailAfterRead(ctx, client, types.StringValue("u9"), types.StringValue("u9"), types.StringValue("Frank@Example.com"))
	if kept.ValueString() != "Frank@Example.com" {
		t.Errorf("the same person's address became %s", kept)
	}

	// Someone else now (changed outside Terraform): their address.
	other := personEmailAfterRead(ctx, client, types.StringValue("u8"), types.StringValue("u9"), types.StringValue("old@example.com"))
	if other.ValueString() != "frank.new@example.com" {
		t.Errorf("another person's address is %s", other)
	}

	// An import by address: as it was written, when it is theirs.
	imported := personEmailAfterRead(ctx, client, types.StringNull(), types.StringValue("u9"), types.StringValue("Frank.New@Example.com"))
	if imported.ValueString() != "Frank.New@Example.com" {
		t.Errorf("an import's address became %s", imported)
	}

	// Nobody named: no address.
	if none := personEmailAfterRead(ctx, client, types.StringNull(), types.StringNull(), types.StringNull()); !none.IsNull() {
		t.Errorf("nobody has the address %s", none)
	}
}

func TestPeopleIDForWrite(t *testing.T) {
	_, client := newDirectoryAPI(t, func(body map[string]interface{}) (int, interface{}) {
		query, _ := body["query"].(map[string]interface{})
		user, _ := query["user"].(map[string]interface{})
		if user["email"] == "gina@example.com" {
			return page(membership("u10", "team-a", false, "gina@example.com", nil))
		}
		return page()
	})
	ctx := context.Background()

	id := types.StringUnknown()
	var diags diag.Diagnostics
	if !personIDForWrite(ctx, client, &id, types.StringValue("Gina@Example.com"), "user_email", &diags) || id.ValueString() != "u10" {
		t.Fatalf("Gina was not found at apply: %s %v", id, diags)
	}

	known := types.StringValue("u-known")
	if !personIDForWrite(ctx, client, &known, types.StringValue("gina@example.com"), "user_email", &diags) || known.ValueString() != "u-known" {
		t.Fatalf("a planned ID was looked up again")
	}

	missing := types.StringUnknown()
	diags = diag.Diagnostics{}
	if personIDForWrite(ctx, client, &missing, types.StringValue("nobody@example.com"), "user_email", &diags) {
		t.Fatalf("someone outside the project was written")
	}
	if !diags.HasError() || !strings.Contains(diags.Errors()[0].Summary(), "nobody@example.com is not in this project") {
		t.Fatalf("the error is %v", diags)
	}
}

func TestPeopleAlreadyInvitedHint(t *testing.T) {
	hint := alreadyInvitedHint(errorString("the OneUptime API returned status 400: This user has already been invited to this team"), "oneuptime_team_member", "team_id")
	if !strings.Contains(hint, "terraform import oneuptime_team_member.<name> <team_id>/<email address>") {
		t.Fatalf("hint: %q", hint)
	}
	// The server's message ends with no full stop: the hint is a paragraph
	// of its own, and the command a line of its own, never run on into it.
	if !strings.HasPrefix(hint, "\n\nThey are in this team already. ") || !strings.Contains(hint, "\n\n  terraform import ") {
		t.Fatalf("the hint runs on into the server's message: %q", hint)
	}
	if alreadyInvitedHint(errorString("something else"), "oneuptime_team_member", "team_id") != "" {
		t.Fatalf("another error got the hint")
	}
	if alreadyInvitedHint(nil, "oneuptime_team_member", "team_id") != "" {
		t.Fatalf("no error got the hint")
	}
}

type errorString string

func (e errorString) Error() string { return string(e) }

// A row whose member is no person - an owner team, an escalation rule's
// team or schedule - is imported by both IDs, and an address in its place
// says how to write it instead.
func TestMembershipImportOfARowWithoutAPerson(t *testing.T) {
	ownerTeam := membershipImport{
		listPath:        "/monitor-owner-team/get-list",
		parentField:     "monitorId",
		parentAttribute: "monitor_id",
		parentNoun:      "monitor",
		personField:     "teamId",
		personAttribute: "team_id",
		byEmail:         false,
		kind:            membershipKindOwner,
	}

	if got := ownerTeam.importForm(); got != "<monitor_id>/<team_id>" {
		t.Fatalf("importForm = %q", got)
	}
	if got := ownerTeam.notFound("a-team", "a-monitor"); got != `a-team is not an owner of the monitor "a-monitor".` {
		t.Fatalf("notFound = %q", got)
	}

	var diags diag.Diagnostics
	if _, _, ok := importIDOfMembership(context.Background(), &Client{}, "a-monitor/sre@example.com", ownerTeam, &diags); ok {
		t.Fatalf("an email address in place of a team imported")
	}
	if !diags.HasError() || !strings.Contains(diags[0].Detail(), "import it as <monitor_id>/<team_id>") {
		t.Fatalf("an email address in place of a team says %v", diags)
	}

	onCall := ownerTeam
	onCall.kind = membershipKindOnCall
	onCall.parentNoun = "escalation rule"
	if got := onCall.notFound("a-team", "a-rule"); got != `a-team is not on the escalation rule "a-rule".` {
		t.Fatalf("notFound = %q", got)
	}

	member := ownerTeam
	member.kind = membershipKindMember
	member.parentNoun = ""
	member.parentAttribute = "team_id"
	member.byEmail = true
	if got := member.importForm(); got != "<team_id>/<email address or user id>" {
		t.Fatalf("importForm = %q", got)
	}
	// With no noun, the parent's attribute says what it is.
	if got := member.notFound("alice@example.com", "a-team"); got != `alice@example.com is not a member of the team "a-team", nor invited to it.` {
		t.Fatalf("notFound = %q", got)
	}

	// An ID with no "/" is the row's own.
	id, email, ok := importIDOfMembership(context.Background(), nil, "5a0e0000-0000-4000-8000-000000000001", ownerTeam, &diags)
	if !ok || id != "5a0e0000-0000-4000-8000-000000000001" || email != "" {
		t.Fatalf("an ID of its own imported as %q, %q, %t", id, email, ok)
	}
}
