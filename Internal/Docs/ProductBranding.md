# OneUptime Product Branding Guide

This document details the colors, icons, and product information used in the homepage hero section.

## Product Cards Overview

| Product | Color | Tailwind Color |
|---------|-------|----------------|
| Status Page | Emerald | `emerald` |
| Incidents | Rose | `rose` |
| Monitoring | Blue | `blue` |
| On-Call | Stone | `stone` |
| Logs | Amber | `amber` |
| Metrics | Purple | `purple` |
| Traces | Yellow | `yellow` |
| Exceptions | Orange | `orange` |
| Workflows | Sky | `sky` |
| Dashboards | Indigo | `indigo` |
| AI Agent | Violet | `violet` |

---

## Detailed Product Specifications

### 1. Status Page
- **Color:** Emerald
- **Tailwind Classes:** `bg-emerald-50`, `ring-emerald-200`, `text-emerald-600`
- **Glow Class:** `hero-glow-emerald`
- **Link:** `/product/status-page`
- **Icon:** Checkmark in circle
```html
<svg class="h-5 w-5 text-emerald-600" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
  <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
</svg>
```

### 2. Incidents
- **Color:** Rose
- **Tailwind Classes:** `bg-rose-50`, `ring-rose-200`, `text-rose-600`
- **Glow Class:** `hero-glow-rose`
- **Link:** `/product/incident-management`
- **Icon:** Warning triangle
```html
<svg class="h-5 w-5 text-rose-600" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
  <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"></path>
</svg>
```

### 3. Monitoring
- **Color:** Blue
- **Tailwind Classes:** `bg-blue-50`, `ring-blue-200`, `text-blue-600`
- **Glow Class:** `hero-glow-blue`
- **Link:** `/product/monitoring`
- **Icon:** Globe with grid lines
```html
<svg class="h-5 w-5 text-blue-600" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
  <path stroke-linecap="round" stroke-linejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418"></path>
</svg>
```

### 4. On-Call
- **Color:** Stone
- **Tailwind Classes:** `bg-stone-50`, `ring-stone-200`, `text-stone-600`
- **Glow Class:** `hero-glow-stone`
- **Link:** `/product/on-call`
- **Icon:** Phone
```html
<svg class="h-5 w-5 text-stone-600" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
  <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z"></path>
</svg>
```

### 5. Logs
- **Color:** Amber
- **Tailwind Classes:** `bg-amber-50`, `ring-amber-200`, `text-amber-600`
- **Glow Class:** `hero-glow-amber`
- **Link:** `/product/logs-management`
- **Icon:** Stacked horizontal lines (log entries)
```html
<svg class="h-5 w-5 text-amber-600" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
  <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z"></path>
</svg>
```

### 6. Metrics
- **Color:** Purple
- **Tailwind Classes:** `bg-purple-50`, `ring-purple-200`, `text-purple-600`
- **Glow Class:** `hero-glow-purple`
- **Link:** `/product/apm`
- **Icon:** Line chart / heartbeat
```html
<svg class="h-5 w-5 text-purple-600" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
  <path stroke-linecap="round" stroke-linejoin="round" d="M2 12h3l2-4 3 8 3-6 2 4h7"></path>
  <path stroke-linecap="round" stroke-linejoin="round" d="M2 20h20"></path>
</svg>
```

### 7. Traces
- **Color:** Yellow
- **Tailwind Classes:** `bg-yellow-50`, `ring-yellow-200`, `text-yellow-600`
- **Glow Class:** `hero-glow-yellow`
- **Link:** `/product/apm`
- **Icon:** Waterfall / span diagram
```html
<svg class="h-5 w-5 text-yellow-600" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
  <rect x="2" y="3" width="20" height="4" rx="0.5"></rect>
  <rect x="2" y="10" width="10" height="4" rx="0.5"></rect>
  <rect x="2" y="17" width="5" height="4" rx="0.5"></rect>
  <rect x="17" y="17" width="5" height="4" rx="0.5"></rect>
</svg>
```

### 8. Exceptions
- **Color:** Orange
- **Tailwind Classes:** `bg-orange-50`, `ring-orange-200`, `text-orange-600`
- **Glow Class:** `hero-glow-rose` (uses rose glow effect)
- **Link:** `/product/apm`
- **Icon:** Bug
```html
<svg class="h-5 w-5 text-orange-600" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
  <ellipse cx="12" cy="14" rx="5" ry="6"></ellipse>
  <path stroke-linecap="round" d="M9 8.5C9 6.5 10.5 5 12 5s3 1.5 3 3.5M4 11l3 1m10-1 3 1M4 17l3-1m10 1 3-1M12 8v12M9 14h6"></path>
</svg>
```

### 9. Workflows
- **Color:** Sky
- **Tailwind Classes:** `bg-sky-50`, `ring-sky-200`, `text-sky-600`
- **Glow Class:** `hero-glow-sky`
- **Link:** `/product/workflows`
- **Icon:** Flow diagram (rotated 180°)
```html
<svg class="h-5 w-5 text-sky-600" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" style="transform: rotate(180deg)">
  <rect x="3" y="3" width="6" height="4" rx="1" stroke-width="1.5"></rect>
  <rect x="15" y="3" width="6" height="4" rx="1" stroke-width="1.5"></rect>
  <rect x="9" y="17" width="6" height="4" rx="1" stroke-width="1.5"></rect>
  <path stroke-linecap="round" d="M6 7v3a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7M12 12v5"></path>
</svg>
```

### 10. Dashboards
- **Color:** Indigo
- **Tailwind Classes:** `bg-indigo-50`, `ring-indigo-200`, `text-indigo-600`
- **Glow Class:** `hero-glow-indigo`
- **Link:** `/product/coming-soon`
- **Icon:** Pie chart
```html
<svg class="h-5 w-5 text-indigo-600" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
  <path stroke-linecap="round" stroke-linejoin="round" d="M10.5 6a7.5 7.5 0 107.5 7.5h-7.5V6z"></path>
  <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 10.5H21A7.5 7.5 0 0013.5 3v7.5z"></path>
</svg>
```

### 11. AI Agent (Featured Card)
- **Color:** Violet
- **Tailwind Classes:** `bg-violet-50`, `ring-violet-200`, `text-violet-600`
- **Glow Class:** `hero-glow-violet`
- **Link:** `/product/ai-agent`
- **Icon:** Sparkles (AI/Magic)
```html
<svg class="h-5 w-5 text-violet-600" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
  <path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z"></path>
</svg>
```

---

## Color Reference (Tailwind CSS)

| Color Name | 50 (Background) | 200 (Ring) | 600 (Icon/Text) |
|------------|-----------------|------------|-----------------|
| Emerald | `#ecfdf5` | `#a7f3d0` | `#059669` |
| Rose | `#fff1f2` | `#fecdd3` | `#e11d48` |
| Blue | `#eff6ff` | `#bfdbfe` | `#2563eb` |
| Stone | `#fafaf9` | `#e7e5e4` | `#57534e` |
| Amber | `#fffbeb` | `#fde68a` | `#d97706` |
| Purple | `#faf5ff` | `#e9d5ff` | `#9333ea` |
| Yellow | `#fefce8` | `#fef08a` | `#ca8a04` |
| Orange | `#fff7ed` | `#fed7aa` | `#ea580c` |
| Sky | `#f0f9ff` | `#bae6fd` | `#0284c7` |
| Indigo | `#eef2ff` | `#c7d2fe` | `#4f46e5` |
| Violet | `#f5f3ff` | `#ddd6fe` | `#7c3aed` |

---

## Card Component Structure

Each product card follows this structure:

```html
<div class="hero-card-wrapper hero-glow-{color}-wrapper h-full">
  <a href="/product/{slug}" class="hero-card hero-glow-{color} group flex flex-col items-center justify-center text-center rounded-2xl bg-white px-4 py-5 ring-1 ring-inset ring-gray-200 transition-all hover:ring-{color}-300 h-full">
    <div class="flex h-11 w-11 items-center justify-center rounded-xl bg-{color}-50 ring-1 ring-{color}-200">
      <!-- SVG Icon with text-{color}-600 -->
    </div>
    <div class="mt-3 text-sm font-medium text-gray-900">{Product Name}</div>
  </a>
</div>
```

---

## Glow Effect CSS

Each color has a corresponding glow effect defined in the `<style>` block:

```css
.hero-glow-{color}-wrapper::before {
    background: radial-gradient(ellipse at center, rgb({r} {g} {b} / 0.06) 0%, rgb({r} {g} {b} / 0.02) 40%, transparent 70%);
}
.hero-glow-{color}:hover {
    background-color: rgb(255 255 255) !important;
    box-shadow: 0 0 0 1px rgb({r} {g} {b} / 0.08), 0 4px 12px -4px rgb({r} {g} {b} / 0.1), 0 0 30px -8px rgb({r} {g} {b} / 0.08);
}
```

---