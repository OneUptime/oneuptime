package oneuptime_infrastructure_agent

import (
	"encoding/json"
	"github.com/go-co-op/gocron/v2"
	"github.com/gookit/greq"
	"log/slog"
	"os"
	"time"
)

type Agent struct {
	SecretKey    string
	OneUptimeURL string
	scheduler    gocron.Scheduler
	mainJob      gocron.Job
	shutdownHook Hook
}

func NewAgent(secretKey string, url string) *Agent {
	ag := &Agent{
		SecretKey:    secretKey,
		OneUptimeURL: url,
	}
	slog.Info("Starting agent...")
	slog.Info("Agent configuration:")
	slog.Info("Secret key: " + ag.SecretKey)
	slog.Info("OneUptime URL: " + ag.OneUptimeURL)
	if ag.SecretKey == "" || ag.OneUptimeURL == "" {
		slog.Error("Secret key and OneUptime URL are required")
		os.Exit(1)
		return ag
	}

	// check if secret key is valid
	if !checkIfSecretKeyIsValid(ag.SecretKey, ag.OneUptimeURL) {
		slog.Error("Secret key is invalid")
		os.Exit(1)
		return ag
	}

	scheduler, err := gocron.NewScheduler()
	if err != nil {
		slog.Error(err.Error())
		os.Exit(1)
		return ag
	}

	job, err := scheduler.NewJob(gocron.DurationJob(time.Minute), gocron.NewTask(collectMetricsJob, ag.SecretKey, ag.OneUptimeURL))
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

func (ag *Agent) Close() {
	err := ag.scheduler.Shutdown()
	if err != nil {
		slog.Error(err.Error())
	}
}

func collectMetricsJob(secretKey string, oneuptimeURL string) {
	memMetrics := getMemoryMetrics()
	if memMetrics == nil {
		slog.Warn("Failed to get memory metrics")
	}

	cpuMetrics := getCpuMetrics()
	if cpuMetrics == nil {
		slog.Warn("Failed to get CPU metrics")
	}

	diskMetrics := listDiskMetrics()
	if diskMetrics == nil {
		slog.Warn("Failed to get disk metrics")
	}

	servProcesses := getServerProcesses()
	if servProcesses == nil {
		slog.Warn("Failed to get server processes")
	}

	metricsReport := &ServerMonitorReport{
		SecretKey: secretKey,
		BasicInfrastructureMetrics: &BasicInfrastructureMetrics{
			MemoryMetrics: memMetrics,
			CpuMetrics:    cpuMetrics,
			DiskMetrics:   diskMetrics,
		},
		RequestReceivedAt:          time.Now().UTC().Format("2006-01-02T15:04:05.000Z"),
		OnlyCheckRequestReceivedAt: false,
		Processes:                  servProcesses,
	}

	reqData := struct {
		ServerMonitorResponse *ServerMonitorReport `json:"serverMonitorResponse"`
	}{
		ServerMonitorResponse: metricsReport,
	}
	postBuilder := greq.New(oneuptimeURL).Post("/server-monitor/response/ingest/" + secretKey).
		JSONType().JSONBody(reqData)
	resp, err := postBuilder.Do()
	if err != nil {
		slog.Error(err.Error())
	}
	if resp.IsFail() {
		slog.Error("Failed to ingest metrics with status code ", resp.StatusCode)
		respJson, _ := json.Marshal(resp)
		slog.Error("Response: ", string(respJson))
	}
	slog.Info("1 minute metrics have been sent to OneUptime.")
}

func checkIfSecretKeyIsValid(secretKey string, baseUrl string) bool {
	if secretKey == "" {
		slog.Error("Secret key is empty")
		return false
	}
	resp, err := greq.New(baseUrl).JSONType().GetDo("/server-monitor/secret-key/verify/" + secretKey)
	if err != nil {
		slog.Error(err.Error())
		return false
	}
	if resp.StatusCode != 200 {
		slog.Error("Secret key verification failed with status code ", resp.StatusCode)
		return false
	}
	return true
}
