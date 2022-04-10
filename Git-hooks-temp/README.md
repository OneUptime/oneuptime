# Hooks

Like many other Version Control Systems, Git has a way to fire off custom scripts when certain important actions occur. Hooks are triggered by operations such as committing and merging.

This project has a git pre-commit hook that automatically runs when you execute `git commit`. This pre-commit is responsible for linting the project. This is one of the ways to be sure any code git committed has been linted properly.

## Enable git hooks

Run these command in your terminal from the root of this project.

```
root="$(pwd)"
ln -s "$root/git-hooks" "$root/.git/hooks"
```
