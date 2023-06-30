enum OnCallDutyPolicyStatus {
    Scheduled = 'Scheduled',
    ExecutingFirstEscalation = 'Executing First Escalation Rule',
    ExecutionInProgress = 'Execution in Progress',
    SuccessfullyAcknowledged = 'Successfully Acknowledged',
    FailedToAcknowledge = 'Failed to Acknowledge',
    Error = 'Error',
}

export default OnCallDutyPolicyStatus;
