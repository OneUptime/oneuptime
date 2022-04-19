# Changelog

## v2.3.1

- Fix `invalid regexp group` error in browsers or environments that do not support the negative lookbehind regular expression assertion.

## v2.3.0

- Accept the `Error` constructor as `circularValue` option to throw on circular references as the regular JSON.stringify would:

```js
import { configure } from 'safe-stable-stringify'

const object = {}
object.circular = object;

const stringify = configure({ circularValue: TypeError })

stringify(object)
// TypeError: Converting circular structure to JSON
```

- Fixed escaping wrong surrogates. Only lone surrogates are now escaped.

## v2.2.0

- Reduce module size by removing the test and benchmark files from the published package
- Accept `undefined` as `circularValue` option to remove circular properties from the serialized output:

```js
import { configure } from 'safe-stable-stringify'

const object = { array: [] }
object.circular = object;
object.array.push(object)

configure({ circularValue: undefined })(object)
// '{"array":[null]}'
```

## v2.1.0

- Added `maximumBreadth` option to limit stringification at a specific object or array "width" (number of properties / values)
- Added `maximumDepth` option to limit stringification at a specific nesting depth
- Implemented the [well formed stringify proposal](https://github.com/tc39/proposal-well-formed-stringify) that is now part of the spec
- Fixed maximum spacer length (10)
- Fixed TypeScript definition
- Fixed duplicated array replacer values serialized more than once

## v2.0.0

- __[BREAKING]__ Convert BigInt to number by default instead of ignoring these values
  If you wish to ignore these values similar to earlier versions, just use the new `bigint` option and set it to `false`.
- __[BREAKING]__ Support ESM
- __[BREAKING]__ Requires ES6
- Optional BigInt support
- Deterministic behavior is now optional
- The value to indicate a circular structure is now adjustable
- Significantly faster TypedArray stringification
- Smaller Codebase
- Removed stateful indentation to guarantee side-effect freeness

## v1.1.1

- Fixed an indentation issue in combination with empty arrays and objects
- Updated dev dependencies

## v1.1.0

- Add support for IE11 (https://github.com/BridgeAR/safe-stable-stringify/commit/917b6128de135a950ec178d66d86b4d772c7656d)
- Fix issue with undefined values (https://github.com/BridgeAR/safe-stable-stringify/commit/4196f87, https://github.com/BridgeAR/safe-stable-stringify/commit/4eab558)
- Fix typescript definition (https://github.com/BridgeAR/safe-stable-stringify/commit/7a87478)
- Improve code coverage (https://github.com/BridgeAR/safe-stable-stringify/commit/ed8cadc, https://github.com/BridgeAR/safe-stable-stringify/commit/b58c494)
- Update dev dependencies (https://github.com/BridgeAR/safe-stable-stringify/commit/b857ea8)
- Improve docs