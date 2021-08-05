package fyipe

import (
	"fmt"
	"reflect"
	"runtime"
)

func GetExceptionStackTrace(exception error) *Stacktrace {
	// Get the method out of the package used to manage the error
	currentMethod := getStackTraceMethod(exception)

	var programCounters []uintptr
	if currentMethod.IsValid() {
		// Get the programcounters out if it if current method is valid
		programCounters = getProgramCountersOutOfMethod(currentMethod)
	} else {
		// TODO handle method where we didnt handle the package yet
		return nil
	}

	if len(programCounters) == 0 {
		return nil // no program counter or we couldnt extract the program counter so its empty
	}

	// extract frames from the callersframes with the program counters
	frames := extractFrameFromProgramCounter(programCounters)

	// set the resulting frames in the stacktrace object

	finalStackTrace := Stacktrace{
		Frames: frames,
	}

	// return stacktrace
	return &finalStackTrace
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

func getProgramCountersOutOfMethod(method reflect.Value) []uintptr {

	stackTrace := method.Call(make([]reflect.Value, 0))[0]

	if stackTrace.Kind() != reflect.Slice { // if not an array, we end the show
		return nil
	}
	var programCounterHolder []uintptr
	for i := 0; i < stackTrace.Len(); i++ {
		currentStack := stackTrace.Index(i)

		// if we have justt th program counters, we save to the array
		if currentStack.Kind() == reflect.Uintptr {
			programCounterHolder = append(programCounterHolder, uintptr(currentStack.Uint()))
		}

		if currentStack.Kind() == reflect.Struct { // if struct, we get the field containing the program counter
			programCounterHolder = append(programCounterHolder, uintptr(currentStack.FieldByName("ProgramCounter").Uint()))
		}
	}

	return programCounterHolder
}

func extractFrameFromProgramCounter(programCounters []uintptr) []Frame {
	callersFrames := runtime.CallersFrames(programCounters)
	var frames []Frame

	for {
		callerFrame, more := callersFrames.Next()

		newFrame := Frame{
			MethodName: callerFrame.Function,
			FileName:   callerFrame.File,
			LineNumber: fmt.Sprint(callerFrame.Line),
		}
		frames = append(frames, newFrame)

		if !more {
			break
		}
	}

	return frames
}
