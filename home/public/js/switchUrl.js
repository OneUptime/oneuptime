
let accountsUrl = window.location.origin+'/accounts';
let backendUrl = window.location.origin+'/api'

//eslint-disable-next-line
function loginUrl(extra) {
    if (extra) {
        window.location.href = `${accountsUrl}/login${extra}`;
    }
    else {
        window.location.href = `${accountsUrl}/login`;
    }
}
//eslint-disable-next-line
function registerUrl(params) {
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

