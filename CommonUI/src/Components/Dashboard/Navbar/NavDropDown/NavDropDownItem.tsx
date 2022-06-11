import React, { ReactElement, FunctionComponent } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowRight } from '@fortawesome/free-solid-svg-icons';
import Route from 'Common/Types/API/Route';
import Navigation from '../../../../Utils/Navigation';

export interface ComponentProps {
    title: string;
    description?: string;
    route: Route;
}

const NavDropDownItem: FunctionComponent<ComponentProps> = ({
    title,
    description,
    route,
}: ComponentProps): ReactElement => {
    return (
        <div
            className="body"
            onClick={() => {
                Navigation.navigate(route);
            }}
        >
            <div className="nav-details">
                <h4>{title}</h4>
                {description && <p>{description}</p>}
            </div>
            <div>
                <FontAwesomeIcon icon={faArrowRight} />
            </div>
        </div>
    );
};

export default NavDropDownItem;
