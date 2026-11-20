// Deploys Quorum to Arc Testnet and writes the address into .env.local
// Usage:  PRIVATE_KEY=0xyourtestnetkey node scripts/deploy.mjs
// Use a throwaway testnet wallet funded from https://faucet.circle.com (Arc Testnet).
import fs from 'fs';
import { createPublicClient, createWalletClient, http, defineChain } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const artifact = JSON.parse(fs.readFileSync(new URL('../src/quorum-artifact.json', import.meta.url)));
const USDC = '0x3600000000000000000000000000000000000000';

const arcTestnet = defineChain({
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.testnet.arc.io'] } },
});

const pk = process.env.PRIVATE_KEY;
if (!pk) {
  console.error('Set PRIVATE_KEY to a testnet wallet key, e.g.  PRIVATE_KEY=0x... node scripts/deploy.mjs');
  process.exit(1);
}

const account = privateKeyToAccount(pk.startsWith('0x') ? pk : `0x${pk}`);
const publicClient = createPublicClient({ chain: arcTestnet, transport: http() });
const walletClient = createWalletClient({ account, chain: arcTestnet, transport: http() });

console.log(`Deploying Quorum from ${account.address} to Arc Testnet…`);
const hash = await walletClient.deployContract({
  abi: artifact.abi,
  bytecode: artifact.bytecode,
  args: [USDC],
});
console.log(`  tx: ${hash}`);
const receipt = await publicClient.waitForTransactionReceipt({ hash });
const address = receipt.contractAddress;
console.log(`✅ Quorum deployed at ${address}`);
console.log(`   https://explorer.testnet.arc.io/address/${address}`);

fs.writeFileSync(new URL('../.env.local', import.meta.url), `VITE_QUORUM_ADDRESS=${address}\n`);
console.log('   Wrote VITE_QUORUM_ADDRESS to .env.local. Restart `npm run dev` to pick it up.');
console.log('   On Vercel, add VITE_QUORUM_ADDRESS as an environment variable.');
