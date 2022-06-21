import React, { ReactElement } from "react";

export interface ComponentProps {
   
}

const UserProfile = (_props: ComponentProps): ReactElement => {
    return (<div className="d-inline-block dropdown">
    <button id="page-header-user-dropdown" aria-haspopup="true" className="btn header-item bg-soft-light border-start border-end" aria-expanded="false"><img className="rounded-circle header-profile-user" src="/static/media/avatar-1.0fdabd61.jpg" alt="Header Avatar" /><span className="d-none d-xl-inline-block ms-2 me-1">admin</span><i className="mdi mdi-chevron-down d-none d-xl-inline-block" /></button>
    <div tabIndex={-1} role="menu" aria-hidden="true" className="dropdown-menu-end dropdown-menu">
      <a href="/contacts-profile" tabIndex={0} role="menuitem" className="dropdown-item"> <i className="bx bx-user font-size-16 align-middle me-1" />Profile </a><a href="/profile" tabIndex={0} role="menuitem" className="dropdown-item"><span className="badge bg-success float-end">11</span><i className="bx bx-wrench font-size-16 align-middle me-1" />Settings</a><a href="/page-lock-screen" tabIndex={0} role="menuitem" className="dropdown-item"><i className="bx bx-lock-open font-size-16 align-middle me-1" />Lock screen</a>
      <div className="dropdown-divider" /><a className="dropdown-item" href="/logout"><i className="bx bx-power-off font-size-16 align-middle me-1 text-danger" /><span>Logout</span></a></div>
  </div>)
}


export default UserProfile;