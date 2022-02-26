
let accountsUrl = window.location.origin+'/accounts';
let backendUrl = window.location.hostname==='localhost'? 'http://localhost:3002': window.location.origin+'/api'


//eslint-disable-next-line
function loginUrl(extra: $TSFixMe) {
    if (extra) {
        window.location.href = `${accountsUrl}/login${extra}`;
    }
    else {
        window.location.href = `${accountsUrl}/login`;
    }
}
//eslint-disable-next-line
function registerUrl(params: $TSFixMe) {
    if (params) {
        window.location.href = `${accountsUrl}/register${params}`;
    }
    else {
        window.location.href = `${accountsUrl}/register`;
    }
}
//eslint-disable-next-line
function formUrl() {
    return `${backendUrl}/lead/`;
}

