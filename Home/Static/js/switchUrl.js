let accountsUrl = window.location.origin + "/accounts";

// Determine the backend URL based on whether the hostname is 'localhost'
let backendUrl =
  window.location.hostname === "localhost"
    ? "http://localhost:3002"
    : window.location.origin + "/api";

// Redirect user to login page with optional extra path
//eslint-disable-next-line
function loginUrl(extra) {
  if (extra) {
    window.location.href = `${accountsUrl}/login${extra}`;
  } else {
    window.location.href = `${accountsUrl}/login`;
  }
}

// Redirect user to register page with optional query parameters
//eslint-disable-next-line
function registerUrl(params) {
  if (params) {
    window.location.href = `${accountsUrl}/register${params}`;
  } else {
    window.location.href = `${accountsUrl}/register`;
  }
}

// Get the URL for submitting a lead form to the backend
//eslint-disable-next-line
function formUrl() {
  return `${backendUrl}/lead/`;
}