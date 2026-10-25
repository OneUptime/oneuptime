package main

import (
	"bytes"
	"context"
	"encoding/json"
	"go/ast"
	"go/parser"
	"go/token"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"oneuptime-infrastructure-agent/model"
	"path/filepath"
	"strings"
	"testing"
)

// The agent's requests carry the monitor's secret key, in their address and
// in their body, so they follow a redirect only on the server they were
// sent to (redirect.go). These tests send them over real HTTP to local
// servers: one that redirects to another server, one that redirects to
// itself, and the other server, which must never hear from the agent.

// The path a server that redirects to itself sends every request to.
const testMovedPath = "/moved"

// newRedirectingAgentServer starts a local server that records every request
// and answers it with a redirect of the given status to to(itself) +
// testMovedPath + the request's path - but a request already under
// testMovedPath, which it answers with 200.
func newRedirectingAgentServer(t *testing.T, status int, to func(self string) string) (*httptest.Server, *agentRequestRecorder) {
	t.Helper()

	recorder := &agentRequestRecorder{}

	var srv *httptest.Server
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		recorder.add(agentRecordedRequest{
			method:  r.Method,
			path:    r.URL.Path,
			body:    body,
			readErr: err,
		})

		if strings.HasPrefix(r.URL.Path, testMovedPath+"/") {
			w.WriteHeader(http.StatusOK)
			return
		}

		w.Header().Set("Location", to(srv.URL)+testMovedPath+r.URL.Path)
		w.WriteHeader(status)
	}))
	t.Cleanup(srv.Close)

	return srv, recorder
}

func TestIsRedirectOnSameServer(t *testing.T) {
	onSameServer := []struct{ name, from, to string }{
		{"the same address", "http://app:3002/a", "http://app:3002/b"},
		{"the same address, a query added", "https://x.com/a", "https://x.com/b?c=d"},
		{"the same name in other capitals", "https://oneuptime.com/a", "https://OneUptime.COM/a"},
		{"the scheme in capitals", "https://oneuptime.com/a", "HTTPS://oneuptime.com/b"},
		{"http moved to https", "http://oneuptime.example.com/a", "https://oneuptime.example.com/a"},
		{"http on 80 moved to https on 443, written out", "http://x.com:80/a", "https://x.com:443/a"},
		{"the default port written out", "https://x.com/a", "https://x.com:443/b"},
		{"an IPv6 address", "http://[::1]:3002/a", "http://[::1]:3002/b"},
		{"from an address that names a user, to the server without it", "https://agent:secret@oneuptime.example.com/a", "https://oneuptime.example.com/b"},
	}

	for _, tc := range onSameServer {
		t.Run(tc.name, func(t *testing.T) {
			if !isRedirectOnSameServer(mustParse(t, tc.from), mustParse(t, tc.to)) {
				t.Errorf("a redirect from %s to %s should stay on the server", tc.from, tc.to)
			}
		})
	}

	elsewhere := []struct{ name, from, to string }{
		{"another host", "https://oneuptime.com/a", "https://collector.example.net/a"},
		{"a host that only starts like it", "https://oneuptime.com/a", "https://oneuptime.com.example.net/a"},
		{"a subdomain", "https://oneuptime.com/a", "https://www.oneuptime.com/a"},
		{"another port", "http://app:3002/a", "http://app:3003/a"},
		{"https moved to http", "https://oneuptime.com/a", "http://oneuptime.com/a"},
		{"http moved to https on another port", "http://x.com:3002/a", "https://x.com/a"},
		{"http moved to https from another port", "http://x.com/a", "https://x.com:8443/a"},
		{"another scheme", "https://oneuptime.com/a", "ftp://oneuptime.com/a"},
		{"credentials added", "https://oneuptime.com/a", "https://user:pass@oneuptime.com/a"},
		{"another IPv6 address", "http://[::1]:3002/a", "http://[::2]:3002/a"},
		{"an address with no host", "https://oneuptime.com/a", "https:///a"},
	}

	for _, tc := range elsewhere {
		t.Run("not "+tc.name, func(t *testing.T) {
			if isRedirectOnSameServer(mustParse(t, tc.from), mustParse(t, tc.to)) {
				t.Errorf("a redirect from %s to %s should not stay on the server", tc.from, tc.to)
			}
		})
	}

	t.Run("not when either address is missing", func(t *testing.T) {
		if isRedirectOnSameServer(nil, mustParse(t, "https://x.com/a")) || isRedirectOnSameServer(mustParse(t, "https://x.com/a"), nil) {
			t.Error("a missing address must never count as the same server")
		}
	})
}

func TestSameServerRedirectsOnlyStopsAfterTenRedirects(t *testing.T) {
	first := &http.Request{URL: mustParse(t, "https://oneuptime.com/a")}
	next := &http.Request{URL: mustParse(t, "https://oneuptime.com/b")}

	via := []*http.Request{first}
	if err := sameServerRedirectsOnly(next, via); err != nil {
		t.Fatalf("a first redirect on the same server was refused: %v", err)
	}

	for len(via) < maxRedirects {
		via = append(via, next)
	}
	if err := sameServerRedirectsOnly(next, via); err == nil {
		t.Fatal("an eleventh redirect was followed; the agent must stop after ten, as Go's client does")
	}
}

func TestSameServerRedirectsOnlyNamesTheOriginOnly(t *testing.T) {
	first := &http.Request{URL: mustParse(t, "https://oneuptime.com"+testVerifyPath+testSecretKey)}
	next := &http.Request{URL: mustParse(t, "https://collector.example.net/x"+testVerifyPath+testSecretKey+"?key="+testSecretKey)}

	err := sameServerRedirectsOnly(next, []*http.Request{first})
	if err == nil {
		t.Fatal("a redirect to another server was followed")
	}

	message := err.Error()
	for _, want := range []string{"https://oneuptime.com", "https://collector.example.net", "another server"} {
		if !strings.Contains(message, want) {
			t.Errorf("error %q does not name %q", message, want)
		}
	}
	for _, unwanted := range []string{testSecretKey, "/x", testVerifyPath} {
		if strings.Contains(message, unwanted) {
			t.Errorf("error %q names %q: it may name where the redirect pointed, never its path or what the request carried", message, unwanted)
		}
	}
}

func TestCheckIfSecretKeyIsValidIsNotSentOnToAnotherServer(t *testing.T) {
	for _, status := range []int{http.StatusMovedPermanently, http.StatusFound, http.StatusSeeOther, http.StatusTemporaryRedirect, http.StatusPermanentRedirect} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			buf := captureAgentLogs(t)
			other, otherRecorder := newRecordingAgentServer(t, http.StatusOK, "")
			srv, recorder := newRedirectingAgentServer(t, status, func(string) string {
				return other.URL
			})

			if checkIfSecretKeyIsValid(context.Background(), testSecretKey, srv.URL, "") {
				t.Error("a key whose verification was redirected to another server must not be treated as valid")
			}

			request := recorder.only(t)
			if want := testVerifyPath + testSecretKey; request.path != want {
				t.Errorf("verify path = %q, want %q", request.path, want)
			}
			if got := otherRecorder.all(); len(got) != 0 {
				t.Fatalf("the other server was sent %d request(s): %+v", len(got), got)
			}

			logs := buf.String()
			if !strings.Contains(logs, "another server") || !strings.Contains(logs, other.URL) {
				t.Errorf("expected the refused redirect to be logged with where it pointed, got:\n%s", logs)
			}
			assertNoSecretInLogs(t, buf, testSecretKey)
		})
	}
}

func TestCheckIfSecretKeyIsValidFollowsARedirectOnItsOwnServer(t *testing.T) {
	buf := captureAgentLogs(t)
	srv, recorder := newRedirectingAgentServer(t, http.StatusTemporaryRedirect, func(self string) string {
		return self
	})

	if !checkIfSecretKeyIsValid(context.Background(), testSecretKey, srv.URL, "") {
		t.Fatalf("a verification redirected on its own server should get there, got logs:\n%s", buf.String())
	}

	paths := []string{}
	for _, request := range recorder.all() {
		paths = append(paths, request.path)
	}
	if want := []string{testVerifyPath + testSecretKey, testMovedPath + testVerifyPath + testSecretKey}; strings.Join(paths, " ") != strings.Join(want, " ") {
		t.Errorf("paths = %v, want %v", paths, want)
	}

	assertNoSecretInLogs(t, buf, testSecretKey)
}

// What every request would do without the check: Go's client follows the
// redirect to the other server, a 307's body - the secret key in it - with
// it. This is why the agent's clients check their redirects.
func TestWithoutTheCheckAPostIsFollowedToAnotherServerBodyAndAll(t *testing.T) {
	other, otherRecorder := newRecordingAgentServer(t, http.StatusOK, "")
	srv, _ := newRedirectingAgentServer(t, http.StatusTemporaryRedirect, func(string) string {
		return other.URL
	})

	body := []byte(`{"serverMonitorResponse":{"secretKey":"` + testSecretKey + `"}}`)
	resp, err := (&http.Client{}).Post(srv.URL+testIngestPath+testSecretKey, "application/json", bytes.NewBuffer(body))
	if err != nil {
		t.Fatalf("post failed: %v", err)
	}
	_ = resp.Body.Close()

	request := otherRecorder.only(t)
	if !bytes.Contains(request.body, []byte(testSecretKey)) {
		t.Fatalf("expected Go's client to send the body on to the other server, got %q", request.body)
	}
}

// collectMetricsJob collects real metrics through syscalls, which takes a
// few seconds, so each test below calls it once.
func TestCollectMetricsJobIsNotSentOnToAnotherServer(t *testing.T) {
	buf := captureAgentLogs(t)
	other, otherRecorder := newRecordingAgentServer(t, http.StatusOK, "")
	srv, recorder := newRedirectingAgentServer(t, http.StatusTemporaryRedirect, func(string) string {
		return other.URL
	})

	collectMetricsJob(context.Background(), testSecretKey, srv.URL, "")

	request := recorder.only(t)
	if want := testIngestPath + testSecretKey; request.path != want {
		t.Errorf("ingest path = %q, want %q", request.path, want)
	}
	if got := otherRecorder.all(); len(got) != 0 {
		t.Fatalf("the other server was sent %d request(s), the secret key in their bodies: %+v", len(got), got)
	}

	logs := buf.String()
	if !strings.Contains(logs, "Failed to send request to server") || !strings.Contains(logs, "another server") {
		t.Errorf("expected the refused redirect to be logged, got:\n%s", logs)
	}
	if strings.Contains(logs, "Metrics successfully pushed to OneUptime server") {
		t.Errorf("metrics were reported as pushed although the request was not sent on:\n%s", logs)
	}
	assertNoSecretInLogs(t, buf, testSecretKey)
}

func TestCollectMetricsJobFollowsARedirectOnItsOwnServer(t *testing.T) {
	buf := captureAgentLogs(t)
	srv, recorder := newRedirectingAgentServer(t, http.StatusPermanentRedirect, func(self string) string {
		return self
	})

	collectMetricsJob(context.Background(), testSecretKey, srv.URL, "")

	requests := recorder.all()
	if len(requests) != 2 {
		t.Fatalf("expected the ingest request and its redirect on the same server, got %d request(s): %+v", len(requests), requests)
	}
	if want := testMovedPath + testIngestPath + testSecretKey; requests[1].path != want {
		t.Errorf("redirected path = %q, want %q", requests[1].path, want)
	}

	var payload struct {
		ServerMonitorResponse *model.ServerMonitorReport `json:"serverMonitorResponse"`
	}
	if err := json.Unmarshal(requests[1].body, &payload); err != nil || payload.ServerMonitorResponse == nil {
		t.Fatalf("the redirected request's body is not the metrics report: %v\nbody: %s", err, requests[1].body)
	}
	if payload.ServerMonitorResponse.SecretKey != testSecretKey {
		t.Errorf("the redirected report's secretKey = %q, want the real secret", payload.ServerMonitorResponse.SecretKey)
	}

	if !strings.Contains(buf.String(), "Metrics successfully pushed to OneUptime server") {
		t.Errorf("expected the redirected report to be pushed, got:\n%s", buf.String())
	}
	assertNoSecretInLogs(t, buf, testSecretKey)
}

// Every http.Client the agent makes - each one sends the secret key - checks
// its redirects with sameServerRedirectsOnly. Read from the package's source,
// so a new client made without the check fails here.
func TestEveryAgentHTTPClientChecksItsRedirects(t *testing.T) {
	dir := guardPackageDir(t)
	files := guardSourceFiles(t, []string{dir, filepath.Join(dir, "utils"), filepath.Join(dir, "model")})

	clients := 0
	fset := token.NewFileSet()

	for _, path := range files {
		file, err := parser.ParseFile(fset, path, nil, 0)
		if err != nil {
			t.Fatalf("could not parse %s: %v", path, err)
		}

		ast.Inspect(file, func(node ast.Node) bool {
			literal, ok := node.(*ast.CompositeLit)
			if !ok || !isHTTPClientType(literal.Type) {
				return true
			}

			clients++

			checked := false
			for _, element := range literal.Elts {
				field, ok := element.(*ast.KeyValueExpr)
				if !ok {
					continue
				}
				key, keyOk := field.Key.(*ast.Ident)
				value, valueOk := field.Value.(*ast.Ident)
				if keyOk && valueOk && key.Name == "CheckRedirect" && value.Name == "sameServerRedirectsOnly" {
					checked = true
				}
			}

			if !checked {
				t.Errorf("%s: an http.Client made without CheckRedirect: sameServerRedirectsOnly", fset.Position(literal.Pos()))
			}

			return true
		})
	}

	// The agent's requests all get their client from newHTTPClient (client.go).
	if clients < 1 {
		t.Errorf("found %d http.Client literal(s), want at least 1; the scan has stopped finding them", clients)
	}
}

func isHTTPClientType(expr ast.Expr) bool {
	selector, ok := expr.(*ast.SelectorExpr)
	if !ok {
		return false
	}
	pkg, ok := selector.X.(*ast.Ident)

	return ok && pkg.Name == "http" && selector.Sel.Name == "Client"
}

func mustParse(t *testing.T, raw string) *url.URL {
	t.Helper()

	parsed, err := url.Parse(raw)
	if err != nil {
		t.Fatalf("could not parse %q: %v", raw, err)
	}
	return parsed
}
