import {createPublicClient, createWalletClient, erc20Abi, formatUnits, http, parseEther, parseUnits} from 'viem'
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

const ARTIFACTS_PATH = "./artifacts/contracts/exchange-protocol/contracts/";

async function estimateSwapContractsGas() {
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

    console.log("deploy factory gas estimate: ", formatUnits(deployFactoryEstimatedGas, 18))

    const TOKEN_1_ADDRESS = "0x9D173E6c594f479B4d47001F8E6A95A7aDDa42bC"
    const TOKEN_2_ADDRESS = "0xfb5B838b6cfEEdC2873aB27866079AC55363D37E"

    const createPairEstimatedGas = await publicClient.estimateContractGas({
        account,
        abi: factoryContractAbi,
        address: BNB_FACTORY_ADDRESS,
        functionName: 'createPair',
        args: [TOKEN_1_ADDRESS, TOKEN_2_ADDRESS]
    });

    console.log("create pair gas estimate: ", formatUnits(createPairEstimatedGas, 18));

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

    console.log("deploy router gas estimate: ", formatUnits(deployRouterEstimatedGas, 18) )

    const SWAP_TOKEN_1_ADDRESS = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d"
    const SWAP_TOKEN_2_ADDRESS = "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82"

    const amountIn = parseUnits('0.1', 18);
    const amountOutMin = parseUnits('0.04', 18);
    const swapPath = [SWAP_TOKEN_1_ADDRESS, SWAP_TOKEN_2_ADDRESS];

    const approveResult = await client.writeContract({
        address: SWAP_TOKEN_1_ADDRESS,
        abi: erc20Abi,
        functionName: 'approve',
        args: [BNB_ROUTER_ADDRESS, amountIn]
    })

    const approveRx = await publicClient.waitForTransactionReceipt({ hash: approveResult, confirmations: 1 });

    console.log("token approve gas used: ", formatUnits(approveRx.gasUsed, 18))

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

    console.log("swap tokens gas estimate: ", formatUnits(callSwapEstimatedGas, 18));

    const totalGasBigInt = deployFactoryEstimatedGas + createPairEstimatedGas + deployRouterEstimatedGas + approveRx.gasUsed + callSwapEstimatedGas;
    const totalGas = formatUnits(totalGasBigInt, 18);

    console.log(`TCO (Swap Tokens): ${totalGas}`)
}

estimateSwapContractsGas().catch(console.error)