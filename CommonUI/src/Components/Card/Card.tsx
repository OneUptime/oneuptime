import React, { FunctionComponent, ReactElement } from 'react';

export interface ComponentProps {
    title: string;
    description: string;
    buttons?: Array<ReactElement>;
    children?: Array<ReactElement> | ReactElement;
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
                            <h4 className="card-title">{props.title}</h4>
                                <p className="card-title-desc">{props.description}</p>
                            </div>
                            <div>
                                { props.buttons}
                            </div>
                        </div>
                        {props.children && <div className="card-body">
                            {props.children}
                        </div>}
                    </div>
                </div>
            </div>

        </React.Fragment>
    );
};

export default Card;
