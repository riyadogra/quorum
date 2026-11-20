import { defineChain } from 'viem';

export const arcTestnet = defineChain({
  id: 5042002,
  name: 'Arc Testnet',
  // Arc's native gas token is USDC. Wallets see it with 18 decimals; the
  // ERC-20 interface at USDC_ADDRESS uses the usual 6.
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: {
    default: { http: import.meta.env.VITE_RPC_URL ? [import.meta.env.VITE_RPC_URL] : ['https://rpc.testnet.arc.io', 'https://rpc.testnet.arc.network'] },
  },
  blockExplorers: {
    default: { name: 'Arc Explorer', url: 'https://explorer.testnet.arc.io' },
  },
  testnet: true,
});

export const USDC_ADDRESS = '0x3600000000000000000000000000000000000000';
export const QUORUM_ADDRESS = import.meta.env.VITE_QUORUM_ADDRESS || '';
export const EXPLORER = arcTestnet.blockExplorers.default.url;
