import React from 'react';
import ShouldRender from '../basic/ShouldRender';
import PropTypes from 'prop-types';
import { ListLoader } from '../basic/Loader';

const GitCredentialList = ({ isRequesting, error, gitCredentials }) => (
    <div className="Box-root  Margin-bottom--12">
        <div className="bs-ContentSection Card-root Card-shadow--medium">
            <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                    <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                        <span className="ContentHeader-title Text-color--dark Text-display--inline Text-fontSize--20 Text-fontWeight--regular Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                            <span style={{ textTransform: 'capitalize' }}>
                                Git Credentials
                            </span>
                        </span>
                        <span
                            style={{ textTransform: 'lowercase' }}
                            className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap"
                        >
                            <span>
                                Here&#39;s a list of all the available Git
                                Credentials for this project
                            </span>
                        </span>
                    </div>
                    <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                        <div></div>
                    </div>
                </div>
            </div>
            <div style={{ overflow: 'hidden', overflowX: 'auto' }}>
                <table className="Table">
                    <thead className="Table-body">
                        <tr className="Table-row db-ListViewItem db-ListViewItem-header">
                            <td
                                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                style={{ height: '1px', minWidth: '270px' }}
                            >
                                <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                    <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                        <span>Git Username</span>
                                    </span>
                                </div>
                            </td>
                        </tr>
                    </thead>

                    <tbody
                        className="Table-body"
                        style={{ pointerEvents: 'none' }}
                    >
                        {gitCredentials.map(gitCredential => (
                            <tr
                                key={gitCredential._id}
                                className="Table-row db-ListViewItem bs-ActionsParent db-ListViewItem--hasLink"
                            >
                                <td
                                    className="Table-cell Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{ height: '1px' }}
                                >
                                    <a
                                        className="db-ListViewItem-link"
                                        href="/radar/lists/rsl_1C6makKGKS4tO8UaygcziemN"
                                    >
                                        <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                            <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                <div className="Box-root">
                                                    <span>
                                                        {
                                                            gitCredential.gitUsername
                                                        }
                                                    </span>
                                                </div>
                                            </span>
                                        </div>
                                    </a>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <ShouldRender if={!isRequesting && gitCredentials.length === 0}>
                <div
                    className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--center"
                    style={{
                        textAlign: 'center',
                        marginTop: '20px',
                        padding: '0 10px',
                    }}
                >
                    There are no git credentials for this project
                </div>
            </ShouldRender>

            <ShouldRender if={isRequesting}>
                <ListLoader />
            </ShouldRender>

            <div className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween">
                <ShouldRender if={error}>
                    <div className="bs-Tail-copy" style={{ padding: '10px' }}>
                        <div
                            className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart"
                            style={{
                                textAlign: 'center',
                                marginTop: '10px',
                                padding: '0 10px',
                            }}
                        >
                            <div className="Box-root Margin-right--8">
                                <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                            </div>
                            <div className="Box-root">
                                <span style={{ color: 'red' }}>{error}</span>
                            </div>
                        </div>
                    </div>
                </ShouldRender>
                <div className="Box-root Padding-horizontal--20 Padding-vertical--16">
                    <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart"></div>
                </div>
            </div>
        </div>
    </div>
);

GitCredentialList.displayName = 'GitCredentialList';

GitCredentialList.propTypes = {
    error: PropTypes.string,
    isRequesting: PropTypes.bool.isRequired,
    gitCredentials: PropTypes.array,
};

export default GitCredentialList;
