package io.hackerbay.fyipe;

import io.hackerbay.fyipe.model.Frame;
import io.hackerbay.fyipe.model.StackTrace;
import io.hackerbay.fyipe.model.TrackerOption;
import io.hackerbay.fyipe.util.FileReader;

import java.net.URL;
import java.util.*;

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
    private HashMap contentCache = new HashMap(100);
    private FileReader fileReader = new FileReader();

    
    public Util(TrackerOption options) {
        this.options = options;
    }
    public String generateV4EventId() {
        UUID uuid = UUID.randomUUID();
        return uuid.toString();
    }
    public StackTrace getExceptionStackTrace(Exception exception) {
        String message = exception.getMessage();
        StackTraceElement[] stackTraceElement = exception.getStackTrace();

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

        // TODO check for code capture and action
//        this.getErrorCodeSnippet(stackTrace);
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

        // reversing the list
        Collections.reverse(frameArrayList);

        return  frameArrayList;
    }
    private void getErrorCodeSnippet(StackTrace stackTrace) {
        ArrayList<Frame> frameArrayList = stackTrace.getStackTraceFrame();
        this.getFrameContent(frameArrayList.get(0));
        // TODO get content related to each frame

        // TODO update content of each frame
    }
    private Frame getFrameContent(Frame frame) {
        Boolean isFile = false;
        // check what it starts with
        isFile = frame.getFileName().startsWith("file");
        if(isFile) {
            String fileName = frame.getFileName().substring(5);
//            fileName = fileName.replace(".java", ".class");
            // TODO try to get the file from the cache
            String content = fileReader.readFile(fileName);
        }

        return frame;
    }
    
}
