# ⚡ Electricity Bills Tracker

> A fully offline-first web application and Android APK for electricity transformer operators to manage customer billing records, track payments, and generate WhatsApp reminders.

**Built by iApp Solutions Pvt. Ltd. © 2026 — All Rights Reserved.**

---

## Table of Contents

1. [Overview](#overview)
2. [Features](#features)
3. [Functional Flow](#functional-flow)
4. [Technical Architecture](#technical-architecture)
5. [Project Structure](#project-structure)
6. [Data Models](#data-models)
7. [API Reference](#api-reference)
8. [Client-Side DB Layer](#client-side-db-layer)
9. [PWA & Service Worker](#pwa--service-worker)
10. [Android APK (Capacitor)](#android-apk-capacitor)
11. [Data Migration](#data-migration)
12. [Setup & Running](#setup--running)
13. [Scripts](#scripts)
14. [Author & Credits](#author--credits)

---

## Overview

The **Electricity Bills Tracker** is designed for authorized electricity transformer operators and administrators. It allows them to:

- Register customers connected to their transformer
- Create and manage electricity bills (metered by days × quantity × rate)
- Track payments, pending amounts, and collection rates
- Send WhatsApp reminders with a shareable bill image
- View a monthly balance sheet comparing customer collections vs. board charges

The app works **100% offline** using `localStorage` as the primary data store. When deployed with a Node.js server, it can optionally persist data as JSON files on disk.

---

## Features

| Feature | Description |
|---------|-------------|
| **Customer Management** | Add, edit, delete customers with name, mobile, address |
| **Customer Cards** | Responsive card grid — name bold, mobile shaded; click to open detail page |
| **Customer Detail Page** | View customer info + all their bills as cards with full action support |
| **Bill Management** | Create bills (start date, qty, rate); stop bills; edit collected amount |
| **Bill Cards** | Each bill shows period, qty, rate, days, total, collected, pending with color indicators |
| **Tracker — By Customer** | Expand any customer to see all their bills; send WhatsApp payment reminders |
| **Tracker — By Month/Year** | Filter all bills overlapping a selected month; summary totals |
| **Balance Sheet** | Monthly P&L — customer collections vs. electricity board charges; donut charts |
| **WhatsApp Reminders** | Canvas-rendered bill image shared/downloaded as PNG or sent via WhatsApp |
| **CSV Import/Export** | Export customers and bills to CSV; import from CSV |
| **Backup & Restore** | Full JSON backup export; restore from file |
| **PWA** | Installable on Android/iOS home screen; works offline via Service Worker |
| **Android APK** | Native Android app built with Capacitor |
| **Data Migration** | Script to migrate server-side JSON data into browser localStorage |

---

## Functional Flow

### 1. Customer Lifecycle

```
Add Customer
    │
    ▼
Customer Card (grid view)
    │  click card
    ▼
Customer Detail Page
    ├── Customer Info (name, mobile, address, registered date)
    └── Bills Section
            │
            ├── Add Bill  ──► Bill created (status: active)
            │                    │
            │               [days pass]
            │                    │
            ├── Stop Bill ──► Bill stopped (status: stopped, stopDate set)
            │
            ├── Edit Bill ──► Update qty, rate, collected amount, dates
            │
            ├── WhatsApp  ──► Canvas bill image → share / download / WhatsApp
            │
            └── Delete Bill
```

### 2. Bill Calculation

```
Bill Total = numberOfDays × quantity × perDayCharge
           where numberOfDays = ceil((stopDate - startDate) / 86400000)
                 stopDate     = actual stop date OR today (if still active)

Pending Amount = max(0, total + arrears - collectedAmount)
```

### 3. Tracker Flow

```
Tracker Tab
    ├── By Customer
    │       └── All customers listed as expandable cards
    │               └── Click to expand → all bills for that customer
    │                       └── 📱 WhatsApp → sends payment reminder
    │
    └── By Month/Year
            └── Pick month + year → all bills overlapping that period
                    └── Summary: total billed, collected, pending
```

### 4. Balance Sheet Flow

```
Select Month + Year
    │
    ▼
Customer side:   All bills overlapping month → totalCharged, totalCollected, totalPending
Board side:      Monthly charge record → projectedAmount (board bill), unitsCharged
    │
    ▼
Revenue = totalCollected − projectedAmount
Units projected = totalActiveQty × 22.5 (avg units/set/month)
Collection rate = (totalCollected / totalCharged) × 100
    │
    ▼
Displayed as summary cards + donut charts
```

### 5. WhatsApp Reminder Flow

```
Click 📱 Remind on a bill
    │
    ▼
showBillImageModal()
    │
    ├── Renders bill details onto HTML5 Canvas (name, period, days,
    │   sets, rate, total, paid, pending)
    │
    ├── [Download PNG]  → saves image to device
    ├── [Share]         → Web Share API (mobile)
    └── [Open WhatsApp] → wa.me/91{mobile}?text={encoded message}
```

### 6. Backup & Restore

```
Backup  → reads localStorage → JSON blob → downloaded as .json file
Restore → user picks .json file → validates → writes to localStorage → reloads app
```

---

## Technical Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Browser / Android APK               │
│                                                         │
│  ┌──────────┐  ┌──────────┐  ┌────────────────────┐   │
│  │index.html│  │ styles.css│  │      app.js        │   │
│  │  (UI/    │  │ (design  │  │  (all UI logic,    │   │
│  │  tabs)   │  │  system) │  │   event handlers,  │   │
│  └──────────┘  └──────────┘  │   render fns)      │   │
│                               └────────┬───────────┘   │
│                                        │ apiFetch()     │
│                               ┌────────▼───────────┐   │
│                               │       db.js         │   │
│                               │  (localStorage DB   │   │
│                               │   + URL router)     │   │
│                               └────────┬───────────┘   │
│                                        │ localStorage   │
│  ┌─────────────┐                       │               │
│  │   sw.js     │              ┌────────▼───────────┐   │
│  │ (Service    │              │    localStorage    │   │
│  │  Worker /   │              │  ebt_customers     │   │
│  │  cache)     │              │  ebt_bills         │   │
│  └─────────────┘              │  ebt_charges       │   │
│                               └────────────────────┘   │
└─────────────────────────────────────────────────────────┘

          (optional) Node.js Server — server.js
          ┌─────────────────────────────────────┐
          │  Express REST API  (port 3500)       │
          │  GET/POST/PUT/DELETE                 │
          │  /api/customers                      │
          │  /api/bills                          │
          │  /api/tracker/customers              │
          │  /api/tracker/by-month               │
          │  /api/monthly-charges                │
          │  /api/balance-sheet                  │
          │                                      │
          │  data/                               │
          │    customers.json                    │
          │    bills.json                        │
          │    monthly-charges.json              │
          └─────────────────────────────────────┘
```

### Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Offline-first with `localStorage`** | Works without a server; perfect for Android APK via Capacitor |
| **`db.js` mirrors `server.js`** | Same business logic runs client-side; `apiFetch()` routes to `DB.route()` instead of real HTTP |
| **Vanilla JS (no framework)** | Zero build step; instant load; easily bundled into APK |
| **Capacitor for Android** | Wraps the PWA in a native WebView; produces a signed APK |
| **Canvas for bill images** | Generates a shareable/downloadable bill PNG without any server dependency |

---

## Project Structure

```
electricity-bills-tracker/
│
├── public/                     # All frontend assets (served statically)
│   ├── index.html              # Single-page app shell; all tabs defined here
│   ├── app.js                  # All UI logic (~1400 lines)
│   │                           #   - Tab switching
│   │                           #   - Customer CRUD + card grid + detail page
│   │                           #   - Bill CRUD + card rendering
│   │                           #   - Tracker (by customer + by month)
│   │                           #   - Balance Sheet
│   │                           #   - WhatsApp bill image (Canvas)
│   │                           #   - CSV import/export
│   │                           #   - Backup & Restore
│   ├── db.js                   # Offline localStorage data layer (~320 lines)
│   │                           #   - Mirrors all server.js routes
│   │                           #   - URL router: DB.route(method, url, body)
│   │                           #   - enrichBill(), billOverlapsMonth()
│   ├── styles.css              # Design system (~870 lines)
│   │                           #   - CSS variables (colors, shadows, radius)
│   │                           #   - Components: tabs, cards, tables, modals,
│   │                           #     badges, buttons, customer cards, bill cards
│   ├── sw.js                   # Service Worker (cache-first for offline PWA)
│   ├── manifest.json           # Web App Manifest (PWA install metadata)
│   └── version.txt             # App version displayed in About tab
│
├── server.js                   # Express.js REST API (~300 lines)
│                               #   - Reads/writes JSON files in data/
│                               #   - enrichBill() for computed fields
│                               #   - Serves public/ as static files
│
├── data/                       # Server-side persistent data (JSON files)
│   ├── customers.json
│   ├── bills.json
│   └── monthly-charges.json
│
├── scripts/
│   └── generate-migration.js   # Reads data/ JSON → generates migrate.html
│
├── capacitor.config.json       # Capacitor config (appId, appName, webDir)
├── package.json                # Node.js dependencies & npm scripts
└── README.md                   # This file
```

---

## Data Models

### Customer

```json
{
  "id":        "uuid-v4",
  "name":      "Ravi Kumar",
  "mobile":    "9876543210",
  "address":   "Door No. 12, Street Name",
  "createdAt": "2025-01-15T10:30:00.000Z"
}
```

### Bill

```json
{
  "id":              "uuid-v4",
  "customerId":      "customer-uuid",
  "startDate":       "2025-01-01",
  "stopDate":        "2025-01-31",
  "quantity":        2,
  "perDayCharge":    200,
  "arrears":         0,
  "collectedAmount": 8000,
  "status":          "active | stopped",
  "createdAt":       "2025-01-01T08:00:00.000Z"
}
```

**Computed fields** (added by `enrichBill()`, not stored):

| Field | Formula |
|-------|---------|
| `customerName` | Joined from customers |
| `customerMobile` | Joined from customers |
| `numberOfDays` | `ceil((stopDate - startDate) / 86400000)` |
| `total` | `numberOfDays × quantity × perDayCharge` |
| `pendingAmount` | `max(0, total + arrears - collectedAmount)` |

### Monthly Charge

```json
{
  "id":              "uuid-v4",
  "month":           1,
  "year":            2025,
  "projectedAmount": 15000,
  "billPaidDate":    "2025-02-05",
  "unitsCharged":    450,
  "comments":        "January board bill",
  "createdAt":       "2025-02-01T09:00:00.000Z"
}
```

---

## API Reference

All endpoints are served by `server.js` on port **3500**. The same routes are mirrored in `db.js` for offline use.

### Customers

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/customers` | List all customers |
| `POST` | `/api/customers` | Create customer `{ name, mobile, address }` |
| `PUT` | `/api/customers/:id` | Update customer fields |
| `DELETE` | `/api/customers/:id` | Delete customer + cascade delete their bills |

### Bills

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/bills` | List bills; optional `?status=active\|stopped` and `?customerId=` |
| `POST` | `/api/bills` | Create bill `{ customerId, startDate, quantity, perDayCharge }` |
| `PUT` | `/api/bills/:id` | Update bill (setting `stopDate` auto-sets `status: stopped`) |
| `DELETE` | `/api/bills/:id` | Delete bill |

### Tracker

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/tracker/customers` | All customers with their enriched bills nested |
| `GET` | `/api/tracker/by-month?month=&year=` | Bills overlapping a given month + summary totals |

### Monthly Charges

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/monthly-charges` | All monthly charge records |
| `POST` | `/api/monthly-charges` | Create or upsert `{ month, year, projectedAmount, unitsCharged, ... }` |
| `PUT` | `/api/monthly-charges/:id` | Update a charge record |
| `DELETE` | `/api/monthly-charges/:id` | Delete a charge record |

### Balance Sheet

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/balance-sheet?month=&year=` | Full monthly P&L: bills, charges, revenue, donut data |

---

## Client-Side DB Layer

`public/db.js` is a self-contained in-browser database that **mirrors every server route**, making the app work entirely offline.

### How it works

```
app.js calls apiFetch('/api/bills?customerId=xyz')
    │
    ▼
apiFetch(url, opts)
    │  parses method + body
    ▼
DB.route('GET', '/api/bills?customerId=xyz', null)
    │  splits path + query params via URLSearchParams
    ▼
getBills(status=undefined, customerId='xyz')
    │  reads ebt_bills from localStorage
    │  maps each bill through enrichBill()
    │  filters by customerId
    ▼
returns enriched, filtered bill array
```

### localStorage Keys

| Key | Contents |
|-----|----------|
| `ebt_customers` | JSON array of customer objects |
| `ebt_bills` | JSON array of raw bill objects |
| `ebt_charges` | JSON array of monthly charge objects |

---

## PWA & Service Worker

`public/sw.js` implements a **cache-first** strategy:

1. On **install** — pre-caches `index.html`, `styles.css`, `db.js`, `app.js`, `manifest.json`
2. On **activate** — deletes old cache versions
3. On **fetch** — returns cached response if available; falls back to network and caches the response

The app is installable as a PWA on Android and iOS via the browser's "Add to Home Screen" prompt. `manifest.json` defines the app name, theme color (`#1e3a8a`), icons, and `display: standalone`.

---

## Android APK (Capacitor)

The app is packaged as a native Android APK using [Capacitor](https://capacitorjs.com/).

```
App ID  : com.aevana.electricitybillstracker
WebDir  : public
Scheme  : https (androidScheme)
```

### Build Commands

```bash
# First-time setup
npm run android:init     # cap add android && cap sync android

# Sync web assets to Android project
npm run android:sync     # cap sync android

# Open in Android Studio
npm run android:open     # cap open android

# Build debug APK
npm run android:build    # cap sync android && ./gradlew assembleDebug
```

The generated APK embeds the entire `public/` folder into the Android WebView. Data is stored in the device's `localStorage` (persists across app restarts; cleared on uninstall).

---

## Data Migration

When moving from a server-backed deployment (JSON files) to the offline/APK version (localStorage), use the migration script:

```bash
node scripts/generate-migration.js
```

This reads `data/customers.json`, `data/bills.json`, `data/monthly-charges.json` and generates a `migrate.html` file. Open `migrate.html` in the target browser (same browser/device as the app) and:

- **Import & Overwrite** — replaces all localStorage data with the server data
- **Merge** — adds only records whose `id` doesn't already exist (safe, non-destructive)

---

## Setup & Running

### Prerequisites

- Node.js ≥ 18
- npm ≥ 9
- (For APK) Android Studio + JDK 17

### Install dependencies

```bash
npm install
```

### Run in development mode

```bash
npm run dev        # starts server with nodemon on http://localhost:3500
```

### Run in production mode

```bash
npm start          # starts server on http://localhost:3500
```

### Use as a pure offline app (no server)

Simply open `public/index.html` directly in a browser or install as a PWA. All data is stored in `localStorage` via `db.js`. No server is needed.

---

## Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `start` | `node server.js` | Start production server |
| `dev` | `nodemon server.js` | Start dev server with auto-reload |
| `android:init` | `cap add android && cap sync android` | First-time Android project setup |
| `android:sync` | `cap sync android` | Sync web changes to Android project |
| `android:open` | `cap open android` | Open project in Android Studio |
| `android:build` | `cap sync android && ./gradlew assembleDebug` | Build debug APK |
| `migrate` | `node scripts/generate-migration.js` | Generate data migration HTML |

---

## Author & Credits

| Field | Details |
|-------|---------|
| **App Name** | Electricity Bills Tracker |
| **App ID** | `com.aevana.electricitybillstracker` |
| **Version** | See `public/version.txt` |
| **Company** | iApp Solutions Pvt. Ltd. |
| **Copyright** | © 2026 iApp Solutions Pvt. Ltd. All Rights Reserved |
| **Repository** | [github.com/aevana/eapp](https://github.com/aevana/eapp) |
| **Platform** | Web PWA + Android APK |
| **License** | Proprietary — unauthorized reproduction or distribution is strictly prohibited |

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla HTML5, CSS3, JavaScript (ES2020+) |
| Backend (optional) | Node.js + Express.js |
| Mobile | Capacitor v6 (Android WebView wrapper) |
| Data (offline) | Browser `localStorage` |
| Data (server) | JSON flat files |
| Bill images | HTML5 Canvas API |
| PWA | Web App Manifest + Service Worker |
| Notifications | WhatsApp `wa.me` deep links |
| IDs | UUID v4 |

---

> For support or compliance concerns, contact iApp Solutions through official channels.
