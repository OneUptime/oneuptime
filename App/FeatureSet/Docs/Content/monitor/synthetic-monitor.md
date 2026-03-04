# Synthetic Monitor

Synthetic monitoring is a way to proactively monitor your applications by simulating user interactions. You can create a synthetic monitor to check the availability and performance of your applications from different locations around the world.

#### Example

The following example shows how to use a Synthetic Monitor:

```javascript

// Objects available in the context of the script are:

// - axios: Axios module to make HTTP requests
// - page: Playwright Page object to interact with the browser
// - browserType: Browser type in the current run context - Chromium, Firefox, Webkit
// - screenSizeType: Screen size type in the current run context - Mobile, Tablet, Desktop
// - browser: Playwright Browser object to interact with the browser

// You can use these objects to interact with the browser and make HTTP requests.

await page.goto('https://playwright.dev/');

// Playwright Documentation here: https://playwright.dev/docs/intro

// Here are some of the variables that you can use in the context of the monitored object:

console.log(browserType) // This will list the browser type in the current run context - Chromium, Firefox, Webkit

console.log(screenSizeType) // This will list the screen size type in the current run context - Mobile, Tablet, Desktop

// Playwright page object belongs to that specific browser context, so you can use it to interact with the browser.

// To take screenshots,

const screenshots = {};

screenshots['screenshot-name'] = await page.screenshot(); // you can save multiple screenshots and have them with different names.

// when you want to return a value, use return statement with data as a prop. You can also add screenshots in the screenshots array.

// To log data, use console.log
// console.log('Hello World');

// You also have browser context available in the script. You can use it to interact with the browser if you need to (for example, to create a new page or dealing with popups).


return {
    data: 'Hello World',
    screenshots: screenshots 
};
```

### Use of Playwright

We use Playwright to simulate user interactions. You can use Playwright `page` object to interact with the browser and perform actions like clicking buttons, filling forms, and taking screenshots. 

### Screenshots

You can take screenshots of the page at any point in the script. You can take multiple screenshots and return them in the screenshots array. These screenshots will be available in the OneUptime Dashboard for that specific monitor.

```javascript

// To take screenshots,

const screenshots = {};

screenshots['screenshot-name'] = await page.screenshot();

return {
    data: 'Hello World',
    screenshots: screenshots 
};

```


### Using Monitor Secrets

#### Adding a secret

To add a secret, please go to OneUptime Dashboard -> Project Settings -> Monitor Secrets -> Create Monitor Secret.

![Create Secret](/docs/static/images/CreateMonitorSecret.png)

You can select which monitors have access to the secret. In this case we added `ApiKey` secret and selected monitors to have access to it.

**Please note**: Secrets are encrypted and stored securely. If you lose the secret, you will need to create a new secret. You cannot view or update the secret after its saved. 

#### Using a secret

To use Monitor Secrets in the script, you can use `monitorSecrets` object in the context of the script. You can use it to access the secrets that you have added to the monitor.

```javascript
// if your secret is of type string then you need to wrap it in quotes
let stringSecret = '{{monitorSecrets.StringSecret}}';

// if your secret is of type number or boolean then you can use it directly
let numberSecret = {{monitorSecrets.NumberSecret}};

// if your secret is of type boolean then you can use it directly
let booleanSecret = {{monitorSecrets.BooleanSecret}};

// you can even console log to see if the secrets is being fetched correctly
console.log(stringSecret); 
```

### Modules available in the script
- `browser`: You can use this module to interact with the browser. It is a Playwright Browser object that allows you to create new pages, close pages, and perform other browser-related actions.
- `page`: You can use this module to interact with the browser. It is a Playwright Page object that allows you to perform actions like clicking buttons, filling forms, and taking screenshots.
- `axios`: You can use this module to make HTTP requests. It is a promise-based HTTP client for the browser and Node.js.
- `crypto`: You can use this module to perform cryptographic operations. It is a built-in Node.js module that provides cryptographic functionality that includes a set of wrappers for OpenSSL's hash, HMAC, cipher, decipher, sign, and verify functions.
- `console.log`: You can use this module to log data to the console. This is useful for debugging purposes.
- `http`: You can use this module to make HTTP requests. It is a built-in Node.js module that provides an HTTP client and server.
- `https`: You can use this module to make HTTPS requests. It is a built-in Node.js module that provides an HTTPS client and server.

### Things to consider

- You only have `page` object available in the context of the script. This is from Playwright Page class. You can use it to run all the interactions with the browser.
- You can use `console.log` to log the data in the console. This will be available in the logs section of the monitor.
- You can return the data from the script using the `return` statement. You can also return screenshots in the screenshots array.
- You can use `browserType` and `screenSizeType` variables to get the browser type and screen size type in the current run context. Feel free to use them in your script if you like. 
- This is a JavaScript script, so you can use all the JavaScript features in the script.
- You can use `axios` module to make HTTP requests in the script. You can use it to make API calls from the script.
- If you are using oneuptime.com, you will always have the latest version of Playwright & browsers available in the context of the script. If you're self-hosting, please make sure you update the probes to have the latest version of Playwright and the browsers. 
- Timeout for the script is 2 minutes. If the script takes more than 2 mins, it will be terminated.