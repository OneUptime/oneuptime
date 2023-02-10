export interface EnableWorkflowOn {
    create?: boolean | undefined;
    update?: boolean | undefined;
    delete?: boolean | undefined;
    read?: boolean | undefined;
}

export default (enableWorkflowOn: EnableWorkflowOn) => {
    return (ctr: Function) => {
        ctr.prototype.enableWorkflowOn = enableWorkflowOn;
    };
};
