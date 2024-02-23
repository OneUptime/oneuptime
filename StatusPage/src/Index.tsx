import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { BrowserRouter } from 'react-router-dom';

import Telemetry from 'CommonUI/src/Utils/Telemetry';

Telemetry.init({
    serviceName: 'StatusPage',
});

const root: any = ReactDOM.createRoot(
    document.getElementById('root') as HTMLElement
);

root.render(
    <BrowserRouter>
        <App />
    </BrowserRouter>
);
