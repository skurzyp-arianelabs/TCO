import {createPublicClient, createWalletClient, erc20Abi, formatUnits, http, parseUnits} from 'viem'
import {bsc} from 'viem/chains'
import { encodeDeployData } from 'viem/utils'
import { privateKeyToAccount } from 'viem/accounts'
import * as fs from "node:fs/promises";
import path from "node:path";
import "dotenv/config"

type Address = `0x${string}`

const BNB_FACTORY_ADDRESS = "0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73";
const BNB_ROUTER_ADDRESS = "0x10ED43C718714eb63d5aA57B78B54704E256024E";
const BNB_WETH_ADDRESS = "0x4DB5a66E937A9F4473fA95b1cAF1d1E1D62E29EA"
const BNB_RPC = "https://bsc-rpc.publicnode.com"
const PRIVATE_KEY = process.env.PRIVATE_KEY as Address;
const PUBLIC_KEY = "0xACD0BD350355336c5537dE56250Ef01eD61e73eB"

const account = privateKeyToAccount(PRIVATE_KEY)

const publicClient = createPublicClient({
  chain: bsc,
  transport: http(BNB_RPC),
})

const client = createWalletClient({
  account,
  chain: bsc,
  transport: http(BNB_RPC),
})

const ARTIFACTS_PATH = "./contracts/exchange-protocol/artifacts/contracts";

// Function to fetch BNB price from CoinGecko
async function fetchBNBPrice(): Promise<number> {
  const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=binancecoin&vs_currencies=usd');
  const data = await response.json();
  return data.binancecoin.usd;
}

interface CostEstimate {
  gasUsed: bigint;
  gasPrice: bigint;
  costInWei: bigint;
  costInBNB: string;
  costInUSD: string;
}

function logCostEstimate(operation: string, gasEstimate: CostEstimate): void {
  console.log(`\n=== ${operation} ===`);
  console.log(`Gas used: ${gasEstimate.gasUsed.toString()}`);
  console.log(`Gas price: ${formatUnits(gasEstimate.gasPrice, 9)} Gwei`);
  console.log(`Cost in BNB: ${gasEstimate.costInBNB}`);
  console.log(`Cost in USD: $${gasEstimate.costInUSD}`);
}

function calculateOperationCost(gasUsed: bigint, gasPrice: bigint, bnbUsdPrice: number): CostEstimate {
  const costInWei = gasUsed * gasPrice;
  const costInBNB = formatUnits(costInWei, 18);
  const costInUSD = (parseFloat(costInBNB) * bnbUsdPrice).toFixed(6);

  return {
    gasUsed,
    gasPrice,
    costInWei,
    costInBNB,
    costInUSD
  };
}

async function estimateFactoryDeployment(gasPrice: bigint, bnbUsdPrice: number): Promise<CostEstimate> {
  const factoryContractPath = path.join(ARTIFACTS_PATH, "PancakeFactory.sol/PancakeFactory.json")
  const factoryContractArtifact = await fs.readFile(factoryContractPath, "utf-8")
  const factoryContract = JSON.parse(factoryContractArtifact);
  const factoryContractAbi = factoryContract["abi"];
  const factoryContractBytecode = factoryContract["bytecode"];


  const deployFactoryData = encodeDeployData({
    abi: factoryContractAbi,
    bytecode: factoryContractBytecode,
    args: [PUBLIC_KEY],
  })

  const deployFactoryEstimatedGas = await publicClient.estimateGas({
    account,
    data: deployFactoryData,
  })

  const costEstimate = calculateOperationCost(deployFactoryEstimatedGas, gasPrice, bnbUsdPrice);
  logCostEstimate("Factory Deployment", costEstimate);

  return costEstimate;
}

async function estimateCreatePair(gasPrice: bigint, bnbUsdPrice: number): Promise<CostEstimate> {
  const factoryContractPath = path.join(ARTIFACTS_PATH, "PancakeFactory.sol/PancakeFactory.json")
  const factoryContractArtifact = await fs.readFile(factoryContractPath, "utf-8")
  const factoryContract = JSON.parse(factoryContractArtifact);
  const factoryContractAbi = factoryContract["abi"];

  const TOKEN_1_ADDRESS = "0x9D173E6c594f479B4d47001F8E6A95A7aDDa42bC"
  const TOKEN_2_ADDRESS = "0xfb5B838b6cfEEdC2873aB27866079AC55363D37E"

  const createPairEstimatedGas = await publicClient.estimateContractGas({
    account,
    abi: factoryContractAbi,
    address: BNB_FACTORY_ADDRESS,
    functionName: 'createPair',
    args: [TOKEN_1_ADDRESS, TOKEN_2_ADDRESS]
  });

  const costEstimate = calculateOperationCost(createPairEstimatedGas, gasPrice, bnbUsdPrice);
  logCostEstimate("Create Pair", costEstimate);

  return costEstimate;
}

async function estimateRouterDeployment(gasPrice: bigint, bnbUsdPrice: number): Promise<CostEstimate> {

  const routerContractPath = path.join(ARTIFACTS_PATH, "PancakeRouter.sol/PancakeRouter.json")
  const routerContractArtifact = await fs.readFile(routerContractPath, "utf-8")
  const routerContract = JSON.parse(routerContractArtifact);
  const routerContractAbi = routerContract["abi"];
  const routerContractBytecode = routerContract["bytecode"];

  const deployRouterData = encodeDeployData({
    abi: routerContractAbi,
    bytecode: routerContractBytecode,
    args: [BNB_FACTORY_ADDRESS, BNB_WETH_ADDRESS],
  })

  const deployRouterEstimatedGas = await publicClient.estimateGas({
    account,
    data: deployRouterData,
  });

  const costEstimate = calculateOperationCost(deployRouterEstimatedGas, gasPrice, bnbUsdPrice);
  logCostEstimate("Router Deployment", costEstimate);

  return costEstimate;
}

async function performTokenApproval(bnbUsdPrice: number): Promise<CostEstimate> {
  const SWAP_TOKEN_1_ADDRESS = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d"
  const amountIn = parseUnits('0.1', 18);

  const approveResult = await client.writeContract({
    address: SWAP_TOKEN_1_ADDRESS,
    abi: erc20Abi,
    functionName: 'approve',
    args: [BNB_ROUTER_ADDRESS, amountIn]
  })

  const approveRx = await publicClient.waitForTransactionReceipt({
    hash: approveResult,
    confirmations: 1
  });

  const effectiveGasPrice = approveRx.effectiveGasPrice as bigint;
  const costEstimate = calculateOperationCost(approveRx.gasUsed, effectiveGasPrice, bnbUsdPrice);
  logCostEstimate("Token Approval", costEstimate);

  return costEstimate;
}

async function estimateTokenSwap(gasPrice: bigint, bnbUsdPrice: number): Promise<CostEstimate> {
  const routerContractPath = path.join(ARTIFACTS_PATH, "PancakeRouter.sol/PancakeRouter.json")
  const routerContractArtifact = await fs.readFile(routerContractPath, "utf-8")
  const routerContract = JSON.parse(routerContractArtifact);
  const routerContractAbi = routerContract["abi"];

  const SWAP_TOKEN_1_ADDRESS = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d"
  const SWAP_TOKEN_2_ADDRESS = "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82"

  const amountIn = parseUnits('0.1', 18);
  const amountOutMin = parseUnits('0.02', 18);
  const swapPath = [SWAP_TOKEN_1_ADDRESS, SWAP_TOKEN_2_ADDRESS];
  const deadline = Math.floor(Date.now() / 1000) + 60 * 10;

  const callSwapEstimatedGas = await publicClient.estimateContractGas({
    account,
    abi: routerContractAbi,
    address: BNB_ROUTER_ADDRESS,
    functionName: 'swapExactTokensForTokens',
    args: [
      amountIn,
      amountOutMin,
      swapPath,
      PUBLIC_KEY,
      deadline
    ]
  });

  const costEstimate = calculateOperationCost(callSwapEstimatedGas, gasPrice, bnbUsdPrice);
  logCostEstimate("Token Swap", costEstimate);

  return costEstimate;
}

async function estimateSwapContractsCosts() {
  console.log("🔍 Starting costs estimation for swap contracts...\n");

  // Fetch current gas price and BNB USD price
  const [gasPrice, bnbUsdPrice] = await Promise.all([
    publicClient.getGasPrice(),
    fetchBNBPrice()
  ]);

  console.log(`Current gas price: ${formatUnits(gasPrice, 9)} Gwei`);
  console.log(`BNB price (USD): ${bnbUsdPrice.toFixed(3)}`);

  try {
    // Estimate each operation
    const factoryDeployment = await estimateFactoryDeployment(gasPrice, bnbUsdPrice);
    const createPair = await estimateCreatePair(gasPrice, bnbUsdPrice);
    const routerDeployment = await estimateRouterDeployment(gasPrice, bnbUsdPrice);
    const tokenApproval = await performTokenApproval(bnbUsdPrice); // this action cannot be estimated and it's mainnet cost must be paid
    const tokenSwap = await estimateTokenSwap(gasPrice, bnbUsdPrice);

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

    const totalCostInBNB = formatUnits(totalCostInWei, 18);
    const totalCostInUSD = (parseFloat(totalCostInBNB) * bnbUsdPrice).toFixed(6);

    console.log(`\n=== TOTAL COST OVERVIEW (TCO) ===`);
    console.log(`Total gas used: ${totalGasUsed.toString()}`);
    console.log(`Total cost in BNB: ${totalCostInBNB}`);
    console.log(`Total cost in USD: ${totalCostInUSD}`);

    // Breakdown by operation
    console.log(`\n=== COST BREAKDOWN ===`);
    console.log(`Factory Deployment: ${factoryDeployment.costInBNB} BNB ($${factoryDeployment.costInUSD})`);
    console.log(`Create Pair: ${createPair.costInBNB} BNB (${createPair.costInUSD})`);
    console.log(`Router Deployment: ${routerDeployment.costInBNB} BNB ($${routerDeployment.costInUSD})`);
    console.log(`Token Approval: ${tokenApproval.costInBNB} BNB ($${tokenApproval.costInUSD})`);
    console.log(`Token Swap: ${tokenSwap.costInBNB} BNB ($${tokenSwap.costInUSD})`);

  } catch (error) {
    console.error("❌ Error during gas estimation:", error);
  }
}

// Run the estimation
estimateSwapContractsCosts().catch(console.error);