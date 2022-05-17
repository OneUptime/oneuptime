import app from 'CommonServer/Utils/StartServer';
import path from 'path';
import {
    ExpressRequest,
    ExpressResponse,
    ExpressStatic,
} from 'CommonServer/Utils/Express';

app.use(ExpressStatic(path.join(__dirname, 'build')));

app.use(
    '/accounts/static/js',
    ExpressStatic(path.join(__dirname, 'build', 'static', 'js'))
);

app.use('/accounts', ExpressStatic(path.join(__dirname, 'build')));

app.get('/*', (_req: ExpressRequest, res: ExpressResponse) => {
    res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

export default app;
