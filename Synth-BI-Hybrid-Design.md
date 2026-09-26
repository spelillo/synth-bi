---
description: A hybrid design system combining Zapier's typography,
  component geometry, spacing, and structured UI language with Wise's
  lime-green, sage, white, and near-black color system.
name: Synth-BI-hybrid-design
version: alpha
---

# Synth BI --- Hybrid Design System

## Design Direction

Synth BI combines the **typographic and UI discipline of Zapier** with
the **fintech color language of Wise**.

The result should feel: - Clean and professional - Data-forward rather
than playful - Warm and approachable without looking soft - Modern
fintech / analytics - Dense enough for dashboards, but spacious enough
for marketing pages

### Source Blend

**From Zapier** - Degular Display for large display typography - Inter
for body, controls, navigation, and supporting text - 12px canonical
radius for cards and buttons - Cream/white-style spacious layouts -
Strong black typography - Restrained component system - Flat surfaces
with elevation primarily through background contrast - Sentence-case
headlines

**From Wise** - Wise lime green as the primary brand accent - Pale
sage-green surfaces - Pure white card surfaces - Near-black ink - Deep
green secondary ink - Green semantic/status family - Large, confident
fintech-style whitespace

------------------------------------------------------------------------

# Colors

## Brand

-   **Primary / Synth Green:** `#9fe870`
-   **Primary Active:** `#cdffad`
-   **Primary Neutral:** `#c5edab`
-   **Primary Pale:** `#e2f6d5`

## Surface

-   **Canvas:** `#ffffff`
-   **Canvas Soft:** `#e8ebe6`

## Text

-   **Ink:** `#0e0f0c`
-   **Ink Deep:** `#163300`
-   **Body:** `#454745`
-   **Mute:** `#868685`

## Semantic

-   **Positive:** `#2ead4b`
-   **Positive Deep:** `#054d28`
-   **Warning:** `#ffd11a`
-   **Warning Deep:** `#b86700`
-   **Warning Content:** `#4a3b1c`
-   **Negative:** `#d03238`
-   **Negative Deep:** `#a72027`
-   **Negative Darkest:** `#a7000d`
-   **Negative Background:** `#320707`

## Tertiary Illustration Accents

-   **Peach:** `#ffc091`
-   **Cyan:** `#38c8ff`

### Color Principle

The identity should primarily revolve around:

`#9fe870` + `#ffffff` + `#e8ebe6` + `#0e0f0c`

Green is the recognizable brand accent. Semantic green should remain
distinct from the primary brand green when communicating application
status.

------------------------------------------------------------------------

# Typography

## Font Family

### Display

**Degular Display**

Used for: - Hero headlines - Major marketing statements - Large
dashboard section titles - High-emphasis numbers

Fallback:

`Inter, system-ui, -apple-system, sans-serif`

### Utility

**Inter**

Used for: - Navigation - Body copy - Buttons - Forms - Tables - Labels -
Supporting headings - Data-heavy UI

This follows Zapier's two-face hierarchy: a distinctive display face
paired with a highly readable utility face.

------------------------------------------------------------------------

# Type Scale

  Token                  Size   Weight   Line Height Use
  ------------------ -------- -------- ------------- ------------------------
  `display-xl`           56px      500          56px Hero headline
  `display-lg`           48px      500          48px Large section headline
  `display-md`           32px      500          36px Section headline
  `display-sub-lg`       48px      500       49.92px Inter sub-display
  `display-sub-md`       32px      400          40px Supporting display
  `display-sub-sm`       24px      600          30px Card title
  `display-xs`           20px      700          25px Small display
  `body-lg`              20px      400          30px Lead paragraph
  `body-md`              18px      400          27px Default body
  `body-md-strong`       18px      600          27px Emphasized body
  `body-sm`              16px      400          24px Secondary body
  `body-sm-strong`       16px      600          24px Strong secondary text
  `caption`              14px      400          21px Metadata
  `eyebrow`              14px      500          14px Section label
  `button-md`            18px      600          27px Primary button
  `button-sm`          14.4px      700        14.4px Compact control

## Typography Principles

-   Use **Degular Display 500** for major display moments.
-   Use **Inter** everywhere else.
-   Keep headlines sentence-case.
-   Avoid excessive bolding.
-   Use large type and whitespace instead of decorative effects.
-   Use positive tracking for small display/eyebrow labels where
    appropriate.
-   Do not use Wise's 900-weight display treatment; the hybrid
    intentionally retains Zapier's lighter, more editorial display
    voice.

------------------------------------------------------------------------

# Shapes

Zapier's geometry is retained rather than Wise's larger 24px radius.

  Token       Value Use
  -------- -------- ------------------------------
  `none`        0px Full-width bands
  `sm`          6px Inputs / small controls
  `md`         12px Buttons / cards / primary UI
  `pill`     9999px Tags / status badges
  `full`     9999px Circular controls

### Shape Principle

**12px is the default.**

Use pills only when the component is explicitly a badge, status, or
compact metadata element.

Avoid making the entire interface look like Wise's 24px rounded-card
system.

------------------------------------------------------------------------

# Spacing

Base unit: **4px**

  Token     Value
  ------- -------
  `xxs`       2px
  `xs`        4px
  `sm`        8px
  `md`       12px
  `lg`       16px
  `xl`       24px
  `2xl`      32px
  `3xl`      48px
  `4xl`      64px

### Layout Principle

Use Zapier's generous 64px section rhythm for marketing surfaces while
retaining tighter 24px interiors for product cards.

------------------------------------------------------------------------

# Components

## Navigation

### `nav-bar`

-   Background: `#ffffff`
-   Text: `#0e0f0c`
-   Typography: `body-sm`
-   Padding: `12px 24px`

### `nav-link`

-   Color: `#0e0f0c`
-   Typography: `body-sm`

Active navigation may use `#9fe870` as a subtle indicator rather than
changing the entire link background.

------------------------------------------------------------------------

# Buttons

## `button-primary`

The primary Synth BI action.

-   Background: `#9fe870`
-   Text: `#0e0f0c`
-   Typography: `button-md`
-   Radius: `12px`
-   Padding: `12px 24px`

Examples: - Get started - Create report - Connect data - Run analysis

## `button-secondary`

-   Background: `#0e0f0c`
-   Text: `#ffffff`
-   Typography: `button-md`
-   Radius: `12px`
-   Padding: `12px 24px`

## `button-tertiary`

-   Background: `#ffffff`
-   Text: `#0e0f0c`
-   Border: `1px solid #0e0f0c`
-   Radius: `12px`
-   Padding: `12px 24px`

## `button-text`

-   Background: transparent
-   Text: `#0e0f0c`
-   Typography: `button-sm`

------------------------------------------------------------------------

# Cards

## `card-content`

The default application card.

-   Background: `#ffffff`
-   Text: `#0e0f0c`
-   Radius: `12px`
-   Padding: `24px`

Cards should sit against `#e8ebe6` when additional surface separation is
useful.

## `card-feature-sage`

-   Background: `#e8ebe6`
-   Text: `#0e0f0c`
-   Radius: `12px`
-   Padding: `24px`

## `card-feature-green`

-   Background: `#e2f6d5`
-   Text: `#0e0f0c`
-   Radius: `12px`
-   Padding: `24px`

## `card-feature-dark`

-   Background: `#0e0f0c`
-   Text: `#9fe870`
-   Radius: `12px`
-   Padding: `24px`

This is the strongest promotional surface in the system.

------------------------------------------------------------------------

# Data & Analytics Components

Synth BI is a business-intelligence product, so the visual system should
prioritize information density without becoming visually noisy.

## `data-card`

-   Background: `#ffffff`
-   Radius: `12px`
-   Padding: `24px`
-   No heavy shadow
-   Optional `1px` border using `#e8ebe6`

## `metric-card`

Large metric value uses `display-md` or `display-sub-lg`.

Recommended hierarchy:

**Label** Inter 14px / 600 / muted

**Value** Degular Display 32--48px / 500 / ink

**Change** Inter 14--16px / 600

Positive change: `#2ead4b`

Negative change: `#d03238`

## `data-table`

Header: - Background: `#e8ebe6` - Typography: `caption` - Text:
`#0e0f0c`

Body: - Background: `#ffffff` - Typography: `body-sm`

Row divider: - `#e8ebe6`

Avoid excessive borders. Surface contrast should do most of the
structural work.

## `chart-accent`

Primary visualization accent: `#9fe870`

Supporting visualization colors should use restrained variations of the
Wise semantic palette rather than introducing arbitrary bright colors.

------------------------------------------------------------------------

# Inputs & Forms

## `text-input`

-   Background: `#ffffff`
-   Text: `#0e0f0c`
-   Border: `1px solid #0e0f0c`
-   Typography: `body-md`
-   Radius: `6px`
-   Padding: `12px 16px`

## Focus

Use a visible green focus treatment:

-   Border: `#9fe870`
-   Optional outer ring: `#c5edab`

Avoid glowing neon effects.

------------------------------------------------------------------------

# Hero

## `hero-band`

The default marketing hero.

-   Background: `#e8ebe6`
-   Text: `#0e0f0c`
-   Padding: `64px 24px`
-   Headline: `display-xl`

The hero should use a strong headline on the left and a product
visualization / dashboard card on the right at desktop.

## `hero-band-dark`

-   Background: `#0e0f0c`
-   Text: `#ffffff`
-   Accent text: `#9fe870`
-   Padding: `64px 24px`

Use selectively for major product moments.

------------------------------------------------------------------------

# Dashboard Shell

The application should use the same brand language without becoming a
marketing page.

### App background

`#e8ebe6`

### Main content

`#ffffff`

### Sidebar

`#ffffff`

### Active navigation

Use a subtle `#e2f6d5` background with `#0e0f0c` text and a small
`#9fe870` indicator.

### Primary action

`#9fe870`

### Typography

Inter for the majority of the application.

Degular Display is reserved for: - Major KPI numbers - Page-level
titles - High-value analytical summaries

------------------------------------------------------------------------

# Badges

## `badge-positive`

-   Background: `#e2f6d5`
-   Text: `#054d28`
-   Typography: `body-sm-strong`
-   Radius: pill
-   Padding: `4px 12px`

## `badge-neutral`

-   Background: `#e8ebe6`
-   Text: `#0e0f0c`
-   Radius: pill

## `badge-negative`

-   Background: `#320707`
-   Text: `#ffffff`
-   Radius: pill

------------------------------------------------------------------------

# Elevation

Keep the interface mostly flat.

  Level     Treatment
  --------- -------------------------------------------
  Level 0   Flat surface, no border/shadow
  Level 1   1px border using `#e8ebe6`
  Level 2   White card against sage background
  Level 3   Very soft shadow for modals/popovers only

The primary elevation mechanism is:

**sage background → white card**

rather than heavy shadows.

------------------------------------------------------------------------

# Layout

## Marketing Container

Approximately **1280px**, centered with responsive gutters.

## Product Container

Approximately **1200px**, centered.

## Desktop

`>= 1024px`

-   Split hero
-   2--4 column feature grids
-   Persistent navigation
-   Dense analytics layouts

## Tablet

`768–1023px`

-   2-column grids
-   Reduced section spacing
-   Hero may remain split where space permits

## Mobile

`< 768px`

-   Stacked hero
-   1-column cards
-   Full-width primary actions
-   Collapsed navigation
-   Reduced display typography

------------------------------------------------------------------------

# Illustration & Visual Language

Use Wise's restraint but Zapier's structured product-marketing approach.

Preferred: - Product screenshots - Dashboard mockups - Simple data
visualizations - Geometric diagrams - Small abstract data objects -
Minimal illustrations

Avoid: - Excessive gradients - 3D blobs - Generic AI imagery -
Decorative glassmorphism - Heavy shadows - Random neon colors

The product itself should be the visual centerpiece.

------------------------------------------------------------------------

# Synth BI Logo Direction

The logo should follow the existing Synth wordmark direction:

**Synth** in near-black.

**bi** in Wise green `#9fe870`.

Optional treatment:

A soft black rounded container behind `bi`, using the same `12px` radius
as the product UI.

The logo should remain simple and readable at small sizes.

------------------------------------------------------------------------

# Design Principles

1.  **Zapier structure, Wise color.**
2.  **Degular Display for brand moments; Inter for utility.**
3.  **Lime green is the primary identity accent.**
4.  **12px is the canonical component radius.**
5.  **Use sage backgrounds and white cards to create depth.**
6.  **Keep dashboards information-dense but visually calm.**
7.  **Avoid unnecessary gradients, shadows, and decorative UI.**
8.  **Use green deliberately --- not everywhere.**
9.  **Let typography and spacing create hierarchy.**
10. **The product should feel like serious analytics software with a
    modern fintech identity.**

------------------------------------------------------------------------

# Do's

-   Use `#9fe870` for primary actions and brand highlights.
-   Use `#e8ebe6` for large background sections and application shells.
-   Use white cards against sage surfaces.
-   Use Degular Display for major headlines and KPI moments.
-   Use Inter for nearly all product UI.
-   Use 12px radius for cards and buttons.
-   Maintain generous whitespace around major content.
-   Keep charts and dashboards restrained and readable.
-   Use near-black `#0e0f0c` instead of pure black.

# Don'ts

-   Don't use Zapier orange as a brand color.
-   Don't copy Wise's 24px card radius as the default.
-   Don't make every element green.
-   Don't use heavy 900-weight display typography as the default.
-   Don't overuse pills.
-   Don't rely on shadows to separate every component.
-   Don't introduce arbitrary accent colors into the core brand system.
-   Don't make the product look like a generic AI SaaS dashboard.
-   Don't sacrifice information density for decorative whitespace.

------------------------------------------------------------------------

# Core Token Summary

``` yaml
brand:
  primary: "#9fe870"
  primary-active: "#cdffad"
  primary-pale: "#e2f6d5"

surface:
  canvas: "#ffffff"
  canvas-soft: "#e8ebe6"

ink:
  primary: "#0e0f0c"
  deep: "#163300"
  body: "#454745"
  mute: "#868685"

typography:
  display: "Degular Display"
  utility: "Inter"
  display-weight: 500
  body-weight: 400
  strong-weight: 600

radius:
  component: "12px"
  input: "6px"
  pill: "9999px"

spacing:
  base: "4px"
  card: "24px"
  section: "64px"
```
