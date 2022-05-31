import React, { ReactElement, FC } from 'react';
import Table from '../Table/Table';
import './TableContainer.scss';

export interface ComponentProps {
    title: string;
    description?: string;
    asideComponents?: Array<ReactElement>;
    footerText?: string;
    pagination?: ReactElement;
}

const TableContainer: FC<ComponentProps> = ({
    title,
    description,
    footerText,
    asideComponents,
    pagination,
}): ReactElement => {
    return (
        <div className="tableContainer">
            <div className="tableContainer_header">
                <div className="tableContainer_header__details">
                    <h2>{title}</h2>
                    <p>{description}</p>
                </div>
                <div className="tableContainer_header__aside">
                    {asideComponents?.map((item, index) => (
                        <React.Fragment key={index}>{item}</React.Fragment>
                    ))}
                </div>
            </div>
            <div className="tableContainer_body">
                <Table
                    columns={['One', 'Two', 'Three', 'Four', 'Five']}
                    records={[]}
                />
            </div>
            <div className="tableContainer_footer">
                <div className="tableContainer_footer__details">
                    <p>{footerText}</p>
                </div>
                {pagination}
            </div>
        </div>
    );
};

export default TableContainer;
