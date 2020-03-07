# Licencing Project

## Getting Started
Please follow the guidelines below to set up a copy of this project locally on your machine for development and testing purposes. 

### First steps

Your can get a copy of this project by using the;
* git clone command

Using the terminal, move into the root folder of this project, move into the 'licensing' project folder and then run

```
npm install

```
to install required dependencies.

### Furthermore
A secret variable is required for both the Airtable configuration and token generation at license confirmation. Therefore, on your project directory:
* Create an env file
* Inside .env file, type the following : 

```
AIRTABLE_API_KEY = "******"
AIRTABLE_BASE_ID = "******"
TOKEN_SECRET="******"
```
*N/B: The secret variable can be any text of your choice*

### Testing
To start the API server run

```
npm start
```
You can then start making requests via postman.

To test the application on your local machine, run

```
npm test
```

## API Endpoints

### License confirmation
* Request Method: POST
* URL: https://localhost:5000/api/license

Request body should contain license and email; the API will return a token for the user.
* Sample Request: {
                    "license": "user license",
                    "email": "user email"
                }
* Sample Response: {
                    "token": "The generate web token"   
                }

## Modules used

* [mocha](http://mochajs.org) - A test framework for automated tests.
* [jsonwebtoken](https://www.npmjs.com/package/jsonwebtoken) - Token generation and verification.
* [chai](https://www.npmjs.com/package/chai) - An assertion library.

## Author

* **Okeke Chekwube Julius**
