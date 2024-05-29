import { Green, Red } from 'Common/Types/BrandColors';
import ColorCircle from 'CommonUI/src/Components/ColorCircle/ColorCircle';
import Span, { SpanStatus } from 'Model/AnalyticsModels/Span';
import React, { FunctionComponent, ReactElement } from 'react';

export interface ComponentProps {
    span: Span;
    title?: string | undefined;
    titleClassName?: string | undefined;
}

const SpanStatusElement: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const { span } = props;

    return (
        <div className="flex space-x-2">
            <div className="mt-1">
                {span &&
                (span.statusCode === SpanStatus.Unset || !span.statusCode) ? (
                    <ColorCircle color={Green} tooltip="Span Status: Unset" />
                ) : (
                    <></>
                )}
                {span && span.statusCode === SpanStatus.Ok ? (
                    <ColorCircle color={Green} tooltip="Span Status: Ok" />
                ) : (
                    <></>
                )}
                {span && span.statusCode === SpanStatus.Error ? (
                    <ColorCircle color={Red} tooltip="Span Status: Error" />
                ) : (
                    <></>
                )}
            </div>
            {props.title && (
                <div className={props.titleClassName}>{props.title}</div>
            )}
        </div>
    );
};

export default SpanStatusElement;
