package oneuptime_InfrastructureAgent_go

import (
	"github.com/gookit/slog"
	"github.com/kardianos/service"
)

type ServiceSysLogHandler struct {
	slog.LevelWithFormatter
	systemServiceLogger service.Logger
}

func NewServiceSysLogHandler(serviceLogger service.Logger) *ServiceSysLogHandler {
	return &ServiceSysLogHandler{
		systemServiceLogger: serviceLogger,
	}
}

func (s *ServiceSysLogHandler) Close() error {
	return nil
}

func (s *ServiceSysLogHandler) Flush() error {
	return nil
}

//func (s *ServiceSysLogHandler) IsHandling(level slog.Level) bool {
//	//TODO implement me
//	panic("implement me")
//}

func (s *ServiceSysLogHandler) Handle(record *slog.Record) error {
	formattedLog, err := s.Formatter().Format(record)
	if err != nil {
		return err
	}
	return s.systemServiceLogger.Info(string(formattedLog))
}
