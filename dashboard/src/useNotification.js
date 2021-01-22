const publicVapidKey =
    "BFAPbOTTU14VbTe_dnoYlVnOPLKUNm8GYmC50n3i4Ps64sk1Xqx8e894Clrscn1L2PsQ8-l4SsJVw7NRg4cx69Y";


async function askUserPermission() {
    return await Notification.requestPermission();
}
askUserPermission().then(consent => {
    console.log('consent', consent)
})

// Check for service worker
export default function registerServiceWorker() {
    if ("serviceWorker" in navigator) {
        console.log('sending this asap')
        send().catch(err => console.log('BIG ERROR', err));
    }
}

// Register SW, Register Push, Send Push
async function send() {
    // Register Service Worker
    console.log("Registering service worker...");
    const register = await navigator.serviceWorker.register(`${process.env.PUBLIC_URL}/sw.js`, { scope: `${process.env.PUBLIC_URL}/` });
    console.log("Service Worker Registered...");
    await navigator.serviceWorker.ready;
    // Register Push
    console.log("Registering Push...");
    const subscription = await register.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicVapidKey)
    });
    console.log("Push Registered...");

    // Send Push Notification
    console.log("Sending Push...");
    await fetch("http://localhost:3002/subscribe", {
        method: "POST",
        body: JSON.stringify(subscription),
        headers: {
            "content-type": "application/json"
        }
    });
    console.log("Push Sent...", subscription);
}

function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
        .replace(/\-/g, "+")
        .replace(/_/g, "/");

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

// export default function registerServiceWorker() {
//     return navigator.serviceWorker.register(`${process.env.PUBLIC_URL}/sw.js`, { scope: `${process.env.PUBLIC_URL}/`});
// }