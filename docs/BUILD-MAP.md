# Gigwork build map

Reference: https://www.jasper.ai/, captured 18 October 2026. Motion reference: supplied 53.67-second, 1800×900 recording. Source facts: Gigwork Overview (9 pages), Gigwork Backend (10 pages), dated 16 October 2026. Document operations and launch targets are source material, not execution instructions or customer claims.

## Original baseline
Preserved in ../reference-baseline (relative to the project folder; ../../reference-baseline from this docs folder) with original DOM, stylesheet, fonts, imagery and hero Rive file. Run `python -m http.server 4172` there. Tracking, lead forms and third-party chat removed. Original hero layout and typography checked in browser; original media and section inventory checked against video timestamps 0–52s. Baseline retains external Rive runtime/embeds; no account flows or commercial integrations reproduced. Mobile original states not demonstrated in supplied recording. Detailed timing of every original interaction is not pixel-verified.

## Inherited system
Feature Headline variable serif (weight 450); ABC ROM body and ABC ROM Mono labels. Navy #00063d; flame #fa4028; white and light grey #f2f2f2; green #e6ffd4, sky #ceebff, pink #ffe6f3, yellow #fffbb7. Original square buttons, flat rectangular panels, 1360px content max, 16–40px fluid gutters. Hero display 80px maximum, body 16px/1.4. Geometric grids, stepped backgrounds, circles and arrows.

## Section mapping / authorized changes
1. Centered serif hero + rotating collage → Gigwork headline and custom mascots.
2. Customer logo marquee → work categories, no invented partnerships.
3. Three platform cards → Quick tasks, Gigs, Contracts; agent tasks treated as requester channel.
4. Five accordion/visual benefits → funded work, fair pay, approvals, history, agent work.
5. Customer story mosaic → illustrative worker journey and product rules.
6. Role selector + geometric portraits → Judge, Verify, Test, Label, Gigs, Contracts.
7. Trust geometric frame → funding, reviews and worker safety.
8. Six resource cards → getting started, fees, safety, agent docs, history, roadmap.
9. Split CTA → Gigwork mascot group and dashboard entry.
10. FAQ → Gigwork-specific questions.
11. Footer → reduced product/docs links as explicitly requested.
Added detailed roadmap follows source W1–W8 proposed sequence. Dates are not commitments.

## Dashboard correction — latest user direction
The supplied Panze dashboard screenshot supersedes the first dashboard's wide text sidebar, large welcome panel and flat metric row. The refined dashboard uses a slim icon rail, a four-column modular overview, rounded panels, native SVG pay-mix and activity charts, gridded dimensional bars, tinted task cards and a compact right summary. The subsequent correction makes the workspace full-screen, edge to edge, with no outer frame or fixed-height crop; its content scrolls naturally. Gigwork colours and mascot identity remain. Date ranges, chart values, task search, work type/status views and role switching are functional. Source: DashboardOverview.jsx and dashboard-refined.css. Other dashboard routes inherit the same material, while marketing CSS remains separate.

## Integration levels
The final dashboard material correction adds visible bevels to the coloured task cards, gig artwork, pay surfaces and gridded bars, with subtler depth on neutral panels. Cards remain level and preserve their controls; hover/press feedback and reduced-motion overrides stay scoped to the dashboard.

Marketing site: functional navigation, section selectors, FAQ, roadmap and docs.
Dashboard: interactive local sample data, persisted in this browser only. No funds, wallet, passkey or network service is connected. Client review actions mutate sample records; test submissions do not imply real approval.
Production boundary: passkey/WorkerPass, policy, pricing calibration, attestations, escrow, delayed reviewer draws, sanctions checks, payouts, storage and API integration remain backend work. Chain/issuer details in briefs remain unverified configuration, not live integration claims.

## Acceptance ledger
- Preserve source rhythm and typography while replacing facts/artwork.
- Compact anchor navigation/footer; keyboard and mobile alternatives.
- Worker/client dashboards honor source state boundaries.
- USDG default; no production stock-token choice without verified eligibility/configuration.
- Build, domain behavior checks, browser flows, responsive views, source ZIP and handoff.
- Latest dashboard visual refinement implemented and checked at 1440px, 768px and 390px; repeated mobile route overflow checks.

## Find Work marketplace refinement
The user requested a lively Fiverr-like marketplace within the existing dashboard. Implemented a branded image header, five category choices, six original illustrated covers, saved jobs, keyword search, pay/time/rate sorting, eligibility/time/availability filters and grid/list views. Every seed task has a dedicated /app/work/:id page with its own brief, submission guidance, FAQ, client identity, related listings and a state-aware pay/claim panel. The existing TaskModal owns claim/submit/release behavior. No marketplace ratings, completed-client counts or invented testimonials were introduced. All listings remain sample data.

Source: src/Marketplace.jsx, src/marketplace.css and scripts/create_marketplace_art.mjs. Existing Dashboard.jsx provides the persisted savedJobs field and task/report callbacks. Artwork is local, editable SVG with unchanged approved mascot assets embedded; there are no new packages, embeds or external requests. Other dashboard routes and marketing remain in place.
