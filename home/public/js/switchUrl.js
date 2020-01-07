
var accountsUrl = '';
var backendUrl = '';
if (window.location.href.indexOf('localhost') > -1) {
    accountsUrl = 'http://localhost:3003';
    backendUrl = 'http://localhost:3002';
} else if (window.location.href.indexOf('staging') > -1) {
    accountsUrl = 'https://staging-accounts.fyipe.com';
    backendUrl = 'https://staging-api.fyipe.com';
} else {
    accountsUrl = 'https://accounts.fyipe.com';
    backendUrl = 'https://api.fyipe.com';
}
//eslint-disable-next-line
function loginUrl(extra){
    if(extra){
        window.location.href = `${accountsUrl}/login${extra}`;
    }
    else{
    window.location.href = `${accountsUrl}/login`;
    }
}
//eslint-disable-next-line
function registerUrl(params){
    if(params){
        window.location.href = `${accountsUrl}/register${params}`;
    }
    else{
    window.location.href = `${accountsUrl}/register`;
    }
}
//eslint-disable-next-line
function formUrl(){
    return `${backendUrl}/lead/`;
}

