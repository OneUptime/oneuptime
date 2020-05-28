function getParentRoute(childRoute, projectId = null) {
    const urlParts = childRoute.split('/');
    const lastNode = urlParts.pop();
    if (lastNode === 'alert-log') {
        return urlParts.join('/').concat('/on-call');
    }
    if (childRoute.includes('sub-project') && childRoute.includes('schedule')) {
        const urlParts = childRoute.split('/').slice(0, 4);
        return urlParts.join('/').concat('/on-call');
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
    return urlParts.join('/');
}

export default getParentRoute;
