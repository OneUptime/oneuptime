import React, { FunctionComponent, ReactElement, useEffect } from 'react';
import Input from '../Input/Input';

export interface FiterOptions {
    searchText?: string | undefined;
}

export interface ComponentProps {
    onFilterChanged: (filterOptions: FiterOptions) => void;
}

const LogsFilter: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [filterOptions, setFilterOptions] = React.useState<FiterOptions>({});

    useEffect(() => {
        props.onFilterChanged(filterOptions);
    }, [filterOptions]);

    return (
        <div>
            <Input
                onChange={(value: string) => {
                    setFilterOptions({
                        searchText: value,
                    });
                }}
            />
        </div>
    );
};

export default LogsFilter;
