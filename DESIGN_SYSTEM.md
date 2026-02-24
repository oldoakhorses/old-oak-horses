# Old Oak Horses — Design System

## Typography
- Primary font: Space Mono
- Load: `@import url('https://fonts.googleapis.com/css2?family=Space+Mono:ital,wght@0,400;0,700;1,400&display=swap');`
- Stack: `'Space Mono', 'SF Mono', 'Menlo', monospace`
- Use bold for headers, totals, buttons, active states
- Use regular for body text
- Use italic only for `old-oak-horses` brand in nav

## Color Palette
- Background: `#F8F9FB`
- Card: `#FFFFFF`
- Border: `#E8EAF0`
- Light border: `#F0F1F5`
- Text: `#1A1A2E`
- Secondary: `#6B7084`
- Muted: `#9EA2B0`
- Accent: `#4A5BDB`
- Accent tint: `rgba(74,91,219,0.08)`
- Input background: `#F2F3F7`
- Hover: `#FAFAFC`
- Progress track: `#EDEEF2`

## Subcategory Colors
- Joint Injection: `#22C583`
- Physical Exam: `#4A5BDB`
- Radiograph: `#A78BFA`
- Vaccine: `#F59E0B`
- Dental Work: `#EF4444`
- Bloodwork: `#FBBF24`
- Lameness: `#14B8A6`
- Ultrasound: `#EC4899`
- Chiropractic: `#818CF8`
- Surgery: `#F87171`
- Medication: `#34D399`
- Sedation: `#2DD4BF`

## Core Rules
- All UI uses Space Mono only
- Cards: white, 1px border, 12px radius, no drop shadows
- Nav is sticky, white, 52px, bottom border
- Breadcrumb format: `old-oak-horses / ...`
- Back links format: `← cd /path`
- Section titles use `snake_case`
- Labels use `//`-comment style
- Footer format: `OLD_OAK_HORSES // SECTION`

## Buttons
- Outlined: transparent bg, border `#E8EAF0`, text `#6B7084`
- Filled: bg `#1A1A2E`, white text, bold
- Radius 6px, size 11px

## Progress Bars
- Track: 4px height, `#EDEEF2`
- Fill uses accent/subcategory color with opacity
