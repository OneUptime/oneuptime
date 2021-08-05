package fyipe

import "reflect"

type Stacktrace struct {
	Frames []Frame
}
type Frame struct {
	MethodName string
	FileName   string
	FileNo     string
}

func GetExceptionStackTrace(exception error) *Stacktrace {
	// TODO Get the method out of the package used to manage the error
	currentMethod := getStackTraceMethod(exception)

	// TODO Get the pointcounters out if it

	// TODO extract frames from the callersframes with the point counters

	// TODO set the resulting frames in the stacktrace object

	// TODO set other properties of the stacktrace object

	// TODO return stacktrace
}

func getStackTraceMethod(exception error) reflect.Value {

	var method reflect.Value
	// try to get the method from the two package

	// if error is managed by https://github.com/go-errors/errors
	methodGetStackFrame := reflect.ValueOf(exception).MethodByName("StackFrames")

	// if error is managed by https://github.com/pkg/errors
	methodGetStackTrace := reflect.ValueOf(exception).MethodByName("StackTrace")

	if methodGetStackFrame.IsValid() {
		method = methodGetStackFrame
	}

	if methodGetStackTrace.IsValid() {
		method = methodGetStackTrace
	}

	return method
}
