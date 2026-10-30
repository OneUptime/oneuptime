package main

import (
	"bufio"
	"context"
	"flag"
	"fmt"
	"log/slog"
	"oneuptime-infrastructure-agent/utils"
	"os"
	"time"

	"github.com/gookit/config/v2"
	"github.com/kardianos/service"
)

type agentService struct {
	config *ConfigFile

	// stop cancels the context the agent runs with, and stopped is closed
	// once runAgent has returned. Start makes both.
	stop    context.CancelFunc
	stopped chan struct{}
}

func (a *agentService) Start(s service.Service) error {
	if service.Interactive() {
		slog.Info("Running in terminal.")
	} else {
		slog.Info("Running under service manager.")
	}
	ctx, stop := context.WithCancel(context.Background())
	a.stop = stop
	a.stopped = make(chan struct{})
	go a.runAgent(ctx)
	return nil
}

// runAgent runs the agent until ctx is cancelled, then shuts it down.
func (a *agentService) runAgent(ctx context.Context) {
	defer close(a.stopped)

	agent := NewAgent(ctx, a.config.SecretKey, a.config.OneUptimeURL, a.config.ProxyURL)
	if agent == nil {
		return
	}
	agent.Start()

	<-ctx.Done()
	slog.Info("Service Exiting...")
	agent.Close()
}

// Stop is called however the agent runs: by kardianos/service when the
// service manager stops the service, and on Ctrl+C when the agent runs in a
// terminal. The process exits as soon as Stop returns, so it returns only
// once the agent has shut down: its scheduler stopped, and a report or key
// verification in flight abandoned.
func (a *agentService) Stop(s service.Service) error {
	a.stop()
	<-a.stopped
	return nil
}

func showLogs(maxLines int, follow bool) {
	logPath := utils.GetLogPath()

	// Check if log file exists
	if _, err := os.Stat(logPath); os.IsNotExist(err) {
		fmt.Printf("No log file found at %s\n", logPath)
		return
	}

	// Open the log file
	file, err := os.Open(logPath)
	if err != nil {
		fmt.Printf("Error opening log file: %v\n", err)
		return
	}
	defer file.Close()

	// Read and display the logs
	fmt.Printf("Showing logs from: %s\n", logPath)
	fmt.Println("=====================================")

	if follow {
		// For follow mode, use a simple tail-like implementation
		fmt.Println("Following logs (press Ctrl+C to exit)...")
		fmt.Println("=====================================")

		scanner := bufio.NewScanner(file)
		// First, read existing content
		for scanner.Scan() {
			fmt.Println(scanner.Text())
		}

		// Then watch for new content (simplified implementation)
		// Note: This is a basic implementation. For production, consider using fsnotify or similar
		for {
			scanner = bufio.NewScanner(file)
			scanner.Split(bufio.ScanLines)
			for scanner.Scan() {
				fmt.Println(scanner.Text())
			}
			// Small delay to avoid excessive CPU usage
			time.Sleep(1 * time.Second)
		}
	} else {
		scanner := bufio.NewScanner(file)
		lineCount := 0
		var lines []string

		// Read all lines and keep track of them
		for scanner.Scan() {
			lines = append(lines, scanner.Text())
			lineCount++
		}

		if err := scanner.Err(); err != nil {
			fmt.Printf("Error reading log file: %v\n", err)
			return
		}

		// Show last maxLines lines or all lines if less than maxLines
		startIndex := 0
		if lineCount > maxLines {
			startIndex = lineCount - maxLines
			fmt.Printf("Showing last %d lines (%d total lines):\n", maxLines, lineCount)
		} else {
			fmt.Printf("Showing all %d lines:\n", lineCount)
		}
		fmt.Println("=====================================")

		for i := startIndex; i < lineCount; i++ {
			fmt.Println(lines[i])
		}
	}
}

// serviceRestartDelay is how long after the agent's service fails it is
// started again: the RestartSec of the systemd unit kardianos/service writes
// on Linux, which restarts it always.
const serviceRestartDelay = "2m"

// newServiceConfig is how the agent is installed as a system service.
func newServiceConfig() *service.Config {
	return &service.Config{
		Name:        "oneuptime-infrastructure-agent",
		DisplayName: "OneUptime Infrastructure Agent",
		Description: "The OneUptime Infrastructure Agent is a lightweight, open-source agent that collects system metrics and sends them to the OneUptime platform. It is designed to be easy to configure and use, and to be extensible.",
		Arguments:   []string{"run"},
		Option: service.KeyValue{
			// Windows: start the service again when it fails, as systemd
			// does on Linux and launchd on macOS. Without a recovery action
			// a service that stopped on a failure stayed stopped until
			// someone started it. (Read only on Windows.)
			"OnFailure":              "restart",
			"OnFailureDelayDuration": serviceRestartDelay,
		},
	}
}

// echoesToTerminal says whether the log lines also go to the terminal: for
// every command, whose result they are, and for the service itself only when
// it runs in a terminal - under a service manager it writes to its log alone.
func echoesToTerminal(args []string, interactive bool) bool {
	if len(args) < 2 {
		return false
	}
	return args[1] != "run" || interactive
}

func main() {
	// Initialize logging
	utils.SetDefaultLogger()

	slog.Info("OneUptime Infrastructure Agent")

	if echoesToTerminal(os.Args, service.Interactive()) {
		utils.EchoToTerminal(os.Stdout, os.Stderr)
	}

	config.WithOptions(config.WithTagName("json"))
	cfgFile := newConfigFile()

	svcConfig := newServiceConfig()

	agentSvc := &agentService{
		config: cfgFile,
	}

	s, err := service.New(agentSvc, svcConfig)
	if err != nil {
		slog.Error(err.Error())
		os.Exit(2)
	}

	if len(os.Args) > 1 {
		cmd := os.Args[1]
		switch cmd {
		case "configure":
			installFlags := flag.NewFlagSet("configure", flag.ExitOnError)
			secretKey := installFlags.String("secret-key", "", "Secret key of this monitor, you can find this on OneUptime dashboard (required)")
			oneuptimeURL := installFlags.String("oneuptime-url", "", "OneUptime endpoint root URL (required)")
			proxyURL := installFlags.String("proxy-url", "", "Proxy URL (optional)")
			err := installFlags.Parse(os.Args[2:])
			if err != nil {
				slog.Error(err.Error())
				os.Exit(2)
			}
			agentSvc.config.SecretKey = *secretKey
			agentSvc.config.OneUptimeURL = *oneuptimeURL
			agentSvc.config.ProxyURL = *proxyURL
			if agentSvc.config.SecretKey == "" || agentSvc.config.OneUptimeURL == "" {
				slog.Error("The --secret-key and --oneuptime-url flags are required for the 'configure' command")
				os.Exit(2)
			}
			slog.Info("Configuring service...")
			slog.Info("Secret key: " + utils.MaskSecret(*secretKey))
			slog.Info("OneUptime URL: " + *oneuptimeURL)
			slog.Info("Proxy URL: " + *proxyURL)
			err = agentSvc.config.save(agentSvc.config.SecretKey, agentSvc.config.OneUptimeURL, agentSvc.config.ProxyURL)
			if err != nil {
				slog.Error(err.Error())
				os.Exit(2)
			}
			if err := s.Install(); err != nil {
				slog.Error("Failed to configure service. Please consider uninstalling the service by running 'oneuptime-infrastructure-agent uninstall' and run configure again.", "error", err)
				os.Exit(2)
			}
			fmt.Println("Service installed. Run the service using 'oneuptime-infrastructure-agent start'")
		case "start":
			err := agentSvc.config.loadConfig()
			if os.IsNotExist(err) {
				slog.Error("Service configuration not found. Please run 'oneuptime-infrastructure-agent configure' to configure the service.")
				os.Exit(2)
			}
			if err != nil {
				slog.Error(err.Error())
				os.Exit(2)
			}
			if agentSvc.config.SecretKey == "" || agentSvc.config.OneUptimeURL == "" {
				slog.Error("Service configuration not found or is incomplete. Please run 'oneuptime-infrastructure-agent configure' to configure the service.")
				os.Exit(2)
			}
			err = s.Start()
			if err != nil {
				slog.Error(err.Error())
				os.Exit(1)
			}
			slog.Info("OneUptime Infrastructure Agent Started")
		case "run":
			err := agentSvc.config.loadConfig()
			if os.IsNotExist(err) {
				slog.Error("Service configuration not found. Please run 'oneuptime-infrastructure-agent configure' to configure the service.")
				os.Exit(2)
			}
			if err != nil {
				slog.Error(err.Error())
				os.Exit(2)
			}
			if agentSvc.config.SecretKey == "" || agentSvc.config.OneUptimeURL == "" {
				slog.Error("Service configuration not found or is incomplete. Please run 'oneuptime-infrastructure-agent configure' to configure the service.")
				os.Exit(2)
			}
			err = s.Run()
			if err != nil {
				slog.Error(err.Error())
				os.Exit(1)
			}
		case "uninstall", "stop", "restart":
			err := service.Control(s, cmd)
			if err != nil {
				slog.Error(err.Error())
				os.Exit(2)
			}
			if cmd == "uninstall" {
				err := agentSvc.config.removeConfigFile()
				if err != nil {
					slog.Error(err.Error())
					os.Exit(2)
				}
				slog.Info("Service Uninstalled")
			}
			if cmd == "stop" {
				slog.Info("Service Stopped")
			}
			if cmd == "restart" {
				slog.Info("Service Restarted")
			}
		case "help":
			fmt.Println("Usage: oneuptime-infrastructure-agent configure | uninstall | start | stop | restart | status | logs")
			fmt.Println()
			fmt.Println("Commands:")
			fmt.Println("  configure    Configure the agent with secret key and OneUptime URL")
			fmt.Println("  start        Start the agent service")
			fmt.Println("  stop         Stop the agent service")
			fmt.Println("  restart      Restart the agent service")
			fmt.Println("  status       Show the status of the agent service")
			fmt.Println("  logs         Show agent logs")
			fmt.Println("    -n <num>   Number of lines to show (default: 100)")
			fmt.Println("    -f         Follow log output (like tail -f)")
			fmt.Println("  uninstall    Uninstall the agent service")
			fmt.Println("  help         Show this help message")
		case "status":
			sc, err := s.Status()
			if err != nil {
				slog.Error(err.Error())
				os.Exit(2)
			}
			if sc == service.StatusRunning {
				slog.Info("Service is running")
			} else if sc == service.StatusStopped {
				slog.Info("Service is stopped")
			} else {
				slog.Info("Service status unknown")
			}
		case "logs":
			logFlags := flag.NewFlagSet("logs", flag.ExitOnError)
			lines := logFlags.Int("n", 100, "Number of lines to show")
			follow := logFlags.Bool("f", false, "Follow log output")
			err := logFlags.Parse(os.Args[2:])
			if err != nil {
				slog.Error(err.Error())
				os.Exit(2)
			}
			showLogs(*lines, *follow)
		default:
			slog.Error("Invalid command")
			os.Exit(2)
		}
	} else {
		fmt.Println("Usage: oneuptime-infrastructure-agent configure | uninstall | start | stop | restart | status | logs")
	}
}
