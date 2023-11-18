import React, { FunctionComponent, ReactElement, useEffect } from 'react';
import Input from '../Input/Input';
import Button from '../Button/Button';
import IconProp from 'Common/Types/Icon/IconProp';

export interface FiterOptions {
    searchText?: string | undefined;
}

export interface ComponentProps {
    onFilterChanged: (filterOptions: FiterOptions) => void;
    onAutoScrollChanged: (turnOnAutoScroll: boolean) => void;
}

const LogsFilters: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [filterOptions, setFilterOptions] = React.useState<FiterOptions>({});

    const [turnOnAutoScroll, setTurnOnAutoScroll] = React.useState<boolean>(true);



    useEffect(() => {
        props.onFilterChanged(filterOptions);
    }, [filterOptions]);

    return (
        <div>
            <div>
                <Input
                    placeholder="Search"
                    onChange={(value: string) => {
                        setFilterOptions({
                            searchText: value,
                        });
                    }}
                />
            </div>
            <div className="flex">
                <Input
                    placeholder="Start Time"
                    onChange={(value: string) => {
                        setFilterOptions({
                            searchText: value,
                        });
                    }}
                    type={'datetime-local'}
                />
                <Input
                    placeholder="End Time"
                    onChange={(value: string) => {
                        setFilterOptions({
                            searchText: value,
                        });
                    }}
                    type={'datetime-local'}
                />
            </div>
            <div>
                <Input
                    placeholder="SQL Query"
                    onChange={(value: string) => {
                        setFilterOptions({
                            searchText: value,
                        });
                    }}
                />
            </div>

            <div>
                {!turnOnAutoScroll && <Button title='Start Autoscroll' icon={IconProp.Play} onClick={()=>{
                    setTurnOnAutoScroll(true);
                    props.onAutoScrollChanged(true);
                }} /> }
                {turnOnAutoScroll && <Button title='Stop Autoscroll' icon={IconProp.Stop} onClick={()=>{
                    setTurnOnAutoScroll(false);
                    props.onAutoScrollChanged(false);
                }} /> }
            </div>
        </div>
    );
};

export default LogsFilters;
