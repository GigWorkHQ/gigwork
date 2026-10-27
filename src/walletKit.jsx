import React from 'react';
import '@rainbow-me/rainbowkit/styles.css';
import {RainbowKitProvider,connectorsForWallets,lightTheme} from '@rainbow-me/rainbowkit';
import {injectedWallet,coinbaseWallet,metaMaskWallet,rabbyWallet,rainbowWallet,trustWallet,walletConnectWallet} from '@rainbow-me/rainbowkit/wallets';
import {WagmiProvider,createConfig,http} from 'wagmi';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {defineChain} from 'viem';
import {Dashboard} from './Dashboard.jsx';

// RainbowKit wallet picker. Installed wallets announce themselves (EIP-6963) and appear automatically,
// so users choose MetaMask, Rabby, Phantom, OKX… instead of whichever extension grabbed window.ethereum.
export const robinhoodChain=defineChain({id:4663,name:'Robinhood Chain',nativeCurrency:{name:'Ether',symbol:'ETH',decimals:18},rpcUrls:{default:{http:['https://rpc.mainnet.chain.robinhood.com']}},blockExplorers:{default:{name:'Blockscout',url:'https://robinhoodchain.blockscout.com'}}});
export const robinhoodTestnet=defineChain({id:46630,name:'Robinhood Chain Testnet',nativeCurrency:{name:'Ether',symbol:'ETH',decimals:18},rpcUrls:{default:{http:[import.meta.env.VITE_TESTNET_RPC_URL||'https://rpc.testnet.chain.robinhood.com']}},blockExplorers:{default:{name:'Blockscout',url:'https://explorer.testnet.chain.robinhood.com'}},testnet:true});

// A WalletConnect Cloud project ID (public) unlocks mobile/QR wallets. Without one, browser wallets still work.
const projectId=import.meta.env.VITE_WALLETCONNECT_PROJECT_ID||'';
const walletGroups=projectId
 ?[{groupName:'Popular',wallets:[metaMaskWallet,rabbyWallet,coinbaseWallet,rainbowWallet,trustWallet,walletConnectWallet]}]
 :[{groupName:'More wallets',wallets:[injectedWallet,coinbaseWallet]}];

export const wagmiConfig=createConfig({
 connectors:connectorsForWallets(walletGroups,{appName:'GigWork',projectId:projectId||'browser-wallets-only',appUrl:typeof location!=='undefined'?location.origin:undefined}),
 chains:[robinhoodChain,robinhoodTestnet],
 transports:{[robinhoodChain.id]:http(),[robinhoodTestnet.id]:http()},
});
const queryClient=new QueryClient();
const theme=lightTheme({accentColor:'#00063d',accentColorForeground:'white',borderRadius:'medium',fontStack:'system'});

export function WalletProviders({children}){return <WagmiProvider config={wagmiConfig}><QueryClientProvider client={queryClient}><RainbowKitProvider theme={theme} appInfo={{appName:'GigWork',learnMoreUrl:'https://www.gigworkhq.com/docs/getting-started'}} modalSize="compact">{children}</RainbowKitProvider></QueryClientProvider></WagmiProvider>}

export default function DashboardApp(){return <WalletProviders><Dashboard/></WalletProviders>}
