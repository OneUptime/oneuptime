## [v0.3.1] - Jun  3, 2015

 * Fix using read.stdin() as a promise.

## [v0.3.0] - May 23, 2015

 * Implement promises as well as callbacks. You can now use `read().then(...)` as well as `read(fn)`.

## [v0.2.0] - August 27, 2014

 * The callback now passes `err` if any of the files fail.
 * `res.error` now returns an Error object.
 * Added `res.failures` to list files that failed.
 * Added `res.successes` to list files that succeeded.

## v0.1.0 - August 5, 2014

 * Initial release.

[v0.2.0]: https://github.com/rstacruz/read-input/compare/v0.1.0...v0.2.0
[v0.3.0]: https://github.com/rstacruz/read-input/compare/v0.2.0...v0.3.0
[v0.3.1]: https://github.com/rstacruz/read-input/compare/v0.3.0...v0.3.1
