package main

import (
	"bytes"
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

	job, err := scheduler.NewJob(gocron.DurationJob(30*time.Second), gocron.NewTask(collectMetricsJob, ag.SecretKey, ag.OneUptimeURL))
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
	memMetrics := utils.GetMemoryMetrics()
	if memMetrics == nil {
		slog.Warn("Failed to get memory metrics")
	}

	cpuMetrics := utils.GetCpuMetrics()
	if cpuMetrics == nil {
		slog.Warn("Failed to get CPU metrics")
	}

	diskMetrics := utils.ListDiskMetrics()
	if diskMetrics == nil {
		slog.Warn("Failed to get disk metrics")
	}

	servProcesses := utils.GetServerProcesses()
	if servProcesses == nil {
		slog.Warn("Failed to get server processes")
	}

	metricsReport := &model.ServerMonitorReport{
		SecretKey: secretKey,
		BasicInfrastructureMetrics: &model.BasicInfrastructureMetrics{
			MemoryMetrics: memMetrics,
			CpuMetrics:    cpuMetrics,
			DiskMetrics:   diskMetrics,
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
		slog.Error("Failed to marshal request data: ", err)
		return
	}

	req, err := http.NewRequest(http.MethodPost, oneuptimeURL+"/server-monitor/response/ingest/"+secretKey, bytes.NewBuffer(reqBody))
	if err != nil {
		slog.Error("Failed to create request: ", err)
		return
	}
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		slog.Error("Failed to send request: ", err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		slog.Error("Failed to ingest metrics with status code ", resp.StatusCode)
		respBody, _ := io.ReadAll(resp.Body)
		slog.Error("Response: ", string(respBody))
	}

	slog.Info("1 minute metrics have been sent to OneUptime.")
}

func checkIfSecretKeyIsValid(secretKey string, baseUrl string) bool {
	if secretKey == "" {
		slog.Error("Secret key is empty")
		return false
	}
	resp, err := http.NewRequest(http.MethodGet, baseUrl+"/server-monitor/secret-key/verify/"+secretKey, nil)
	if err != nil {
		slog.Error(err.Error())
		return false
	}
	if resp.Response.StatusCode != 200 {
		slog.Error("Secret key verification failed with status code " + strconv.Itoa(resp.Response.StatusCode))
		return false
	}
	return true
}
