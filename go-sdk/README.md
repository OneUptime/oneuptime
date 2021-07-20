# Fyipe SDK

A fyipe sdk for application logger that can be used to send logs about your applications created on your fypie dashboard which can also used for error tracking

## Installation

### Go Install

Via Go

```
 // TODO how to install package
```

<a name="module_api"></a>

## Basic Usage for Logging

```go
// TODO fix import properly
import (
    "fmt"
)

// constructor
option := LoggerOptions{
    ApiUrl: "API_URL",  // https://fyipe.com/api
    ApplicationLogId: "APPLICATION_LOG_ID",
    ApplicationLogKey: "APPLICATION_LOG_KEY",
}

// initalization
setupResponse := Init(option)

// Sending a string log to the server
item := "This is a simple log"

// empty tag
var tag = []string{}

logResponse, logErr := LogInfo(item, tag)

// response after logging a request
fmt.PrintF("Log Info response: %v", logResponse)
fmt.PrintF("Log Info error: %v", logErr)


// Sending a struct log to the server
type StructA struct {
    Name string
    Location string
}
item := StructA{"Tony Lewinsky","Liverpool"}
// empty tag
var tag = []string{}

logResponse, logErr := LogInfo(item, tag)

// response after logging a request
fmt.PrintF("Log Info response: %v", logResponse)
fmt.PrintF("Log Info error: %v", logErr)

// alternatively, tags can be added to the logged item.
item := "This is a simple log"

// using a tag string
var tag = []string{"server-side-error"}
logResponse, logErr := LogWarning(item, tag)

// response after logging a request
fmt.PrintF("Log Warning response: %v", logResponse)
fmt.PrintF("Log Warning error: %v", logErr)

// Using an array of strings
var tags = []string{"server", "error"}

logResponse, logErr := LogError(item, tags)

// response after logging a request
fmt.PrintF("Log Error response: %v", logResponse)
fmt.PrintF("Log Error error: %v", logErr)
```
