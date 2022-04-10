package io.hackerbay.oneuptime;

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
public class OneUptimeHandlerExceptionResolver implements HandlerExceptionResolver {

    private OneUptimeTracker oneuptimeTracker;

    @Autowired
    public OneUptimeHandlerExceptionResolver(OneUptimeTracker oneuptimeTracker) {
        this.oneuptimeTracker = oneuptimeTracker;
    }
    @Override
    public ModelAndView resolveException(HttpServletRequest httpServletRequest, HttpServletResponse httpServletResponse, Object o, Exception exception) {
        oneuptimeTracker.captureException(exception);
        return null;
    }
}
