package io.hackerbay.fyipe;
import java.lang.Thread.UncaughtExceptionHandler;

public class FyipeUncaughtExceptionHandler implements Thread.UncaughtExceptionHandler{
    private final FyipeTracker fyipeTracker;

    private final UncaughtExceptionHandler existingHandler;

    public FyipeUncaughtExceptionHandler(FyipeTracker fyipeTracker, UncaughtExceptionHandler existingHandler) {
        this.fyipeTracker = fyipeTracker;
        this.existingHandler = existingHandler;
    }

    @Override
    public void uncaughtException(Thread thread, Throwable throwable) {
        fyipeTracker.captureException((Exception) throwable);
        if (existingHandler != null) {
            existingHandler.uncaughtException(thread, throwable);
        }
    }
}
