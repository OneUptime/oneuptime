const version = (req: Request, res: Response) => {
    res.send({ helmChartVersion: process.env['npm_package_version'] });
};

export default version;
