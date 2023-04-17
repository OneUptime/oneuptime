import React, { ReactElement } from 'react';
import { FormStep, FormStepState } from '../Types/FormStep';

export interface ComponentProps<T> {
    step: FormStep<T>;
    onClick: (step: FormStep<T>) => void;
    state: FormStepState;
}

const Step: Function = <T extends Object>(
    props: ComponentProps<T>
): ReactElement => {
    return (
        <li
            onClick={() => {
                if (props.state === FormStepState.COMPLETED) {
                    props.onClick(props.step);
                }
            }}
            className={`${
                props.state === FormStepState.COMPLETED ? 'cursor-pointer' : ''
            }`}
        >
            {props.state === FormStepState.COMPLETED && (
                <div className="group">
                    <span className="flex items-start">
                        <span className="relative flex h-5 w-5 flex-shrink-0 items-center justify-center">
                            <svg
                                className="h-full w-full text-indigo-600 group-hover:text-indigo-800"
                                viewBox="0 0 20 20"
                                fill="currentColor"
                                aria-hidden="true"
                            >
                                <path
                                    fillRule="evenodd"
                                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"
                                    clipRule="evenodd"
                                />
                            </svg>
                        </span>
                        <span className="ml-3 text-sm font-medium text-gray-500 group-hover:text-gray-900">
                            {props.step.title}
                        </span>
                    </span>
                </div>
            )}

            {props.state === FormStepState.ACTIVE && (
                <div className="flex items-start" aria-current="step">
                    <span
                        className="relative flex h-5 w-5 flex-shrink-0 items-center justify-center"
                        aria-hidden="true"
                    >
                        <span className="absolute h-4 w-4 rounded-full bg-indigo-200"></span>
                        <span className="relative block h-2 w-2 rounded-full bg-indigo-600"></span>
                    </span>
                    <span className="ml-3 text-sm font-medium text-indigo-600">
                        {props.step.title}
                    </span>
                </div>
            )}

            {props.state === FormStepState.INACTIVE && (
                <div className="group">
                    <div className="flex items-start">
                        <div
                            className="relative flex h-5 w-5 flex-shrink-0 items-center justify-center"
                            aria-hidden="true"
                        >
                            <div className="h-2 w-2 rounded-full bg-gray-300"></div>
                        </div>
                        <p className="ml-3 text-sm font-medium text-gray-500 w-max">
                            {props.step.title}
                        </p>
                    </div>
                </div>
            )}
        </li>
    );
};

export default Step;
