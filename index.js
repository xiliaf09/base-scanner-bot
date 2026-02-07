import TelegramBot from 'node-telegram-bot-api';
import { ethers } from 'ethers';
import axios from 'axios';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load env from parent directory
dotenv.config({ path: join(__dirname, '..', '.env') });

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const BASE_RPC = process.env.BASE_RPC_URL;
const MIN_LIQUIDITY = parseInt(process.env.MIN_LIQUIDITY_USD) || 5000;
const SCAN_INTERVAL = parseInt(process.env.SCAN_INTERVAL_SECONDS) || 60;

// Initialize
const bot = new TelegramBot(TOKEN, { polling: true });
const provider = new ethers.JsonRpcProvider(BASE_RPC);

// Storage
const seenTokens = new Set();
let subscribedChats = new Set();
let isScanning = false;

// Uniswap V2 Factory on Base (for DEX detection)
const UNISWAP_V2_FACTORY = '0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6';
const FACTORY_ABI = [
  'event PairCreated(address indexed token0, address indexed token1, address pair, uint)'
];

// ERC20 ABI (minimal)
const ERC20_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)'
];

// Format number with commas
function formatNumber(num) {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// Get token info
async function getTokenInfo(address) {
  try {
    const contract = new ethers.Contract(address, ERC20_ABI, provider);
    const [name, symbol, decimals, totalSupply] = await Promise.all([
      contract.name(),
      contract.symbol(),
      contract.decimals(),
      contract.totalSupply()
    ]);
    
    return { name, symbol, decimals, totalSupply: totalSupply.toString() };
  } catch (error) {
    return null;
  }
}

// Fetch additional data from DEXScreener
async function getDexScreenerData(address) {
  try {
    const response = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${address}`);
    if (response.data?.pairs && response.data.pairs.length > 0) {
      const pair = response.data.pairs[0];
      return {
        liquidity: pair.liquidity?.usd || 0,
        priceUsd: pair.priceUsd || '0',
        volume24h: pair.volume?.h24 || 0,
        priceChange24h: pair.priceChange?.h24 || 0,
        pairAddress: pair.pairAddress,
        dexId: pair.dexId
      };
    }
    return null;
  } catch (error) {
    console.log(`DEXScreener error for ${address}:`, error.message);
    return null;
  }
}

// Format and send token alert
async function sendTokenAlert(tokenAddress, tokenInfo, dexData) {
  const message = `
🆕 *New Token Detected on Base*

📛 *Name:* ${tokenInfo.name}
🎯 *Symbol:* $${tokenInfo.symbol}
📍 *Address:* \`${tokenAddress}\`

${dexData ? `
💰 *Liquidity:* $${formatNumber(Math.round(dexData.liquidity))}
📊 *Volume 24h:* $${formatNumber(Math.round(dexData.volume24h))}
💵 *Price:* $${dexData.priceUsd}
${dexData.priceChange24h ? `📈 *24h Change:* ${dexData.priceChange24h.toFixed(2)}%` : ''}
` : '⚠️ *No DEX data yet*'}

🔗 *Links:*
• [BaseScan](https://basescan.org/token/${tokenAddress})
• [DexScreener](https://dexscreener.com/base/${tokenAddress})

⏰ ${new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}
`;

  for (const chatId of subscribedChats) {
    try {
      await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    } catch (error) {
      console.error(`Failed to send to ${chatId}:`, error.message);
    }
  }
}

// Scan for new tokens
async function scanNewTokens() {
  try {
    const factory = new ethers.Contract(UNISWAP_V2_FACTORY, FACTORY_ABI, provider);
    const currentBlock = await provider.getBlockNumber();
    const fromBlock = currentBlock - 100; // Last ~100 blocks (~3-5 minutes on Base)
    
    const events = await factory.queryFilter('PairCreated', fromBlock, currentBlock);
    
    for (const event of events) {
      const token0 = event.args.token0;
      const token1 = event.args.token1;
      
      // Check both tokens
      for (const tokenAddress of [token0, token1]) {
        const lowerAddress = tokenAddress.toLowerCase();
        
        // Skip if already seen
        if (seenTokens.has(lowerAddress)) continue;
        
        // Mark as seen
        seenTokens.add(lowerAddress);
        
        // Get token info
        const tokenInfo = await getTokenInfo(tokenAddress);
        if (!tokenInfo) continue;
        
        // Wait a bit for DEX data to be available
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Get DEX data
        const dexData = await getDexScreenerData(tokenAddress);
        
        // Filter by liquidity if available
        if (dexData && dexData.liquidity < MIN_LIQUIDITY) {
          console.log(`Skipping ${tokenInfo.symbol} - low liquidity: $${dexData.liquidity}`);
          continue;
        }
        
        // Send alert
        await sendTokenAlert(tokenAddress, tokenInfo, dexData);
        
        console.log(`✅ Alerted: ${tokenInfo.symbol} (${tokenAddress})`);
      }
    }
  } catch (error) {
    console.error('Scan error:', error.message);
  }
}

// Start scanning loop
async function startScanning() {
  if (isScanning) return;
  isScanning = true;
  
  console.log('🔍 Scanner started...');
  
  while (isScanning) {
    await scanNewTokens();
    await new Promise(resolve => setTimeout(resolve, SCAN_INTERVAL * 1000));
  }
}

// Bot commands
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  subscribedChats.add(chatId);
  
  bot.sendMessage(chatId, 
    `🤖 *Base Token Scanner Active*\n\n` +
    `Je surveille les nouveaux tokens sur Base et je t'alerterai dès qu'un nouveau token avec de la liquidité apparaît.\n\n` +
    `*Commandes:*\n` +
    `/start - S'abonner aux alertes\n` +
    `/stop - Se désabonner\n` +
    `/status - Statut du scanner\n` +
    `/config - Configuration actuelle\n\n` +
    `✅ Tu es maintenant abonné aux alertes !`,
    { parse_mode: 'Markdown' }
  );
  
  // Start scanning if not already
  if (!isScanning) {
    startScanning();
  }
});

bot.onText(/\/stop/, (msg) => {
  const chatId = msg.chat.id;
  subscribedChats.delete(chatId);
  
  bot.sendMessage(chatId, 
    `❌ Tu es maintenant désabonné des alertes.\n\nUtilise /start pour te réabonner.`
  );
});

bot.onText(/\/status/, (msg) => {
  const chatId = msg.chat.id;
  
  bot.sendMessage(chatId,
    `📊 *Scanner Status*\n\n` +
    `Status: ${isScanning ? '✅ Active' : '❌ Inactive'}\n` +
    `Abonnés: ${subscribedChats.size}\n` +
    `Tokens vus: ${seenTokens.size}\n` +
    `Dernier check: ${new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}`,
    { parse_mode: 'Markdown' }
  );
});

bot.onText(/\/config/, (msg) => {
  const chatId = msg.chat.id;
  
  bot.sendMessage(chatId,
    `⚙️ *Configuration*\n\n` +
    `Liquidité minimale: $${formatNumber(MIN_LIQUIDITY)}\n` +
    `Intervalle de scan: ${SCAN_INTERVAL}s\n` +
    `Network: Base\n` +
    `Factory: Uniswap V2`,
    { parse_mode: 'Markdown' }
  );
});

// Error handling
bot.on('polling_error', (error) => {
  console.error('Polling error:', error.message);
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
});

console.log('✅ Bot started successfully!');
console.log(`Monitoring Base for new tokens...`);
