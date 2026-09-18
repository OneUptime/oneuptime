/*
 * What a subscriber notification about an announcement or a public note is
 * telling people: that it was just posted, or that something already posted
 * has been edited. The two share one send path and differ only in wording,
 * template and the status columns they track.
 */
enum SubscriberNotificationTrigger {
  Created = "Created",
  Updated = "Updated",
}

export default SubscriberNotificationTrigger;
