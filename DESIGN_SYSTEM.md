# Old Oak Horses — Design System

Reference this document for all UI work on this project. Every page, component, and report must follow these guidelines consistently.

---

## Brand Identity

**Site Name:** Old Oak Horses  
**Tone:** Refined, professional, equestrian. Clean data presentation with warmth. Never clinical or corporate.

---

## Typography
```css
/* Load via Google Fonts */
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;1,600&family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500;600&display=swap');
```

| Role | Font | Usage |
|---|---|---|
| Display / Headings | Playfair Display | Page titles, horse names, invoice totals, section headers |
| Body | DM Sans | Descriptions, labels, UI text, metadata |
| Data / Code | DM Mono | Amounts, percentages, dates, IDs, tags, column headers |

**Rules:**
- Never use Inter, Roboto, or Arial
- Large monetary amounts always use Playfair Display
- Column headers and report labels always use DM Mono, uppercase, `letter-spacing: 0.08–0.12em`
- Body copy and descriptions use DM Sans at 13–14px

---

## Color Palette
```css
:root {
  /* Backgrounds */
  --bg-page:        #F7F6F3;  /* warm off-white, used for all page backgrounds */
  --bg-card:        #FFFFFF;  /* all cards and panels */
  --bg-subtle:      #FAFAF8;  /* hover states, nested panels */
  --bg-dark:        #1C1C1C;  /* nav bar, footer summary */
  --bg-dark-2:      #2A2A2A;  /* inactive toggle buttons */

  /* Text */
  --text-primary:   #1C1C1C;
  --text-secondary: #444444;
  --text-muted:     #888888;
  --text-faint:     #BBBBBB;
  --text-on-dark:   #FFFFFF;

  /* Borders */
  --border-light:   #F0EDE8;
  --border-card:    #EDEAE4;

  /* Accent — white on dark surfaces only */
  --accent:         #FFFFFF;

  /* Shadows */
  --shadow-card:    0 1px 4px rgba(0,0,0,0.06);
}
```

**Rules:**
- White (`#FFFFFF`) is the accent color — use it on dark (`#1C1C1C`) surfaces only for highlighted values, totals, and active states
- Never use white text on white or light backgrounds
- No purple gradients, no generic AI color schemes
- Page background is always `#F7F6F3`, never pure white

---

## Subcategory Color Map

Used for badges and progress bars throughout all veterinary reports. Always use the full set consistently:
```javascript
const subcategoryColors = {
  "Travel Cost":     { bg: "#F0F4FF", text: "#3B5BDB", dot: "#3B5BDB", bar: "#3B5BDB" },
  "Physical Exam":   { bg: "#F0FFF4", text: "#2F855A", dot: "#2F855A", bar: "#2F855A" },
  "Joint Injection": { bg: "#FFF5F5", text: "#C53030", dot: "#C53030", bar: "#C53030" },
  "Ultrasound":      { bg: "#FFFBF0", text: "#B7791F", dot: "#B7791F", bar: "#B7791F" },
  "MRI":             { bg: "#FAF0FF", text: "#6B21A8", dot: "#6B21A8", bar: "#6B21A8" },
  "Radiograph":      { bg: "#FFF0F6", text: "#9D174D", dot: "#9D174D", bar: "#9D174D" },
  "Medication":      { bg: "#F0FDFF", text: "#0E7490", dot: "#0E7490", bar: "#0E7490" },
  "Sedation":        { bg: "#FFF7ED", text: "#C2410C", dot: "#C2410C", bar: "#C2410C" },
  "Vaccine":         { bg: "#F0FFF9", text: "#0D7A5F", dot: "#0D7A5F", bar: "#0D7A5F" },
  "Labs":            { bg: "#F5F0FF", text: "#5B21B6", dot: "#5B21B6", bar: "#5B21B6" },
  "Other":           { bg: "#F9FAFB", text: "#6B7280", dot: "#6B7280", bar: "#6B7280" },
};
```

Fee type pills:
```javascript
const feeTypeColors = {
  service:    { bg: "#E8F4FF", text: "#1A6BAF" },
  drug:       { bg: "#FFF0F0", text: "#B91C1C" },
  laboratory: { bg: "#F0FFF4", text: "#166534" },
};
```

---

## Components

### Navigation Bar
- Full width, background `#1C1C1C`, height 56px, horizontal padding 32–40px
- Left: breadcrumb — `Old Oak Horses` in Playfair Display italic white, `/` dividers in `#444`, section names in `#888`, current page in `#fff`
- Right: optional contextual controls only (no currency toggle)

### Cards
```css
.card {
  background: #FFFFFF;
  border-radius: 16px;
  box-shadow: 0 1px 4px rgba(0,0,0,0.06);
  padding: 28px 32px;
  margin-bottom: 20px;
}
```

### Section Labels (above card titles)
```css
/* e.g. "REPORT 1", "VETERINARY INVOICE", "HORSE SUBTOTAL" */
font-family: DM Mono;
font-size: 10px;
font-weight: 700;
letter-spacing: 0.12em;
color: #1C1C1C;
text-transform: uppercase;
margin-bottom: 4px;
```

### Badges (subcategory)
- Pill shape, `border-radius: 99px`, padding `3px 10px`
- Small colored dot on left (6×6px circle)
- Font: DM Sans, 11px, weight 600
- Colors from subcategory color map above

### Progress Bars
- Track: `#F0EDE8`, height 5px, border-radius 99px
- Fill: subcategory bar color
- Percentage label right-aligned in DM Mono, 11px, `#888`

### Data Tables
- Header row: DM Mono, 10px, weight 700, `#BBB`, `letter-spacing: 0.07em`, uppercase
- Data rows: 14–15px padding top/bottom, `border-bottom: 1px solid #F7F6F3`
- Hover state: background `#FAFAF8`
- Amounts right-aligned in DM Mono
- Text descriptions in DM Sans weight 500

### Footer Summary Bar
```css
background: #1C1C1C;
border-radius: 12px;
padding: 22px 28px;
```
- Left: summary label in `#555` monospace, line items in `#666` with white values
- Right: `TOTAL DUE` label in `#555` monospace, large amount in Playfair Display white `#fff`

### Horse Section Header
- 38×38px circle avatar, background `#1C1C1C`, horse emoji centered
- Horse name in Playfair Display 20px
- Subtitle (item count) in DM Sans 12px `#999`
- Right-aligned subtotal with monospace label above

---

## Spacing & Layout
```
Page max-width:     1040px
Page padding:       36px 24px
Card gap:           20px
Section padding:    28px 32px (standard), 18px 22px (nested)
Table row padding:  14px 18px
```

---

## Currency Behavior

- All monetary values displayed in the UI must be USD only
- Use `$` formatting for all amounts with two decimals
- Do not render GBP display values in UI components
- Do not show exchange rate notes in report or invoice headers

---

## Footer Watermark

Every report page ends with a small centered line:
```
OLD OAK HORSES · [CATEGORY] · [PROVIDER NAME IN CAPS]
```
Font: DM Mono, 11px, `#CCC`

---

## Rules — Never Do

- Never use Inter, Roboto, Arial, or system-ui as a primary font
- Never use white text on light backgrounds
- Never use purple gradients or generic SaaS color schemes
- Never show a provider dropdown without a category selected first
- Never display GBP values in UI
- Never use bullet points or dense text in report UI — use cards, bars, and tables

Save that as DESIGN_SYSTEM.md at the root of your project and tell Claude Code to reference it at the start of any UI task with: "Before building any UI, read DESIGN_SYSTEM.md and follow it exactly."
