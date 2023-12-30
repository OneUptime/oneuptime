// This is basicaly meant to get a cookie by name
var getCookiebyName = function (name) {
    var pair = document.cookie.match(new RegExp(name + '=([^;]+)'));
    return !!pair ? pair[1] : null;
};