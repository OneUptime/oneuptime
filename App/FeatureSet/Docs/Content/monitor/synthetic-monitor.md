# Synthetic Monitor

Synthetic monitoring is a way to proactively monitor your applications by simulating user interactions. You can create a synthetic monitor to check the availability and performance of your applications from different locations around the world.

#### Example

The following example shows how to use a Synthetic Monitor:

```javascript
// You can use axios module, and page object from Playwright here.
// Page Object is a class that represents a single page in a browser.

await page.goto('https://playwright.dev/');

// Playwright Documentation here: https://playwright.dev/docs/intro

// Here are some of the variables that you can use in the context of the monitored object:

console.log(browserType) // This will list the browser type in the current run context - Chromium, Firefox, Webkit

console.log(screenSizeType) // This will list the screen size type in the current run context - Mobile, Tablet, Desktop

// Playwright page object belongs to that specific browser context, so you can use it to interact with the browser.

// To take screenshots,

const screenshots = [];

const screenshot = {
    screenshotDataInBase64: (await page.screenshot()).toString('base64'), // returns base64 encoded image
    screenshotName: 'Playwright Screenshot'
};

// make sure you add it to screnshot array

screenshots.push(screenshot);

// when you want to return a value, use return statement with data as a prop. You can also add screenshots in the screenshots array.

return {
    data: 'Hello World',
    screenshots: screenshots // array of screenshots
};
```

### Use of Playwright

We use Playwright to simulate user interactions. You can use Playwright `page` object to interact with the browser and perform actions like clicking buttons, filling forms, and taking screenshots. 

### Things to consider

- You only have `page` object available in the context of the script. This is from Playwright Page class. You can use it to run all the interactions with the browser.
- You can use `console.log` to log the data in the console. This will be available in the logs section of the monitor.
- You can return the data from the script using the `return` statement. You can also return screenshots in the screenshots array.
- You can use `browserType` and `screenSizeType` variables to get the browser type and screen size type in the current run context. Feel free to use them in your script if you like. 
- This is a JavaScript script, so you can use all the JavaScript features in the script.
- You can use `axios` module to make HTTP requests in the script. You can use it to make API calls from the script.
- If you are using oneuptime.com, you will always have the latest version of Playwright & browsers available in the context of the script. If you're self-hosting, please make sure you update the probes to have the latest version of Playwright and the browsers. 
- Timeout for the script is 2 minutes. If the script takes more than 2 mins, it will be terminated.