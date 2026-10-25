package main

import (
	"log/slog"
	"net/http"
	"net/url"
	"time"
)

// requestTimeout bounds every request the agent sends to OneUptime, from
// dialing to the last byte of the response body. Without it a server or proxy
// that takes the connection and never answers holds the request open forever:
// at startup that request is the secret key's verification, which the agent
// waits on before it schedules a single report. It stays below the 30s report
// interval.
var requestTimeout = 20 * time.Second

// newHTTPClient makes the client the agent sends a request to OneUptime with,
// through the proxy when there is one.
func newHTTPClient(proxyUrl string) *http.Client {
	// The request carries the secret key, so it follows a redirect only on
	// the server it was sent to (redirect.go).
	client := &http.Client{Timeout: requestTimeout, CheckRedirect: sameServerRedirectsOnly}

	if proxyUrl != "" {
		proxyURL, _ := url.Parse(proxyUrl)
		client.Transport = &http.Transport{Proxy: http.ProxyURL(proxyURL)}
		slog.Info("Using proxy to send request:" + proxyUrl)
	}

	return client
}
