# GitHub Ops

### Cancel all GitHub actions jobs at once. 

Please install GitHub CLI and run the below command in your terminal.

```
brew install gh
```

Authenticate with your GitHub account

```
gh auth login
````

Then run the below command in your terminal

```
for id in $(gh run list --limit 5000 --jq ".[] | select (.status == \"queued\" ) | .databaseId" --json databaseId,status); do gh run cancel $id; done
```