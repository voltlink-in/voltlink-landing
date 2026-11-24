# VoltLink Landing Page

Official public landing page and web presence for VoltLink - The new companion to your two-wheeler.

## Tech Stack

- React 19
- TypeScript
- Vite
- Tailwind CSS v4
- GSAP & ScrollTrigger
- Three.js
- Lucide Icons

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Start Development Server

```bash
npm run dev
```

Starts the local development server at `http://localhost:5173`. In development mode, garage portal links default to `http://localhost:5174`.

### 3. Build for Production

```bash
npm run build
```

Performs type checking with TypeScript and builds the production-optimized static bundle to the `dist/` directory.

### 4. Preview Production Build

```bash
npm run preview
```

Serves the built bundle from `dist/` locally.

## Environment Variables

Copy `.env.example` to `.env` or set environment variables in your deployment platform:

| Variable | Description | Default (Dev) | Default (Prod) |
| :--- | :--- | :--- | :--- |
| `VITE_GARAGE_PORTAL_URL` | Target URL for Garage Portal login and registration | `http://localhost:5174` | `https://guradge.voltlink.in` |

## Deployment

### Vercel Deployment

This repository includes a dedicated `vercel.json` configuration configured with:
- Framework preset: `vite`
- Single Page Application rewrites to `/index.html`
- 1-year immutable caching for static assets in `/assets/`
- Standard security headers (`nosniff`, `SAMEORIGIN`, `strict-origin-when-cross-origin`)

To deploy via Vercel:
1. Push this repository to GitHub (`git@github.com:voltlink-in/voltlink-landing.git`).
2. Import the project in your Vercel Dashboard.
3. Keep default settings (`Build Command: npm run build`, `Output Directory: dist`).
4. (Optional) Set `VITE_GARAGE_PORTAL_URL` to `https://guradge.voltlink.in` in Vercel Environment Variables.

