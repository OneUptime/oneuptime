enum CopilotEventStatus {
  PR_CREATED = "Pull Request Created", // PR created and waiting for review
  NO_ACTION_REQUIRED = "No Action Required", // No PR needed. All is good.
}

export default CopilotEventStatus;
