/*
 * AI Template definitions for different note types
 * These templates guide AI generation for various use cases
 */

export interface AITemplate {
  id: string;
  name: string;
  content: string;
}

// Default hardcoded templates for incident postmortem
export const POSTMORTEM_TEMPLATES: Array<AITemplate> = [
  {
    id: "default-standard",
    name: "Standard Postmortem",
    content: `## Executive Summary
[Brief overview of the incident, its impact, and resolution]

## Incident Timeline
| Time | Event |
|------|-------|
| [Time] | [Event description] |

## Root Cause Analysis
[Detailed analysis of what caused the incident]

## Impact Assessment
- **Duration**: [How long the incident lasted]
- **Users Affected**: [Number or percentage of affected users]
- **Services Affected**: [List of affected services]

## Resolution
[Steps taken to resolve the incident]

## Action Items
- [ ] [Action item 1]
- [ ] [Action item 2]
- [ ] [Action item 3]

## Lessons Learned
[Key takeaways and improvements identified]`,
  },
  {
    id: "default-detailed",
    name: "Detailed Technical Postmortem",
    content: `## Incident Overview
**Incident Title**: [Title]
**Severity**: [P1/P2/P3/P4]
**Duration**: [Start time] - [End time]
**Authors**: [Names]

## Summary
[2-3 sentence summary of the incident]

## Detection
- **How was the incident detected?** [Monitoring alert / Customer report / etc.]
- **Time to detection**: [Duration from start to detection]

## Timeline
| Timestamp | Action | Owner |
|-----------|--------|-------|
| [Time] | [What happened] | [Who did it] |

## Root Cause
### Primary Cause
[Detailed explanation of the root cause]

### Contributing Factors
1. [Factor 1]
2. [Factor 2]

## Impact
### Customer Impact
[Description of how customers were affected]

### Business Impact
[Description of business consequences]

### Technical Impact
[Systems and services affected]

## Mitigation & Resolution
### Immediate Actions
[Steps taken to stop the bleeding]

### Permanent Fix
[Long-term solution implemented]

## Prevention
### What Went Well
- [Item 1]
- [Item 2]

### What Went Wrong
- [Item 1]
- [Item 2]

### Where We Got Lucky
- [Item 1]

## Action Items
| Action | Owner | Priority | Due Date |
|--------|-------|----------|----------|
| [Action] | [Name] | [High/Medium/Low] | [Date] |

## Appendix
[Any additional technical details, logs, or graphs]`,
  },
  {
    id: "default-brief",
    name: "Brief Postmortem",
    content: `## What Happened
[Concise description of the incident]

## Why It Happened
[Root cause explanation]

## How We Fixed It
[Resolution steps]

## How We Prevent It
- [ ] [Prevention action 1]
- [ ] [Prevention action 2]`,
  },
];

// Default templates for public notes (customer-facing)
export const PUBLIC_NOTE_TEMPLATES: Array<AITemplate> = [
  {
    id: "public-status-update",
    name: "Status Update",
    content: `## Current Status
[Brief description of the current situation]

## What We're Doing
[Actions being taken to resolve the issue]

## Next Update
[Expected time for next update or resolution]`,
  },
  {
    id: "public-resolution",
    name: "Resolution Notice",
    content: `## Issue Resolved
[Brief description of what was resolved]

## Summary
[What happened and how it was fixed]

## Prevention
[Steps taken to prevent recurrence]

Thank you for your patience.`,
  },
  {
    id: "public-maintenance",
    name: "Maintenance Update",
    content: `## Maintenance Status
[Current phase of the maintenance]

## Progress
[What has been completed]

## Remaining Work
[What still needs to be done]

## Expected Completion
[Estimated completion time]`,
  },
];

// Default templates for internal notes (team-facing)
export const INTERNAL_NOTE_TEMPLATES: Array<AITemplate> = [
  {
    id: "internal-investigation",
    name: "Investigation Update",
    content: `## Current Investigation Status
[What we're looking at]

## Findings So Far
- [Finding 1]
- [Finding 2]

## Hypothesis
[Current theory about the root cause]

## Next Steps
- [ ] [Action 1]
- [ ] [Action 2]`,
  },
  {
    id: "internal-technical",
    name: "Technical Analysis",
    content: `## Technical Details
[Detailed technical observations]

## Metrics/Logs
[Relevant metrics or log entries]

## Impact Assessment
[Technical impact analysis]

## Recommendations
[Technical recommendations for resolution]`,
  },
  {
    id: "internal-handoff",
    name: "Shift Handoff",
    content: `## Current State
[Where things stand now]

## Actions Taken
[What has been done so far]

## Open Questions
[Things that still need investigation]

## Immediate Priorities
- [ ] [Priority 1]
- [ ] [Priority 2]

## Contacts
[Key people involved or to contact]`,
  },
];
