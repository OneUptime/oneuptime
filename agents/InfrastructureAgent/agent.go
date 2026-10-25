package main

import (
	"bytes"
	"context"
	"encoding/json"
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
// the process when the configuration is incomplete or the key is not
// accepted, and returns nil when ctx is cancelled - the agent stopping - while
// the key is being verified.
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
		slog.Error("Secret key is invalid. If you are sure that the secret key is correct, please check your network connection, OneUptime URL (" + ag.OneUptimeURL + "), Proxy URL (" + ag.ProxyURL + ") and try again.")
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
		slog.Warn("Failed to get server processes")
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

// checkIfSecretKeyIsValid asks OneUptime whether it accepts the secret key.
// The request is abandoned when ctx is cancelled, and the key is then not
// called valid.
func checkIfSecretKeyIsValid(ctx context.Context, secretKey string, oneuptimeUrl string, proxyUrl string) bool {
	if secretKey == "" {
		slog.Error("Secret key is empty")
		return false
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodGet, oneuptimeUrl+"/server-monitor/secret-key/verify/"+secretKey, nil)
	if err != nil {
		// A URL that cannot be parsed is quoted whole in the error, the secret
		// key at its end.
		slog.Error(utils.RedactSecret(err.Error(), secretKey))
		return false
	}

	resp, err := newHTTPClient(proxyUrl).Do(request)
	if err != nil {
		if ctx.Err() != nil {
			// The agent is stopping, which NewAgent logs.
			return false
		}
		// Same *url.Error leak as the ingest request above: the verify URL also
		// ends in the secret.
		slog.Error(utils.RedactSecret(err.Error(), secretKey))
		return false
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		slog.Error("Secret key verification failed with status code " + strconv.Itoa(resp.StatusCode))
		return false
	}
	return true
}
