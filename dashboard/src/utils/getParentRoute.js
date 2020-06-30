function getParentRoute(childRoute, projectId = null, type) {
    const urlParts = childRoute.split('/');
    const lastNode = urlParts.pop();
    if (lastNode === 'alert-log') {
        return urlParts.join('/').concat('/on-call');
    }
    if (lastNode === 'incident-log' || lastNode === 'application-log') {
        return urlParts.join('/').concat('/monitoring');
    }
    if (childRoute.includes('sub-project') && childRoute.includes('schedule')) {
        const urlParts = childRoute.split('/').slice(0, 4);
        return urlParts.join('/').concat('/on-call');
    }
    if (childRoute.includes('issues')) {
        const urlParts = childRoute.split('/');
        urlParts.pop();
        urlParts.pop();
        return urlParts.join('/');
    }
    if (
        childRoute.includes('sub-project') &&
        childRoute.includes('status-page')
    ) {
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
    if (type === 'applicationSecurityId') {
        const urlParts = childRoute.split('/');
        urlParts.splice(urlParts.indexOf('application') + 1, urlParts.length);
        return urlParts.join('/');
    }
    if (type === 'containerSecurityId') {
        const urlParts = childRoute.split('/');
        urlParts.splice(urlParts.indexOf('container') + 1, urlParts.length);
        return urlParts.join('/');
    }
    return urlParts.join('/');
}

export default getParentRoute;
