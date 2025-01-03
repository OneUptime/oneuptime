package main

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/url"
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
	ProxyURL     string
	scheduler    gocron.Scheduler
	mainJob      gocron.Job
	shutdownHook Hook
}

func NewAgent(secretKey string, oneuptimeUrl string, proxyUrl string) *Agent {

	ag := &Agent{
		SecretKey:    secretKey,
		OneUptimeURL: oneuptimeUrl,
		ProxyURL:     proxyUrl,
	}
	utils.SetDefaultLogger()
	slog.Info("Starting agent...")
	slog.Info("Agent configuration:")
	slog.Info("Secret key: " + ag.SecretKey)
	slog.Info("OneUptime URL: " + ag.OneUptimeURL)
	slog.Info("Proxy URL: " + ag.ProxyURL)
	if ag.SecretKey == "" || ag.OneUptimeURL == "" {
		slog.Error("Secret key and OneUptime URL are required")
		os.Exit(1)
		return ag
	}

	// check if secret key is valid
	if !checkIfSecretKeyIsValid(ag.SecretKey, ag.OneUptimeURL, ag.ProxyURL) {
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

func (ag *Agent) Close() {
	err := ag.scheduler.Shutdown()
	if err != nil {
		slog.Error(err.Error())
	}
}

func collectMetricsJob(secretKey string, oneuptimeUrl string, proxyUrl string) {
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

	req, err := http.NewRequest(http.MethodPost, oneuptimeUrl+"/server-monitor/response/ingest/"+secretKey, bytes.NewBuffer(reqBody))
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

func checkIfSecretKeyIsValid(secretKey string, oneuptimeUrl string, proxyUrl string) bool {

	// if we have a proxy, we need to use that to make the request

	client := &http.Client{}

	if proxyUrl != "" {
		proxyURL, _ := url.Parse(proxyUrl)
		transport := &http.Transport{Proxy: http.ProxyURL(proxyURL)}
		client = &http.Client{Transport: transport}
	}

	if secretKey == "" {
		slog.Error("Secret key is empty")
		return false
	}
	resp, err := client.Get(oneuptimeUrl + "/server-monitor/secret-key/verify/" + secretKey)
	if err != nil {
		slog.Error(err.Error())
		return false
	}
	if resp.StatusCode != 200 {
		slog.Error("Secret key verification failed with status code " + strconv.Itoa(resp.StatusCode))
		return false
	}
	return true
}
