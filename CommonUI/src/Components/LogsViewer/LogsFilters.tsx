import React, { FunctionComponent, ReactElement, useEffect } from 'react';
import Input, { InputType } from '../Input/Input';
import Button, { ButtonStyleType } from '../Button/Button';
import IconProp from 'Common/Types/Icon/IconProp';
import Dropdown from '../Dropdown/Dropdown';
import FieldLabelElement from '../Forms/Fields/FieldLabel';
// import TelemetryService from 'Model/Models/TelemetryService';
import CodeEditor from '../CodeEditor/CodeEditor';
import CodeType from 'Common/Types/Code/CodeType';

export interface FiterOptions {
    searchText?: string | undefined;
}

export interface ComponentProps {
    onFilterChanged: (filterOptions: FiterOptions) => void;
    onAutoScrollChanged: (turnOnAutoScroll: boolean) => void;
    // telemetryServices?: Array<TelemetryService>;
}

const LogsFilters: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [filterOptions, setFilterOptions] = React.useState<FiterOptions>({});

    const [turnOnAutoScroll, setTurnOnAutoScroll] =
        React.useState<boolean>(true);
    const [showMoreFilters, setShowMoreFilters] =
        React.useState<boolean>(false);
    const [isSqlQuery, setIsSqlQuery] = React.useState<boolean>(false);

    useEffect(() => {
        props.onFilterChanged(filterOptions);
    }, [filterOptions]);

    return (
        <div className="shadow sm:overflow-hidden sm:rounded-md">
            <div className="bg-white py-6 px-4 sm:p-6">
                <div>
                    <div className="flex space-x-2 justify-between">
                        <div className="w-full mr-2">
                            {!isSqlQuery && (
                                <div className="space-y-4">
                                    <div>
                                        <FieldLabelElement
                                            title="Search Logs"
                                            required={true}
                                        />
                                        <Input
                                            placeholder="Search"
                                            onChange={(value: string) => {
                                                setFilterOptions({
                                                    searchText: value,
                                                });
                                            }}
                                        />
                                    </div>

                                    {showMoreFilters && (
                                        <div>
                                            <FieldLabelElement
                                                title="Telemetry Services"
                                                required={true}
                                            />
                                            <Dropdown
                                                isMultiSelect={true}
                                                options={[
                                                    {
                                                        label: 'Information',
                                                        value: 'information',
                                                    },
                                                    {
                                                        label: 'Warning',
                                                        value: 'warning',
                                                    },
                                                    {
                                                        label: 'Error',
                                                        value: 'error',
                                                    },
                                                ]}
                                            />
                                        </div>
                                    )}
                                    {showMoreFilters && (
                                        <div>
                                            <FieldLabelElement
                                                title="Log Severity"
                                                required={true}
                                            />
                                            <Dropdown
                                                isMultiSelect={true}
                                                options={[
                                                    {
                                                        label: 'Information',
                                                        value: 'information',
                                                    },
                                                    {
                                                        label: 'Warning',
                                                        value: 'warning',
                                                    },
                                                    {
                                                        label: 'Error',
                                                        value: 'error',
                                                    },
                                                ]}
                                            />
                                        </div>
                                    )}
                                    {showMoreFilters && (
                                        <div className="flex space-x-2 w-full">
                                            <div className="w-1/2">
                                                <FieldLabelElement
                                                    title="Start Time"
                                                    required={true}
                                                />
                                                <Input
                                                    placeholder="Start Time"
                                                    onChange={(
                                                        value: string
                                                    ) => {
                                                        setFilterOptions({
                                                            searchText: value,
                                                        });
                                                    }}
                                                    type={InputType.DATETIME_LOCAL}
                                                />
                                            </div>
                                            <div className="w-1/2">
                                                <FieldLabelElement
                                                    title="End Time"
                                                    required={true}
                                                />
                                                <Input
                                                    placeholder="End Time"
                                                    onChange={(
                                                        value: string
                                                    ) => {
                                                        setFilterOptions({
                                                            searchText: value,
                                                        });
                                                    }}
                                                    type={InputType.DATETIME_LOCAL}
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                            {isSqlQuery && (
                                <div>
                                    <div className="space-y-1">
                                        <FieldLabelElement
                                            title="SQL Query"
                                            required={true}
                                            description="Enter a SQL query to filter logs."
                                        />
                                        <CodeEditor
                                            type={CodeType.SQL}
                                            placeholder="SQL Query"
                                            onChange={(value: string) => {
                                                setFilterOptions({
                                                    searchText: value,
                                                });
                                            }}
                                            showLineNumbers={true}
                                        />
                                    </div>
                                </div>
                            )}
                        </div>
                        {!isSqlQuery && (
                            <div>
                                <div className="mt-7 -ml-5 justify-end flex w-44">
                                    {!turnOnAutoScroll && (
                                        <Button
                                            title="Start Autoscroll"
                                            icon={IconProp.Play}
                                            onClick={() => {
                                                setTurnOnAutoScroll(true);
                                                props.onAutoScrollChanged(true);
                                            }}
                                        />
                                    )}
                                    {turnOnAutoScroll && (
                                        <Button
                                            title="Stop Autoscroll"
                                            icon={IconProp.Stop}
                                            onClick={() => {
                                                setTurnOnAutoScroll(false);
                                                props.onAutoScrollChanged(
                                                    false
                                                );
                                            }}
                                        />
                                    )}
                                </div>
                            </div>
                        )}
                        {isSqlQuery && (
                            <div className="">
                                <div className="mt-12 -ml-8 justify-end flex w-44">
                                    <Button
                                        title="Search with SQL"
                                        onClick={() => {}}
                                    />
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                <div>
                    <div className="flex justify-between -ml-2 -mr-2">
                        <div className="flex">
                            {!isSqlQuery && (
                                <div>
                                    {!showMoreFilters && (
                                        <Button
                                            buttonStyle={
                                                ButtonStyleType.SECONDARY_LINK
                                            }
                                            title="Show More Options"
                                            onClick={() => {
                                                setShowMoreFilters(true);
                                            }}
                                        />
                                    )}
                                    {showMoreFilters && (
                                        <Button
                                            buttonStyle={
                                                ButtonStyleType.SECONDARY_LINK
                                            }
                                            title="Hide More Options"
                                            onClick={() => {
                                                setShowMoreFilters(false);
                                            }}
                                        />
                                    )}
                                </div>
                            )}
                            <div>
                                {!isSqlQuery && (
                                    <Button
                                        buttonStyle={
                                            ButtonStyleType.SECONDARY_LINK
                                        }
                                        title="Search with SQL instead"
                                        onClick={() => {
                                            setIsSqlQuery(true);
                                        }}
                                    />
                                )}
                                {isSqlQuery && (
                                    <Button
                                        buttonStyle={
                                            ButtonStyleType.SECONDARY_LINK
                                        }
                                        title="Search with Text instead"
                                        onClick={() => {
                                            setIsSqlQuery(false);
                                        }}
                                    />
                                )}
                            </div>
                        </div>
                        <div className="flex">
                            <div>
                                <Button
                                    buttonStyle={ButtonStyleType.SECONDARY_LINK}
                                    title="Save as Preset"
                                    onClick={() => {
                                        setIsSqlQuery(true);
                                    }}
                                />
                            </div>
                            <div>
                                <Button
                                    buttonStyle={ButtonStyleType.SECONDARY_LINK}
                                    title="Load from Preset"
                                    onClick={() => {
                                        setIsSqlQuery(true);
                                    }}
                                />
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default LogsFilters;
