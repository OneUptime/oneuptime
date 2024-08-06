export interface Review {
  name: string;
  text: string;
  title: string;
}

const reviews: Review[] = [
  {
    name: "Anderson, GK2 Cloud",
    text: "Thanks for building OneUptime, it really is fantastic. We are getting more excited every day!",
    title: "OneUptime is fantastic!",
  },
  {
    name: "Reg, Skillable",
    text: "We use OneUptime to reliably monitor endpoint availability globally, and it delivers.",
    title: "OneUptime delivers!",
  },
  {
    name: "Charlie",
    text: "I love the on-call rotation setup. It has made scheduling so much easier.",
    title: "Great on-call rotation",
  },
  {
    name: "Diana",
    text: "The performance tracking and log analysis tools are very powerful. Highly recommend!",
    title: "Powerful tools",
  },
  {
    name: "Ethan",
    text: "OneUptime's dashboard is very user-friendly and intuitive.",
    title: "User-friendly dashboard",
  },
  {
    name: "Fiona",
    text: "The uptime monitoring is very reliable. We haven't missed a single alert.",
    title: "Reliable monitoring",
  },
  {
    name: "George",
    text: "The customer support team is very responsive and helpful.",
    title: "Excellent customer support",
  },
  {
    name: "Hannah",
    text: "Setting up tests and securing our services has never been easier.",
    title: "Easy setup and security",
  },
  {
    name: "Ian",
    text: "The status page feature is fantastic. Our customers appreciate the transparency.",
    title: "Fantastic status page",
  },
  {
    name: "Jenna",
    text: "OneUptime has improved our incident response time dramatically.",
    title: "Improved response time",
  },
  {
    name: "Kevin",
    text: "The integration with our existing tools was seamless.",
    title: "Seamless integration",
  },
  {
    name: "Laura",
    text: "The alerts are very customizable, which is great for our specific needs.",
    title: "Customizable alerts",
  },
  {
    name: "Mike",
    text: "The performance tracking has helped us identify and fix issues quickly.",
    title: "Quick issue resolution",
  },
  {
    name: "Nina",
    text: "The log analysis feature is very detailed and insightful.",
    title: "Detailed log analysis",
  },
  {
    name: "Oscar",
    text: "OneUptime has made our monitoring process much more efficient.",
    title: "Efficient monitoring",
  },
  {
    name: "Paula",
    text: "The incident management workflow is very well thought out.",
    title: "Well-designed workflow",
  },
  {
    name: "Quinn",
    text: "The on-call rotation feature has reduced our scheduling headaches.",
    title: "Reduced scheduling headaches",
  },
  {
    name: "Rachel",
    text: "The status page is very professional and easy to update.",
    title: "Professional status page",
  },
  {
    name: "Sam",
    text: "The alerts are very accurate and timely.",
    title: "Accurate alerts",
  },
  {
    name: "Tina",
    text: "The customer support is always ready to help with any issues.",
    title: "Supportive customer service",
  },
  {
    name: "Umar",
    text: "The performance tracking has given us great insights into our system's health.",
    title: "Great insights",
  },
  {
    name: "Vera",
    text: "The log analysis has helped us debug errors much faster.",
    title: "Faster debugging",
  },
  {
    name: "Will",
    text: "The uptime monitoring is very dependable.",
    title: "Dependable monitoring",
  },
  {
    name: "Xena",
    text: "The incident management tools have streamlined our processes.",
    title: "Streamlined processes",
  },
  {
    name: "Yara",
    text: "The on-call rotation setup is very flexible.",
    title: "Flexible rotation setup",
  },
  {
    name: "Zane",
    text: "The status page has improved our communication with customers.",
    title: "Improved communication",
  },
  {
    name: "Aiden",
    text: "The alerts are very precise and help us stay on top of issues.",
    title: "Precise alerts",
  },
  {
    name: "Bella",
    text: "The performance tracking tools are very comprehensive.",
    title: "Comprehensive tools",
  },
  {
    name: "Carter",
    text: "The log analysis feature is very user-friendly.",
    title: "User-friendly log analysis",
  },
  {
    name: "Daisy",
    text: "OneUptime has made our monitoring and management tasks much easier.",
    title: "Easier management",
  },
  {
    name: "Eli",
    text: "The incident management feature is very effective.",
    title: "Effective incident management",
  },
  {
    name: "Faith",
    text: "The on-call rotation has improved our team's efficiency.",
    title: "Improved efficiency",
  },
  {
    name: "Gabe",
    text: "The status page is very easy to set up and maintain.",
    title: "Easy setup",
  },
  {
    name: "Holly",
    text: "The alerts are very reliable and timely.",
    title: "Reliable alerts",
  },
  {
    name: "Isaac",
    text: "The performance tracking has helped us optimize our system.",
    title: "Optimized system",
  },
  {
    name: "Jade",
    text: "The log analysis tools are very detailed and helpful.",
    title: "Helpful log analysis",
  },
  {
    name: "Kyle",
    text: "OneUptime has made our monitoring process much more streamlined.",
    title: "Streamlined monitoring",
  },
  {
    name: "Lily",
    text: "The incident management workflow is very efficient.",
    title: "Efficient workflow",
  },
  {
    name: "Mason",
    text: "The on-call rotation feature is very user-friendly.",
    title: "User-friendly rotation",
  },
  {
    name: "Nora",
    text: "The status page has been a great addition to our communication tools.",
    title: "Great addition",
  },
  {
    name: "Owen",
    text: "The alerts are very accurate and help us respond quickly.",
    title: "Quick response",
  },
  {
    name: "Piper",
    text: "The performance tracking tools are very insightful.",
    title: "Insightful tools",
  },
  {
    name: "Quincy",
    text: "The log analysis feature is very comprehensive.",
    title: "Comprehensive log analysis",
  },
  {
    name: "Riley",
    text: "OneUptime has made our incident management process much smoother.",
    title: "Smoother process",
  },
  {
    name: "Sophie",
    text: "The on-call rotation setup is very efficient.",
    title: "Efficient setup",
  },
  {
    name: "Tyler",
    text: "The status page is very professional and easy to use.",
    title: "Professional and easy",
  },
  {
    name: "Uma",
    text: "The alerts are very timely and help us stay on top of issues.",
    title: "Timely alerts",
  },
  {
    name: "Victor",
    text: "The performance tracking has given us great insights into our system.",
    title: "Great system insights",
  },
  {
    name: "Wendy",
    text: "The log analysis tools are very detailed and useful.",
    title: "Useful log analysis",
  },
];

// divide reviews array into three equal lists. This is helpful for the UI
const reviewsList1: Array<Review> = [];
const reviewsList2: Array<Review> = [];
const reviewsList3: Array<Review> = [];

for (let i: number = 0; i < reviews.length; i++) {
  if (i % 3 === 0) {
    reviewsList1.push(reviews[i]!);
  } else if (i % 3 === 1) {
    reviewsList2.push(reviews[i]!);
  } else {
    reviewsList3.push(reviews[i]!);
  }
}

export default { reviewsList1, reviewsList2, reviewsList3 };
