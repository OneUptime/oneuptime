const express = require('express');
const app = express();
const path = require('path');

// set the server port
app.set('port', process.env.PORT || 3423);

// set the view engine to ejs
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

//serve files in public directory
app.use(
    ['/chart', '/'],
    express.static(path.join(__dirname, 'public'), { maxAge: 2592000 })
);

app.listen(app.get('port'), function() {
    // eslint-disable-next-line no-console
    console.log('API Reference started on PORT:' + app.get('port'));
});
