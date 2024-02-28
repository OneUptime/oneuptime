import EnableWorkflowOn from '../BaseDatabase/EnableWorkflowOn';
import GenericFunction from '../GenericFunction';

export default (enableWorkflowOn: EnableWorkflowOn) => {
    return (ctr: GenericFunction) => {
        ctr.prototype.enableWorkflowOn = enableWorkflowOn;
    };
};
