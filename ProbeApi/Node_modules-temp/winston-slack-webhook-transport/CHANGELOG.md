# CHANGELOG

## 2.1.0 (2021/10/4)

* You can now return `false` in the formatter function to prevent the plugin from posting a message to Slack. This functionality is courtesy of [Pull #14](https://github.com/TheAppleFreak/winston-slack-webhook-transport/pull/14), which closes [Issue #12](https://github.com/TheAppleFreak/winston-slack-webhook-transport/issues/12) in the process. Thanks @iedmrc and @daxadal!
* Updated documentation and typings to reflect the above change.
* Removed Yarn as the package manager in favor of using NPM instead. 
* Set up Github Actions to simplify the process of updating the package on NPM in the future.
* Updated copyright year in LICENSE. Probably should have done that about 10 months ago... ¯\\_(ツ)_/¯
* Updated dependencies

## 2.0.0 (2020/8/14)

**WARNING**: This is a potentially **BREAKING CHANGE**.

* **BREAKING**: Removed the `channel`, `username`, `iconEmoji`, and `iconUrl` properties from the constructor and typings. According to Slack, [these properties cannot be overridden by webhooks](https://api.slack.com/messaging/webhooks#advanced_message_formatting) so it makes no sense to include them and potentially confuse users. As per semantic versioning, I am bumping the version to 2.0.0 to prevent existing clients using these features from suddenly breaking unexpectedly. Nothing else about the code has been modified at this time.
* Removed checks for the aforementioned properties in the tests.
* Fixed link rot in README.md and added a little more detail to the package instructions.
* Modified package.json to only bundle the files needed to use the package. Sorry about accidentally bloating the package size to over 2MB because I left the Yarn executable in...
* Updated copyright year in LICENSE
* Updated dependencies

## 1.2.5 (2020/7/29)

* Updated dependencies
* Updated gitignore to latest Node version
* Fixed error in README.md (as per [Pull #11](https://github.com/TheAppleFreak/winston-slack-webhook-transport/pull/11)). Thanks @zachweinberg!
* Changed all tabs in README.md to spaces for a more unified presentation
* Changed `test` script to not point directly at the Jest executable anymore
* Added Yarn 2 files
* Updated yarn.lock so that GitHub would stop yelling at me about lodash being out of date

## 1.2.4 (2020/5/7)

* Updated yarn.lock so that GitHub would stop yelling at me about acorn being out of date

## 1.2.3 (2020/5/7)

* Updated dependencies

## 1.2.2 (2020/5/7)

* Fixed TypeScript declaration file (as per [Pull #9](https://github.com/TheAppleFreak/winston-slack-webhook-transport/pull/9)). Thanks @dmitryyacenko and @xr!

## 1.2.1 (2020/2/28)

* Fixed TypeScript declaration file (as per [Issue #7](https://github.com/TheAppleFreak/winston-slack-webhook-transport/issues/7)). Thanks @FredericLatour!

## 1.2.0 (2020/2/14)

* Replaced [request](https://github.com/request/request) with [axios](https://github.com/axios/axios) now that [request has been deprecated.](https://github.com/request/request/issues/3142)
* Changed tests to use [Jest](https://jestjs.io/)
* Added proxy server support (as per [Pull #6](https://github.com/TheAppleFreak/winston-slack-webhook-transport/pull/6)). Thanks @gumkins!
* Added TypeScript declaration file

## 1.1.0 (2019/7/15)

* Callback now triggers only after request completes (as per [Pull #4](https://github.com/TheAppleFreak/winston-slack-webhook-transport/pull/4)). Thanks @iudelsmann!

## 1.0.1 (2019/6/21)

* Updated dependencies

## 1.0.0 (2019/3/5)

**WARNING** - This is a **BREAKING CHANGE**. 

* Reworked the logger so it uses [request](https://github.com/request/request) instead of the much heavier Slack API.
* Added support for the new [Layout Blocks](https://api.slack.com/messaging/composing/layouts) formatting option that Slack recently introduced.
* Implemented formatter suggestion from [Issue #2](https://github.com/TheAppleFreak/winston-slack-webhook-transport/issues/2) to tidy up the logger calls. 
* Removed the old method of attaching attachments, also as a suggestion from Issue #2.