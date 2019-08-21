var faker = require('faker');

var ACCOUNTS_URL = 'http://localhost:3003';
var DASHBOARD_URL = 'http://localhost:3000';
var user = faker.helpers.createCard();
var cvv = '542';
var expiryDate = '09/2020';

var headlessMode = true;

function generateRandomBusinessEmail(){
    return `${Math.random().toString(36).substring(7)}@${Math.random().toString(36).substring(5)}.com`;
}

function generatePassword() {
    return Math.random().toString(36).substring(7);
}

function generateWrongEmail() {
    return Math.random().toString(36).substring(8) + '@' + Math.random().toString(24).substring(8) + '.com';
}

var cardNumber = '4111111111111111';

module.exports = { ACCOUNTS_URL, DASHBOARD_URL, user, cardNumber, cvv, expiryDate, generatePassword, generateWrongEmail, headlessMode, generateRandomBusinessEmail };