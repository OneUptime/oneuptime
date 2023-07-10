enum WorkflowStatus {
    Scheduled = 'Scheduled',
    Executing = 'Executing',
    Success = 'Success',
    Error = 'Error',
    Timeout = 'Timeout',
    WorkflowCountExceeded = 'WorkflowCountExceeded',
}

export default WorkflowStatus;
