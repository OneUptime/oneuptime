// Tailwind

import React, { FunctionComponent, ReactElement } from 'react';
import Icon, { IconProp, SizeProp } from '../Icon/Icon';
import Input from '../Input/Input';

export interface ComponentProps {
    onChange: (search: string) => void;
}

const SearchBox: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <div className="relative z-0 flex flex-1 items-center justify-center px-2 sm:absolute sm:inset-0">
            <div className="w-full sm:max-w-xs">
                <label className="sr-only">Search</label>
                <div className="relative">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">

                        <Icon icon={IconProp.Search} size={SizeProp.Five} className="text-gray-400" />
                    </div>
                    <Input onChange={(value) => {
                        props.onChange(value);
                    }} id="search" name="search" className="block w-full rounded-md border border-gray-300 bg-white py-2 pl-10 pr-3 text-sm placeholder-gray-500 focus:border-slate-500 focus:text-gray-900 focus:placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-slate-500 sm:text-sm" placeholder="Search" type="search" />
                </div>
            </div>
        </div>
    );
};

export default SearchBox;
