import React from 'react';

const Page = () => {
    return (<div className="page-content">
    <div className="container-fluid">
      <div className="row">
        <div className="col-12">
          <div className="page-title-box d-sm-flex align-items-center justify-content-between">
            <h4 className="mb-0 font-size-18">Dashboard</h4>
            <div className="page-title-right">
              <ol className="breadcrumb m-0">
                <li className="breadcrumb-item">
                  <a href="/dashboard">Dashboard</a>
                </li>
                <li className="active breadcrumb-item" aria-current="page">
                  <a href="/dashboard">Dashboard</a>
                </li>
              </ol>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
  )
}

export default Page; 