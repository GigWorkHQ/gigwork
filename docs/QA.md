# Verification record — 18 October 2026

## Automated and source checks

- `pnpm test`: six domain tests pass. Covers claim/submit/review/default credit order, prevention of duplicate credit, skip/release, claim expiry, $6/hour batch floor, 24-hour minimum review, funding arithmetic, cancellation boundaries, Pay-run fee cap and stock-country exclusions.
- `pnpm build`: production Vite build passes after dashboard refinement and favicon addition.
- `pnpm audit --prod`: no known vulnerabilities reported by the registry at check time. This is a dependency check, not a penetration test.
- Focused UI review: React escapes dynamic text; no innerHTML, dangerouslySetInnerHTML, eval, executable URLs, remote embeds, network API calls or client secrets in application source. The local sample store is explicitly labeled. Form guards reject duplicate final batch/report/withdraw submissions; task transitions guard repeated credit. Preview server binds only to 127.0.0.1 and restricts files to dist.

## Browser flows exercised

1. Task WL-1048: claim; empty submission rejected; answer/reason submitted; switch to client review; approve; available sample balance increased from $317.40 to $317.88 and history contained the full $0.48 credit. Navigation preserved local state.
2. Batch: low assignment pay rejected by hourly floor. 50 items × 3 workers × $0.50 quoted $75 principal + $9 fee + $15 reserve = $99. Created funded local sample appeared in task batches.
3. Gig: funded milestone started; progress recorded; delivery notes submitted; client approval credited $240. Started/submitted work had no ordinary cancellation control.
4. Contract: client proposed $200; worker accepted for next period; current reserve stayed $180. Period-end run credited $180 once, disabled a repeat, deducted $1.80 client fee from unreserved funds. Next reserve used accepted $200 and showed $418.20 remaining unreserved.
5. Payout preferences: US selection kept stock allocation disabled at 0% and displayed the source exclusion. Escape closed the dialog.
6. Dashboard refinement: search `translation` returned the matching task; week/month filters changed chart range; keyboard activation of 15 October displayed $180; type/status toggle changed bars; worker/client switching changed navigation and summary. Empty client queue showed an explicit empty state.
7. Marketing: hero pause/scene selector; desktop and phone anchor navigation; mobile menu; interactive roadmap stage 06; product accordions, work-type selectors and FAQ inspected. Links route into implemented pages/guides.
8. Local sample state reset after financial-flow tests. No real account, transaction, signature, email or report was sent.

## Visual and responsive evidence

- Desktop: 1440 × 1000 overview, contract page, hero and benefits. Earlier 1280 checks informed the initial layout.
- Tablet: 768 × 1024 overview. Slim rail and two-column chart/task arrangement reviewed; sidebar transform override repaired.
- Phone: 390 × 844 overview and marketplace; menu opened/closed; every dashboard route loaded without broken images. Document width did not exceed viewport width. Table containers intentionally allow internal horizontal scrolling.
- Evidence files include refined-desktop-dashboard.png, refined-dashboard-full.png, refined-mobile-dashboard.png, desktop-homepage.png, desktop-how-it-works.png, mobile-roadmap.png and desktop-contract.png. Earlier screenshots named desktop-dashboard/tablet-dashboard predate the latest refinement.
- Browser warning logs observed during checks were injected wallet-extension messages. They were not application errors. No production backend or network-failure flow is claimed tested.
- Reduced-motion CSS disables transitions and animation; marketing timer checks reduced-motion, hidden document and offscreen hero. Keyboard focus states exist; native dialogs provide focus/escape. OS-level reduced-motion emulation was not separately exercised.
- Handoff PDF: four pages rendered with Poppler and every page visually inspected. No clipping or table overflow observed.
- Latest user corrections: dashboard outer frame removed; shell begins at viewport x=0, fills available document width, and scrolls naturally without a fixed-height crop. Coloured cards, gig artwork, pay surfaces and bars have bevel highlights and lower-edge shading; controls remain above decorative layers.

## Fidelity and known boundaries

The original desktop reference/video was inspected and a recoverable baseline preserved. The Gigwork build keeps section order, typography, spacing system, colour roles and geometric composition. Original Rive scenes are rebuilt as native UI/CSS with new mascots, and content lengths differ. Simplified navigation/footer, product-specific illustrations, roadmap and the later dashboard reference are authorized changes. This is not a claim of pixel equality or exact reproduction of every original animation; original mobile motion was not supplied in the video. The private baseline retains external Rive dependencies.

Live identity, policy enforcement, independent calibration, staking, on-chain records, review selection, funding, APIs, scheduled jobs, payments, issuer eligibility, stock routes and public history links are not integrated. They are called out in the UI, guides and handoff. Source PDF chain/provider assumptions were not independently verified; no live monetary action is enabled. Font license remains unresolved as recorded in ASSET-NOTICES.md.

## Portable delivery

The final full developer transfer is documented in `DELIVERY-VERIFICATION.md`. It adds a portable launcher, detailed source-to-backend implementation maps, original reference recording and a six-page handoff PDF. The final frontend build matches the published Gigwork brand update. Earlier screenshots and checks in this file predate the rename; current evidence uses a `gigwork-` prefix.

The source package includes local runtime assets, compatible lockfile, built dist, a dependency-free Node preview server, original PDFs outside public directories, handoff and reference baseline. Final packaging performs CRC validation, SHA-256 file manifests and an independent extracted install/build; release verification output is delivered beside the archive.

## Marketplace follow-up
- Production build and all six existing domain tests pass after the marketplace changes.
- Browser checks: saved translation job persisted across navigation into a second tab, then was unsaved; search empty state and reset worked; a two-minute filter returned four jobs and highest-pay sorting placed $0.60 / $0.50 / $0.48 / $0.30 in that order. Detail route opened from its listing; claim and penalty-free release completed for WL-1052. Submission/Questions controls and an FAQ worked, including Enter keyboard activation. Copy link reported successful clipboard write.
- Layouts inspected at 1280 desktop, 768 tablet and 390 phone. Both marketplace and detail pages fit the viewport without document overflow. All seven new image assets loaded locally. Tablet pay layout was revised into a compact two-column summary below the cover; phone uses one column and a horizontal category scroller.
- New scoped hover states lift cards and zoom artwork, reveal a brief link, and highlight saved hearts. Native buttons/links retain keyboard and touch operation. The reduced-motion rule disables new transitions/animation. OS-level preference emulation remains untested.
- Focused security review: all task/client strings are escaped JSX text; links use fixed local routes and supplied internal task IDs; images are generated from first-party fixed strings and approved local PNGs. No new dependencies, remote embeds, network destinations, secrets, HTML injection or privileged actions were added. Card saves, navigation and preview actions are separate controls; sample monetary state remains governed by existing domain transitions. This is a focused source review, not a penetration test.
- Evidence: marketplace-before.png, marketplace-desktop.png, marketplace-cards.png, marketplace-mobile.png, marketplace-job-desktop.png, marketplace-job-mobile.png and marketplace-tablet.png.
