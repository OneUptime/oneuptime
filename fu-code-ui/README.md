# Code follow-ups, UI review: before and after

These images show the surfaces the UI review of the Code follow-ups changed, as the builder
left them (before) and after the review. Each one is the real production page rendered
offline by the `packages/E2E/Code` fixture, on its synthetic data (every repository, Runner
and task name is made up), captured with Inter, the font production loads. The GitHub
comments are drawn from the exact markdown the composer writes, in a box styled like a
GitHub thread's comment.

- `runner-card-default-before.png` / `-after.png`: a repository that follows the project's
  default Runner. "Project default" was loose grey words between the name and its status; it
  is now the small green pill Runbooks → Runners draws beside the default's name.
- `runner-card-gitlab-before.png` / `-after.png`: a GitLab repository on the Global Runner.
  Its line said "before the pull request opens" right above the Merge Requests card; it now
  says "before the merge request opens".
- `runner-modal-gitlab-before.png` / `-after.png`: the same repository's Runner picker: the
  line under it in GitLab's word too.
- `runner-card-git-server-before.png` / `-after.png`: a repository on a Git server, where AI
  pushes a branch and opens no pull request: "before the branch is pushed".
- `log-phone-before.png` / `-after.png`: a task's Log on a phone. The time and the tool's
  pill filled the row and cut each step's words to nothing; the words now take a line of
  their own, lined up with the time.
- `log-desktop-before.png` / `-after.png`: the Log of a task's first turn of two: the card
  under the Turn picker now says "Every step this turn took".
- `log-unread-before.png` / `-after.png`: a turn's record that could not be read: Refresh
  under the way back and the picker.
- `github-reply-before.png` / `-after.png`: the GitHub App's answer while a repository's
  commands are off: "…in OneUptime, with this repository's Respond to GitHub Commands switch"
  instead of a colon before the link.
