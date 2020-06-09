const Logger = require('./src/index');

async function logApiRequest() {
    Logger('5edf4d94a68af8016be57931', '2003e4d7-ebe9-4e16-b254-b3ed4b75575a') // set application log id and key
        .log({content: 'this is a test log'}) // set any data type to log
        .then(res => {
            if(res.status === 200) { // request was successfully logged
                console.log(res.data)
            } else { // request failed 
                console.log(res.response.data)
            }
        }) // get response
        .catch(err => console.log(err.data)); // get error
}
logApiRequest();
