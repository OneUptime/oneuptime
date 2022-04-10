let fs = require('fs')
let path = require('path');
let proc = require('child_process');

const PROJECT_DIR = process.cwd();
process.env.PROJECT_DIR = PROJECT_DIR;

namespace('doc', function () {
  task('generate', ['doc:clobber'], function () {
    var cmd = '../node-jsdoc-toolkit/app/run.js -n -r=100 ' +
        '-t=../node-jsdoc-toolkit/templates/codeview -d=./doc/ ./lib';
    jake.logger.log('Generating docs ...');
    jake.exec([cmd], function () {
      jake.logger.log('Done.');
      complete();
    });
  }, {async: true});

  task('clobber', function () {
    var cmd = 'rm -fr ./doc/*';
    jake.exec([cmd], function () {
      jake.logger.log('Clobbered old docs.');
      complete();
    });
  }, {async: true});

});

desc('Generate docs for Jake');
task('doc', ['doc:generate']);

npmPublishTask('jake', function () {
  this.packageFiles.include([
    'Makefile',
    'jakefile.js',
    'README.md',
    'package.json',
    'usage.txt',
    'lib/**',
    'bin/**',
    'test/**'
    ]);
  this.packageFiles.exclude([
    'test/tmp'
  ]);
});

jake.Task['publish:package'].directory = PROJECT_DIR;

namespace('test', function () {

  let integrationTest = task('integration', ['publish:package'], async function () {
    let pkg = JSON.parse(fs.readFileSync(`${PROJECT_DIR}/package.json`).toString());
    let version = pkg.version;

    proc.execSync('rm -rf ./node_modules');
    // Install from the actual package, run tests from the packaged binary
    proc.execSync(`mkdir -p node_modules/.bin && mv ${PROJECT_DIR}/pkg/jake-v` +
        `${version} node_modules/jake && ln -s ${process.cwd()}` +
      '/node_modules/jake/bin/cli.js ./node_modules/.bin/jake');

    let testArgs = [];
    if (process.env.filter) {
      testArgs.push(process.env.filter);
    }
    else {
      testArgs.push('*.js');
    }
    let spawned = proc.spawn(`${PROJECT_DIR}/node_modules/.bin/mocha`, testArgs, {
      stdio: 'inherit'
    });
    return new Promise((resolve, reject) => {
      spawned.on('exit', () => {
        if (!(process.env.noclobber || process.env.noClobber)) {
          proc.execSync('rm -rf tmp_publish && rm -rf package.json' +
              ' && rm -rf package-lock.json && rm -rf node_modules');
          // Rather than invoking 'clobber' task
          jake.rmRf(`${PROJECT_DIR}/pkg`);
        }
        resolve();
      });
    });

  });

  integrationTest.directory = `${PROJECT_DIR}/test/integration`;

  let unitTest = task('unit', async function () {
    let testArgs = [];
    if (process.env.filter) {
      testArgs.push(process.env.filter);
    }
    else {
      testArgs.push('*.js');
    }
    let spawned = proc.spawn(`${PROJECT_DIR}/node_modules/.bin/mocha`, testArgs, {
      stdio: 'inherit'
    });
  });

  unitTest.directory = `${PROJECT_DIR}/test/unit`;
});

desc('Runs all tests');
task('test', ['test:unit', 'test:integration']);
