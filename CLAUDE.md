# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## What this is

LIMS José: internal Next.js app for a single clinical laboratory (one site, one lab) — patients, orders, results, reports, analytics, catalog, Excel import, and offline continuity. No landing page, no public signup. Written in Spanish; keep UI copy and clinical terminology in Spanish.

This repo pins Next.js 16.2.11 / React 19.2.4 — per AGENTS.md above, check `node_modules/next/dist/docs/` for the actual API before assuming training-data conventions apply.

## Commands

```bash
npm run dev              # runs build:patient-worker first (predev hook)
npm run build             # runs build:patient-worker first (prebuild hook)
npm run lint
npm run typecheck         # tsc --noEmit
npm test                  # vitest run (single file: npx vitest run src/lib/clinical.test.ts)
npm run test:e2e          # builds, then runs scripts/run-e2e.mjs (Playwright, tests/e2e/)
npm run offline:keys      # generates ES256 JWK pair for offline-lease auth
```

There is no `src/workers/patient-roster.worker.ts` build step wired into Vitest/tsc directly — it's bundled standalone via esbuild into `public/workers/patient-roster.worker.js` and must be rebuilt (predev/prebuild do this automatically) whenever the worker source changes.

## Architecture

### Single shared account, analyst-attributed authorship

There is no `profiles` table and no app-level roles. One shared Supabase Auth account is used to access the app (RLS checks `auth.uid()` against `lab_settings.authorized_user_id`). Staff sign in with a **username**, not an email: `lab_settings.login_username` maps to the account's address through the `email_for_login(text)` RPC, which is `security definer` and callable by `anon` because the login screen has no session yet. Clinical authorship is separate: every analysis registration must explicitly select an active row from `public.analysts`, and `register_daily_analyses` / `apply_offline_operation` reject writes without one. Don't conflate "who is logged in" with "who performed the analysis" anywhere in the code.

**One sign-in screen per connectivity state, never two in a row.** Online, `/login` is the only screen: it authenticates against Supabase and then hands the typed password to `/app` in memory (`offline/handoff.ts`) over a *soft* navigation, so the bootstrap can prepare-or-unlock the local vault silently. A hard navigation would drop the handoff, which is why `/login` uses `router.push` in offline mode. Offline, the service worker serves `/offline` and its `AccessGate` unwraps the vault with the same credentials — `proxy.ts` never runs in that case, so its redirect to `/login` is always the right answer for an online client. `/app` reached online without a handoff bounces back to `/login` once (guarded by a `sessionStorage` mark, so a lost handoff degrades to one prompt instead of an infinite loop) rather than showing a second form.

### Demo mode vs. real mode

`NEXT_PUBLIC_DEMO_MODE` gates whether `/app` reads fixture data or exclusively real Supabase tables. It must be `false` in Preview/Production. When adding a data-fetching path, check how it behaves under both modes — an empty real database should render zero-state metrics, not fall back to fixtures.

### Clinical domain rules (see `src/lib/clinical.ts`, `docs/CLINICAL-SAFETY.md`)

- **No clinical approval workflow.** The lifecycle is draft → printed, full stop. `orders.status` / `result_revisions.status` are legacy columns frozen at `draft` — do not treat them as functional state.
- **Corrections, not edits.** A validated/printed report is never mutated in place; `amend_report` creates a new revision with a mandatory reason and preserves the prior report (clinical snapshot — historical reports never change when the catalog changes later).
- **Critical values are non-blocking.** A critical result shows a visible warning but can still be saved and printed.
- **Canonical catalog order.** Capture, storage, and printing must follow the versioned clinical order from the catalog (`src/lib/catalog-order.ts`, `catalog-groups.ts`) — never re-sort alphabetically.
- **Report views** (`src/lib/report-views.ts`). One catalog group can be reported several ways: `MICROBIOLOGIA` (stool) yields Parásito Seriado, Reacción Inflamatoria, Parásito Directo and Coprofuncional from the same analyses. A view is a list of subgroups plus a printed title; it only *preselects* which results to include — the analyst still adjusts the per-result checkboxes, which remain the source of truth for what gets printed. Views filter on `resultSubsection()` from `result-presentation.ts`, the same function that titles the sections, so selection and layout cannot diverge.
- **Linked hematology fields.** Entering hematíes, hemoglobina, or hematocrito auto-derives the other two (`Hto = Hb × 3`, `Hb = Hto / 3`, `hematíes = Hb / 3`); any later edit recalculates the same triplet. This logic lives in `clinical.ts` — reuse it rather than reimplementing per form.
- **No unit/method mixing** across a patient's historical trend, and no automated diagnostic suggestions anywhere.
- Reference ranges (`analysis_versions.reference_ranges`) and `critical_limits` have specific JSON shapes documented in `docs/SUPABASE.md` — check for overlaps when touching range logic.

### Offline-first sync (`src/lib/offline/`, `docs/OFFLINE-PWA.md`)

Supabase is always the canonical source; enrolled devices keep an encrypted local replica plus an operation queue.

**Writes go straight to Supabase whenever the device is online *and* its outbox is empty** (`writeThrough()` in `repository.tsx`) — that's what keeps concurrent users seeing each other's work instead of five diverging replicas. The empty-outbox clause is a correctness requirement, not an optimization: bypassing queued operations reorders writes (e.g. saving results against an order the server doesn't have yet). While anything is pending, everything goes through the queue, in order.

**Every incoming snapshot is rebased** (`rebase.ts`) before it replaces the local one. `/api/sync/pull` always returns a full snapshot, so storing it verbatim would erase changes still sitting in the outbox — the operation would stay queued while its effect vanished from screen. `rebaseSnapshot` re-applies the pending queue on top, and is a no-op (same reference) when the queue is empty.

Key pieces:
- `db.ts` — IndexedDB snapshot/outbox/conflict storage, encrypted at rest (AES-256-GCM, key wrapped via PBKDF2-HMAC-SHA256 over the **account password**; decrypted data key lives only in memory while the PWA tab is open). `rewrapOfflineVault` re-wraps it when the password changes.
- `lease.ts` / `lease-server.ts` — ES256 device authorization, expires at 72h, renewed on reconnect (`OFFLINE_LEASE_PRIVATE_JWK` is server-only, never bundled).
- `sync.ts`, API routes under `src/app/api/sync/` — `GET /pull` (snapshot + cursor), `POST /push` (max 50 ops/batch, dependency-ordered), applied server-side through the `apply_offline_operation` RPC inside one Postgres transaction, deduplicated via `offline_mutation_receipts`.
- Conflicts (demographics or `lock_version` mismatches) are never auto-resolved "last write wins" — they surface in a reconciliation panel.
- Cache Storage only holds the app shell and public assets; API/Supabase/PDF/DNI/result responses are never cached.
- What's allowed offline: patient lookup + last 90 days, registering patients/batches, editing results, generating PDFs, and editing the catalog. Excel import, inviting users, and password changes require connectivity.
- Catalog edits travel as `catalog.apply` operations whose payload is the same body `/api/catalog` accepts; both paths dispatch through the `apply_catalog_operation` RPC, so there is exactly one implementation. Client-generated UUIDs for new groups/subsections/analyses/versions are authoritative — the analysis code is derived from the analysis id so it survives sync unchanged. Catalog metadata reconciles last-write-wins (unlike clinical data); archiving/deleting something already gone returns `noop`.

When touching this layer, changes to the wire format between client and `apply_offline_operation` need a matching Supabase migration and must stay backward-compatible with devices that haven't synced yet.

### Reports and PII

Generated PDFs (`src/lib/report-pdf.ts`) go to the private `clinical-reports` Storage bucket. `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_SECRET_KEY` are server-only secrets for administrative tasks — never expose them to the browser or use them in a client-reachable code path.

### Database migrations

SQL migrations are hand-applied (not via Supabase CLI push) and tracked in `supabase/migrations/`, numbered `YYYYMMDDNNNN_description.sql`. `docs/SUPABASE.md` lists the intended run order and what each migration does — read it before adding a new one, since later migrations depend on schema/RPCs introduced earlier (e.g., the DNI-as-patient-key migration removes `public.profiles` entirely, and the canonical-catalog migration fixes clinical ordering that later code assumes). `scripts/apply-*.mjs` and `scripts/verify-*.mjs` pair with specific migrations for one-off data backfills/verification — check for a matching script when writing a migration that touches existing data.

### Testing

Vitest covers `src/lib/**/*.test.ts` (unit/logic, including offline sync and clinical math). Playwright e2e (`tests/e2e/`) runs against a production build via `scripts/run-e2e.mjs`, not `next dev`. When adding clinical logic (reference ranges, critical limits, hematology derivation, catalog ordering), add or extend a Vitest case in the corresponding `*.test.ts` next to the source file rather than a new top-level test file.
