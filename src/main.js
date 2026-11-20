import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  fallback,
  parseUnits,
  formatUnits,
  getAddress,
  isAddress,
  erc20Abi,
} from 'viem';
import { arcTestnet, USDC_ADDRESS, QUORUM_ADDRESS, EXPLORER } from './chain.js';
import artifact from './quorum-artifact.json';

const ABI = artifact.abi;
const STATUS = ['Pending', 'Executed', 'Rejected', 'Cancelled'];

const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: fallback(arcTestnet.rpcUrls.default.http.map((u) => http(u))),
});
let walletClient = null;
let account = null;

const $ = (id) => document.getElementById(id);
const usd = (v) => `$${Number(formatUnits(v ?? 0n, 6)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');
const same = (a, b) => a && b && a.toLowerCase() === b.toLowerCase();
const who = (a) => (same(a, account) ? 'You' : short(a));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ago = (t) => {
  const s = Math.floor(Date.now() / 1000 - Number(t));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};
const addrLink = (a) => `<a href="${EXPLORER}/address/${a}" target="_blank" rel="noopener">${who(a)}</a>`;

// ------------------------------------------------------------ UI feedback
let toastTimer;
function toast(msg, kind = 'info', ms = 4500) {
  const t = $('toast');
  t.innerHTML = msg;
  t.className = `toast ${kind}`;
  clearTimeout(toastTimer);
  if (ms) toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
}

const FRIENDLY = {
  NotOfficer: "Only this club's officers can do that.",
  AlreadyVoted: "You've already voted on this request.",
  NotPending: 'This request has already been decided.',
  InsufficientClubBalance: "The treasury doesn't have enough to cover that.",
  InvalidConfig: 'Check the club settings: approvals needed must be between 1 and the number of officers.',
  ZeroAmount: 'Enter an amount above $0.',
  BadClub: "That club doesn't exist.",
};
function errText(e) {
  const name = e?.cause?.data?.errorName || e?.data?.errorName || e?.cause?.cause?.data?.errorName;
  if (name && FRIENDLY[name]) return FRIENDLY[name];
  if (e?.code === 4001 || /rejected|denied/i.test(e?.message)) return 'You cancelled the transaction in your wallet.';
  return e?.shortMessage || e?.message || String(e);
}

async function run(label, fn) {
  try {
    toast(`⏳ ${label}… confirm in your wallet.`, 'info', 0);
    const res = await fn();
    toast(`✅ ${label} done.`, 'ok');
    return res;
  } catch (e) {
    console.error(e);
    toast(`⚠️ ${esc(errText(e))}`, 'err', 7000);
    return null;
  }
}

async function send(functionName, args) {
  await ensureChain();
  const { request } = await publicClient.simulateContract({ address: QUORUM_ADDRESS, abi: ABI, functionName, args, account });
  const hash = await walletClient.writeContract(request);
  return publicClient.waitForTransactionReceipt({ hash });
}

// ------------------------------------------------------------ wallet
async function connect() {
  if (!window.ethereum) {
    toast('Install MetaMask or Rabby to use Quorum, then add USDC from faucet.circle.com (Arc Testnet).', 'err', 8000);
    return null;
  }
  walletClient = createWalletClient({ chain: arcTestnet, transport: custom(window.ethereum) });
  const [a] = await walletClient.requestAddresses();
  account = getAddress(a);
  await ensureChain();
  onAccount();
  return account;
}

async function ensureChain() {
  const id = await walletClient.getChainId();
  if (id === arcTestnet.id) return;
  try {
    await walletClient.switchChain({ id: arcTestnet.id });
  } catch {
    await walletClient.addChain({ chain: arcTestnet });
  }
}

async function onAccount() {
  $('connect').textContent = short(account);
  $('connect').classList.replace('btn-dark', 'btn-light');
  refreshWalletBalance();
  if (route.club !== null) loadClub();
  else loadMyClubs();
}

async function refreshWalletBalance() {
  if (!account) return;
  try {
    const bal = await publicClient.readContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: 'balanceOf', args: [account] });
    $('wallet-bal').textContent = `${usd(bal)} USDC`;
    $('wallet-bal').classList.remove('hidden');
  } catch (e) { console.error(e); }
}

async function requireAccount() {
  return account || (await connect());
}

// ------------------------------------------------------------ routing
const params = new URLSearchParams(location.search);
const route = { club: params.has('club') ? Number(params.get('club')) : null };

// ------------------------------------------------------------ home
let thresholdTouched = false;
function updateThresholdOptions() {
  const n = 1 + parseOfficers().length;
  const sel = $('c-threshold');
  const prev = thresholdTouched ? Number(sel.value) : Math.min(2, n);
  sel.innerHTML = Array.from({ length: n }, (_, i) => `<option value="${i + 1}">${i + 1} of ${n} officers</option>`).join('');
  sel.value = String(Math.min(prev, n));
  updateRule();
}

function parseOfficers() {
  return $('c-officers').value.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
}

function updateRule() {
  const n = 1 + parseOfficers().length;
  const t = $('c-threshold').value || 1;
  const lim = Number($('c-limit').value || 0);
  $('c-rule').innerHTML = `Officers can spend up to <b>$${lim}/day</b> on their own. Anything more needs <b>${t} of ${n}</b> officers to approve.`;
}

async function createClub() {
  if (!(await requireAccount())) return;
  const name = $('c-name').value.trim();
  if (!name) return toast('Give your club a name.', 'err');
  const raw = parseOfficers();
  const bad = raw.find((a) => !isAddress(a));
  if (bad) return toast(`"${esc(bad.slice(0, 20))}" isn't a valid wallet address.`, 'err');
  const officers = raw.map((a) => getAddress(a));
  const threshold = BigInt($('c-threshold').value || 1);
  const limit = parseUnits(String($('c-limit').value || 0), 6);

  const receipt = await run('Creating your treasury', () => send('createClub', [name, officers, threshold, limit]));
  if (!receipt) return;
  const count = await publicClient.readContract({ address: QUORUM_ADDRESS, abi: ABI, functionName: 'clubCount' });
  location.href = `/?club=${Number(count) - 1}&new=1`;
}

async function loadMyClubs() {
  if (!account) return;
  const el = $('my-clubs');
  try {
    const ids = await publicClient.readContract({ address: QUORUM_ADDRESS, abi: ABI, functionName: 'getClubsOf', args: [account] });
    if (!ids.length) {
      el.innerHTML = '<p class="muted">No clubs yet. Start one, or ask your treasurer for your club\'s dues link.</p>';
      return;
    }
    const clubs = await Promise.all(ids.map((id) => publicClient.readContract({ address: QUORUM_ADDRESS, abi: ABI, functionName: 'getClub', args: [id] })));
    el.innerHTML = clubs.map(([c], i) => {
      const officer = c.officers.some((o) => same(o, account));
      return `<a class="club-item" href="/?club=${ids[i]}">
        <div><b>${esc(c.name)}</b><span>${officer ? 'Officer' : 'Member'} · ${c.officers.length} officers</span></div>
        <b class="amt">${usd(c.balance)}</b>
      </a>`;
    }).join('');
  } catch (e) {
    console.error(e);
    el.innerHTML = `<p class="muted">Couldn't load your clubs. ${esc(errText(e))}</p>`;
  }
}

// ------------------------------------------------------------ club
let club = null;

async function loadClub() {
  const id = BigInt(route.club);
  try {
    const [[c, allowanceLeft], requests, deposits] = await Promise.all([
      publicClient.readContract({ address: QUORUM_ADDRESS, abi: ABI, functionName: 'getClub', args: [id] }),
      publicClient.readContract({ address: QUORUM_ADDRESS, abi: ABI, functionName: 'getRequests', args: [id] }),
      publicClient.readContract({ address: QUORUM_ADDRESS, abi: ABI, functionName: 'getDeposits', args: [id] }),
    ]);
    let votes = {};
    if (account) {
      const pendingIdx = requests.map((r, i) => (r.status === 0 ? i : -1)).filter((i) => i >= 0);
      const v = await Promise.all(pendingIdx.map((i) => publicClient.readContract({ address: QUORUM_ADDRESS, abi: ABI, functionName: 'voteOf', args: [id, BigInt(i), account] })));
      pendingIdx.forEach((i, k) => (votes[i] = Number(v[k])));
    }
    club = { id, c, allowanceLeft, requests, deposits, votes };
    renderClub();
  } catch (e) {
    console.error(e);
    $('club-name').textContent = 'Club not found';
    $('club-rule').textContent = errText(e);
  }
}

function isOfficer() {
  return club && account && club.c.officers.some((o) => same(o, account));
}

function renderClub() {
  const { id, c, allowanceLeft, requests, deposits, votes } = club;
  document.title = `${c.name} · Quorum`;
  $('club-id').textContent = `Club #${id}`;
  $('club-name').textContent = c.name;
  $('club-rule').innerHTML = `Officers can spend up to <b>${usd(c.dailyLimit)}/day</b> on their own. Anything more needs <b>${c.threshold} of ${c.officers.length}</b> officers to approve.`;
  $('s-balance').textContent = usd(c.balance);
  $('s-raised').textContent = usd(c.totalRaised);
  $('s-spent').textContent = usd(c.totalSpent);
  $('s-members').textContent = new Set(deposits.map((d) => d.from.toLowerCase())).size;
  $('s-allow').textContent = usd(allowanceLeft);

  // officers
  $('officers').innerHTML = c.officers.map((o) => `<div class="officer"><span class="avatar">${o.slice(2, 4).toUpperCase()}</span>${addrLink(o)}${same(o, c.creator) ? '<span class="tag">Founder</span>' : ''}</div>`).join('');

  // spend form
  const off = isOfficer();
  $('spend-form').classList.toggle('hidden', !off);
  $('spend-who').textContent = off ? "You're an officer. Small spends go through instantly; bigger ones go to the other officers for approval." : account ? "Only this club's officers can request spends." : 'Connect your wallet. Only officers can request spends.';
  updateSpendHint();

  // pending
  const pending = requests.map((r, i) => ({ r, i })).filter(({ r }) => r.status === 0).reverse();
  $('pending-count').textContent = pending.length ? pending.length : '';
  $('pending').innerHTML = pending.length ? pending.map(({ r, i }) => {
    const pct = Math.min(100, (Number(r.approvals) / Number(c.threshold)) * 100);
    const myVote = votes[i] || 0;
    const canVote = off && myVote === 0;
    const mine = same(r.requester, account);
    return `<div class="req">
      <div class="req-top"><b>${esc(r.reason || 'No reason given')}</b><span class="amt neg">${usd(r.amount)}</span></div>
      <p class="small muted">To ${addrLink(r.to)} · requested by ${addrLink(r.requester)} · ${ago(r.createdAt)}</p>
      <div class="bar"><div style="width:${pct}%"></div></div>
      <p class="small"><b>${r.approvals} of ${c.threshold}</b> approvals${r.rejections ? ` · ${r.rejections} rejected` : ''}${myVote === 1 ? ' · <span class="ok">you approved</span>' : myVote === 2 ? ' · <span class="neg">you rejected</span>' : ''}</p>
      <div class="req-actions">
        ${canVote ? `<button class="btn btn-primary btn-sm" data-act="approve" data-i="${i}">Approve</button><button class="btn btn-light btn-sm" data-act="reject" data-i="${i}">Reject</button>` : ''}
        ${mine ? `<button class="btn btn-ghost btn-sm" data-act="cancel" data-i="${i}">Cancel request</button>` : ''}
      </div>
    </div>`;
  }).join('') : '<p class="muted">Nothing waiting. All spends are settled.</p>';
  document.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => vote(b.dataset.act, BigInt(b.dataset.i))));

  // ledger
  const items = [
    ...deposits.map((d) => ({ t: Number(d.at), html: `<div class="li"><span class="dot in">↓</span><div><b>${who(d.from)} paid dues</b><p class="small muted">${esc(d.note || 'Dues')} · ${ago(d.at)} · ${addrLink(d.from)}</p></div><span class="amt pos">+${usd(d.amount)}</span></div>` })),
    ...requests.filter((r) => r.status !== 0).map((r) => {
      const exec = r.status === 1;
      const label = exec ? (r.autoApproved ? 'Spent (within daily allowance)' : `Spent (approved by ${r.approvals} officers)`) : STATUS[r.status];
      return { t: Number(r.decidedAt || r.createdAt), html: `<div class="li ${exec ? '' : 'dim'}"><span class="dot ${exec ? 'out' : 'x'}">${exec ? '↑' : '×'}</span><div><b>${esc(r.reason || 'Spend')}</b><p class="small muted">${label} · to ${addrLink(r.to)} · ${ago(r.decidedAt || r.createdAt)}</p></div><span class="amt ${exec ? 'neg' : 'strike'}">−${usd(r.amount)}</span></div>` };
    }),
  ].sort((a, b) => b.t - a.t);
  $('ledger').innerHTML = items.length ? items.map((x) => x.html).join('') : '<p class="muted">No activity yet. Share the dues link to get started.</p>';
}

function updateSpendHint() {
  if (!club) return;
  const amt = Number($('sp-amount').value || 0);
  if (!amt) { $('sp-hint').innerHTML = `Today's allowance left: <b>${usd(club.allowanceLeft)}</b>.`; return; }
  const a = parseUnits(String(amt), 6);
  if (a > club.c.balance) $('sp-hint').innerHTML = `<span class="neg">The treasury only has ${usd(club.c.balance)}.</span>`;
  else if (a <= club.allowanceLeft) $('sp-hint').innerHTML = '⚡ Within today\'s allowance. This sends <b>instantly</b>.';
  else $('sp-hint').innerHTML = `🛡️ Over today's allowance. This needs <b>${club.c.threshold} of ${club.c.officers.length}</b> officers to approve (your request counts as 1).`;
}

async function payDues() {
  if (!(await requireAccount())) return;
  const amt = Number($('d-amount').value || 0);
  if (!(amt > 0)) return toast('Enter an amount above $0.', 'err');
  const amount = parseUnits(String(amt), 6);
  const bal = await publicClient.readContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: 'balanceOf', args: [account] });
  if (bal < amount) return toast(`You have ${usd(bal)} USDC. Get test USDC at <a href="https://faucet.circle.com" target="_blank">faucet.circle.com</a> (choose Arc Testnet).`, 'err', 9000);

  const allowance = await publicClient.readContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: 'allowance', args: [account, QUORUM_ADDRESS] });
  if (allowance < amount) {
    const ok = await run('Step 1 of 2: allowing Quorum to collect your dues', async () => {
      await ensureChain();
      const hash = await walletClient.writeContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: 'approve', args: [QUORUM_ADDRESS, amount], account });
      return publicClient.waitForTransactionReceipt({ hash });
    });
    if (!ok) return;
  }
  const r = await run(allowance < amount ? 'Step 2 of 2: paying dues' : 'Paying dues', () => send('payDues', [club.id, amount, $('d-note').value.trim()]));
  if (r) { $('d-note').value = ''; await Promise.all([loadClub(), refreshWalletBalance()]); celebrate(); }
}

async function requestSpend() {
  if (!(await requireAccount())) return;
  const to = $('sp-to').value.trim();
  if (!isAddress(to)) return toast("That isn't a valid wallet address.", 'err');
  const amt = Number($('sp-amount').value || 0);
  if (!(amt > 0)) return toast('Enter an amount above $0.', 'err');
  const reason = $('sp-reason').value.trim();
  if (!reason) return toast('Say what it\'s for. Your members will see it.', 'err');
  const r = await run('Submitting spend request', () => send('requestSpend', [club.id, getAddress(to), parseUnits(String(amt), 6), reason]));
  if (r) { ['sp-to', 'sp-amount', 'sp-reason'].forEach((k) => ($(k).value = '')); await loadClub(); refreshWalletBalance(); }
}

async function vote(act, i) {
  if (!(await requireAccount())) return;
  const label = { approve: 'Approving', reject: 'Rejecting', cancel: 'Cancelling' }[act];
  const r = await run(`${label} request`, () => send(act, [club.id, i]));
  if (r) { await loadClub(); refreshWalletBalance(); }
}

function celebrate() {
  const el = document.createElement('div');
  el.className = 'confetti';
  el.innerHTML = Array.from({ length: 24 }, (_, i) => `<i style="left:${Math.random() * 100}%;animation-delay:${Math.random() * 0.4}s;background:hsl(${(i * 37) % 360} 80% 60%)"></i>`).join('');
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2200);
}

// ------------------------------------------------------------ init
function init() {
  $('connect').addEventListener('click', connect);
  if (QUORUM_ADDRESS) $('contract-link').href = `${EXPLORER}/address/${QUORUM_ADDRESS}`;
  else $('contract-link').classList.add('hidden');

  if (!QUORUM_ADDRESS) {
    $('setup').classList.remove('hidden');
    return;
  }

  if (window.ethereum) {
    window.ethereum.on?.('accountsChanged', (a) => { if (a[0]) { account = getAddress(a[0]); onAccount(); } });
    window.ethereum.request({ method: 'eth_accounts' }).then((a) => {
      if (a[0]) {
        walletClient = createWalletClient({ chain: arcTestnet, transport: custom(window.ethereum) });
        account = getAddress(a[0]);
        onAccount();
      }
    }).catch(() => {});
  }

  if (route.club !== null && !Number.isNaN(route.club)) {
    $('club').classList.remove('hidden');
    $('invite').addEventListener('click', async () => {
      await navigator.clipboard.writeText(`${location.origin}/?club=${route.club}`);
      toast('Dues link copied. Drop it in your club GroupMe.', 'ok');
    });
    document.querySelectorAll('#dues-chips button').forEach((b) => b.addEventListener('click', () => ($('d-amount').value = b.dataset.v)));
    $('d-pay').addEventListener('click', payDues);
    $('sp-go').addEventListener('click', requestSpend);
    $('sp-amount').addEventListener('input', updateSpendHint);
    if (params.get('new')) {
      $('banner').innerHTML = '🎉 Your treasury is live on Arc. Copy the dues link and send it to your members.';
      $('banner').classList.remove('hidden');
    }
    loadClub();
    setInterval(() => document.visibilityState === 'visible' && loadClub(), 10000);
  } else {
    $('home').classList.remove('hidden');
    $('c-officers').addEventListener('input', updateThresholdOptions);
    $('c-threshold').addEventListener('change', () => { thresholdTouched = true; updateRule(); });
    $('c-limit').addEventListener('input', updateRule);
    $('c-create').addEventListener('click', createClub);
    $('open-go').addEventListener('click', () => { const v = $('open-id').value; if (v !== '') location.href = `/?club=${v}`; });
    updateThresholdOptions();
  }
}

init();
