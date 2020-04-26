module.exports = (product) => {
    var products = {
        pagerduty: {
            productName: "PagerDuty",
            iconUrl: "/img/pagerduty.jpeg",
            price:"$29/mo",
            fyipePrice: "$22/mo",
            description: "Check out how we compare with PagerDuty. We do most of what PagerDuty does and a whole lot more.",
            descriptionLine2: "If you're a startup, we're a lot cheaper than PagerDuty which saves you a hundreds today, thousands as you grow.",
            faq: [
                {
                    question: "How does Fyipe compare with PagerDuty?",
                    answer: "PagerDuty is an incident management and on call tool whereas Fyipe is a complete SRE and IT Ops platform. Fyipe offers mostly everything that PagerDuty offers, but a lot more like monitoring, status-page, security, performance-monitoring and more. Please check detailed comparision above for more info."
                },
                {
                    question: "Do I need to buy a monitoring solution to monitor my resources?",
                    answer: "PagerDuty needs a seperate monitoring solution that you need to buy which then sends data to PagerDuty for on call and incident management. Fyipe has a built in monitoring solution as well. You use one product, your team has one dashboard, save time, simplify ops."
                },
                {
                    question: "I have already bought an external monitoring solution. Will Fyipe work with it?",
                    answer: "Yes! We integrate with every single monitoring solution in the market - like Pingdom, UptimeRobot, DataDog, Site 24x7 and more."
                }
            ],
            items: [
            {
                type: "category",
                title: "Incident Management and On Call Scheduling",
            },
            {
                type: "item",
                title: "Alerts by Email, SMS, Call and Push Notifications",
                description: "Have your team alerted by any of the channels including Slack and Microsoft Teams",
                productColumn: "tick",
                fyipeColumn: "tick"
            },
            {
                type: "item",
                title: "On Call Rotations",
                description: "Rotate your on-call team daily, weekly or monthly. We also support custom rotations.",
                productColumn: "tick",
                fyipeColumn: "tick"
            },
            {
                type: "item",
                title: "Vacation Policy",
                description: "Have vacation policy built into your company's on-call schedule.",
                productColumn: "tick",
                fyipeColumn: "tick"
            },
            {
                type: "item",
                title: "Sick Policy",
                description: "Have sick policy built into your company's on-call schedule.",
                productColumn: "tick",
                fyipeColumn: "tick"
            },
            {
                type: "item",
                title: "On-call for Geo-distributed teams",
                description: "Support on-call schedules for teams in multiple timezones who are geo-distributed.",
                productColumn: "tick",
                fyipeColumn: "tick"
            },
            {
                type: "category",
                title: "Monitoring",
            },
            {
                type: "item",
                title: "Monitor anything",
                description: "Server, Containers, API's, Websites, IoT and more.",
                productColumn: "",
                fyipeColumn: "tick"
            },
            {
                type: "item",
                title: "Uptime Check",
                description: "How often we check uptime of your resources.",
                productColumn: "",
                fyipeColumn: "tick"
            },
            {
                type: "item",
                title: "Probe Locations",
                description: "We check your uptime from different locations around the world.",
                productColumn: "",
                fyipeColumn: "tick"
            },
            {
                type: "item",
                title: "Public Status Pages",
                description: "Public Status Page for your customers.",
                productColumn: "Every 1 second",
                fyipeColumn: "US, Canada, EU & Australia."
            },
            {
                type: "category",
                title: "Status Page",
            },
            {
                type: "item",
                title: "Public Status Pages",
                description: "Public Status Page for your customers.",
                productColumn: "",
                fyipeColumn: "tick"
            },
            {
                type: "item",
                title: "Unlimited Subscribers",
                description: "You can have unlimited customer subscribers and have them alerted by Email, SMS, RSS or more.",
                productColumn: "",
                fyipeColumn: "tick"
            },
            {
                type: "item",
                title: "Scheduled Events",
                description: "You can show scheduled maintenance window on your status page.",
                productColumn: "",
                fyipeColumn: "tick"
            },
            {
                type: "item",
                title: "Private Status Page",
                description: "Private status pages for your internal team.",
                productColumn: "",
                fyipeColumn: "tick"
            },
            {
                type: "category",
                title: "Misc",
            },
            {
                type: "item",
                title: "Integrations",
                description: "Integrate Fyipe with more than 2000+ apps.",
                productColumn: "Integrates with 350+ apps",
                fyipeColumn: "Integrates with 2000+ apps"
            },
            {
                type: "item",
                title: "API Access",
                description: "Build custom integrations with unlimited API access.",
                productColumn: "tick",
                fyipeColumn: "tick"
            }]
        },
        "statuspage.io": {
            productName: "StatusPage.io",
            iconUrl: "/img/statuspagelogo.png",
            price:"$79/mo",
            fyipePrice: "$22/mo",
            description: "Check out how we compare with StatusPage.io. We do most of what StatusPage.io does and a whole lot more.",
            descriptionLine2: "If you're a startup, we're a lot cheaper than StatusPage.io which saves you a hundreds today, thousands as you grow.",
            faq: [
                {
                    question: "How does Fyipe compare with StatusPage.io?",
                    answer: "StatusPage.io is a status page tool whereas Fyipe is a complete SRE and IT Ops platform. Fyipe offers mostly everything that StatusPage.io offers, but a lot more like monitoring, incident management, on-call scheduling, security, performance-monitoring and more. Please check detailed comparision above for more info."
                },
                {
                    question: "Do I need to buy a monitoring solution to monitor my resources?",
                    answer: "StatusPage.io needs a seperate monitoring solution that you need to buy which then sends data to StatusPage.io. Fyipe has a built in monitoring solution as well. You use one product, your team has one dashboard, save time, simplify ops."
                },
                {
                    question: "I have already bought an external monitoring solution. Will Fyipe work with it?",
                    answer: "Yes! We integrate with every single monitoring solution in the market - like Pingdom, UptimeRobot, DataDog, Site 24x7 and more."
                }
            ],
            items: [
            {
                type: "category",
                title: "Incident Management and On Call Scheduling",
            },
            {
                type: "item",
                title: "Alerts by Email, SMS, Call and Push Notifications",
                description: "Have your team alerted by any of the channels including Slack and Microsoft Teams",
                productColumn: "",
                fyipeColumn: "tick"
            },
            {
                type: "item",
                title: "On Call Rotations",
                description: "Rotate your on-call team daily, weekly or monthly. We also support custom rotations.",
                productColumn: "",
                fyipeColumn: "tick"
            },
            {
                type: "item",
                title: "Vacation Policy",
                description: "Have vacation policy built into your company's on-call schedule.",
                productColumn: "",
                fyipeColumn: "tick"
            },
            {
                type: "item",
                title: "Sick Policy",
                description: "Have sick policy built into your company's on-call schedule.",
                productColumn: "",
                fyipeColumn: "tick"
            },
            {
                type: "item",
                title: "On-call for Geo-distributed teams",
                description: "Support on-call schedules for teams in multiple timezones who are geo-distributed.",
                productColumn: "",
                fyipeColumn: "tick"
            },
            {
                type: "category",
                title: "Monitoring",
            },
            {
                type: "item",
                title: "Monitor anything",
                description: "Server, Containers, API's, Websites, IoT and more.",
                productColumn: "",
                fyipeColumn: "tick"
            },
            {
                type: "item",
                title: "Uptime Check",
                description: "How often we check uptime of your resources.",
                productColumn: "",
                fyipeColumn: "tick"
            },
            {
                type: "item",
                title: "Probe Locations",
                description: "We check your uptime from different locations around the world.",
                productColumn: "",
                fyipeColumn: "tick"
            },
            {
                type: "item",
                title: "Public Status Pages",
                description: "Public Status Page for your customers.",
                productColumn: "",
                fyipeColumn: "US, Canada, EU & Australia."
            },
            {
                type: "category",
                title: "Status Page",
            },
            {
                type: "item",
                title: "Public Status Pages",
                description: "Public Status Page for your customers.",
                productColumn: "tick",
                fyipeColumn: "tick"
            },
            {
                type: "item",
                title: "Subscribers",
                description: "You can have customer subscribers and have them alerted by Email, SMS, RSS or more.",
                productColumn: "250 Subscribers",
                fyipeColumn: "Unlimited Subscribers"
            },
            {
                type: "item",
                title: "Scheduled Events",
                description: "You can show scheduled maintenance window on your status page.",
                productColumn: "tick",
                fyipeColumn: "tick"
            },
            {
                type: "item",
                title: "Private Status Page",
                description: "Private status pages for your internal team.",
                productColumn: "tick",
                fyipeColumn: "tick"
            },
            {
                type: "category",
                title: "Misc",
            },
            {
                type: "item",
                title: "Integrations",
                description: "Integrate Fyipe with more than 2000+ apps.",
                productColumn: "Integrates with 80+ apps",
                fyipeColumn: "Integrates with 2000+ apps"
            },
            {
                type: "item",
                title: "API Access",
                description: "Build custom integrations with unlimited API access.",
                productColumn: "tick",
                fyipeColumn: "tick"
            }]
        }
    }

    return products[product];
}