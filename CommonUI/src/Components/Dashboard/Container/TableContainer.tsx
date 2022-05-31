import React, { ReactElement, FC } from 'react';
import Button from '../../Basic/Button/Button';
import ButtonTypes from '../../Basic/Button/ButtonTypes';
import './TableContainer.scss';

export interface ComponentProps {
    title: string;
    description?: string;
    footerText?: string;
}

const TableContainer: FC<ComponentProps> = ({
    title,
    description,
    footerText,
}): ReactElement => {
    return (
        <div className="tableContainer">
            <div className="tableContainer_header">
                <div className="tableContainer_header__details">
                    <h2>{title}</h2>
                    <p>{description}</p>
                </div>
                <div className="tableContainer_header__aside">
                    <Button
                        title="Button"
                        id="table_button"
                        type={ButtonTypes.Button}
                    />
                    <Button
                        title="Button"
                        id="table_button"
                        type={ButtonTypes.Button}
                    />
                </div>
            </div>
            <div className="tableContainer_body"></div>
            <div className="tableContainer_footer">
                <div className="tableContainer_footer__details">
                    <p>{footerText}</p>
                </div>
                <div></div>
            </div>
        </div>
    );
};

export default TableContainer;
