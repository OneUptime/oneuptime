import React, { CSSProperties, FunctionComponent, ReactElement } from 'react';
import Button, { ButtonStyleType } from '../Button/Button';
import Icon, { IconProp, ThickProp } from '../Icon/Icon';

export interface CardButtonSchema {
    title: string;
    buttonStyle: ButtonStyleType;
    onClick: () => void;
    disabled?: boolean | undefined;
    icon: IconProp;
    isLoading?: undefined | boolean;
}

export interface ComponentProps {
    title: string;
    description: string;
    icon?: IconProp | undefined;
    buttons?: undefined | Array<CardButtonSchema>;
    children?: undefined | Array<ReactElement> | ReactElement;
    cardBodyStyle?: undefined | CSSProperties;
}

const Card: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <React.Fragment>
            <div className="row">
                <div className="col-xl-12">
                    <div className="card">
                        <div className="card-header justify-space-between">
                            <div>
                                <h4 className="card-title flex">
                                    {props.icon ? (
                                        <span>
                                            <Icon
                                                icon={props.icon}
                                                thick={ThickProp.Thick}
                                            />
                                        </span>
                                    ) : (
                                        <></>
                                    )}
                                    &nbsp;{props.title}
                                </h4>
                                <p className="card-title-desc">
                                    {props.description}
                                </p>
                            </div>
                            <div>
                                {props.buttons?.map(
                                    (button: CardButtonSchema, i: number) => {
                                        return (
                                            <span
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
                                                    onClick={() => {
                                                        if (button.onClick) {
                                                            button.onClick();
                                                        }
                                                    }}
                                                    disabled={button.disabled}
                                                    icon={button.icon}
                                                />
                                            </span>
                                        );
                                    }
                                )}
                            </div>
                        </div>
                        {props.children && (
                            <div
                                className="card-body"
                                style={props.cardBodyStyle || {}}
                            >
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
