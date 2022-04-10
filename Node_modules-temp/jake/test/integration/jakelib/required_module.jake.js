let { task, namespace } = require("jake");

namespace('usingRequire', function () {
  task('test', () => {
    console.log('howdy test');
  });
});



