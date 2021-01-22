const webpush = require("web-push");

const vapidKeys = {
    privateKey: "8aXTsH48-cegK-xBApLxxOezCOZIjaWpg81Dny2zbio",
    publicKey: "BFAPbOTTU14VbTe_dnoYlVnOPLKUNm8GYmC50n3i4Ps64sk1Xqx8e894Clrscn1L2PsQ8-l4SsJVw7NRg4cx69Y"
};

webpush.setVapidDetails("mailto:augustine.igwe@hackerbay.io", vapidKeys.publicKey, vapidKeys.privateKey);

function sendPushNotification(req, res) {
    // Get pushSubscription object
    const subscription = req.body;
    console.log('subscription', subscription)

    // Send 201 - resource created
    res.status(201).json({});

    // Create payload
    const payload = JSON.stringify({ title: "Push Test" });

    // Pass object into sendNotification
    webpush
        .sendNotification(subscription, payload)
        .catch(err => console.error(err));
}

module.exports = { sendPushNotification };