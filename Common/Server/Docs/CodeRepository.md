# Code Repository

```javascript
const branchName: string = 'test-branch-11';

await CodeRepositoryUtil.createOrCheckoutBranch({
    serviceRepository: serviceRepository,
    branchName: branchName,
});

// test code from here.
const file: CodeRepositoryFile | undefined =
    filesInService[Object.keys(filesInService)[0]!];

await CodeRepositoryUtil.writeToFile({
    filePath: file!.filePath!,
    content: 'Hello World',
});

// commit the changes

await CodeRepositoryUtil.addFilesToGit({
    filePaths: [file!.filePath!],
});

await CodeRepositoryUtil.commitChanges({
    message: 'Test commit',
});

await CodeRepositoryUtil.pushChanges({
    branchName: branchName,
    serviceRepository: serviceRepository,
});

// create a pull request

await CodeRepositoryUtil.createPullRequest({
    title: 'Test PR',
    body: 'Test PR body',
    branchName: branchName,
    serviceRepository: serviceRepository,
});
```