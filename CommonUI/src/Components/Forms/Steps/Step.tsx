
import React, { FunctionComponent, ReactElement } from 'react';
import { FormStep } from '../Types/FormStep';

export interface ComponentProps {
    step: FormStep;
    onClick: (step: FormStep) => void;
}

const Step: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <li onClick={()=>{
            props.onClick(props.step);
        }}>
            <div className="group">
                <span className="flex items-start">
                    <span className="relative flex h-5 w-5 flex-shrink-0 items-center justify-center">
                        <svg className="h-full w-full text-indigo-600 group-hover:text-indigo-800" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                            <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clip-rule="evenodd" />
                        </svg>
                    </span>
                    <span className="ml-3 text-sm font-medium text-gray-500 group-hover:text-gray-900">{props.step.title}</span>
                </span>
            </div>
        </li>
    );
};

export default Step;
