import EnableWorkflowOn from '../BaseDatabase/EnableWorkflowOn';

export default (enableWorkflowOn: EnableWorkflowOn) => {
    return (ctr: Function) => {
        ctr.prototype.enableWorkflowOn = enableWorkflowOn;
    };
};
