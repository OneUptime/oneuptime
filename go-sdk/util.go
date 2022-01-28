package oneuptime

import (
	"bufio"
	"fmt"
	"log"
	"os"
	"reflect"
	"runtime"
	"strconv"
)

func GetExceptionStackTrace(exception error, options TrackerOption) *Stacktrace {
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

	// if user allowed code snippet, get code snippet for frame
	if options.CaptureCodeSnippet {
		frames = getErrorCodeSnippet(frames)
	}

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

func getErrorCodeSnippet(frames []Frame) []Frame {

	var updatedFrames []Frame
	for _, frame := range frames {
		// try to read the file content and save to frame
		lines := readFileContent(frame)

		newFrame := addCodeSnippetToFrame(lines, frame, 5) // 5 lines by default

		updatedFrames = append(updatedFrames, newFrame)

	}

	return updatedFrames
}

func readFileContent(frame Frame) []string {
	fileName := frame.FileName

	// try to read the file content and save to frame
	file, errFile := os.Open(fileName)
	if errFile != nil {
		log.Fatal(errFile)
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	var lines []string
	// optionally, resize scanner's capacity for lines over 64K, see next example
	for scanner.Scan() {
		lines = append(lines, scanner.Text())
	}

	return lines
}

func addCodeSnippetToFrame(lines []string, frame Frame, linesOfContext int) Frame {
	if len(lines) < 1 {
		return frame
	}

	var lineNumber int
	var errconv error

	if frame.LineNumber != "" {
		lineNumber, errconv = strconv.Atoi(frame.LineNumber)
		if errconv != nil {
			panic(errconv)
		}
	}

	maxLines := len(lines)

	sourceLine := max(min(maxLines, lineNumber-1), 0)

	// attach the line before the error
	frame.LinesBeforeError = getPathOfLines(lines, max(0, sourceLine-linesOfContext), linesOfContext)

	// attach the line after the error
	frame.LinesAfterError = getPathOfLines(
		lines, min(sourceLine+1, maxLines), 1+linesOfContext,
	)

	// attach the error line
	frame.ErrorLine = lines[min(maxLines-1, sourceLine)]

	return frame
}

func getPathOfLines(lines []string, start int, count int) []string {
	terminal := start + count
	return lines[start:terminal]
}
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
