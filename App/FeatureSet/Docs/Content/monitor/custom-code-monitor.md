# Custom Code Monitor

Custom Code Monitor allows you to write custom scripts to monitor your applications. You can use this feature to monitor your applications in a way that is not possible with the existing monitors. For example, you can have multi-step API requests. 

#### Example

The following example shows how to use a Synthtic Monitor:

```javascript
// You can use axios module, and page object from Playwright here.

await axios.get('https://api.example.com/');

// Axios Documentation here: https://axios-http.com/docs/intro

return {
    data: 'Hello World' // return any data you like here. 
};
```

### Things to consider

- You can use `console.log` to log the data in the console. This will be available in the logs section of the monitor.
- You can return the data from the script using the `return` statement. 
- This is a JavaScript script, so you can use all the JavaScript features in the script.
- You can use `axios` module to make HTTP requests in the script. You can use it to make API calls from the script.