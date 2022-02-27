function getParentRoute(
    childRoute: $TSFixMe,
    projectId = null,
    type: $TSFixMe
) {
    const urlParts = childRoute.split('/');
    const lastNode = urlParts.pop();
    if (lastNode === 'alert-log') {
        return urlParts.join('/').concat('/on-call');
    }
    if (type === 'project-incidents') {
        const urlParts = childRoute.split('/');
        urlParts.pop();
        return urlParts.join('/');
    }
    if (type === 'scheduledEvents') {
        const urlParts = childRoute.split('/');
        urlParts.pop();
        return urlParts.join('/');
    }
    if (
        lastNode === 'incident-log' ||
        lastNode === 'application-log' ||
        lastNode === 'error-tracker'
    ) {
        return urlParts.join('/').concat('/monitoring');
    }
    if (type === 'incidents') {
        const urlParts = childRoute.split('/');
        urlParts.splice(
            urlParts.indexOf('incidents'),
            urlParts.length,
            'monitoring'
        );
        return urlParts.join('/');
    }
    if (type === 'incident-log') {
        const urlParts = childRoute.split('/');
        urlParts.splice(
            urlParts.indexOf('incidents'),
            urlParts.length,
            'incident-log'
        );
        return urlParts.join('/');
    }
    if (type === 'announcement') {
        const urlParts = childRoute.split('/');
        urlParts.splice(urlParts.length - 1, 1);
        return urlParts.join('/');
    }
    if (type === 'application-log') {
        const urlParts = childRoute.split('/');
        urlParts.splice(
            urlParts.indexOf('application-logs'),
            urlParts.length,
            'monitoring'
        );
        return urlParts.join('/');
    }
    if (type === 'application-logs') {
        const urlParts = childRoute.split('/');
        urlParts.splice(
            urlParts.indexOf('application-logs'),
            urlParts.length,
            'application-log'
        );
        return urlParts.join('/');
    }
    if (type === 'error-tracker') {
        const urlParts = childRoute.split('/');
        urlParts.splice(
            urlParts.indexOf('error-trackers'),
            urlParts.length,
            'monitoring'
        );
        return urlParts.join('/');
    }
    if (type === 'error-trackers') {
        const urlParts = childRoute.split('/');
        urlParts.splice(
            urlParts.indexOf('error-trackers'),
            urlParts.length,
            'error-tracker'
        );
        return urlParts.join('/');
    }
    if (childRoute.includes('schedule')) {
        const urlParts = childRoute.split('/').slice(0, 4);
        return urlParts.join('/').concat('/on-call');
    }
    if (childRoute.includes('issues')) {
        const urlParts = childRoute.split('/');
        urlParts.pop();
        urlParts.pop();
        return urlParts.join('/');
    }
    if (childRoute.includes('status-page')) {
        const urlParts = childRoute.split('/').slice(0, 4);
        return urlParts.join('/').concat('/status-pages');
    }
    if (childRoute.includes('profile')) {
        const urlParts = childRoute.split('/').slice(0, 2);
        return urlParts.join('/').concat('/project/', projectId, '/team');
    }
    if (childRoute.includes('incidents')) {
        const urlParts = childRoute.split('/');
        urlParts.pop();
        urlParts.pop();
        return urlParts.join('/').concat('/incident-log');
    }
    if (childRoute.includes('application-logs')) {
        const urlParts = childRoute.split('/');
        urlParts.pop();
        urlParts.pop();
        return urlParts.join('/').concat('/application-log');
    }
    if (childRoute.includes('error-trackers')) {
        const urlParts = childRoute.split('/');
        urlParts.pop();
        urlParts.pop();
        let url = '';
        childRoute.includes('events')
            ? (url = urlParts.join('/'))
            : (url = urlParts.join('/').concat('/error-tracker'));
        return url;
    }
    if (type === 'component') {
        const urlParts = childRoute.split('/');
        urlParts.splice(
            urlParts.indexOf('security'),
            urlParts.length,
            'monitoring'
        );
        return urlParts.join('/');
    }
    if (lastNode === 'container' || lastNode === 'application') {
        return urlParts.join('/').concat('/container');
    }
    if (type === 'applicationSecuritySlug') {
        const urlParts = childRoute.split('/');
        urlParts.splice(urlParts.indexOf('application') + 1, urlParts.length);
        return urlParts.join('/');
    }
    if (type === 'containerSecuritySlug') {
        const urlParts = childRoute.split('/');
        urlParts.splice(urlParts.indexOf('container') + 1, urlParts.length);
        return urlParts.join('/');
    }
    if (type === 'basic') {
        const urlParts = childRoute.split('/');
        urlParts.splice(
            urlParts.indexOf('settings'),
            urlParts.length,
            'monitoring'
        );
        return urlParts.join('/');
    }
    if (type === 'performance-tracker') {
        const urlParts = childRoute.split('/');
        urlParts.pop();
        return urlParts.join('/');
    }
    if (type === 'component-tracker') {
        const urlParts = childRoute.split('/');
        urlParts.splice(
            urlParts.indexOf('performance-tracker'),
            urlParts.length,
            'monitoring'
        );
        return urlParts.join('/');
    }
    return urlParts.join('/');
}

export default getParentRoute;
