# Changelog

## 0.2.0 — 2026-05-22

### Added

- **Express** integration via `createWorqRouter()` and `attachWebSocket(server)`
- Shared route/render modules; `npm run dev:express` example
- Optional `express` peer dependency

### Fixed

- Express static assets served at `/static/` (CSS, HTMX, WebSocket client)
- HTMX retry/delete on Failed and Scheduled tables (badge stays in Actions column; delete removes row)

## 0.1.1

- README and repository metadata fixes

## 0.1.0

- Initial release: Fastify plugin, BullMQ adapter, dashboard UI, REST client
