
self.addEventListener("push", e => {
  const data = e.data.json();
  self.registration.showNotification(data.title, {
    body: "Notified by Augustine Igwe!!!",
    icon: "https://www.dropbox.com/s/dwawm02f1toxnm8/Fyipe-Icon.png?dl=0&raw=1"
  });
});
  