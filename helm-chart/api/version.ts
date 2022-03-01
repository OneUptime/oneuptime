const version = (req: express.Request, res: express.Response) => {
    res.send({ helmChartVersion: process.env.npm_package_version });
};

export default version;
