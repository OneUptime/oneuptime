
let accountsUrl = window.location.origin + '/accounts';
let backendUrl = window.location.hostname === 'localhost' ? 'http://localhost:3002' : window.location.origin + '/api'


function loginUrl(extra: string) {
    if (extra) {
        window.location.href = `${accountsUrl}/login${extra}`;
    }
    else {
        window.location.href = `${accountsUrl}/login`;
    }
}

function registerUrl(params: string) {
    if (params) {
        window.location.href = `${accountsUrl}/register${params}`;
    }
    else {
        window.location.href = `${accountsUrl}/register`;
    }
}
function formUrl() {
    return `${backendUrl}/lead/`;
}

