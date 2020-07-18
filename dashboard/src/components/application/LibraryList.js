import React from 'react';
import { logLibraries } from '../../config';

function renderLibraries() {
    const list = logLibraries.getLibraries().map(library => {
        return (
            <a
                target="_blank"
                key={library.id}
                href={library.link}
                rel="noreferrer noopener"
            >
                <img
                    style={{
                        width: '30px',
                        height: '30px',
                        margin: '10px',
                    }}
                    src={library.icon}
                    alt={library.iconText}
                />
            </a>
        );
    });
    return list;
}
const LibraryList = () => (
    <div tabIndex="0" className="Box-root Margin-vertical--12">
        <div className="db-Trends bs-ContentSection Card-root Card-shadow--medium">
            <div className="Box-root">
                <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                    <div className="Box-root">
                        <span className="ContentHeader-title Text-color--inherit Text-fontSize--16 Text-fontWeight--medium Text-typeface--base Text-lineHeight--28">
                            <span>Application Logging Libraries</span>
                        </span>
                        <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap"></span>
                    </div>
                    <div>{renderLibraries()}</div>
                </div>
            </div>
        </div>
    </div>
);

LibraryList.displayName = 'LibraryList';

export default LibraryList;
