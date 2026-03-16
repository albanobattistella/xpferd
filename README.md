<p align="center">
    <img alt="Icon" src="docs/icons/icon2.svg" width="33%">
</p>
<p align="center">
  <a href="https://github.com/tiehfood/xpferd/releases/latest">
    <img alt="Release Version" src="https://img.shields.io/github/release/tiehfood/xpferd.svg"/>
  </a>
  <a href="https://hub.docker.com/r/tiehfood/xpferd">
    <img alt="Docker Pulls" src="https://img.shields.io/docker/pulls/tiehfood/xpferd"/>
  </a>
  <a href="LICENSE">
    <img alt="License" src="https://img.shields.io/github/license/tiehfood/xpferd.svg"/>
  </a>
  <a href="https://github.com/tiehfood/xpferd">
    <img alt="Stars" src="https://img.shields.io/github/stars/tiehfood/xpferd?style=flat&label=github+stars"/>
  </a>
  <a href="https://www.buymeacoffee.com/tiehfood">
    <img alt="ByMeACoffee" src="https://raw.githubusercontent.com/pachadotdev/buymeacoffee-badges/main/bmc-orange.svg"/>
  </a>
</p>

# X(P)FeRD

I needed a simple Application for creating, managing, and exporting XRechnung XML invoices and ZUGFeRD PDF invoices (German e-invoicing standard).
Especially the simple WYSIWYG PDF template editor is a feature I couldn't find a existing solution I liked.
So I build this little app (with a little help of AI, I will be honest 🙈).
It's probably not perfect, as I have only limited test data, but feel free to report any issues or submit PRs if you want to contribute.

## Features

- Create and edit invoices with all legally required fields for Germany
- Auto-calculated totals (net, tax, gross)
- Export invoices as XRechnung 3.0 compliant XML
- Design single page invoice PDF with WYSIWYG editor
  - Support for SVG logos
  - Use custom fonts (TTF/OFT)
  - Custom and common help lines (including envelope window, folding marks and borders)
- Export invoices as ZUGFeRD 2.1 compliant PDF (with embedded XML)
- Duplicate invoices or create from templates
- Swagger API documentation at `/api-docs`

## Screenshots
| ![Screenshot01](docs/screenshots/screen1.png) | ![Screenshot02](docs/screenshots/screen2.png) |
|:---------------------------------------------:|:---------------------------------------------:|
| ![Screenshot03](docs/screenshots/screen3.png) | ![Screenshot04](docs/screenshots/screen4.png) |


## Quick Start (Docker Compose)

```bash
# Development (hot-reload)
docker-compose up dev

# Production
docker-compose up production
```

The app is available at `http://localhost:3000`.

## Manual Docker Setup

```bash
# Build the dev image
docker build -f Dockerfile.dev -t xrechnung-dev .

# Start a persistent dev container
docker run -d --name xr-dev \
  -v "$(pwd):/app" \
  -p 3000:3000 \
  xrechnung-dev

# Install dependencies
docker exec xr-dev pnpm install

# Build the frontend
docker exec xr-dev node build-client.js

# Start the server
docker exec xr-dev npx tsx src/server/index.ts
```

## Running Tests

```bash
docker exec xr-dev npx vitest run
```

Or via Docker Compose:

```bash
docker-compose run --rm test
```

## Frameworks & Libraries
- **Application:** TypeScript, Svelte 5, Express
- **Database:** SQLite
- **PDF Generation:** @libpdf/core
- **XML Generation:** xmlbuilder2 (UBL 2.1 / XRechnung 3.0)
- **API Documentation:** Swagger-UI (`/api-docs`)
