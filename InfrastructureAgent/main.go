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
	p.agent = NewAgent(p.config.SecretKey, p.config.OneUptimeURL)
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
	// Set up the configuration
	config.WithOptions(config.WithTagName("json"))
	cfg := newConfigFile()

	// Set up the service
	svcConfig := &service.Config{
		Name:        "oneuptime-infrastructure-agent",
		DisplayName: "OneUptime Infrastructure Agent",
		Description: "The OneUptime Infrastructure Agent is a lightweight, open-source agent that collects system metrics and sends them to the OneUptime platform. It is designed to be easy to install and use, and to be extensible.",
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

	if err != nil {
		slog.Error(err.Error())
		os.Exit(2)
	}

	if len(os.Args) > 1 {
		cmd := os.Args[1]
		switch cmd {
		case "install":
			installFlags := flag.NewFlagSet("install", flag.ExitOnError)
			secretKey := installFlags.String("secret-key", "", "Secret key (required)")
			oneuptimeURL := installFlags.String("oneuptime-url", "", "Oneuptime endpoint root URL (required)")
			err := installFlags.Parse(os.Args[2:])
			if err != nil {
				slog.Error(err.Error())
				os.Exit(2)
			}
			prg.config.SecretKey = *secretKey
			prg.config.OneUptimeURL = *oneuptimeURL
			if prg.config.SecretKey == "" || prg.config.OneUptimeURL == "" {
				slog.Error("The --secret-key and --oneuptime-url flags are required for the 'install' command")
				os.Exit(2)
			}
			// save configuration
			err = prg.config.save(prg.config.SecretKey, prg.config.OneUptimeURL)
			if err != nil {
				slog.Error(err.Error())
				os.Exit(2)
			}
			// Install the service
			if err := s.Install(); err != nil {
				slog.Error("Failed to install service: ", err)
				os.Exit(2)
			}
			fmt.Println("Service installed")
		case "start":
			err := prg.config.loadConfig()
			if os.IsNotExist(err) {
				slog.Error("Service configuration not found. Please install the service properly.")
				os.Exit(2)
			}
			if err != nil {
				slog.Error(err.Error())
				os.Exit(2)
			}
			if err != nil || prg.config.SecretKey == "" || prg.config.OneUptimeURL == "" {
				slog.Error("Service configuration not found or is incomplete. Please install the service properly.")
				os.Exit(2)
			}
			err = s.Start()
			if err != nil {
				slog.Error(err.Error())
				os.Exit(2)
			}
			slog.Info("Service Started")
		case "run":
			err := prg.config.loadConfig()
			if os.IsNotExist(err) {
				slog.Error("Service configuration not found. Please install the service properly.")
				os.Exit(2)
			}
			if err != nil {
				slog.Error(err.Error())
				os.Exit(2)
			}
			if err != nil || prg.config.SecretKey == "" || prg.config.OneUptimeURL == "" {
				slog.Error("Service configuration not found or is incomplete. Please install the service properly.")
				os.Exit(2)
			}
			err = s.Run()
			if err != nil {
				slog.Error(err.Error())
				os.Exit(2)
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
		// add help command
		case "help":
			fmt.Println("Usage: oneuptime-infrastructure-agent install | uninstall | start | stop | restart")
		default:
			slog.Error("Invalid command")
			os.Exit(2)
		}
	} else {
		fmt.Println("Usage: oneuptime-infrastructure-agent install | uninstall | start | stop | restart")
	}
}
