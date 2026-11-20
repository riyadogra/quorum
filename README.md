# Quorum 🏛️

**The club treasury nobody can run off with.**

Most student organizations run their money through one treasurer's Venmo. Records are a mess, members have no idea where their dues went, and every year some club loses money it can't account for. Quorum puts a club's money in a shared USDC treasury on Arc with rules enforced by a smart contract:

- **Members pay dues** with one link.
- **Small spends go through instantly.** Any officer can spend up to a daily allowance (for example $50/day for pizza) without waiting.
- **Big spends need a quorum.** Anything over the allowance needs, for example, 2 of 3 officers to approve before a cent moves.
- **Everyone sees everything.** Every deposit and every spend, with its reason and who approved it, is recorded on-chain.

Built for the UBC 2026 Hackathon, **Consumer Applications** track (Best use of Arc).

## Why Arc

Arc is Circle's stablecoin-native L1: USDC is the gas token, so a club treasurer never needs to buy a separate token just to pay fees, and every number in the app is in dollars. Quorum holds and moves USDC through Arc's ERC-20 interface at `0x3600000000000000000000000000000000000000`.

## How it works

`contracts/Quorum.sol` is a single contract that hosts any number of clubs.

| Function | Who | What it does |
|---|---|---|
| `createClub(name, officers, threshold, dailyLimit)` | Anyone | Creates a club. The creator is automatically an officer. |
| `payDues(clubId, amount, note)` | Anyone | Pulls USDC from the member into the club's balance and logs it. |
| `requestSpend(clubId, to, amount, reason)` | Officers | If the amount fits in today's remaining allowance, it pays out immediately. Otherwise it creates a pending request with the requester's approval already counted. |
| `approve(clubId, requestId)` | Officers | Adds an approval. When approvals reach the threshold, the payment executes. |
| `reject(clubId, requestId)` | Officers | Adds a rejection. Once the threshold can no longer be reached, the request is closed as rejected. |
| `cancel(clubId, requestId)` | Requester | Withdraws a pending request. |

**Safety details**

- The daily allowance is **shared across the day**, so an officer can't drain the club with many small spends. It resets every 24 hours (UTC day).
- Each club's balance is tracked separately even though one contract holds all funds, and spends can never exceed the club's own balance.
- An officer can vote once per request. Non-officers cannot request or vote.
- State is updated before any USDC transfer.

12 Hardhat tests cover all of the above (`npm test`).

**Frontend:** Vite + vanilla JS + viem. Reads everything straight from the contract (no backend, no database). Works with MetaMask, Rabby, or any injected wallet, and adds Arc Testnet to the wallet automatically.

## Run it

```bash
npm install
npm test                     # compile + run the contract tests
```

### 1. Get a testnet wallet ready
- Use a **throwaway** MetaMask or Rabby wallet, not one that holds real funds.
- Get testnet USDC at https://faucet.circle.com (choose **Arc Testnet**). USDC is also the gas token, so that's all you need.

### 2. Deploy the contract
```bash
PRIVATE_KEY=0xYOUR_TESTNET_KEY npm run deploy
```
This deploys `Quorum` to Arc Testnet and writes `VITE_QUORUM_ADDRESS` into `.env.local`. Never commit that key; `.env.local` is gitignored.

### 3. Run the app
```bash
npm run dev
```
Open http://localhost:5173.

### 4. Deploy the site
Push to GitHub, import into Vercel (framework preset **Vite**), and add the environment variable `VITE_QUORUM_ADDRESS` with your contract address.

## Network details

| | |
|---|---|
| Network | Arc Testnet |
| Chain ID | 5042002 |
| RPC | https://rpc.testnet.arc.io |
| Explorer | https://explorer.testnet.arc.io |
| USDC (ERC-20) | `0x3600000000000000000000000000000000000000` |

## What's next

- **Officer elections:** rotate officers each year with a quorum vote instead of creating a new club.
- **Receipts:** attach a photo of the receipt to each spend (hash stored on-chain, file on IPFS).
- **Dues tracking:** who has and hasn't paid this semester, with reminders.
- **Budgets by category:** events, travel, merch, each with its own allowance.
- **University integration:** student org advisors get a read-only view for audits.
