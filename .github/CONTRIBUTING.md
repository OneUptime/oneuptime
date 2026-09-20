# Contributing to OneUptime

We love your input! We want to make contributing to this project as easy and transparent as possible, whether it's:

- Reporting a bug
- Discussing the current state of the code
- Submitting a fix
- Proposing new features
- Becoming a maintainer

## We Develop with Github

We use github to host code, to track issues and feature requests, as well as accept pull requests.

## We Use [Github Flow](https://docs.github.com/en/get-started/quickstart/github-flow), So All Code Changes Happen Through Pull Requests

Pull requests are the best way to propose changes to the codebase (we use [Github Flow](https://docs.github.com/en/get-started/quickstart/github-flow)). We actively welcome your pull requests:

1. Fork the repo and create your branch from `master`.
2. If you've added code that should be tested, add tests.
3. If you've changed APIs, update the documentation.
4. Ensure the test suite passes.
5. Make sure your code lints.
6. Issue that pull request!

## Licensing of contributions

OneUptime is developed in one repository with two licenses, and the license
that covers your contribution depends on where the change lands. The preamble
of the root [`LICENSE`](../LICENSE) file sets out the split:

- **Everything outside the [`ee/`](../ee) directory** is licensed under the
  [Apache License 2.0](../LICENSE), whose text follows that preamble. When you
  submit changes there, your submissions are understood to be under that same
  license.
- **The [`ee/`](../ee) directory** holds the OneUptime Enterprise Edition and is
  licensed under the [OneUptime Enterprise License](../ee/LICENSE), not Apache
  2.0. By submitting changes to `ee/`, you agree that your contribution is
  licensed under `ee/LICENSE` and that OneUptime may use, modify, distribute,
  sublicense and sell it as part of its commercial products and services.

A pull request that touches both is covered by both rules, each for its own
files. OneUptime may ask you to sign a Contributor License Agreement (CLA)
before merging changes to `ee/`. Changes to `ee/` and to the license files are
reviewed by the code owners listed in [CODEOWNERS](./CODEOWNERS).

Feel free to contact the maintainers if that's a concern.

## Report bugs using Github's [issues](https://github.com/OneUptime/oneuptime)

We use GitHub issues to track public bugs. Report a bug by [opening a new issue](https://github.com/OneUptime/oneuptime/issues/new); it's that easy!

## Write bug reports with detail, background, and sample code

**Great Bug Reports** tend to have:

- A quick summary and/or background
- Steps to reproduce
  - Be specific!
  - Give sample code if you can.
- What you expected would happen
- What actually happens
- Notes (possibly including why you think this might be happening, or stuff you tried that didn't work)

## Use a Consistent Coding Style

- You can try running `npm run fix` for style unification

## License

By contributing, you agree that your contributions outside the `ee/` directory
will be licensed under the Apache License 2.0, and your contributions to the
`ee/` directory under the OneUptime Enterprise License, as described in
[Licensing of contributions](#licensing-of-contributions).
