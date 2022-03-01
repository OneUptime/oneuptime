import Express from 'common-server/utils/express';
const express = Express.getLibrary();

const version = (req: express.Request, res: express.Response) => {
    res.send({ docsVersion: process.env.npm_package_version });
};

export default version;
