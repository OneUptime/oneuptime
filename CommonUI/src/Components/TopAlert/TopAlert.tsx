
import React, { FunctionComponent, ReactElement } from 'react'

export interface ComponentProps {
    title: string;
    description: string;
}

const TopAlert: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <div className="flex items-center text-center gap-x-6 bg-gray-700 px-6 py-2.5 sm:px-3.5">
            <p className="text-sm leading-6 text-white w-full">
                <div className='w-full'>
                    <strong className="font-semibold">{props.title}</strong>&nbsp;-&nbsp;
                    {props.description} &nbsp;&nbsp;
                    <a
                        href="#"
                        className="flex-none rounded-full bg-gray-200 px-3.5 py-1 text-sm font-semibold text-gray-900 shadow-sm hover:bg-gray-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900"
                    >
                        Go to User Dashboard <span aria-hidden="true">&rarr;</span>
                    </a>
                </div>
            </p>
        </div>
    )
}

export default TopAlert; 