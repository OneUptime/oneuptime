package io.hackerbay.fyipe;

import io.hackerbay.fyipe.model.Frame;
import io.hackerbay.fyipe.model.StackTrace;
import io.hackerbay.fyipe.model.TrackerOption;
import io.hackerbay.fyipe.util.FileReader;

import java.net.URL;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
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
    private HashMap contentCache = new HashMap(100);
    private FileReader fileReader = new FileReader();

    
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

        // TODO check for code capture and action
        this.getErrorCodeSnippet(stackTrace);
        return stackTrace;
    }
    private ArrayList<Frame> buildFrame(StackTraceElement[] stackTraceElements) {
        ArrayList<Frame> frameArrayList = new ArrayList<>();
        System.out.println(stackTraceElements[0].getClassName());
        System.out.println(stackTraceElements[1].getClassName());
        Arrays.asList(stackTraceElements).stream().forEach(e -> {
            String className = e.getClassName().replace(".", "/");
            URL u = getClass().getResource(className+ ".java");
            if(u == null) {
                u = getClass().getClassLoader().getResource(className+ ".class");
            }
            frameArrayList.add(
                    new Frame(
                            e.getMethodName(),
                            e.getLineNumber(),
                            u.toString()
                    )
            );

        });

        return  frameArrayList;
    }
    private void getErrorCodeSnippet(StackTrace stackTrace) {
        ArrayList<Frame> frameArrayList = stackTrace.getStackTraceFrame();
        this.getFrameContent(frameArrayList.get(0));
        // TODO get content related to each frame

        // TODO update content of each frame
    }
    private Frame getFrameContent(Frame frame) {
        System.out.println(frame);
        Boolean isFile = false;
        // check what it starts with
        isFile = frame.getFileName().startsWith("file");
        if(isFile) {
            String fileName = frame.getFileName().substring(5);
//            fileName = fileName.replace(".java", ".class");
            // TODO try to get the file from the cache
            String content = fileReader.readFile(fileName);
            System.out.println("content" + content);
        }

        return frame;
    }
    
}
