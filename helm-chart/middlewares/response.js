export default {
    sendEmptyResponse(req, res) {
        //purge request.
        //req = null;
        return res.status(200).send();
    },
};
