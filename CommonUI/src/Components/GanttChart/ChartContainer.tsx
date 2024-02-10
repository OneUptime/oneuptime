import React, { FunctionComponent, ReactElement, Ref } from 'react';

export interface ComponentProps {
    onWidthChange: (width: number) => void;
    children?: undefined | Array<ReactElement> | ReactElement;
}

const ChartContainer: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const divRef: Ref<HTMLDivElement> = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
        if (!props.onWidthChange) {
            return;
        }

        if (!divRef.current) {
            return;
        }

        const resizeObserver: ResizeObserver = new ResizeObserver(() => {
            if (divRef.current && props.onWidthChange) {
                props.onWidthChange(divRef.current.offsetWidth);
            }
        });

        resizeObserver.observe(divRef.current);

        return () => {
            return resizeObserver.disconnect();
        }; // clean up
    }, []);

    return (
        <div ref={divRef} className={'w-full'}>
            {props.children}
        </div>
    );
};

export default ChartContainer;
