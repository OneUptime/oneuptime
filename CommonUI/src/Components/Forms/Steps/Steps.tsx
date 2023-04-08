
import React, { FunctionComponent, ReactElement } from 'react';
import { FormStep, FormStepState } from '../Types/FormStep';
import Step from './Step';

export interface ComponentProps {
    steps: Array<FormStep>;
    onClick: (step: FormStep) => void;
    currentFormStepId: string;
}

const Steps: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {



    return (
        <div className="pr-4 py-12 sm:pr-6 lg:pr-8">
            <nav className="flex justify-center" aria-label="Progress">
                <ol role="list" className="space-y-6">
                    {props.steps.map((step, index) => {


                        const indexOfCurrentState = props.steps.findIndex((step) => {
                            return step.id === props.currentFormStepId;
                        });

                        let state: FormStepState = FormStepState.INACTIVE;

                        if (indexOfCurrentState > index) {
                            state = FormStepState.COMPLETED;
                        } else if (indexOfCurrentState === index) {
                            state = FormStepState.ACTIVE;
                        } else {
                            state = FormStepState.INACTIVE;
                        }

                        return (
                            <Step state={state} step={step} key={index} onClick={(step: FormStep) => {
                                props.onClick(step);
                            }} />
                        )
                    })}

                </ol>
            </nav>
        </div>
    );
};

export default Steps;
