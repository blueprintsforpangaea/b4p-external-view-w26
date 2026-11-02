# Product

<!-- impeccable:product-schema 1 -->

> Written from the owner's brief in the project thread and the code in this repository, without a live interview (the owner works through a project chat, not this terminal). Inferred facts are marked *(assumed)*.

## Platform

web

## Users

Staff at Blueprints for Pangaea partner clinics who order donated medical supplies for their clinic: nurses, clinic coordinators and administrators. Many are not technical and some are older; they use the site occasionally, not daily, on a work computer or a phone *(assumed: phone use is common at smaller clinics)*. Their job: find the supplies the clinic needs, see how many are in stock, put together a list and send it to Blueprints, then follow it until it ships.

A second audience is the Blueprints team (HQ), who review requests; that internal side is out of scope for the public site.

## Product Purpose

Blueprints for Pangaea collects unused medical supplies and sends them, free, to partner clinics. This site shows the current donated inventory, read from the team's inventory sheet, and lets a partner clinic request items. Success: a clinic finds what it needs and sends a correct request without help, and the team gets requests it can fill.

## Positioning

The supplies are donated surplus, free to partner clinics, listed straight from Blueprints' real warehouse inventory, down to the batch, box and use-by date. It is not a store: there are no prices, carts or payment, and what is listed changes as donations arrive and ship.

## Operating Context

- Inventory is the "Final Inventorying" tab of the team's Google Sheet: about 2,400 rows; columns Manufacturer Name, Category, Subcategory, General, Name, Lot Number, Notes, Quantity, Date of Expiration, Pallet Number, Box Number, Image URL, Review. The site groups rows by Subcategory (12 groups such as Airway & Oxygen, IV Supplies, Needles & Syringes) and by kind of supply.
- Many supplies have a photo of the actual item (Google Drive). Photos of patient-sample containers are withheld for privacy.
- Product names are often long and technical (part numbers, sizes, sterile/non-sterile).
- Flow: browse or search, add supplies to a list with a quantity, review, send; the clinic is emailed as the request moves through Submitted, Under review, Approved, Shipped (or Denied).
- Partner clinics sign in with an invited work email.

## Capabilities and Constraints

- Requests are capped (up to 100 different supplies per request); quantities cannot exceed stock.
- Labels on supplies: Low stock, Expires soon, Team check (reviewed by hand), On hold (set aside for another clinic).
- Expired and unnamed rows are hidden.
- The deployed site has a strict Content Security Policy; external fonts and images must be allowed explicitly.

## Brand Commitments

- Name: Blueprints for Pangaea (B4P). The logo is a blue globe (Pangaea).
- Palette from the Blueprints website: navy #000e3f for headings, blue #0035a2 for links, #0069f3 for buttons, warm off-white #f6f4f0 ground.
- Typeface: Public Sans.
- The owner explicitly dislikes generic, AI-generated-looking design: no purple gradients, no boxes around everything, no rounded-everything, no icon-in-a-circle tiles, no kicker labels, no emoji, no invented stats.
- Voice: plain, short, friendly, like a person at a small nonprofit. No marketing language.

## Evidence on Hand

- Real inventory rows (live sheet) and real item photos (Drive links in the sheet).
- Real screenshots of the request flow in `my-dashboard/src/assets/guide/`.
- The Blueprints logo (`my-dashboard/src/assets/b4p-logo.jpg`).
- No testimonials, clinic names, impact numbers or partner logos are on hand for this site; do not invent them.

## Product Principles

1. Obvious beats clever: every clickable thing looks clickable, every label says what it does.
2. Show the real thing: real names, real stock, real photos, real dates.
3. Stock is the truth: never imply more is available than the sheet says.
4. One clear next step on every screen.
5. Privacy first: nothing that could identify a patient is ever shown.

## Accessibility & Inclusion

Older readers: no text under 15px, large tap targets (44px+), high contrast (WCAG AA at least), works with keyboard and screen readers, readable at phone width.
