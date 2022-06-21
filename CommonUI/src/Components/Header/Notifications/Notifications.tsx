import React, { ReactElement } from "react";

export interface ComponentProps {
    children: ReactElement | Array<ReactElement>
}

const Notifications = (props: ComponentProps): ReactElement => {
    return (<div tabIndex={-1} role="menu" aria-hidden="true" className="dropdown-menu-lg dropdown-menu-end p-0 dropdown-menu">
        <div className="p-3">
            <div className="align-items-center row">
                <div className="col">
                    <h6 className="m-0"> Notifications </h6>
                </div>
                <div className="col-auto"><a className="small" href="/dashboard"> Mark as read</a></div>
            </div>
        </div>
        <div data-simplebar="init" style={{ height: '230px' }}><div className="simplebar-wrapper" style={{ margin: '0px' }}>
            <div className="simplebar-height-auto-observer-wrapper">
                <div className="simplebar-height-auto-observer" /></div>
            <div className="simplebar-mask">
                <div className="simplebar-offset" style={{ right: '0px', bottom: '0px' }}><div className="simplebar-content-wrapper" style={{ height: 'auto', overflow: 'hidden' }}><div className="simplebar-content" style={{ padding: '0px' }}>

                    {props.children}

                </div>
                </div>
                </div>
            </div>
            <div className="simplebar-placeholder" style={{ width: '0px', height: '0px' }} />
        </div>
            <div className="simplebar-track simplebar-horizontal" style={{ visibility: 'hidden' }}><div className="simplebar-scrollbar" style={{ width: '0px', display: 'none' }} /></div><div className="simplebar-track simplebar-vertical" style={{ visibility: 'hidden' }}><div className="simplebar-scrollbar" style={{ height: '0px', display: 'none' }} /></div></div>
        <div className="p-2 border-top d-grid"><a className="btn btn-sm btn-link font-size-14 btn-block text-center" href="/dashboard"><i className="mdi mdi-arrow-right-circle me-1" /> View all </a></div></div>)
}


export default Notifications;