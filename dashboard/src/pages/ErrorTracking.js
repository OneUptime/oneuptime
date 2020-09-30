import React, { Component } from 'react';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import Dashboard from '../components/Dashboard';
import getParentRoute from '../utils/getParentRoute';
import Fade from 'react-reveal/Fade';
import { connect } from 'react-redux';
import PropsType from 'prop-types';
import Badge from '../components/common/Badge';
import moment from 'moment';
import Select from '../components/basic/react-select-fyipe';
import Dropdown, { MenuItem } from '@trendmicro/react-dropdown';

class ErrorTracking extends Component {
    render() {
        if (this.props.currentProject) {
            document.title = this.props.currentProject.name + ' Dashboard';
        }
        const {
            location: { pathname },
            component,
        } = this.props;

        const componentName = component ? component.name : '';
        return (
            <Dashboard ready={this.ready}>
                <Fade>
                    <BreadCrumbItem
                        route={getParentRoute(pathname)}
                        name={componentName}
                    />
                    <BreadCrumbItem route={pathname} name="Error Tracking" />
                    <div className="bs-BIM">
                        <div className="Box-root Margin-bottom--12">
                            <div className="bs-ContentSection Card-root Card-shadow--medium">
                                <div className="Box-root">
                                    <div>
                                        <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                                            <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                                                <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                                    <span className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                                        <span
                                                            style={{
                                                                textTransform:
                                                                    'capitalize',
                                                            }}
                                                        >
                                                            Component Errors (2)
                                                        </span>
                                                    </span>
                                                    <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                        <span>
                                                            A description for
                                                            what error tracking
                                                            is. Here&#39;s a
                                                            list of all errors
                                                            being tracked for
                                                            this component.
                                                        </span>
                                                    </span>
                                                </div>
                                                <span className="Margin-all--8">
                                                    <Dropdown>
                                                        <Dropdown.Toggle
                                                            id="filterToggle"
                                                            className="bs-Button bs-DeprecatedButton"
                                                            title={
                                                                'Sort By: Last Seen'
                                                            }
                                                        />
                                                        <Dropdown.Menu>
                                                            <MenuItem title="clear">
                                                                Clear Filters
                                                            </MenuItem>
                                                            <MenuItem title="unacknowledged">
                                                                Unacknowledged
                                                            </MenuItem>
                                                            <MenuItem title="unresolved">
                                                                Unresolved
                                                            </MenuItem>
                                                        </Dropdown.Menu>
                                                    </Dropdown>
                                                </span>
                                                <div
                                                    style={{
                                                        height: '33px',
                                                        margin: '5px 0px',
                                                    }}
                                                >
                                                    <Select
                                                        name="log_type_selector"
                                                        placeholder="Filter Errors"
                                                        className="db-select-pr"
                                                        id="log_type_selector"
                                                        style={{
                                                            height: '33px',
                                                        }}
                                                        options={[
                                                            {
                                                                value: '',
                                                                label:
                                                                    'Unresolved Errors',
                                                            },
                                                        ]}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                        <div>
                                            <div
                                                style={{
                                                    overflow: 'hidden',
                                                    overflowX: 'auto',
                                                }}
                                            >
                                                <table className="Table">
                                                    <thead className="Table-body">
                                                        <tr className="Table-row db-ListViewItem db-ListViewItem-header">
                                                            <td
                                                                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                                style={{
                                                                    height:
                                                                        '1px',
                                                                }}
                                                            >
                                                                <div
                                                                    className="db-ListViewItem-cellContent Padding-vertical--8 Flex-flex Flex-justifyContent--flexEnd Flex-alignItems--center"
                                                                    style={{
                                                                        height:
                                                                            '100%',
                                                                    }}
                                                                >
                                                                    <input type="checkbox" />
                                                                </div>
                                                            </td>
                                                            <td
                                                                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                                style={{
                                                                    height:
                                                                        '1px',
                                                                    minWidth:
                                                                        '350px',
                                                                }}
                                                            >
                                                                <div className="db-ListViewItem-cellContent Box-root Padding-all--8 Flex-flex">
                                                                    <button
                                                                        className="bs-Button bs-Button--icon bs-Button--check"
                                                                        type="button"
                                                                    >
                                                                        <span>
                                                                            Resolve
                                                                        </span>
                                                                        <img
                                                                            src="/dashboard/assets/img/down.svg"
                                                                            alt=""
                                                                            style={{
                                                                                margin:
                                                                                    '0px 10px',
                                                                                height:
                                                                                    '10px',
                                                                                width:
                                                                                    '10px',
                                                                            }}
                                                                        />
                                                                    </button>
                                                                    <button
                                                                        className="bs-Button bs-Button--icon bs-Button--block"
                                                                        type="button"
                                                                    >
                                                                        <span>
                                                                            Ignore
                                                                        </span>
                                                                        <img
                                                                            src="/dashboard/assets/img/down.svg"
                                                                            alt=""
                                                                            style={{
                                                                                margin:
                                                                                    '0px 10px',
                                                                                height:
                                                                                    '10px',
                                                                                width:
                                                                                    '10px',
                                                                            }}
                                                                        />
                                                                    </button>
                                                                    <button
                                                                        className="bs-Button"
                                                                        type="button"
                                                                        disabled={
                                                                            true
                                                                        }
                                                                    >
                                                                        <span>
                                                                            Merge
                                                                        </span>
                                                                    </button>
                                                                    <span className="Margin-left--8">
                                                                        <Dropdown>
                                                                            <Dropdown.Toggle
                                                                                id="filterToggle"
                                                                                className="bs-Button bs-DeprecatedButton"
                                                                            />
                                                                            <Dropdown.Menu>
                                                                                <MenuItem title="clear">
                                                                                    Clear
                                                                                    Filters
                                                                                </MenuItem>
                                                                                <MenuItem title="unacknowledged">
                                                                                    Unacknowledged
                                                                                </MenuItem>
                                                                                <MenuItem title="unresolved">
                                                                                    Unresolved
                                                                                </MenuItem>
                                                                            </Dropdown.Menu>
                                                                        </Dropdown>
                                                                    </span>
                                                                </div>
                                                            </td>
                                                            <td
                                                                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                                style={{
                                                                    height:
                                                                        '1px',
                                                                }}
                                                            >
                                                                <div className="db-ListViewItem-cellContent Box-root Padding-all--8 Flex-flex Flex-justifyContent--spaceBetween">
                                                                    <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                                                        <span>
                                                                            Graph
                                                                        </span>
                                                                    </span>
                                                                    <div className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-wrap--wrap">
                                                                        <span className="Padding-right--8">
                                                                            24h
                                                                        </span>
                                                                        <span className="Text-color--slate">
                                                                            14d
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                            </td>
                                                            <td
                                                                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                                style={{
                                                                    height:
                                                                        '1px',
                                                                }}
                                                            >
                                                                <div className="db-ListViewItem-cellContent Box-root Padding-all--8 Flex-flex Flex-justifyContent--center">
                                                                    <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                                                        <span>
                                                                            Events
                                                                        </span>
                                                                    </span>
                                                                </div>
                                                            </td>
                                                            <td
                                                                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                                style={{
                                                                    height:
                                                                        '1px',
                                                                }}
                                                            >
                                                                <div className="db-ListViewItem-cellContent Box-root Padding-all--8 Flex-flex Flex-justifyContent--center">
                                                                    <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                                                        <span>
                                                                            Users
                                                                        </span>
                                                                    </span>
                                                                </div>
                                                            </td>
                                                            <td
                                                                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                                style={{
                                                                    height:
                                                                        '1px',
                                                                }}
                                                            >
                                                                <div className="db-ListViewItem-cellContent Box-root Padding-all--8 Flex-flex Flex-justifyContent--center">
                                                                    <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                                                        <span>
                                                                            Assigned
                                                                            To
                                                                        </span>
                                                                    </span>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="Table-body">
                                                        <tr className="Table-row db-ListViewItem bs-ActionsParent db-ListViewItem--hasLink incidentListItem">
                                                            <td
                                                                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord"
                                                                style={{
                                                                    height:
                                                                        '1px',
                                                                }}
                                                            >
                                                                <div className="Padding-vertical--8 Flex-flex Flex-justifyContent--spaceBetween">
                                                                    <div
                                                                        style={{
                                                                            height:
                                                                                '20px',
                                                                            width:
                                                                                '10px',
                                                                            backgroundColor:
                                                                                'red',
                                                                            borderTopRightRadius:
                                                                                '5px',
                                                                            borderBottomRightRadius:
                                                                                '5px',
                                                                        }}
                                                                    ></div>
                                                                    <input type="checkbox" />
                                                                </div>
                                                            </td>
                                                            <td
                                                                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord"
                                                                style={{
                                                                    height:
                                                                        '1px',
                                                                    minWidth:
                                                                        '350px',
                                                                }}
                                                            >
                                                                <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                                    <span className="db-ListViewItem-text Text-color--cyan Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                        <div
                                                                            className="Box-root Margin-right--16"
                                                                            style={{
                                                                                cursor:
                                                                                    'pointer',
                                                                            }}
                                                                        >
                                                                            <span className="Text-color--gray">
                                                                                <span className="Text-color--slate Text-fontSize--16 Padding-right--4">
                                                                                    Type
                                                                                    Error
                                                                                </span>{' '}
                                                                                service.function
                                                                                (more
                                                                                details)
                                                                            </span>
                                                                        </div>
                                                                    </span>
                                                                    <div>
                                                                        <div
                                                                            className="Box-root Flex"
                                                                            style={{
                                                                                paddingTop:
                                                                                    '5px',
                                                                            }}
                                                                        >
                                                                            <div className="db-RadarRulesListUserName Box-root Flex-flex Flex-alignItems--center Flex-direction--row Flex-justifyContent--flexStart">
                                                                                Cannot
                                                                                read
                                                                                property
                                                                                name
                                                                                of
                                                                                undefined
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                    <div>
                                                                        <div
                                                                            className="Box-root Flex"
                                                                            style={{
                                                                                paddingTop:
                                                                                    '5px',
                                                                            }}
                                                                        >
                                                                            <div className="db-RadarRulesListUserName Box-root Flex-flex Flex-alignItems--center Flex-direction--row Flex-justifyContent--flexStart">
                                                                                <Badge color="yellow">
                                                                                    C
                                                                                </Badge>{' '}
                                                                                <span className=" Padding-left--4">
                                                                                    Component
                                                                                    Title
                                                                                </span>
                                                                                <div
                                                                                    className="Box-root Margin-right--16 Padding-horizontal--12"
                                                                                    style={{
                                                                                        cursor:
                                                                                            'pointer',
                                                                                    }}
                                                                                >
                                                                                    <img
                                                                                        src="/dashboard/assets/img/time.svg"
                                                                                        alt=""
                                                                                        style={{
                                                                                            marginBottom:
                                                                                                '-5px',
                                                                                            height:
                                                                                                '15px',
                                                                                            width:
                                                                                                '15px',
                                                                                        }}
                                                                                    />
                                                                                    <span className="Padding-left--8">
                                                                                        {moment().fromNow()}{' '}
                                                                                        -{' '}
                                                                                        {moment().format(
                                                                                            'MMMM Do YYYY, h:mm:ss a'
                                                                                        )}
                                                                                    </span>
                                                                                </div>
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </td>
                                                            <td
                                                                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord"
                                                                style={{
                                                                    height:
                                                                        '1px',
                                                                }}
                                                            >
                                                                <div className="db-ListViewItem-link">
                                                                    <div className="db-ListViewItem-cellContent  Box-root Padding-horizontal--2 Padding-vertical--8 Flex-flex Flex-justifyContent--center Flex-alignItems--center ">
                                                                        <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                            -
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                            </td>
                                                            <td
                                                                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord"
                                                                style={{
                                                                    height:
                                                                        '1px',
                                                                }}
                                                            >
                                                                <div className="db-ListViewItem-link">
                                                                    <div className="db-ListViewItem-cellContent  Box-root Padding-horizontal--2 Padding-vertical--8 Flex-flex Flex-justifyContent--center Flex-alignItems--center ">
                                                                        <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                            3.4k
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                            </td>
                                                            <td
                                                                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord"
                                                                style={{
                                                                    height:
                                                                        '1px',
                                                                }}
                                                            >
                                                                <div className="db-ListViewItem-link">
                                                                    <div className="db-ListViewItem-cellContent Box-root Padding-horizontal--2 Padding-vertical--8 Flex-flex Flex-justifyContent--center Flex-alignItems--center">
                                                                        <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                            0
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                            </td>
                                                            <td
                                                                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord"
                                                                style={{
                                                                    height:
                                                                        '1px',
                                                                }}
                                                            >
                                                                <div className="db-ListViewItem-link">
                                                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8 Flex-flex Flex-justifyContent--center Flex-alignItems--center">
                                                                        <img
                                                                            src="/dashboard/assets/img/user.svg"
                                                                            alt=""
                                                                            style={{
                                                                                marginBottom:
                                                                                    '-5px',
                                                                                height:
                                                                                    '20px',
                                                                                width:
                                                                                    '20px',
                                                                                marginRight:
                                                                                    '10px',
                                                                            }}
                                                                        />
                                                                        <img
                                                                            src="/dashboard/assets/img/down.svg"
                                                                            alt=""
                                                                            style={{
                                                                                marginBottom:
                                                                                    '-5px',
                                                                                height:
                                                                                    '10px',
                                                                                width:
                                                                                    '10px',
                                                                            }}
                                                                        />
                                                                    </div>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                        <tr className="Table-row db-ListViewItem bs-ActionsParent db-ListViewItem--hasLink incidentListItem">
                                                            <td
                                                                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord"
                                                                style={{
                                                                    height:
                                                                        '1px',
                                                                }}
                                                            >
                                                                <div className="Padding-vertical--8 Flex-flex Flex-justifyContent--spaceBetween">
                                                                    <div
                                                                        style={{
                                                                            height:
                                                                                '20px',
                                                                            width:
                                                                                '10px',
                                                                            backgroundColor:
                                                                                'orange',
                                                                            borderTopRightRadius:
                                                                                '5px',
                                                                            borderBottomRightRadius:
                                                                                '5px',
                                                                        }}
                                                                    ></div>
                                                                    <input type="checkbox" />
                                                                </div>
                                                            </td>
                                                            <td
                                                                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord"
                                                                style={{
                                                                    height:
                                                                        '1px',
                                                                    minWidth:
                                                                        '350px',
                                                                }}
                                                            >
                                                                <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                                    <span className="db-ListViewItem-text Text-color--cyan Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                        <div
                                                                            className="Box-root Margin-right--16"
                                                                            style={{
                                                                                cursor:
                                                                                    'pointer',
                                                                            }}
                                                                        >
                                                                            <span className="Text-color--gray">
                                                                                <span className="Text-color--slate Text-fontSize--16 Padding-right--4">
                                                                                    Type
                                                                                    Error
                                                                                </span>{' '}
                                                                                service.function
                                                                                (more
                                                                                details)
                                                                            </span>
                                                                        </div>
                                                                    </span>
                                                                    <div>
                                                                        <div
                                                                            className="Box-root Flex"
                                                                            style={{
                                                                                paddingTop:
                                                                                    '5px',
                                                                            }}
                                                                        >
                                                                            <div className="db-RadarRulesListUserName Box-root Flex-flex Flex-alignItems--center Flex-direction--row Flex-justifyContent--flexStart">
                                                                                Cannot
                                                                                read
                                                                                property
                                                                                name
                                                                                of
                                                                                undefined
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                    <div>
                                                                        <div
                                                                            className="Box-root Flex"
                                                                            style={{
                                                                                paddingTop:
                                                                                    '5px',
                                                                            }}
                                                                        >
                                                                            <div className="db-RadarRulesListUserName Box-root Flex-flex Flex-alignItems--center Flex-direction--row Flex-justifyContent--flexStart">
                                                                                <Badge>
                                                                                    R
                                                                                </Badge>{' '}
                                                                                <span className=" Padding-left--4">
                                                                                    Random
                                                                                    Component
                                                                                </span>
                                                                                <div
                                                                                    className="Box-root Margin-right--16 Padding-horizontal--12"
                                                                                    style={{
                                                                                        cursor:
                                                                                            'pointer',
                                                                                    }}
                                                                                >
                                                                                    <img
                                                                                        src="/dashboard/assets/img/time.svg"
                                                                                        alt=""
                                                                                        style={{
                                                                                            marginBottom:
                                                                                                '-5px',
                                                                                            height:
                                                                                                '15px',
                                                                                            width:
                                                                                                '15px',
                                                                                        }}
                                                                                    />
                                                                                    <span className="Padding-left--8">
                                                                                        {moment().fromNow()}{' '}
                                                                                        -{' '}
                                                                                        {moment().format(
                                                                                            'MMMM Do YYYY, h:mm:ss a'
                                                                                        )}
                                                                                    </span>
                                                                                </div>
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </td>
                                                            <td
                                                                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord"
                                                                style={{
                                                                    height:
                                                                        '1px',
                                                                }}
                                                            >
                                                                <div className="db-ListViewItem-link">
                                                                    <div className="db-ListViewItem-cellContent  Box-root Padding-horizontal--2 Padding-vertical--8 Flex-flex Flex-justifyContent--center Flex-alignItems--center ">
                                                                        <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                            -
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                            </td>
                                                            <td
                                                                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord"
                                                                style={{
                                                                    height:
                                                                        '1px',
                                                                }}
                                                            >
                                                                <div className="db-ListViewItem-link">
                                                                    <div className="db-ListViewItem-cellContent  Box-root Padding-horizontal--2 Padding-vertical--8 Flex-flex Flex-justifyContent--center Flex-alignItems--center ">
                                                                        <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                            3.4k
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                            </td>
                                                            <td
                                                                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord"
                                                                style={{
                                                                    height:
                                                                        '1px',
                                                                }}
                                                            >
                                                                <div className="db-ListViewItem-link">
                                                                    <div className="db-ListViewItem-cellContent Box-root Padding-horizontal--2 Padding-vertical--8 Flex-flex Flex-justifyContent--center Flex-alignItems--center">
                                                                        <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                            0
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                            </td>
                                                            <td
                                                                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord"
                                                                style={{
                                                                    height:
                                                                        '1px',
                                                                }}
                                                            >
                                                                <div className="db-ListViewItem-link">
                                                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8 Flex-flex Flex-justifyContent--center Flex-alignItems--center">
                                                                        <img
                                                                            src="/dashboard/assets/img/user.svg"
                                                                            alt=""
                                                                            style={{
                                                                                marginBottom:
                                                                                    '-5px',
                                                                                height:
                                                                                    '20px',
                                                                                width:
                                                                                    '20px',
                                                                                marginRight:
                                                                                    '10px',
                                                                            }}
                                                                        />
                                                                        <img
                                                                            src="/dashboard/assets/img/down.svg"
                                                                            alt=""
                                                                            style={{
                                                                                marginBottom:
                                                                                    '-5px',
                                                                                height:
                                                                                    '10px',
                                                                                width:
                                                                                    '10px',
                                                                            }}
                                                                        />
                                                                    </div>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </Fade>
            </Dashboard>
        );
    }
}

ErrorTracking.displayName = 'ErrorTracking';
const mapStateToProps = (state, ownProps) => {
    const { componentId } = ownProps.match.params;
    const currentProject = state.project.currentProject;
    let component;
    state.component.componentList.components.forEach(item => {
        item.components.forEach(c => {
            if (String(c._id) === String(componentId)) {
                component = c;
            }
        });
    });
    return {
        currentProject,
        component,
    };
};
ErrorTracking.propTypes = {
    component: PropsType.object,
    currentProject: PropsType.object,
    location: PropsType.object,
};
export default connect(mapStateToProps)(ErrorTracking);
