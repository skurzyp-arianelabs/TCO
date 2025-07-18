import { createPublicClient, createWalletClient, erc20Abi, formatUnits, http, parseUnits } from 'viem';
import { arbitrum } from 'viem/chains';
import { encodeDeployData } from 'viem/utils';
import { privateKeyToAccount } from 'viem/accounts';
import * as fs from "node:fs/promises";
import path from "node:path";
import "dotenv/config";

type Address = `0x${string}`;

const ARBITRUM_FACTORY_ADDRESS = "0x02a84c1b3BBD7401a5f7fa98a384EBC70bB5749E";
const ARBITRUM_ROUTER_ADDRESS = "0x8cFe327CEc66d1C090Dd72bd0FF11d690C33a2Eb";
const ARBITRUM_WETH_ADDRESS = "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1";
const ARBITRUM_RPC = "https://arb1.arbitrum.io/rpc";
const PRIVATE_KEY = process.env.PRIVATE_KEY as Address;
const PUBLIC_KEY = "0xACD0BD350355336c5537dE56250Ef01eD61e73eB";

const account = privateKeyToAccount(PRIVATE_KEY);

const publicClient = createPublicClient({
  chain: arbitrum,
  transport: http(ARBITRUM_RPC),
});

const client = createWalletClient({
  account,
  chain: arbitrum,
  transport: http(ARBITRUM_RPC),
});

const ARTIFACTS_PATH = "./contracts/exchange-protocol/artifacts/contracts";

// Function to fetch ETH price from CoinGecko
async function fetchETHPrice(): Promise<number> {
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

  const TOKEN_1_ADDRESS = "0xCBeb19549054CC0a6257A77736FC78C367216cE7";
  const TOKEN_2_ADDRESS = "0x25d887Ce7a35172C62FeBFD67a1856F20FaEbB00";

  const createPairEstimatedGas = await publicClient.estimateContractGas({
    account,
    abi: factoryContractAbi,
    address: ARBITRUM_FACTORY_ADDRESS,
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
    args: [ARBITRUM_FACTORY_ADDRESS, ARBITRUM_WETH_ADDRESS],
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
  const SWAP_TOKEN_1_ADDRESS = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
  const amountIn = parseUnits('0.1', 6);

  const approveResult = await client.writeContract({
    address: SWAP_TOKEN_1_ADDRESS,
    abi: erc20Abi,
    functionName: 'approve',
    args: [ARBITRUM_ROUTER_ADDRESS, amountIn]
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

  const SWAP_TOKEN_1_ADDRESS = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
  const SWAP_TOKEN_2_ADDRESS = "0x912CE59144191C1204E64559FE8253a0e49E6548";

  const amountIn = parseUnits('0.1', 6);
  const amountOutMin = parseUnits('0.2', 18);
  const swapPath = [SWAP_TOKEN_1_ADDRESS, SWAP_TOKEN_2_ADDRESS];
  const deadline = Math.floor(Date.now() / 1000) + 60 * 10;

  const callSwapEstimatedGas = await publicClient.estimateContractGas({
    account,
    abi: routerContractAbi,
    address: ARBITRUM_ROUTER_ADDRESS,
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
  console.log("🔍 Starting costs estimation for swap contracts on Arbitrum...\n");

  // Fetch current gas price and ETH USD price
  const [gasPrice, ethUsdPrice] = await Promise.all([
    publicClient.getGasPrice(),
    fetchETHPrice()
  ]);

  console.log(`Current gas price: ${formatUnits(gasPrice, 9)} Gwei`);
  console.log(`ETH price (USD): ${ethUsdPrice.toFixed(3)}`);

  try {
    // Estimate each operation
    const factoryDeployment = await estimateFactoryDeployment(gasPrice, ethUsdPrice);
    const createPair = await estimateCreatePair(gasPrice, ethUsdPrice);
    const routerDeployment = await estimateRouterDeployment(gasPrice, ethUsdPrice);
    const tokenApproval = await performTokenApproval(ethUsdPrice); // mainnet action
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
