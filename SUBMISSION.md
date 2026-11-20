# UBC 2026 Hackathon Submission: Quorum

**Track:** Consumer Applications
**Chain award:** Best use of Arc

## What did you build?

Quorum is a shared treasury for student clubs. Members pay dues in USDC through one link. Officers can spend small amounts instantly up to a daily allowance, and anything bigger needs a set number of officers (for example 2 of 3) to approve before money moves. Every deposit and every spend, along with its reason and who approved it, is recorded on Arc where every member can see it.

## What problem does it solve?

Almost every student organization runs its money through one person: the treasurer's Venmo or a personal bank account. Members can't see where their dues go, records disappear when the treasurer graduates, and one person can spend the club's money with nobody able to stop them. Clubs lose money this way every year, and honest treasurers have no easy way to prove they are honest. Quorum replaces trust in one person with rules everyone can see.

## How does it work?

A single Solidity contract on Arc Testnet hosts any number of clubs. Each club has a list of officers, an approval threshold, and a daily allowance.

- `payDues` moves USDC from a member into the club's balance and records it with a note.
- `requestSpend` either pays out immediately (if the amount fits in what is left of today's allowance) or opens a request.
- `approve` and `reject` are officer votes. The payment executes automatically the moment the threshold is reached, and the request closes as rejected once the threshold can no longer be reached.
- The allowance is shared across the whole day, so nobody can drain the club with many small spends.

The web app reads everything straight from the contract, with no backend and no database, and uses viem with any browser wallet. It adds Arc Testnet to the wallet automatically. The contract is covered by 12 tests, and the full flow was tested end to end in a browser: create a club, two members pay dues, an instant small spend, and a large spend that waits for a second officer's approval.

**Why Arc:** USDC is Arc's gas token, so a club never needs to buy a second token to pay fees, and every number in the product is in dollars. That is what makes this usable by a club treasurer, not just crypto users.

## What makes it unique?

- It is built for a specific group with a real problem, student org officers, not a generic crypto wallet. The language is dues, officers and reimbursements, not signers and transactions.
- It balances speed with safety. Generic multisig wallets make every coffee purchase wait for signatures. Quorum lets small, everyday spends go through instantly and only slows down the big ones.
- Transparency is the default. Any member can open the club page and see every dollar in and out, with a reason attached to each spend.

## What's next?

- Officer elections each year through a quorum vote.
- Receipt photos attached to each spend.
- Dues tracking and reminders for members who have not paid.
- Category budgets (events, travel, merch).
- A read-only view for university advisors and auditors.

---

## 2-minute demo video script

**Before recording:** set up three wallets (you as president, a second officer, a member). Fund them from faucet.circle.com on Arc Testnet.

**0:00 to 0:15. The problem.**
"Almost every student club runs its money through one treasurer's Venmo. Nobody can see where dues go, and one person can spend everything. Quorum fixes that."

**0:15 to 0:35. Create a club.**
On the home page, create "Illini Robotics", add 2 officer addresses, set "2 of 3 officers" and a $50 daily allowance. Point at the plain-English rule under the form.

**0:35 to 0:55. Collect dues.**
Copy the dues link. Switch to the member wallet and pay $200 with the note "Fall semester dues". The balance updates and the dues appear in Activity.

**0:55 to 1:15. Small spend: instant.**
Switch to the president. Request $30 for "Pizza for general meeting". Show the hint "Within today's allowance, sends instantly", then the money leaving right away.

**1:15 to 1:40. Big spend: needs the quorum.**
Request $120 for "Robotics competition registration". The hint changes to "Needs 2 of 3 officers". It appears in Waiting for approval at 1 of 2. Switch to the second officer and click Approve. The money moves and the Activity log shows "approved by 2 officers".

**1:40 to 1:55. Transparency.**
Show that the member's view has no spend form but sees every transaction. Click an address to open it on the Arc explorer.

**1:55 to 2:00. Close.**
"Your club's money. Nobody can run off with it. Quorum, on Arc."
