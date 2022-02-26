export default {
    sendEmptyResponse(req: $TSFixMe, res: $TSFixMe) {
        //purge request.
        //req = null;
        return res.status(200).send();
    },
};
