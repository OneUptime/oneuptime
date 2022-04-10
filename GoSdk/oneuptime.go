package oneuptime

import (
	"errors"
	"log"
)

type LoggerOptions struct {
	ApplicationLogId  string
	ApplicationLogKey string
	ApiUrl            string
}

type OneUptimeLogger struct {
	options LoggerOptions
}

// Generic Error Messages
var (
	ErrApplicationLogIDMissing  = "Application Log ID cant be empty"
	ErrApplicationLogKeyMissing = "Application Log Key cant be empty"
	ErrApiURLMissing            = "API URL cant be empty"
	ErrContentMissing           = "Content cant be empty"
)

func NewOneUptimeLogger(options LoggerOptions) (*OneUptimeLogger, error) {
	if options.ApplicationLogId == "" {
		return nil, errors.New(ErrApplicationLogIDMissing)
	}
	if options.ApplicationLogKey == "" {
		return nil, errors.New(ErrApplicationLogKeyMissing)
	}
	if options.ApiUrl == "" {
		return nil, errors.New(ErrApiURLMissing)
	}
	// set up API URL
	options.ApiUrl = options.ApiUrl + "/application-log/" + options.ApplicationLogId + "/log"

	oneuptimeLogger := OneUptimeLogger{
		options: options,
	}
	return &oneuptimeLogger, nil
}

// Init initializes the SDK with loggerOptions.
// it returns the error if any of the options are invalid
func Init(options LoggerOptions) error {
	currentOneUptimeLogger, err := NewOneUptimeLogger(options)
	if err != nil {
		return err
	}
	// confirm Logger is ready to be used by binding user's oneuptimeLogger
	logger := CurrentLogger()
	logger.BindOneUptimeLogger(currentOneUptimeLogger)

	return nil
}

func LogInfo(content interface{}, tags []string) (LoggerResponse, error) {

	if content == nil {
		return LoggerResponse{}, errors.New(ErrContentMissing)
	}

	// access oneuptime Logger and send an api request
	logger := CurrentLogger()
	var res, err = logger.MakeApiRequest(content, "info", tags)

	if err != nil {
		log.Fatalln(err)
	}
	return res, err
}

func LogWarning(content interface{}, tags []string) (LoggerResponse, error) {

	if content == nil {
		return LoggerResponse{}, errors.New(ErrContentMissing)
	}

	// access oneuptime Logger and send an api request
	logger := CurrentLogger()
	var res, err = logger.MakeApiRequest(content, "warning", tags)

	if err != nil {
		log.Fatalln(err)
	}
	return res, err
}
func LogError(content interface{}, tags []string) (LoggerResponse, error) {

	if content == nil {
		return LoggerResponse{}, errors.New(ErrContentMissing)
	}

	// access oneuptime Logger and send an api request
	logger := CurrentLogger()
	var res, err = logger.MakeApiRequest(content, "error", tags)

	if err != nil {
		log.Fatalln(err)
	}
	return res, err
}
