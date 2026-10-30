package main

import (
	"fmt"
	"net/http"
	"net/url"
	"strings"
)

// Every request the agent sends to OneUptime carries the monitor's secret
// key, in its address and in its body. Go's HTTP client follows a redirect
// wherever it points, and sends a 307's or a 308's body along with it, so
// the key would go to whatever server a redirect names. The agent follows a
// redirect only while it stays on the server the request was sent to: the
// same address (scheme, host and port), or that address moved from http to
// https on the default ports - the redirect a TLS front door answers plain
// HTTP with. Any other redirect fails the request, and its error says where
// the redirect pointed (its origin alone).

// The most redirects a request follows, as Go's client does by default.
const maxRedirects = 10

// redirectRefused is the error a request fails with when it is redirected in
// a way the agent does not follow. Sending the request again gets the same
// redirect, so it is not worth sending again.
type redirectRefused struct {
	reason string
}

func (e *redirectRefused) Error() string {
	return e.reason
}

// sameServerRedirectsOnly is the CheckRedirect of every http.Client the
// agent sends a request to OneUptime with.
func sameServerRedirectsOnly(req *http.Request, via []*http.Request) error {
	if len(via) >= maxRedirects {
		return &redirectRefused{reason: "stopped after 10 redirects"}
	}

	if len(via) == 0 {
		return nil
	}

	// Every redirect of a chain is held to where the request was first sent.
	from := via[0].URL

	if !isRedirectOnSameServer(from, req.URL) {
		to := originOf(req.URL)

		return &redirectRefused{reason: fmt.Sprintf(
			"the request to %s was redirected to %s, another server, so it was not sent on: the agent follows redirects only on the server it was sent to. If the server is at %s, set the agent's OneUptime URL to that",
			originOf(from), to, to,
		)}
	}

	return nil
}

// isRedirectOnSameServer says whether a redirect from one address to another
// stays on the server the request was sent to.
func isRedirectOnSameServer(from *url.URL, to *url.URL) bool {
	if from == nil || to == nil || !isServerAddress(from) || !isServerAddress(to) {
		return false
	}

	// An address that names a user is never where a redirect may send a request.
	if to.User != nil {
		return false
	}

	if !strings.EqualFold(from.Hostname(), to.Hostname()) {
		return false
	}

	fromScheme := strings.ToLower(from.Scheme)
	toScheme := strings.ToLower(to.Scheme)

	if fromScheme == toScheme {
		return portOf(from) == portOf(to)
	}

	// http to https, from the default port to the default port.
	return fromScheme == "http" &&
		toScheme == "https" &&
		portOf(from) == "80" &&
		portOf(to) == "443"
}

// A host and port, over http or https.
func isServerAddress(address *url.URL) bool {
	scheme := strings.ToLower(address.Scheme)

	return (scheme == "http" || scheme == "https") && address.Hostname() != ""
}

// An address's port, the scheme's default when it names none.
func portOf(address *url.URL) string {
	if port := address.Port(); port != "" {
		return port
	}

	if strings.ToLower(address.Scheme) == "https" {
		return "443"
	}

	return "80"
}

// An address's origin, the part of it an error may name: never its user,
// path or query, which can carry anything.
func originOf(address *url.URL) string {
	if address == nil || address.Host == "" {
		return "an address that could not be read"
	}

	return strings.ToLower(address.Scheme) + "://" + address.Host
}
