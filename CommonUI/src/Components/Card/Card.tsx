import React, { FunctionComponent, ReactElement, Ref } from 'react';
import Button, { ButtonStyleType } from '../Button/Button';

import IconProp from 'Common/Types/Icon/IconProp';
import ShortcutKey from '../ShortcutKey/ShortcutKey';

export interface CardButtonSchema {
    title: string;
    buttonStyle?: ButtonStyleType | undefined;
    onClick: () => void;
    disabled?: boolean | undefined;
    icon: IconProp;
    isLoading?: undefined | boolean;
    className?: string | undefined;
    shortcutKey?: undefined | ShortcutKey;
}

export interface ComponentProps {
    title: string | ReactElement;
    description: string | ReactElement;
    buttons?: undefined | Array<CardButtonSchema>;
    children?: undefined | Array<ReactElement> | ReactElement;
    className?: string | undefined;
    bodyClassName?: string | undefined;
    rightElement?: ReactElement | undefined;
    onCardWidthChange?: undefined | ((width: number) => void);
}

const Card: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const cardRef: Ref<HTMLDivElement> = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
        if (!props.onCardWidthChange) {
            return;
        }

        if (!cardRef.current) {
            return;
        }

        const resizeObserver: ResizeObserver = new ResizeObserver(() => {
            if (cardRef.current && props.onCardWidthChange) {
                props.onCardWidthChange(cardRef.current.offsetWidth);
            }
        });

        resizeObserver.observe(cardRef.current);

        return () => {
            return props.onCardWidthChange && resizeObserver.disconnect();
        }; // clean up
    }, []);

    return (
        <React.Fragment>
            <div ref={cardRef} className={props.className}>
                <div className="shadow sm:overflow-hidden sm:rounded-md">
                    <div className="bg-white py-6 px-4 sm:p-6">
                        <div className="flex justify-between">
                            <div>
                                <h2
                                    data-testid="card-details-heading"
                                    id="card-details-heading"
                                    className="text-lg font-medium leading-6 text-gray-900"
                                >
                                    {props.title}
                                </h2>
                                <p
                                    data-testid="card-description"
                                    className="mt-1 text-sm text-gray-500"
                                >
                                    {props.description}
                                </p>
                            </div>
                            <div className="flex">
                                {props.rightElement}
                                {props.buttons?.map(
                                    (button: CardButtonSchema, i: number) => {
                                        return (
                                            <div
                                                style={
                                                    i > 0
                                                        ? {
                                                              marginLeft:
                                                                  '10px',
                                                          }
                                                        : {}
                                                }
                                                key={i}
                                            >
                                                <Button
                                                    key={i}
                                                    title={button.title}
                                                    buttonStyle={
                                                        button.buttonStyle
                                                    }
                                                    className={button.className}
                                                    onClick={() => {
                                                        if (button.onClick) {
                                                            button.onClick();
                                                        }
                                                    }}
                                                    disabled={button.disabled}
                                                    icon={button.icon}
                                                    shortcutKey={
                                                        button.shortcutKey
                                                    }
                                                    dataTestId="card-button"
                                                />
                                            </div>
                                        );
                                    }
                                )}
                            </div>
                        </div>

                        {props.children && (
                            <div className={props.bodyClassName || 'mt-6'}>
                                {props.children}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </React.Fragment>
    );
};

export default Card;
