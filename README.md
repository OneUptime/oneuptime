# Screenshots for pull requests

This branch holds the screenshots that pull requests show in their
descriptions, one folder per change. It shares no history with `main`, so
none of it is in a checkout of `main` or of a pull request. It used to live
in `main`'s `.github/pr-assets`, where every CI job of every pull request
downloaded all of it: 442 MB, 57% of each checkout, in November 2026.

Add screenshots from a checkout of `main`:

    node Scripts/PR/PublishScreenshots.js <topic> <file or folder>...

It commits them here under `<topic>/` in one commit, and prints the Markdown
to paste into the pull request's description. The links name that commit, so
they keep showing what the pull request showed.

Never force-push or rewrite this branch: pull requests link to its commits.
