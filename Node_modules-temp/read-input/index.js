var fs = require('fs');

/**
 * read() : read(files, function(err, res) { ... })
 * Reads from files. If no files are given, read from stdin.
 * The result `res` is a [result object](#res). If any of the files can't be
 * read, `err` will be an error object.
 *
 *     var read = require('read-input');
 *     var fnames = process.argv.slice(2); //=> ['readme.txt']
 *
 *     read(fnames).then(function (res) {
 *       res.data       // '...'
 *       res.error      // undefined or Error()
 *       res.stdin      // true or false
 *       res.files      // [...]
 *       res.successes  // [...]
 *       res.failures   // [...]
 *     }).catch(function (err) {
 *       // stdin error
 *     });
 *
 * To support older versions of Node.js without Promises, you can use callbacks:
 *
 *     read(fname, function (err, res) {
 *     });
 *
 * You can also iterate through `res.files`.
 *
 *     read(fnames).then(function(res) {
 *       res.files.forEach(function (f) {
 *         f.data    // ...
 *         f.error   // undefined or Error(...)
 *         f.stdin   // true or false
 *         f.name    // 'readme.txt'
 *       }
 *     });
 *
 * If `files` is a blank array (or null), data will be read from stdin. The
 * resulting data will have a similar schema.
 *
 *     read([]).then(fucntion (res) {
 *       ...
 *     });
 */

function read (files, fn) {
  return promisify(fn, function (ok, fail) {
    // from stdin
    if (!files || files.length === 0) {
      read.stdin(function (err, data) {
        if (err)
          ok(new Result([{ stdin: true, error: err }]));
        else
          ok(new Result([{ stdin: true, data: data }]));
      });
    }
    // from files
    else {
      var out = files.map(function (fname) {
        try {
          var data = fs.readFileSync(fname, 'utf-8');
          return { name: fname, data: data };
        } catch (err) {
          return { name: fname, error: err };
        }
      });

      var result = new Result(out);
      ok(result);
    }
  });
}

/**
 * read.stdin() : read.stdin(fn)
 * Read data from standard input. This will not throw errors.
 *
 *   read.stdin().then(function (data) {
 *     console.log(data); // string
 *   });
 *
 *   read.stdin(function (err, data) {
 *     ...
 *   });
 */

read.stdin = function (fn) {
  return promisify(fn, function (ok, err) {
    var data = '';

    process.stdin.setEncoding('utf8');

    process.stdin.on('readable', function() {
      var chunk = process.stdin.read();
      if (chunk !== null) data += chunk;
    });

    process.stdin.on('end', function() {
      ok(data);
    });
  });
};

/**
 * res:
 * The results value is an object passed to the callback of `read()`.
 *
 * ~ data (String): a concatenation of all data in all the files.
 * ~ error (Error): The first error in all files. `undefined` if successful.
 * ~ stdin (Boolean): is `true` if the file is read from stdin
 * ~ files (Array): A list of files.
 * ~ failures (Array): A list of files that failed.
 * ~ successes (Array): A list of files that succeeded.
 *
 * The `files`, `failures` and `successes` are lists of files. Each of the items in these lists
 * has a similar list of values:
 *
 * ~ data (String): File data
 * ~ error (Error): the first error encountered, if applicable
 * ~ stdin (Boolean): is `true` if the file is read from stdin
 * ~ name (String): File name
 *
 * There's also `error.result` which refers to the result object.
 *
 * See [read()](read) for an example.
 */

function Result(files) {
  this.files = files;
}

getter(Result.prototype, 'data', function () {
  return this.files.map(function (f) { return f.data || ""; }).join("");
});

getter(Result.prototype, 'error', function () {
  var fails = this.failures;
  if (fails.length === 0) return;

  var errors = fails.map(function (f) { return f.error; });
  var messages = errors.map(function (f) { return f.message; });

  var err = new Error(messages.join("\n"));
  err.files = fails;
  err.result = this;
  return err;
});

getter(Result.prototype, 'failures', function () {
  return this.files.filter(function (f) { return f.error; });
});

getter(Result.prototype, 'successes', function () {
  return this.files.filter(function (f) { return ! f.error; });
});

getter(Result.prototype, 'stdin', function () {
  return this.files && this.files[0] && this.files[0].stdin;
});

/**
 * getter() : getter(prototype, prop, fn)
 * (private) Defines a get property `prop` in the given `prototype` object.
 */

function getter (proto, prop, fn) {
  Object.defineProperty(proto, prop, { get: fn });
}

/*
 * bridges callbacks and promise mode
 */

function promisify (callback, block) {
  if (callback) {
    block(
      function (result) { callback(null, result); },
      function (err) { callback(err); });
  } else {
    return new Promise(block);
  }
}

module.exports = read;
