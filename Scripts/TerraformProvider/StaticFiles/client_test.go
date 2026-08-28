package provider

/*
 * client.go's select-rejection retry, exercised end to end against a real HTTP
 * server.
 *
 * WHAT THIS FILE PINS
 *
 * The retry exists so that one column the server will not hand over - gated by
 * the API key's permissions, or simply absent from a deployment older than the
 * provider - costs that one attribute instead of failing the whole read. The
 * server has more than one way of saying no, and the retry originally
 * recognised only the permission phrasing:
 *
 *   permission     You do not have permissions to select on - serviceLanguage.
 *   unknown column Invalid select clause. Cannot select on "enableSearchEngineIndexing". ...
 *   analytics      Unknown column: spanId
 *
 * The near-miss fix matters as much as the miss. The API JSON-encodes its error
 * messages, so the quotes around the column name reach the client
 * backslash-escaped; a pattern matched against the raw response body never
 * fires, and nothing here would have noticed because the quote-free permission
 * phrasing kept working. Every test below encodes its error body the way the
 * server really encodes it, and TestDroppableSelectColumn_MatchesRawEscapedBody
 * asserts the escaping is genuinely present rather than trusting it.
 *
 * The message templates below are copies, and copies drift. What stops them is
 * Common/Tests/Server/Types/Database/Permissions/SelectRejectionMessageContract.test.ts,
 * which drives the real permission gates and runs the real patterns over
 * whatever they throw. Reword a message in
 *   Common/Server/Types/Database/Permissions/SelectPermission.ts
 *   Common/Server/Types/AnalyticsDatabase/ModelPermission.ts
 *   Common/Server/Utils/AnalyticsDatabase/StatementGenerator.ts
 * and that file fails; this one tests the retry given the message.
 */

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

/*
 * The two envelopes an error can arrive in. BaseAPI's CRUD routes fall through
 * to the express error handler, which answers {"error": ...}
 * (Common/Server/Utils/StartServer.ts); Response.sendErrorResponse answers
 * {"message": ...}. Both must work - the provider does not get to choose.
 */
const (
	envelopeError   = "error"
	envelopeMessage = "message"
)

func permissionDeniedMessage(column string) string {
	return fmt.Sprintf("You do not have permissions to select on - %s.\n"+
		"                    You need any one of these permissions: Project Owner, Project Admin", column)
}

func unknownColumnMessage(column string) string {
	return fmt.Sprintf("Invalid select clause. Cannot select on %q. "+
		"This column does not exist on Monitor. "+
		"Here are the columns you can select on instead: _id, createdAt, updatedAt, name", column)
}

func analyticsUnknownColumnMessage(column string) string {
	return fmt.Sprintf("Unknown column: %s", column)
}

// rejection is one canned refusal, returned for as long as its column is still
// present in the request's select.
type rejection struct {
	column     string
	statusCode int
	envelope   string
	message    string
	// rawBody, when set, is written instead of a JSON envelope. Used to cover
	// the path where apiErrorMessage cannot decode the body and falls back to
	// the bytes verbatim.
	rawBody string
}

type fakeAPI struct {
	t          *testing.T
	rejections []rejection
	// rejectAnything refuses whichever column it finds first, forever. Used to
	// prove the retry is bounded rather than looping until the context dies.
	rejectAnything bool
	// bodies records every request body received, in order.
	bodies []map[string]interface{}
	paths  []string
	server *httptest.Server
}

func newFakeAPI(t *testing.T, rejections ...rejection) (*fakeAPI, *Client) {
	t.Helper()

	api := &fakeAPI{t: t, rejections: rejections}
	api.server = httptest.NewServer(http.HandlerFunc(api.handle))
	t.Cleanup(api.server.Close)

	client, err := NewClient(api.server.URL, "api-key", "test")
	if err != nil {
		t.Fatalf("NewClient: %s", err)
	}
	return api, client
}

func (f *fakeAPI) handle(w http.ResponseWriter, r *http.Request) {
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		f.t.Errorf("reading request body: %s", err)
		return
	}

	var decoded map[string]interface{}
	if err := json.Unmarshal(raw, &decoded); err != nil {
		f.t.Errorf("request body was not JSON (%s): %s", err, raw)
		return
	}
	f.bodies = append(f.bodies, decoded)
	f.paths = append(f.paths, r.URL.Path)

	selected, _ := decoded["select"].(map[string]interface{})

	for _, reject := range f.rejections {
		if _, present := selected[reject.column]; !present {
			continue
		}
		f.writeError(w, reject)
		return
	}

	if f.rejectAnything && len(selected) > 0 {
		for column := range selected {
			f.writeError(w, rejection{
				column:     column,
				statusCode: http.StatusBadRequest,
				envelope:   envelopeError,
				message:    unknownColumnMessage(column),
			})
			return
		}
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = io.WriteString(w, `{"data":{"_id":"abc123","name":"api-server"}}`)
}

func (f *fakeAPI) writeError(w http.ResponseWriter, reject rejection) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(reject.statusCode)

	if reject.rawBody != "" {
		_, _ = io.WriteString(w, reject.rawBody)
		return
	}
	if err := json.NewEncoder(w).Encode(map[string]string{reject.envelope: reject.message}); err != nil {
		f.t.Errorf("encoding error body: %s", err)
	}
}

func (f *fakeAPI) requestCount() int {
	return len(f.bodies)
}

// selectAt returns the select map from the nth (0-based) recorded request.
func (f *fakeAPI) selectAt(n int) map[string]interface{} {
	f.t.Helper()
	if n >= len(f.bodies) {
		f.t.Fatalf("wanted request %d, server only saw %d", n, len(f.bodies))
	}
	selected, ok := f.bodies[n]["select"].(map[string]interface{})
	if !ok {
		f.t.Fatalf("request %d carried no select object: %v", n, f.bodies[n])
	}
	return selected
}

func monitorSelect() map[string]interface{} {
	return map[string]interface{}{
		"_id":          true,
		"name":         true,
		"description":  true,
		"internalNote": true,
	}
}

func assertSelected(t *testing.T, selected map[string]interface{}, want ...string) {
	t.Helper()
	if len(selected) != len(want) {
		t.Fatalf("select had %d columns %v, wanted %d %v", len(selected), keysOf(selected), len(want), want)
	}
	for _, column := range want {
		if _, present := selected[column]; !present {
			t.Errorf("select was missing %q; it had %v", column, keysOf(selected))
		}
	}
}

func keysOf(m map[string]interface{}) []string {
	keys := make([]string, 0, len(m))
	for key := range m {
		keys = append(keys, key)
	}
	return keys
}

func parseData(t *testing.T, client *Client, resp *http.Response) map[string]interface{} {
	t.Helper()
	var parsed map[string]interface{}
	if err := client.ParseResponse(resp, &parsed); err != nil {
		t.Fatalf("ParseResponse: %s", err)
	}
	data, ok := parsed["data"].(map[string]interface{})
	if !ok {
		t.Fatalf("response had no data object: %v", parsed)
	}
	return data
}

/*
 * The permission phrasing. This one always worked; it is here so that a change
 * made for the unknown-column phrasing cannot quietly break it.
 */
func TestPostWithSelect_DropsPermissionDeniedColumn(t *testing.T) {
	api, client := newFakeAPI(t, rejection{
		column:     "internalNote",
		statusCode: http.StatusUnprocessableEntity,
		envelope:   envelopeMessage,
		message:    permissionDeniedMessage("internalNote"),
	})

	resp, err := client.PostWithSelect(context.Background(), "/monitor/abc/get-item", monitorSelect())
	if err != nil {
		t.Fatalf("PostWithSelect: %s", err)
	}

	if api.requestCount() != 2 {
		t.Fatalf("expected one retry (2 requests), got %d", api.requestCount())
	}
	assertSelected(t, api.selectAt(1), "_id", "name", "description")
	if data := parseData(t, client, resp); data["_id"] != "abc123" {
		t.Errorf("retry did not return the item: %v", data)
	}
}

/*
 * Issue #3414. A provider generated from a newer schema than the server it is
 * pointed at selects a column that deployment has never heard of; before the
 * fix the whole read failed instead of losing the one attribute.
 */
func TestPostWithSelect_DropsUnknownColumn(t *testing.T) {
	selectParam := monitorSelect()
	selectParam["enableSearchEngineIndexing"] = true

	api, client := newFakeAPI(t, rejection{
		column:     "enableSearchEngineIndexing",
		statusCode: http.StatusBadRequest,
		envelope:   envelopeError,
		message:    unknownColumnMessage("enableSearchEngineIndexing"),
	})

	resp, err := client.PostWithSelect(context.Background(), "/status-page/abc/get-item", selectParam)
	if err != nil {
		t.Fatalf("PostWithSelect: %s", err)
	}

	if api.requestCount() != 2 {
		t.Fatalf("expected one retry (2 requests), got %d", api.requestCount())
	}
	assertSelected(t, api.selectAt(1), "_id", "name", "description", "internalNote")
	if data := parseData(t, client, resp); data["_id"] != "abc123" {
		t.Errorf("retry did not return the item: %v", data)
	}
}

// The same phrasing in the other envelope, and the permission phrasing in both.
func TestPostWithSelect_HandlesBothErrorEnvelopes(t *testing.T) {
	cases := []struct {
		name     string
		envelope string
		status   int
		message  func(string) string
	}{
		{"unknown column via error", envelopeError, http.StatusBadRequest, unknownColumnMessage},
		{"unknown column via message", envelopeMessage, http.StatusBadRequest, unknownColumnMessage},
		{"permission via error", envelopeError, http.StatusUnprocessableEntity, permissionDeniedMessage},
		{"permission via message", envelopeMessage, http.StatusUnprocessableEntity, permissionDeniedMessage},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			api, client := newFakeAPI(t, rejection{
				column:     "internalNote",
				statusCode: testCase.status,
				envelope:   testCase.envelope,
				message:    testCase.message("internalNote"),
			})

			if _, err := client.PostWithSelect(context.Background(), "/monitor/abc/get-item", monitorSelect()); err != nil {
				t.Fatalf("PostWithSelect: %s", err)
			}
			if api.requestCount() != 2 {
				t.Fatalf("expected one retry (2 requests), got %d", api.requestCount())
			}
			assertSelected(t, api.selectAt(1), "_id", "name", "description")
		})
	}
}

// ClickHouse-backed models refuse an unknown column with a terser sentence.
func TestPostWithSelect_DropsAnalyticsUnknownColumn(t *testing.T) {
	selectParam := map[string]interface{}{"_id": true, "body": true, "spanId": true}

	api, client := newFakeAPI(t, rejection{
		column:     "spanId",
		statusCode: http.StatusBadRequest,
		envelope:   envelopeError,
		message:    analyticsUnknownColumnMessage("spanId"),
	})

	if _, err := client.PostWithSelect(context.Background(), "/log/get-list", selectParam); err != nil {
		t.Fatalf("PostWithSelect: %s", err)
	}
	if api.requestCount() != 2 {
		t.Fatalf("expected one retry (2 requests), got %d", api.requestCount())
	}
	assertSelected(t, api.selectAt(1), "_id", "body")
}

/*
 * A proxy or a crash can answer with something that is not the API's JSON
 * envelope at all. apiErrorMessage hands those back verbatim, so the patterns
 * have to cope with a bare, unescaped quote as well as an escaped one.
 */
func TestPostWithSelect_DropsUnknownColumnFromNonJSONBody(t *testing.T) {
	api, client := newFakeAPI(t, rejection{
		column:     "internalNote",
		statusCode: http.StatusBadRequest,
		rawBody:    unknownColumnMessage("internalNote"),
	})

	if _, err := client.PostWithSelect(context.Background(), "/monitor/abc/get-item", monitorSelect()); err != nil {
		t.Fatalf("PostWithSelect: %s", err)
	}
	if api.requestCount() != 2 {
		t.Fatalf("expected one retry (2 requests), got %d", api.requestCount())
	}
	assertSelected(t, api.selectAt(1), "_id", "name", "description")
}

// Several skewed columns in one select: each costs one round trip, none is lost.
func TestPostWithSelect_DropsSeveralColumnsInSequence(t *testing.T) {
	api, client := newFakeAPI(t,
		rejection{column: "internalNote", statusCode: http.StatusUnprocessableEntity, envelope: envelopeMessage, message: permissionDeniedMessage("internalNote")},
		rejection{column: "description", statusCode: http.StatusBadRequest, envelope: envelopeError, message: unknownColumnMessage("description")},
		rejection{column: "name", statusCode: http.StatusBadRequest, envelope: envelopeError, message: analyticsUnknownColumnMessage("name")},
	)

	if _, err := client.PostWithSelect(context.Background(), "/monitor/abc/get-item", monitorSelect()); err != nil {
		t.Fatalf("PostWithSelect: %s", err)
	}
	if api.requestCount() != 4 {
		t.Fatalf("expected three retries (4 requests), got %d", api.requestCount())
	}
	assertSelected(t, api.selectAt(3), "_id")
}

/*
 * A 400 that is not about a select column is the caller's to see. The body must
 * still be readable: the retry consumed it to run the patterns and has to put
 * it back before handing the response on.
 */
func TestPostWithSelect_SurfacesUnrelatedBadRequestWithBodyIntact(t *testing.T) {
	api, client := newFakeAPI(t, rejection{
		column:     "_id",
		statusCode: http.StatusBadRequest,
		envelope:   envelopeError,
		message:    "Invalid query. Cannot query on \"nope\". This column does not exist on Monitor.",
	})

	resp, err := client.PostWithSelect(context.Background(), "/monitor/abc/get-item", monitorSelect())
	if err != nil {
		t.Fatalf("PostWithSelect: %s", err)
	}
	if api.requestCount() != 1 {
		t.Fatalf("a non-select rejection must not be retried, got %d requests", api.requestCount())
	}
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected the original 400, got %d", resp.StatusCode)
	}

	err = client.ParseResponse(resp, nil)
	if err == nil {
		t.Fatal("expected ParseResponse to surface the error")
	}
	if !strings.Contains(err.Error(), "Invalid query") {
		t.Errorf("the error body was lost on the way out: %s", err)
	}
}

/*
 * If the server names a column the request never asked for, dropping it would
 * change nothing and asking again would loop. Stop and let the caller see it.
 */
func TestPostWithSelect_StopsWhenTheNamedColumnIsNotInTheSelect(t *testing.T) {
	api, client := newFakeAPI(t, rejection{
		column:     "_id",
		statusCode: http.StatusBadRequest,
		envelope:   envelopeError,
		message:    unknownColumnMessage("somethingElseEntirely"),
	})

	resp, err := client.PostWithSelect(context.Background(), "/monitor/abc/get-item", monitorSelect())
	if err != nil {
		t.Fatalf("PostWithSelect: %s", err)
	}
	if api.requestCount() != 1 {
		t.Fatalf("expected no retry, got %d requests", api.requestCount())
	}
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected the original 400, got %d", resp.StatusCode)
	}
}

// A server that refuses everything must not keep the provider there forever.
func TestPostWithSelect_IsBounded(t *testing.T) {
	api, client := newFakeAPI(t)
	api.rejectAnything = true

	selectParam := map[string]interface{}{}
	for index := 0; index < 12; index++ {
		selectParam[fmt.Sprintf("column%d", index)] = true
	}

	resp, err := client.PostWithSelect(context.Background(), "/monitor/abc/get-item", selectParam)
	if err != nil {
		t.Fatalf("PostWithSelect: %s", err)
	}

	// Eight attempts inside the loop, then one last unretried request.
	if api.requestCount() != 9 {
		t.Fatalf("expected the retry to stop after 9 requests, got %d", api.requestCount())
	}

	/*
	 * The ninth request is the one code path outside the loop, and it is the
	 * one a refactor is most likely to rebuild from scratch and get wrong. It
	 * must still carry what is left of the caller's select, and the caller must
	 * get the server's own refusal back with a readable body.
	 */
	if remaining := api.selectAt(8); len(remaining) != 4 {
		t.Errorf("the last request should still carry the 4 undropped columns, had %v", keysOf(remaining))
	}
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected the server's own 400 back, got %d", resp.StatusCode)
	}
	if err := client.ParseResponse(resp, nil); err == nil {
		t.Error("expected the unresolved rejection to reach the caller as an error")
	}
}

/*
 * The retry can only work on a select it understands. Anything else has to pass
 * straight through rather than be silently swallowed.
 */
func TestPostWithSelect_PassesThroughWhenSelectIsNotAMap(t *testing.T) {
	api, client := newFakeAPI(t)
	api.rejectAnything = true

	resp, err := client.PostWithSelect(context.Background(), "/monitor/abc/get-item", []string{"name"})
	if err != nil {
		t.Fatalf("PostWithSelect: %s", err)
	}
	if api.requestCount() != 1 {
		t.Fatalf("expected exactly one request, got %d", api.requestCount())
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected the server's own answer, got %d", resp.StatusCode)
	}

	/*
	 * Passing through means the select still reaches the server. Tightening the
	 * signature so only map-shaped selects are forwarded would drop this one on
	 * the floor and return an unfiltered row set with a cheerful 200.
	 */
	sent, ok := api.bodies[0]["select"].([]interface{})
	if !ok || len(sent) != 1 || sent[0] != "name" {
		t.Errorf("the select never reached the server intact: %v", api.bodies[0])
	}
}

// Nothing to retry: the body must reach the caller unread.
func TestPostWithSelect_LeavesASuccessfulResponseAlone(t *testing.T) {
	api, client := newFakeAPI(t)

	resp, err := client.PostWithSelect(context.Background(), "/monitor/abc/get-item", monitorSelect())
	if err != nil {
		t.Fatalf("PostWithSelect: %s", err)
	}
	if api.requestCount() != 1 {
		t.Fatalf("expected exactly one request, got %d", api.requestCount())
	}
	if data := parseData(t, client, resp); data["name"] != "api-server" {
		t.Errorf("the success body did not survive: %v", data)
	}
}

/*
 * The by-name data source lookup sends query and limit alongside the select.
 * Retrying must not lose them - a retry that dropped the query would silently
 * match the wrong row, which is worse than the failure it is fixing.
 */
func TestPostBodyWithSelect_PreservesTheRestOfTheBody(t *testing.T) {
	api, client := newFakeAPI(t, rejection{
		column:     "internalNote",
		statusCode: http.StatusBadRequest,
		envelope:   envelopeError,
		message:    unknownColumnMessage("internalNote"),
	})

	listBody := map[string]interface{}{
		"query":  map[string]interface{}{"name": "api-server"},
		"select": monitorSelect(),
		"limit":  2,
	}

	if _, err := client.PostBodyWithSelect(context.Background(), "/monitor/get-list", listBody); err != nil {
		t.Fatalf("PostBodyWithSelect: %s", err)
	}
	if api.requestCount() != 2 {
		t.Fatalf("expected one retry (2 requests), got %d", api.requestCount())
	}
	assertSelected(t, api.selectAt(1), "_id", "name", "description")

	for index := 0; index < 2; index++ {
		body := api.bodies[index]
		query, ok := body["query"].(map[string]interface{})
		if !ok || query["name"] != "api-server" {
			t.Errorf("request %d lost its query: %v", index, body)
		}
		if limit, ok := body["limit"].(float64); !ok || limit != 2 {
			t.Errorf("request %d lost its limit: %v", index, body)
		}
	}
}

// A body with no select at all has nothing to drop; do not retry it.
func TestPostBodyWithSelect_PassesThroughABodyWithoutASelect(t *testing.T) {
	api, client := newFakeAPI(t)
	api.rejectAnything = true

	resp, err := client.PostBodyWithSelect(context.Background(), "/monitor/get-list", map[string]interface{}{
		"query": map[string]interface{}{"name": "api-server"},
	})
	if err != nil {
		t.Fatalf("PostBodyWithSelect: %s", err)
	}
	if api.requestCount() != 1 {
		t.Fatalf("expected exactly one request, got %d", api.requestCount())
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected the server's own answer, got %d", resp.StatusCode)
	}
}

/*
 * PostWithSelect deletes from the caller's map. Every generated caller builds a
 * fresh select literal per request, so that is safe today - this pins it as a
 * contract, so sharing or caching a select map becomes a deliberate decision
 * rather than an accident that starts dropping columns for good.
 */
func TestPostWithSelect_MutatesTheCallersSelectMap(t *testing.T) {
	_, client := newFakeAPI(t, rejection{
		column:     "internalNote",
		statusCode: http.StatusUnprocessableEntity,
		envelope:   envelopeMessage,
		message:    permissionDeniedMessage("internalNote"),
	})

	selectParam := monitorSelect()
	if _, err := client.PostWithSelect(context.Background(), "/monitor/abc/get-item", selectParam); err != nil {
		t.Fatalf("PostWithSelect: %s", err)
	}
	if _, present := selectParam["internalNote"]; present {
		t.Error("expected the dropped column to be removed from the caller's map")
	}
}

/*
 * The escape tolerance, pinned where it actually applies. droppableSelectColumn
 * decodes first, so on that path the tolerance never comes into play; it earns
 * its keep only when apiErrorMessage cannot decode a body and hands back bytes
 * whose quotes are still escaped - a proxy that re-wraps the error, or an
 * envelope key we do not know about. Reaching that branch deliberately means
 * running the patterns directly, which is what this does. Anchor a pattern on a
 * bare quote and the first half fails; drop the quote entirely and the second
 * half fails.
 */
func TestSelectPatterns_MatchEscapedAndBareQuotesAlike(t *testing.T) {
	message := unknownColumnMessage("enableSearchEngineIndexing")
	encoded, err := json.Marshal(map[string]string{envelopeError: message})
	if err != nil {
		t.Fatalf("marshalling the error body: %s", err)
	}

	if !strings.Contains(string(encoded), `\"enableSearchEngineIndexing\"`) {
		t.Fatalf("this test is no longer testing the escaping it was written for: %s", encoded)
	}

	matched := func(text string) string {
		for _, pattern := range droppableSelectColumnPatterns {
			if match := pattern.FindStringSubmatch(text); match != nil {
				return match[1]
			}
		}
		return ""
	}

	if column := matched(string(encoded)); column != "enableSearchEngineIndexing" {
		t.Errorf("escaped body: got %q, wanted enableSearchEngineIndexing", column)
	}
	if column := matched(message); column != "enableSearchEngineIndexing" {
		t.Errorf("decoded message: got %q, wanted enableSearchEngineIndexing", column)
	}
}

/*
 * And the decode itself, pinned. Everywhere else the escape tolerance means a
 * pattern would have found the column with or without apiErrorMessage, so
 * putting the patterns back in front of raw bytes - the original defect - would
 * go unnoticed. This body is valid JSON that spells the column with a \u escape,
 * so the raw bytes do not contain the name at all and only the decode recovers
 * it.
 */
func TestDroppableSelectColumn_DecodesBeforeMatching(t *testing.T) {
	body := `{"error":"Invalid select clause. Cannot select on \"\u0065nableSearchEngineIndexing\". This column does not exist on Status Page."}`

	if strings.Contains(body, "enableSearchEngineIndexing") {
		t.Fatal("this test only means anything while the raw body hides the column name")
	}
	if column := droppableSelectColumn([]byte(body)); column != "enableSearchEngineIndexing" {
		t.Errorf("got %q; the body has to be decoded before the patterns run", column)
	}
}

func TestDroppableSelectColumn(t *testing.T) {
	cases := []struct {
		name string
		body string
		want string
	}{
		{
			name: "permission, message envelope",
			body: jsonBody(t, envelopeMessage, permissionDeniedMessage("serviceLanguage")),
			want: "serviceLanguage",
		},
		{
			name: "permission, error envelope",
			body: jsonBody(t, envelopeError, permissionDeniedMessage("serviceLanguage")),
			want: "serviceLanguage",
		},
		{
			name: "unknown column, error envelope",
			body: jsonBody(t, envelopeError, unknownColumnMessage("enableSearchEngineIndexing")),
			want: "enableSearchEngineIndexing",
		},
		{
			name: "unknown column, undecodable body",
			body: unknownColumnMessage("enableSearchEngineIndexing"),
			want: "enableSearchEngineIndexing",
		},
		{
			name: "analytics unknown column",
			body: jsonBody(t, envelopeError, analyticsUnknownColumnMessage("spanId")),
			want: "spanId",
		},
		{
			/*
			 * The unknown-column message ends with "...you can select on
			 * instead: _id, createdAt". A pattern that reached into that tail
			 * would drop a column the server was recommending.
			 */
			name: "the remediation tail is not mistaken for the rejected column",
			body: jsonBody(t, envelopeError, unknownColumnMessage("enableSearchEngineIndexing")),
			want: "enableSearchEngineIndexing",
		},
		{
			// Query rejections are a different clause; dropping a query column
			// would change which rows come back.
			name: "query permission rejection is not a select rejection",
			body: jsonBody(t, envelopeMessage, "You do not have permissions to query on - name. You need any one of these permissions: Project Owner"),
			want: "",
		},
		{
			name: "an unrelated bad request names nothing",
			body: jsonBody(t, envelopeError, "Project ID not found in the request."),
			want: "",
		},
		{
			name: "an empty body names nothing",
			body: "",
			want: "",
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if got := droppableSelectColumn([]byte(testCase.body)); got != testCase.want {
				t.Errorf("got %q, wanted %q", got, testCase.want)
			}
		})
	}
}

func jsonBody(t *testing.T, envelope string, message string) string {
	t.Helper()
	encoded, err := json.Marshal(map[string]string{envelope: message})
	if err != nil {
		t.Fatalf("marshalling %s: %s", envelope, err)
	}
	return string(encoded)
}
