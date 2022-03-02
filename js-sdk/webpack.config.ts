import path from 'path';

const serverBuild = {
    mode: 'production',
    entry: './src/index.ts',
    target: 'node',
    output: {
        path: path.resolve('dist'),
        filename: 'oneuptime.js',
        library: 'OneUptime',
        libraryExport: 'default',
        libraryTarget: 'umd',
        globalObject: 'this',
    },
    module: {
        rules: [
            {
                test: /\.js?$/,
                exclude: /(node_modules)/,
                use: {
                    loader: 'babel-loader',
                    options: {
                        presets: ['@babel/preset-env'],
                    },
                },
            },
        ],
    },
    resolve: {
        extensions: ['.js'],
    },
};
/*const webBuild = {
    ...serverBuild,
    target: 'web',
    output: { ...serverBuild.output, filename: 'oneuptime.min.js' },
};*/
export default serverBuild;
