import IconProp from "Common/Types/Icon/IconProp";
import React, { FunctionComponent, ReactElement } from "react";
import Icon from "../Icon/Icon";


export interface ComponentProps {
    title: string;
    description: string;
    onClose: () => void; 
    onSubmit: ()=> void; 
    children: ReactElement | Array<ReactElement>
    submitButtonDisabled?: boolean | undefined;
    submitButtonText?: string | undefined;
}

const SideOver: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (

        <div className="relative z-10" aria-labelledby="slide-over-title" role="dialog" aria-modal="true">

            <div className="fixed inset-0"></div>

            <div className="fixed inset-0 overflow-hidden">
                <div className="absolute inset-0 overflow-hidden">
                    <div className="pointer-events-none fixed inset-y-0 right-0 flex max-w-full pl-10 sm:pl-16">

                        <div className="pointer-events-auto w-screen max-w-2xl">
                            <form className="flex h-full flex-col overflow-y-scroll bg-white shadow-xl">
                                <div className="flex-1">

                                    <div className="bg-gray-50 px-4 py-6 sm:px-6">
                                        <div className="flex items-start justify-between space-x-3">
                                            <div className="space-y-1">
                                                <h2 className="text-lg font-medium text-gray-900" id="slide-over-title">{props.title}</h2>
                                                <p className="text-sm text-gray-500">{props.description}</p>
                                            </div>
                                            <div className="flex h-7 items-center">
                                                <button onClick={()=>{
                                                    props.onClose();
                                                }} type="button" className="text-gray-400 hover:text-gray-500">
                                                    <span className="sr-only">Close panel</span>

                                                    <Icon className="h-6 w-6" icon={IconProp.Close}/>
                                                </button>
                                            </div>
                                        </div>
                                    </div>


                                    <div className="space-y-6 py-6 sm:space-y-0 sm:divide-y sm:divide-gray-200 sm:py-0 p-5">

                                        {props.children}

                                    </div>
                                </div>


                                <div className="flex-shrink-0 border-t border-gray-200 px-4 py-5 sm:px-6">
                                    <div className="flex justify-end space-x-3">
                                        <button onClick={()=>{
                                            props.onClose();
                                        }} type="button" className="rounded-md border border-gray-300 bg-white py-2 px-4 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2">Cancel</button>
                                        <button disabled={props.submitButtonDisabled} onClick={()=>{
                                            props.onSubmit();
                                        }} type="submit" className="inline-flex justify-center rounded-md border border-transparent bg-indigo-600 py-2 px-4 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2">{props.submitButtonText || 'Save'}</button>
                                    </div>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
            </div >
        </div >

    );
};

export default SideOver;
