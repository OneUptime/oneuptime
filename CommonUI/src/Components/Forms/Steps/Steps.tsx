
import React, { FunctionComponent, ReactElement } from 'react';
import { FormStep } from '../Types/FormStep';
import Step from './Step';

export interface ComponentProps {
    steps: Array<FormStep>;
    onClick: (step: FormStep) => void;
}

const LabelElement: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <div className="px-4 py-12 sm:px-6 lg:px-8">
            <nav className="flex justify-center" aria-label="Progress">
                <ol role="list" className="space-y-6">
                    {props.steps.map((step, index) => {
                        return (
                            <Step step={step} key={index} onClick={(step: FormStep) => {
                                props.onClick(step);
                            }} />
                        )
                    })}

                </ol>
            </nav>
        </div>
    );
};

export default LabelElement;
