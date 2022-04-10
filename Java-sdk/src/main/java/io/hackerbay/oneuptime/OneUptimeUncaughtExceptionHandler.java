package io.hackerbay.oneuptime;
import java.lang.Thread.UncaughtExceptionHandler;

public class OneUptimeUncaughtExceptionHandler implements Thread.UncaughtExceptionHandler{
    private final OneUptimeTracker oneuptimeTracker;

    private final UncaughtExceptionHandler existingHandler;

    public OneUptimeUncaughtExceptionHandler(OneUptimeTracker oneuptimeTracker, UncaughtExceptionHandler existingHandler) {
        this.oneuptimeTracker = oneuptimeTracker;
        this.existingHandler = existingHandler;
    }

    @Override
    public void uncaughtException(Thread thread, Throwable throwable) {
        oneuptimeTracker.captureException((Exception) throwable);
        if (existingHandler != null) {
            existingHandler.uncaughtException(thread, throwable);
        }
    }
}
