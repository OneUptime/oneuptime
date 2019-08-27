import isEmail from 'sane-email-validation';
import validUrl from 'valid-url';
import valid from 'card-validator';

let apiUrl = null;
let dashboardUrl = null;

// if (window.location.href.indexOf('localhost') > -1) {
//     apiUrl = 'http://localhost:3002';
//     dashboardUrl = 'http://localhost:3000'
// } else if (window.location.href.indexOf('staging') > -1) {
//     apiUrl = 'https://staging-api.fyipe.com';
//     dashboardUrl = 'http://staging-dashboard.fyipe.com'
// } else {
//     apiUrl = 'https://api.fyipe.com';
//     dashboardUrl = 'https://fyipe.com';
// }

if (!isServer) {
    if (window.location.href.indexOf('localhost') > -1) {
        apiUrl = 'http://localhost:3002';
        dashboardUrl = 'http://localhost:3000';
    } else {
        apiUrl = 'http://backend:3002';
        dashboardUrl = 'http://dashboard:3000';
    }
}


export const API_URL = apiUrl;

export const DASHBOARD_URL = dashboardUrl;

export const User = {

  getAccessToken() {
    return localStorage.getItem('access_token');
  },

  setAccessToken(token) {
    localStorage.setItem('access_token', token);
  },

  setUserId(id) {
    localStorage.setItem('id', id);
  },

  getUserId() {
    return localStorage.getItem('id');
  },

  clear() {
    localStorage.clear();
  },

  removeUserId() {
    localStorage.removeItem('id');
  },

  removeAccessToken() {
    localStorage.removeItem('token');
  },

  isLoggedIn() {
    return Boolean(localStorage.getItem('access_token'));
  }

};

// Data validation Util goes in here.
export const Validate = {

  isDomain(domain) {
      return domain.search(/\./) >= 0;
  },

  url(url) {
      return validUrl.isUri(url);
  },

  text(text) {

      if (!text || text.trim() === '') {
          return false;
      }

      return true;
  },

  email(email) {
      if (this.text(email)) return isEmail(email);

return false;
  },

  compare(text1, text2) {
      return text1 === text2;
  },

  card(cardNumber) {
      const numberValidation = valid.number(cardNumber);

      if (!numberValidation.isPotentiallyValid) {
          return false;
      }

      return true;
  },

  cardExpiration(expiry) {
      const numberValidation = valid.expirationDate(expiry);

      if (!numberValidation.isPotentiallyValid) {
          return false;
      }

      return true;
  },

  cvv(cvv) {
      const numberValidation = valid.cvv(cvv);

      if (!numberValidation.isPotentiallyValid) {
          return false;
      }

      return true;
  },

  postalCode(postalCode) {
      const numberValidation = valid.postalCode(postalCode);

      if (!numberValidation.isPotentiallyValid) {
          return false;
      }

      return true;
  }
}


export function getQueryVar (variable,url) {
    if (!url) url = window.location.href;
    variable = variable.replace(/[[\]]/g, '\\$&');
    var regex = new RegExp('[?&]' + variable + '(=([^&#]*)|&|#|$)'),
        results = regex.exec(url);
    if (!results) return null;
    if (!results[2]) return '';
    return decodeURIComponent(results[2].replace(/\+/g, ' '));
}

export const bindRaf = (fn) => {
    let isRunning = null;
    let args = null;

    const run = () => {
        isRunning = false;
        fn(...args);
    };

    return function (...invokingArguments) {
        args = invokingArguments;

        if (isRunning) {
            return;
        }

        isRunning = true;
        requestAnimationFrame(run);
    };
};