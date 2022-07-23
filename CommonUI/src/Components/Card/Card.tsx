import React, { CSSProperties, FunctionComponent, ReactElement } from 'react';

export interface ComponentProps {
    title: string;
    description: string;
    buttons?: undefined | Array<ReactElement>;
    children?: undefined | Array<ReactElement> | ReactElement;
    cardBodyStyle?: undefined | CSSProperties
}

const Card: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <React.Fragment>
            <div className="row">
                <div className="col-xl-12">
                    <div className="card">
                        <div
                            className="card-header justify-space-between"
                        >
                            <div>
                                <h4 className="card-title">{props.title}</h4>
                                <p className="card-title-desc">
                                    {props.description}
                                </p>
                            </div>
                            <div>{props.buttons?.map((button, i) => {
                                return <span style={i > 0 ? {
                                    marginLeft: "10px"
                                }:{}} key={i}>{button}</span>
                            })}</div>
                        </div>
                        {props.children && (
                            <div className="card-body" style={props.cardBodyStyle || {}}>{props.children}</div>
                        )}
                    </div>
                </div>
            </div>
        </React.Fragment>
    );
};

export default Card;
