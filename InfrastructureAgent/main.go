package main

import (
	"flag"
	"fmt"
	"log/slog"
	"os"

	"github.com/gookit/config/v2"
	"github.com/kardianos/service"
)

type program struct {
	exit   chan struct{}
	agent  *Agent
	config *ConfigFile
}

func (p *program) Start(s service.Service) error {
	if service.Interactive() {
		slog.Info("Running in terminal.")
	} else {
		slog.Info("Running under service manager.")
	}
	p.exit = make(chan struct{})
	// Start should not block. Do the actual work async.
	go p.run()
	return nil
}

func (p *program) run() {
	p.agent = NewAgent(p.config.SecretKey, p.config.OneUptimeURL, p.config.ProxyURL)
	p.agent.Start()
	if service.Interactive() {
		slog.Info("Running in terminal.")
		NewShutdownHook().Close(func() {
			slog.Info("Service Exiting...")
			p.agent.Close()
		})
	} else {
		slog.Info("Running under service manager.")
		for {
			select {
			case _, ok := <-p.exit:
				if !ok {
					slog.Info("Service Exiting...")
					p.agent.Close()
					return
				}
			}
		}
	}
}

func (p *program) Stop(s service.Service) error {
	close(p.exit)
	return nil
}

func main() {

	slog.Info("OneUptime Infrastructure Agent")
	// Set up the configuration
	config.WithOptions(config.WithTagName("json"))
	cfg := newConfigFile()

	// Set up the service
	svcConfig := &service.Config{
		Name:        "oneuptime-infrastructure-agent",
		DisplayName: "OneUptime Infrastructure Agent",
		Description: "The OneUptime Infrastructure Agent is a lightweight, open-source agent that collects system metrics and sends them to the OneUptime platform. It is designed to be easy to configure and use, and to be extensible.",
		Arguments:   []string{"run"},
	}

	// Set up the program
	prg := &program{
		config: cfg,
	}

	// Create the service
	s, err := service.New(prg, svcConfig)
	if err != nil {
		slog.Error(err.Error())
		os.Exit(2)
	}

	if len(os.Args) > 1 {
		cmd := os.Args[1]
		switch cmd {
		case "configure":
			installFlags := flag.NewFlagSet("configure", flag.ExitOnError)
			secretKey := installFlags.String("secret-key", "", "Secret key of this monitor. You can find this on OneUptime dashboard (required)")
			oneuptimeURL := installFlags.String("oneuptime-url", "", "Oneuptime endpoint root URL (required)")

			// Take input - proxy URL, proxy port, username / password - all optional

			proxyURL := installFlags.String("proxy-url", "", "Proxy URL - if you are using a proxy (optional)")

			err := installFlags.Parse(os.Args[2:])
			if err != nil {
				slog.Error(err.Error())
				os.Exit(2)
			}

			prg.config.SecretKey = *secretKey
			prg.config.OneUptimeURL = *oneuptimeURL
			prg.config.ProxyURL = *proxyURL

			if prg.config.SecretKey == "" || prg.config.OneUptimeURL == "" {
				slog.Error("The --secret-key and --oneuptime-url flags are required for the 'configure' command")
				os.Exit(2)
			}

			slog.Info("Configuring service...")
			slog.Info("Secret key: " + *secretKey)
			slog.Info("OneUptime URL: " + *oneuptimeURL)
			slog.Info("Proxy URL: " + *proxyURL)

			// save configuration
			err = prg.config.save(prg.config.SecretKey, prg.config.OneUptimeURL, prg.config.ProxyURL)

			if err != nil {
				slog.Error(err.Error())
				os.Exit(2)
			}
			// Install the service
			if err := s.Install(); err != nil {
				slog.Error("Failed to configure service. Please consider uninstalling the service by running 'oneuptime-infrastructure-agent uninstall' and run configure again. \n", err)
				os.Exit(2)
			}
			fmt.Println("Service installed. Run the service using 'oneuptime-infrastructure-agent start'")

		case "start":
			err := prg.config.loadConfig()
			if os.IsNotExist(err) {
				slog.Error("Service configuration not found. Please run 'oneuptime-infrastructure-agent configure' to configure the service.")
				os.Exit(2)
			}
			if err != nil {
				slog.Error(err.Error())
				os.Exit(2)
			}
			if prg.config.SecretKey == "" || prg.config.OneUptimeURL == "" {
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
			err := prg.config.loadConfig()
			if os.IsNotExist(err) {
				slog.Error("Service configuration not found. Please run 'oneuptime-infrastructure-agent configure' to configure the service.")
				os.Exit(2)
			}
			if err != nil {
				slog.Error(err.Error())
				os.Exit(2)
			}
			if prg.config.SecretKey == "" || prg.config.OneUptimeURL == "" {
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
				// remove configuration file
				err := prg.config.removeConfigFile()
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

		// add help command
		case "help":
			fmt.Println("Usage: oneuptime-infrastructure-agent configure | uninstall | start | stop | restart")
		case "status":
			s, err := s.Status()
			if err != nil {
				slog.Error(err.Error())
				os.Exit(2)
			}
			if s == service.StatusRunning {
				slog.Info("Service is running")
			} else if s == service.StatusStopped {
				slog.Info("Service is stopped")
			} else {
				slog.Info("Service status unknown")
			}
		default:
			slog.Error("Invalid command")
			os.Exit(2)
		}
	} else {
		fmt.Println("Usage: oneuptime-infrastructure-agent configure | uninstall | start | stop | restart")
	}
}
