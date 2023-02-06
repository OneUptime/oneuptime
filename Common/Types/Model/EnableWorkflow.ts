export interface EnableWorkflowOn {
    create: boolean;
    update: boolean;
    delete: boolean;
}


export default (enableWorkflowOn: EnableWorkflowOn) => {
    return (ctr: Function) => {
        ctr.prototype.enableWorkflowOn = enableWorkflowOn;
    };
};
