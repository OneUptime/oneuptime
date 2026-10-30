package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"oneuptime-infrastructure-agent/model"
	"oneuptime-infrastructure-agent/utils"
	"os"
	"strconv"
	"time"

	"github.com/go-co-op/gocron/v2"
)

// maxLoggedResponseBody is how much of a response that refuses the metrics is
// read into the log: enough to say what went wrong, and no more of a body
// that could be any length.
const maxLoggedResponseBody = 4 << 10

type Agent struct {
	SecretKey    string
	OneUptimeURL string
	ProxyURL     string
	scheduler    gocron.Scheduler
	mainJob      gocron.Job
}

// NewAgent verifies the secret key and schedules the metrics report. It exits
// the process when the configuration is incomplete or OneUptime refuses the
// key, and returns nil when ctx is cancelled - the agent stopping - while the
// key is being verified. A key that cannot be verified yet - OneUptime or the
// network is down, as at boot - is asked about again until it can be.
func NewAgent(ctx context.Context, secretKey string, oneuptimeUrl string, proxyUrl string) *Agent {

	ag := &Agent{
		SecretKey:    secretKey,
		OneUptimeURL: oneuptimeUrl,
		ProxyURL:     proxyUrl,
	}

	slog.Info("Starting agent...")
	slog.Info("Agent configuration:")
	slog.Info("Secret key: " + utils.MaskSecret(ag.SecretKey))
	slog.Info("OneUptime URL: " + ag.OneUptimeURL)
	slog.Info("Proxy URL: " + ag.ProxyURL)
	if ag.SecretKey == "" || ag.OneUptimeURL == "" {
		slog.Error("Secret key and OneUptime URL are required")
		os.Exit(1)
		return ag
	}

	// check if secret key is valid
	if !checkIfSecretKeyIsValid(ctx, ag.SecretKey, ag.OneUptimeURL, ag.ProxyURL) {
		if ctx.Err() != nil {
			// The verification was cut short, so it says nothing about the key.
			slog.Info("The agent stopped before its secret key was verified")
			return nil
		}
		slog.Error("Secret key is invalid. If you are sure that the secret key is correct, please check the OneUptime URL (" + ag.OneUptimeURL + ") and Proxy URL (" + ag.ProxyURL + ") and try again.")
		os.Exit(1)
		return ag
	}

	scheduler, err := gocron.NewScheduler()
	if err != nil {
		slog.Error(err.Error())
		os.Exit(1)
		return ag
	}

	// collectMetricsJob takes a context first, so gocron passes it one, which
	// it cancels when the scheduler shuts down.
	job, err := scheduler.NewJob(gocron.DurationJob(30*time.Second), gocron.NewTask(collectMetricsJob, ag.SecretKey, ag.OneUptimeURL, ag.ProxyURL))
	if err != nil {
		slog.Error(err.Error())
		os.Exit(1)
		return ag
	}

	ag.scheduler = scheduler
	ag.mainJob = job

	return ag
}

func (ag *Agent) Start() {
	ag.scheduler.Start()
	err := ag.mainJob.RunNow()
	if err != nil {
		slog.Info(err.Error())
		os.Exit(1)
		return
	}
}

// Close stops the scheduler. A report still being collected or sent is
// abandoned, and Close returns once the report has finished.
func (ag *Agent) Close() {
	err := ag.scheduler.Shutdown()
	if err != nil {
		slog.Error(err.Error())
	}
	slog.Info("Agent stopped")
}

// agentStopped says whether ctx is done - the agent stopping - and, when it
// is, logs that the report is not sent.
func agentStopped(ctx context.Context) bool {
	if ctx.Err() == nil {
		return false
	}
	slog.Info("The agent stopped before the metrics were sent")
	return true
}

// collectMetricsJob collects the server's metrics and sends them to OneUptime.
// gocron passes it a context that it cancels when the agent stops. A
// collector can take seconds, so the job looks for the stop after each one:
// stopping waits for the collector running, not for the rest.
func collectMetricsJob(ctx context.Context, secretKey string, oneuptimeUrl string, proxyUrl string) {
	memMetrics := utils.GetMemoryMetrics()
	if memMetrics == nil {
		slog.Warn("Failed to get memory metrics")
	}
	if agentStopped(ctx) {
		return
	}

	cpuMetrics := utils.GetCpuMetrics()
	if cpuMetrics == nil {
		slog.Warn("Failed to get CPU metrics")
	}
	if agentStopped(ctx) {
		return
	}

	diskMetrics := utils.ListDiskMetrics()
	if diskMetrics == nil {
		slog.Warn("Failed to get disk metrics")
	}
	if agentStopped(ctx) {
		return
	}

	networkMetrics := utils.GetNetworkMetrics()
	if networkMetrics == nil {
		slog.Warn("Failed to get network metrics")
	}
	if agentStopped(ctx) {
		return
	}

	loadMetrics := utils.GetLoadMetrics()
	if loadMetrics == nil {
		slog.Warn("Failed to get load average metrics")
	}
	if agentStopped(ctx) {
		return
	}

	hostMetrics := utils.GetHostMetrics()
	if hostMetrics == nil {
		slog.Warn("Failed to get host metrics")
	}
	if agentStopped(ctx) {
		return
	}

	servProcesses := utils.GetServerProcesses()
	if servProcesses == nil {
		slog.Warn("Failed to get server processes; the report has no process list")
	}

	metricsReport := &model.ServerMonitorReport{
		SecretKey: secretKey,
		BasicInfrastructureMetrics: &model.BasicInfrastructureMetrics{
			MemoryMetrics:  memMetrics,
			CpuMetrics:     cpuMetrics,
			DiskMetrics:    diskMetrics,
			NetworkMetrics: networkMetrics,
			LoadMetrics:    loadMetrics,
			HostMetrics:    hostMetrics,
		},
		RequestReceivedAt:          time.Now().UTC().Format("2006-01-02T15:04:05.000Z"),
		OnlyCheckRequestReceivedAt: false,
		Processes:                  servProcesses,
		Hostname:                   utils.GetHostname(),
	}

	reqData := struct {
		ServerMonitorResponse *model.ServerMonitorReport `json:"serverMonitorResponse"`
	}{
		ServerMonitorResponse: metricsReport,
	}
	reqBody, err := json.Marshal(reqData)
	if err != nil {
		slog.Error("Failed to marshal request data", "error", err)
		return
	}

	const ingestPath = "/server-monitor/response/ingest/"

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, oneuptimeUrl+ingestPath+secretKey, bytes.NewBuffer(reqBody))
	if err != nil {
		// A URL that cannot be parsed is quoted whole in the error, the secret
		// key at its end.
		slog.Error("Failed to send request to server", "error", utils.RedactSecret(err.Error(), secretKey))
		return
	}
	request.Header.Set("Content-Type", "application/json")

	resp, err := newHTTPClient(proxyUrl).Do(request)
	if err != nil {
		if agentStopped(ctx) {
			return
		}
		// client.Do returns a *url.Error whose text embeds the whole request
		// URL, and the secret is that URL's final path segment - so the error
		// carries the secret even though nothing here names it.
		slog.Error("Failed to send request to server", "error", utils.RedactSecret(err.Error(), secretKey))
		return
	}

	defer resp.Body.Close()

	if resp.StatusCode == http.StatusOK {
		// The secret key is the last path segment of the endpoint, so log the
		// URL with that segment replaced rather than the URL we requested.
		slog.Info("Metrics successfully pushed to OneUptime server", "status", resp.StatusCode, "endpoint", oneuptimeUrl+ingestPath+utils.RedactedPlaceholder)
	} else {
		slog.Error("Failed to ingest metrics", "status_code", resp.StatusCode)
		respBody, err := io.ReadAll(io.LimitReader(resp.Body, maxLoggedResponseBody))
		if err != nil {
			slog.Error("Failed to read error response body", "error", err)
		} else {
			slog.Error("Server response", "body", string(respBody))
		}
	}
}

// keyVerification is what one attempt to verify the secret key found out.
type keyVerification int

const (
	// OneUptime accepted the key.
	keyAccepted keyVerification = iota
	// OneUptime refused the key, or the agent's settings cannot reach it - a
	// OneUptime URL that cannot be read, or one that redirects to another
	// server. Asking again gets the same answer.
	keyRefused
	// The key could not be verified: OneUptime or the network did not answer,
	// or OneUptime answered with an error of its own. Asking again later may
	// get an answer.
	keyNotVerified
)

// The wait before asking OneUptime about the key again: the first, doubled
// after every answer that is not one, up to the longest. Variables so tests
// can wait less.
var (
	keyVerificationFirstRetry   = 5 * time.Second
	keyVerificationLongestRetry = 5 * time.Minute
)

// nextKeyVerificationRetry returns how long to wait before asking about the key
// again, after waiting previous (0 before the first wait).
func nextKeyVerificationRetry(previous time.Duration) time.Duration {
	if previous <= 0 {
		return keyVerificationFirstRetry
	}
	if next := previous * 2; next < keyVerificationLongestRetry {
		return next
	}
	return keyVerificationLongestRetry
}

// keyVerificationOfStatus says what OneUptime's answer to the verification
// says about the key. OneUptime answers 200 for a key it accepts, and 400 for
// one it does not. A server error, or an answer that the server is too busy
// to give one, says nothing about the key.
func keyVerificationOfStatus(status int) keyVerification {
	switch {
	case status == http.StatusOK:
		return keyAccepted
	case status >= 500, status == http.StatusRequestTimeout, status == http.StatusTooManyRequests:
		return keyNotVerified
	default:
		return keyRefused
	}
}

// keyVerificationOfError says what a verification that got no answer says
// about the key: nothing - unless a redirect the agent does not follow stopped
// it, as the same redirect would stop it again.
func keyVerificationOfError(err error) keyVerification {
	var refused *redirectRefused
	if errors.As(err, &refused) {
		return keyRefused
	}
	return keyNotVerified
}

// verifySecretKey asks OneUptime once whether it accepts the secret key. The
// request is abandoned when ctx is cancelled, and the key is then not
// verified.
func verifySecretKey(ctx context.Context, secretKey string, oneuptimeUrl string, proxyUrl string) keyVerification {
	if secretKey == "" {
		slog.Error("Secret key is empty")
		return keyRefused
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodGet, oneuptimeUrl+"/server-monitor/secret-key/verify/"+secretKey, nil)
	if err != nil {
		// A URL that cannot be parsed is quoted whole in the error, the secret
		// key at its end.
		slog.Error(utils.RedactSecret(err.Error(), secretKey))
		return keyRefused
	}

	resp, err := newHTTPClient(proxyUrl).Do(request)
	if err != nil {
		if ctx.Err() != nil {
			// The agent is stopping, which NewAgent logs.
			return keyNotVerified
		}
		// Same *url.Error leak as the ingest request above: the verify URL also
		// ends in the secret.
		slog.Error(utils.RedactSecret(err.Error(), secretKey))
		return keyVerificationOfError(err)
	}
	defer resp.Body.Close()

	verification := keyVerificationOfStatus(resp.StatusCode)
	if verification != keyAccepted {
		slog.Error("Secret key verification failed with status code " + strconv.Itoa(resp.StatusCode))
	}
	return verification
}

// checkIfSecretKeyIsValid asks OneUptime whether it accepts the secret key
// until it gets an answer: true when OneUptime accepts the key, false when it
// refuses it, or when ctx is cancelled - the agent stopping - first. An agent
// that starts before the network, or while OneUptime is restarting, used to
// exit on the first failed request, and a Windows service then stayed
// stopped.
func checkIfSecretKeyIsValid(ctx context.Context, secretKey string, oneuptimeUrl string, proxyUrl string) bool {
	var wait time.Duration

	for {
		switch verifySecretKey(ctx, secretKey, oneuptimeUrl, proxyUrl) {
		case keyAccepted:
			return true
		case keyRefused:
			return false
		}

		if ctx.Err() != nil {
			return false
		}

		wait = nextKeyVerificationRetry(wait)
		slog.Warn("The secret key could not be verified with OneUptime yet; asking again in " + wait.String())

		timer := time.NewTimer(wait)
		select {
		case <-ctx.Done():
			timer.Stop()
			return false
		case <-timer.C:
		}
	}
}
