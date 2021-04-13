package io.hackerbay.fyipe;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.servlet.HandlerExceptionResolver;
import org.springframework.web.servlet.ModelAndView;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

@Order(Ordered.HIGHEST_PRECEDENCE)
@ControllerAdvice
public class FyipeHandlerExceptionResolver implements HandlerExceptionResolver {

    private FyipeTracker fyipeTracker;

    @Autowired
    public FyipeHandlerExceptionResolver(FyipeTracker fyipeTracker) {
        this.fyipeTracker = fyipeTracker;
        System.out.println("Constructor Exception here");
    }
    @Override
    public ModelAndView resolveException(HttpServletRequest httpServletRequest, HttpServletResponse httpServletResponse, Object o, Exception exception) {
        fyipeTracker.captureException(exception);
        return null;
    }
}
