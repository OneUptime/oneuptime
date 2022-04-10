let assert = require('assert');
let exec = require('child_process').execSync;

suite('publishTask', function () {

  this.timeout(7000);

  test('default task', function () {
    let out = exec('./node_modules/.bin/jake  -q publish').toString().trim();
    let expected = [
      'Fetched remote tags.'
      , 'On branch v0.0'
      , 'Bumped version number to v0.0.2.'
      , 'Created package for zerb v0.0.2'
      , 'Publishing zerb v0.0.2'
      , './pkg/zerb-v0.0.2.tar.gz'
      , 'BOOM! Published.'
      , 'Cleaned up package'
    ].join('\n');
    assert.equal(expected, out);
  });

});

