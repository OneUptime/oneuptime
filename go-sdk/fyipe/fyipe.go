package fyipe

import (
	"errors"
	"log"
	"reflect"
)

type LoggerOptions struct {
	ApplicationLogId  string
	ApplicationLogKey string
	ApiUrl            string
}

type FyipeLogger struct {
	options LoggerOptions
}

func NewFyipeLogger(options LoggerOptions) (*FyipeLogger, error) {
	if options.ApplicationLogId == "" {
		return nil, errors.New("Application Log ID cant be empty")
	}
	if options.ApplicationLogKey == "" {
		return nil, errors.New("Application Log Key cant be empty")
	}
	if options.ApiUrl == "" {
		return nil, errors.New("API URL cant be empty")
	}
	// set up API URL
	options.ApiUrl = options.ApiUrl + "/application-log/" + options.ApplicationLogId + "/log"

	fyipeLogger := FyipeLogger{
		options: options,
	}
	return &fyipeLogger, nil
}

// Init initializes the SDK with loggerOptions.
// it returns the error if any of the options are invalid
func Init(options LoggerOptions) (*FyipeLogger, error) {
	fyipeLogger, err := NewFyipeLogger(options)
	if err != nil {
		return nil, err
	}
	// TODO confirm Logger is ready to be used
	log.Printf(reflect.TypeOf(fyipeLogger).String())
	return fyipeLogger, nil
}

// func validateItems(content, tags) {
// 	// get the class of the content and convert to string for comparison
// 	contentType = reflect.TypeOf(content)
// 	tagType = nil
// 	if(tags != nil) {
// 		tagType= reflect.TypeOf(tags)
// 	}

// 	// check if content type is not a string or hash object
// 	if(!((contentType != "string") || (contentType.eql? "Hash")))
// 		raise "Invalid Content to be logged"
// 	end

// 	# check if tag type is available and its not a string or hash object
// 	if(tagType != nil && (!((tagType.eql? "String") || (tagType.eql? "Array"))))
// 		raise "Invalid Content Tags to be logged"
// 	end
// end
// }

// func Log(content string, tags []string) {
// 	makeApiRequest(content, "info", tags)
// }

// func makeApiRequest(data string, tagType string, tags []string) {
// 	postBody, _ := json.Marshal(map[string]string{
// 		"content":           data,
// 		"type":              tagType,
// 		"applicationLogKey": applicationLogKey,
// 	})
// 	responseBody := bytes.NewBuffer(postBody)

// 	resp, err := http.Post(apiUrl, "application/json", responseBody)

// 	if err != nil {
// 		log.Fatalf("An Error Occured %v", err)
// 	}

// 	body, err := ioutil.ReadAll(resp.Body)
// 	if err != nil {
// 		log.Fatalln(err)
// 	}

// 	sb := string(body)
// 	log.Printf(sb)
// }
