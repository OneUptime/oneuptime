import React from 'react';
import 'CommonUI/src/Styles/Bootstrap';
import ReactDOM from 'react-dom/client';
import App from './App';
import "Common/Typings/Index";

const root: any = ReactDOM.createRoot(
    document.getElementById('root') as HTMLElement
);

root.render(
    <React.StrictMode>
        <App />
    </React.StrictMode>
);
