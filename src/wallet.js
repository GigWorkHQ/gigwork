// Minimal EIP-1193 helpers over the wallet the user picked in RainbowKit. The wallet signs and sends;
// no keys or RPC secrets live here.
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let activeProvider=null;
export function setProvider(next){activeProvider=next||null}
function provider(){if(!activeProvider)throw new Error('Connect your wallet first with the wallet button at the top of the page.');return activeProvider}
function walletError(e){if(e?.code===4001)return new Error('You cancelled the request in your wallet.');if(e?.code===-32002)return new Error('Your wallet already has a pending request. Open it to continue.');return e instanceof Error?e:new Error(e?.message||'The wallet request failed.')}
async function request(method,params){try{return await provider().request(params?{method,params}:{method})}catch(e){throw walletError(e)}}

export const hasWallet=()=>Boolean(activeProvider);
export const shortAddress=a=>a?`${a.slice(0,6)}…${a.slice(-4)}`:'';


export async function ensureChain({chainId,chainName,rpcUrl,explorerUrl}){
 const current=parseInt(await request('eth_chainId'),16);
 if(current===chainId)return;
 const hexId=`0x${chainId.toString(16)}`;
 try{await provider().request({method:'wallet_switchEthereumChain',params:[{chainId:hexId}]})}
 catch(e){
  const missing=e?.code===4902||e?.data?.originalError?.code===4902;
  if(!missing)throw walletError(e);
  if(!rpcUrl)throw new Error(`Add ${chainName} (chain ID ${chainId}) to your wallet, then try again.`);
  await request('wallet_addEthereumChain',[{chainId:hexId,chainName,nativeCurrency:{name:'Ether',symbol:'ETH',decimals:18},rpcUrls:[rpcUrl],...(explorerUrl?{blockExplorerUrls:[explorerUrl]}:{})}]);
 }
}

const utf8Hex=text=>'0x'+Array.from(new TextEncoder().encode(text),b=>b.toString(16).padStart(2,'0')).join('');
export const signMessage=(address,message)=>request('personal_sign',[utf8Hex(message),address]);

// ERC-20 transfer(address,uint256) calldata, built without a client library.
export function transferData(to,amountRaw){
 if(!/^0x[0-9a-fA-F]{40}$/.test(to))throw new Error('Invalid escrow address.');
 const amount=BigInt(amountRaw);if(amount<=0n)throw new Error('Invalid transfer amount.');
 return '0xa9059cbb'+to.slice(2).toLowerCase().padStart(64,'0')+amount.toString(16).padStart(64,'0');
}

export async function sendUsdg({from,token,to,amountRaw}){
 const [active]=await request('eth_accounts');
 if(active?.toLowerCase()!==from.toLowerCase())throw new Error(`Switch your wallet to ${shortAddress(from)}, the wallet you signed in with.`);
 return request('eth_sendTransaction',[{from,to:token,data:transferData(to,amountRaw),value:'0x0'}]);
}

export async function waitForReceipt(hash,{timeoutMs=180000}={}){
 const end=Date.now()+timeoutMs;
 while(Date.now()<end){const receipt=await request('eth_getTransactionReceipt',[hash]).catch(()=>null);if(receipt){if(receipt.status!=='0x1')throw new Error('The USDG transfer reverted. No funds were moved.');return receipt}await sleep(2500)}
 throw new Error('The transfer is still pending. Confirm funding again once it has been mined.');
}

