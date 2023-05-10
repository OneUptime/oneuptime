import FormValues from './FormValues';

export enum FormStepState {
    ACTIVE,
    INACTIVE,
    COMPLETED,
}

export interface FormStep<TEntity> {
    id: string;
    title: string;
    showIf?: ((item: FormValues<TEntity>) => boolean) | undefined;
}
