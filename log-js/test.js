const Logger = require('./src/index');

async function logApiRequest() {
    Logger('id', 'key') // set application log id and key
        .log('test') // set any data type to log
        .then(res => console.log(res.data)) // get response
        .catch(err => console.log(err.message)); // get error
}
logApiRequest();
