package io.hackerbay.fyipe;

import io.hackerbay.fyipe.model.Frame;
import io.hackerbay.fyipe.model.StackTrace;
import io.hackerbay.fyipe.model.TrackerOption;

import java.util.ArrayList;
import java.util.UUID;
enum ErrorEventType {
    error,
    info,
    warning
}
enum ErrorObjectType {
    message,
    error,
    exception
}
public class Util {
    private TrackerOption options;

    
    public Util(TrackerOption options) {
        this.options = options;
    }
    public String generateV4EventId() {
        UUID uuid = UUID.randomUUID();
        return uuid.toString();
    }
    public StackTrace getExceptionStackTrace(Throwable throwable) {
        String message = throwable.getMessage();
        StackTraceElement[] stackTraceElement = throwable.getStackTrace();

        int lineNumber = stackTraceElement[0].getLineNumber();
        String fileName = stackTraceElement[0].getFileName();
        String className = stackTraceElement[0].getClassName();
        String methodName = stackTraceElement[0].getMethodName();

        StackTrace stackTrace = new StackTrace(
                methodName+" @ "+className,
                message,
                lineNumber
        );
        stackTrace.setStackTraceFrame(this.buildFrame(stackTraceElement));

        return stackTrace;
    }
    private ArrayList<Frame> buildFrame(StackTraceElement[] stackTraceElements) {
        ArrayList<Frame> frameArrayList = new ArrayList<>();
        for (int i = 0; i < stackTraceElements.length; i++) {
            frameArrayList.add(
                    new Frame(
                            stackTraceElements[i].getMethodName(),
                            stackTraceElements[i].getLineNumber(),
                            stackTraceElements[i].getFileName()
                    )
            );
        }
        return  frameArrayList;
    }
    
}
