export enum FormStepState {
    ACTIVE, 
    INACTIVE,
    COMPLETED,
}

export interface FormStep {
    id: string;
    title: string;
}