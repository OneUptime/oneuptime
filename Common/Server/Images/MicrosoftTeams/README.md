# Microsoft Teams Icons

This directory contains pre-resized icons for Microsoft Teams app integration.

## Files

- `icon-color-192x192.png` - Color icon for Teams app manifest (192x192px, PNG format)
- `icon-outline-32x32.png` - Outline icon for Teams app manifest (32x32px, PNG format)

## Source

These icons are resized from the original OneUptime logo located at:
`/Home/Static/img/OneUptimePNG/1.png`

## Usage

These pre-resized icons are used by the Microsoft Teams API endpoint:
`/api/teams/manifest-package/:projectId`

## Regeneration

If you need to regenerate these icons from the source logo, you can use:

```javascript
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

// Resize for 192x192 color icon
await sharp('source-image.png')
  .resize(192, 192, { fit: 'cover' })
  .png()
  .toFile('icon-color-192x192.png');

// Resize for 32x32 outline icon
await sharp('source-image.png')
  .resize(32, 32, { fit: 'cover' })
  .png()
  .toFile('icon-outline-32x32.png');
```

## Microsoft Teams Requirements

- Color icon: 192x192 pixels, PNG format
- Outline icon: 32x32 pixels, PNG format
- Both icons should be square with transparent backgrounds where applicable