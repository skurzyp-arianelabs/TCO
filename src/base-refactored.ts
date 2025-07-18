import { createPublicClient, createWalletClient, erc20Abi, formatUnits, http, parseUnits } from 'viem';
import { base } from 'viem/chains';
import { encodeDeployData } from 'viem/utils';
import { privateKeyToAccount } from 'viem/accounts';
import * as fs from "node:fs/promises";
import path from "node:path";
import "dotenv/config";

type Address = `0x${string}`

const BASE_FACTORY_ADDRESS = "0x02a84c1b3BBD7401a5f7fa98a384EBC70bB5749E";
const BASE_ROUTER_ADDRESS = "0x8cFe327CEc66d1C090Dd72bd0FF11d690C33a2Eb";
const BASE_WETH_ADDRESS = "0x4200000000000000000000000000000000000006";
const BASE_RPC = "https://mainnet.base.org";
const PRIVATE_KEY = process.env.PRIVATE_KEY as Address;
const PUBLIC_KEY = "0xACD0BD350355336c5537dE56250Ef01eD61e73eB";

const account = privateKeyToAccount(PRIVATE_KEY);

const publicClient = createPublicClient({
  chain: base,
  transport: http(BASE_RPC),
});

const client = createWalletClient({
  account,
  chain: base,
  transport: http(BASE_RPC),
});

const ARTIFACTS_PATH = "./contracts/exchange-protocol/artifacts/contracts";

// Function to fetch Base ETH price from CoinGecko
async function fetchBaseETHPrice(): Promise<number> {
  const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
  const data = await response.json();
  return data.ethereum.usd;
}

interface CostEstimate {
  gasUsed: bigint;
  gasPrice: bigint;
  costInWei: bigint;
  costInETH: string;
  costInUSD: string;
}

function logCostEstimate(operation: string, gasEstimate: CostEstimate): void {
  console.log(`\n=== ${operation} ===`);
  console.log(`Gas used: ${gasEstimate.gasUsed.toString()}`);
  console.log(`Gas price: ${formatUnits(gasEstimate.gasPrice, 9)} Gwei`);
  console.log(`Cost in ETH: ${gasEstimate.costInETH}`);
  console.log(`Cost in USD: $${gasEstimate.costInUSD}`);
}

function calculateOperationCost(gasUsed: bigint, gasPrice: bigint, ethUsdPrice: number): CostEstimate {
  const costInWei = gasUsed * gasPrice;
  const costInETH = formatUnits(costInWei, 18);
  const costInUSD = (parseFloat(costInETH) * ethUsdPrice).toFixed(6);

  return {
    gasUsed,
    gasPrice,
    costInWei,
    costInETH,
    costInUSD
  };
}

async function estimateFactoryDeployment(gasPrice: bigint, ethUsdPrice: number): Promise<CostEstimate> {
  const factoryContractPath = path.join(ARTIFACTS_PATH, "PancakeFactory.sol/PancakeFactory.json");
  const factoryContractArtifact = await fs.readFile(factoryContractPath, "utf-8");
  const factoryContract = JSON.parse(factoryContractArtifact);
  const factoryContractAbi = factoryContract["abi"];
  const factoryContractBytecode = factoryContract["bytecode"];

  const deployFactoryData = encodeDeployData({
    abi: factoryContractAbi,
    bytecode: factoryContractBytecode,
    args: [PUBLIC_KEY],
  });

  const deployFactoryEstimatedGas = await publicClient.estimateGas({
    account,
    data: deployFactoryData,
  });

  const costEstimate = calculateOperationCost(deployFactoryEstimatedGas, gasPrice, ethUsdPrice);
  logCostEstimate("Factory Deployment", costEstimate);

  return costEstimate;
}

async function estimateCreatePair(gasPrice: bigint, ethUsdPrice: number): Promise<CostEstimate> {
  const factoryContractPath = path.join(ARTIFACTS_PATH, "PancakeFactory.sol/PancakeFactory.json");
  const factoryContractArtifact = await fs.readFile(factoryContractPath, "utf-8");
  const factoryContract = JSON.parse(factoryContractArtifact);
  const factoryContractAbi = factoryContract["abi"];

  const TOKEN_1_ADDRESS = "0xA202B2b7B4D2fe56BF81492FFDDA657FE512De07";
  const TOKEN_2_ADDRESS = "0xc1512B7023A97d54f8Dd757B1F84e132297CA0D7";

  const createPairEstimatedGas = await publicClient.estimateContractGas({
    account,
    abi: factoryContractAbi,
    address: BASE_FACTORY_ADDRESS,
    functionName: 'createPair',
    args: [TOKEN_1_ADDRESS, TOKEN_2_ADDRESS]
  });

  const costEstimate = calculateOperationCost(createPairEstimatedGas, gasPrice, ethUsdPrice);
  logCostEstimate("Create Pair", costEstimate);

  return costEstimate;
}

async function estimateRouterDeployment(gasPrice: bigint, ethUsdPrice: number): Promise<CostEstimate> {
  const routerContractPath = path.join(ARTIFACTS_PATH, "PancakeRouter.sol/PancakeRouter.json");
  const routerContractArtifact = await fs.readFile(routerContractPath, "utf-8");
  const routerContract = JSON.parse(routerContractArtifact);
  const routerContractAbi = routerContract["abi"];
  const routerContractBytecode = routerContract["bytecode"];

  const deployRouterData = encodeDeployData({
    abi: routerContractAbi,
    bytecode: routerContractBytecode,
    args: [BASE_FACTORY_ADDRESS, BASE_WETH_ADDRESS],
  });

  const deployRouterEstimatedGas = await publicClient.estimateGas({
    account,
    data: deployRouterData,
  });

  const costEstimate = calculateOperationCost(deployRouterEstimatedGas, gasPrice, ethUsdPrice);
  logCostEstimate("Router Deployment", costEstimate);

  return costEstimate;
}

async function performTokenApproval(ethUsdPrice: number): Promise<CostEstimate> {
  const SWAP_TOKEN_1_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
  const amountIn = parseUnits('0.1', 6);

  const approveResult = await client.writeContract({
    address: SWAP_TOKEN_1_ADDRESS,
    abi: erc20Abi,
    functionName: 'approve',
    args: [BASE_ROUTER_ADDRESS, amountIn]
  });

  const approveRx = await publicClient.waitForTransactionReceipt({
    hash: approveResult,
    confirmations: 1
  });

  const effectiveGasPrice = approveRx.effectiveGasPrice as bigint;
  const costEstimate = calculateOperationCost(approveRx.gasUsed, effectiveGasPrice, ethUsdPrice);
  logCostEstimate("Token Approval", costEstimate);

  return costEstimate;
}

async function estimateTokenSwap(gasPrice: bigint, ethUsdPrice: number): Promise<CostEstimate> {
  const routerContractPath = path.join(ARTIFACTS_PATH, "PancakeRouter.sol/PancakeRouter.json");
  const routerContractArtifact = await fs.readFile(routerContractPath, "utf-8");
  const routerContract = JSON.parse(routerContractArtifact);
  const routerContractAbi = routerContract["abi"];

  const SWAP_TOKEN_1_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
  const SWAP_TOKEN_2_ADDRESS = "0x4200000000000000000000000000000000000006";

  const amountIn = parseUnits('0.1', 6);
  const amountOutMin = parseUnits('0.000025', 18);
  const swapPath = [SWAP_TOKEN_1_ADDRESS, SWAP_TOKEN_2_ADDRESS];
  const deadline = Math.floor(Date.now() / 1000) + 60 * 10;

  const callSwapEstimatedGas = await publicClient.estimateContractGas({
    account,
    abi: routerContractAbi,
    address: BASE_ROUTER_ADDRESS,
    functionName: 'swapExactTokensForTokens',
    args: [
      amountIn,
      amountOutMin,
      swapPath,
      PUBLIC_KEY,
      deadline
    ]
  });

  const costEstimate = calculateOperationCost(callSwapEstimatedGas, gasPrice, ethUsdPrice);
  logCostEstimate("Token Swap", costEstimate);

  return costEstimate;
}

async function estimateSwapContractsCosts() {
  console.log("🔍 Starting costs estimation for swap contracts on Base...\n");

  // Fetch current gas price and BASE ETH USD price
  const [gasPrice, ethUsdPrice] = await Promise.all([
    publicClient.getGasPrice(),
    fetchBaseETHPrice()
  ]);

  console.log(`Current gas price: ${formatUnits(gasPrice, 9)} Gwei`);
  console.log(`ETH (Base) price (USD): ${ethUsdPrice.toFixed(3)}`);

  try {
    // Estimate each operation
    const factoryDeployment = await estimateFactoryDeployment(gasPrice, ethUsdPrice);
    const createPair = await estimateCreatePair(gasPrice, ethUsdPrice);
    const routerDeployment = await estimateRouterDeployment(gasPrice, ethUsdPrice);
    const tokenApproval = await performTokenApproval(ethUsdPrice); // this action cannot be estimated and it's mainnet cost must be paid
    const tokenSwap = await estimateTokenSwap(gasPrice, ethUsdPrice);

    // Calculate total costs
    const totalGasUsed = factoryDeployment.gasUsed +
      createPair.gasUsed +
      routerDeployment.gasUsed +
      tokenApproval.gasUsed +
      tokenSwap.gasUsed;

    const totalCostInWei = factoryDeployment.costInWei +
      createPair.costInWei +
      routerDeployment.costInWei +
      tokenApproval.costInWei +
      tokenSwap.costInWei;

    const totalCostInETH = formatUnits(totalCostInWei, 18);
    const totalCostInUSD = (parseFloat(totalCostInETH) * ethUsdPrice).toFixed(6);

    console.log(`\n=== TOTAL COST OVERVIEW (TCO) ===`);
    console.log(`Total gas used: ${totalGasUsed.toString()}`);
    console.log(`Total cost in ETH: ${totalCostInETH}`);
    console.log(`Total cost in USD: ${totalCostInUSD}`);

    // Breakdown by operation
    console.log(`\n=== COST BREAKDOWN ===`);
    console.log(`Factory Deployment: ${factoryDeployment.costInETH} ETH ($${factoryDeployment.costInUSD})`);
    console.log(`Create Pair: ${createPair.costInETH} ETH ($${createPair.costInUSD})`);
    console.log(`Router Deployment: ${routerDeployment.costInETH} ETH ($${routerDeployment.costInUSD})`);
    console.log(`Token Approval: ${tokenApproval.costInETH} ETH ($${tokenApproval.costInUSD})`);
    console.log(`Token Swap: ${tokenSwap.costInETH} ETH ($${tokenSwap.costInUSD})`);

  } catch (error) {
    console.error("❌ Error during gas estimation:", error);
  }
}

// Run the estimation
estimateSwapContractsCosts().catch(console.error);
